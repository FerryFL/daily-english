"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, isDbConfigured } from "@/db";
import { settings, videos } from "@/db/schema";
import { buildChunks } from "@/lib/chunker";
import { needsCrop, sliceSegments, validateClipRange } from "@/lib/clip";
import { isAdminEmail } from "@/lib/demo";
import { createClient } from "@/lib/supabase/server";
import { DEMO_CLIP_SETTING_KEY, DEMO_SETTING_KEY } from "@/lib/video-service";
import { isValidVideoId } from "@/lib/youtube";

export interface DemoClipRange {
  startSec: number;
  endSec: number;
}

export async function setDemoVideo(
  videoId: string,
  clip: DemoClipRange | null = null,
): Promise<{ ok: boolean; error?: string }> {
  if (!isDbConfigured()) return { ok: false, error: "Database is not configured." };
  if (!isValidVideoId(videoId)) return { ok: false, error: "Invalid video ID." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    return { ok: false, error: "Forbidden: admin access required." };
  }

  const db = getDb();
  const [video] = await db
    .select({
      id: videos.id,
      durationSec: videos.durationSec,
      segments: videos.segments,
    })
    .from(videos)
    .where(eq(videos.id, videoId))
    .limit(1);

  if (!video) {
    return { ok: false, error: "Video not found in uploaded videos." };
  }

  const effectiveDuration =
    video.durationSec ??
    (video.segments.length > 0
      ? Math.ceil(Math.max(...video.segments.map((s) => s.start + s.dur)))
      : null);

  if (needsCrop(effectiveDuration) && !clip) {
    return {
      ok: false,
      error: "This video is longer than 15 minutes. Please select a cropped clip first.",
    };
  }

  let validatedClip: DemoClipRange | null = null;
  if (clip) {
    const check = validateClipRange(clip.startSec, clip.endSec, effectiveDuration);
    if (!check.valid) {
      return { ok: false, error: check.error ?? "Invalid clip range." };
    }
    const chunks = buildChunks(sliceSegments(video.segments, check.startSec, check.endSec));
    if (chunks.length === 0) {
      return {
        ok: false,
        error: "No English captions found in the selected clip range.",
      };
    }
    validatedClip = { startSec: check.startSec, endSec: check.endSec };
  }

  await db
    .insert(settings)
    .values({
      key: DEMO_SETTING_KEY,
      value: videoId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        value: videoId,
        updatedAt: new Date(),
      },
    });

  if (validatedClip) {
    await db
      .insert(settings)
      .values({
        key: DEMO_CLIP_SETTING_KEY,
        value: JSON.stringify(validatedClip),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: {
          value: JSON.stringify(validatedClip),
          updatedAt: new Date(),
        },
      });
  } else {
    await db.delete(settings).where(eq(settings.key, DEMO_CLIP_SETTING_KEY));
  }

  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath(`/practice/${videoId}`);
  return { ok: true };
}
