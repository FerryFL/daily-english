"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, isDbConfigured } from "@/db";
import { chunkAttempts, progress } from "@/db/schema";
import { buildChunks } from "@/lib/chunker";
import { sliceSegments, validateClipRange } from "@/lib/clip";
import { createClient } from "@/lib/supabase/server";
import { getOrFetchVideo } from "@/lib/video-service";
import { isValidVideoId } from "@/lib/youtube";

export interface SaveClipInput {
  videoId: string;
  startSec: number;
  endSec: number;
}

export async function saveVideoClip(
  input: SaveClipInput,
): Promise<{ ok: boolean; error?: string }> {
  if (!isValidVideoId(input.videoId)) {
    return { ok: false, error: "Invalid YouTube video ID." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to save a clip." };
  }

  let video;
  try {
    video = await getOrFetchVideo(input.videoId);
  } catch {
    return { ok: false, error: "Could not load video captions. Please try again." };
  }

  const effectiveDuration =
    video.durationSec ??
    (video.segments.length > 0
      ? Math.ceil(Math.max(...video.segments.map((s) => s.start + s.dur)))
      : null);

  const check = validateClipRange(input.startSec, input.endSec, effectiveDuration);
  if (!check.valid) {
    return { ok: false, error: check.error };
  }

  const sliced = sliceSegments(video.segments, check.startSec, check.endSec);
  const chunks = buildChunks(sliced);
  if (chunks.length === 0) {
    return {
      ok: false,
      error: "No English captions were found in this time range. Please pick another section.",
    };
  }

  if (isDbConfigured()) {
    const db = getDb();
    await Promise.all([
      db
        .delete(chunkAttempts)
        .where(
          and(
            eq(chunkAttempts.userId, user.id),
            eq(chunkAttempts.videoId, input.videoId),
          ),
        ),
      db
        .insert(progress)
        .values({
          userId: user.id,
          videoId: input.videoId,
          currentChunk: 0,
          totalChunks: chunks.length,
          clipStartSec: check.startSec,
          clipEndSec: check.endSec,
          completed: false,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [progress.userId, progress.videoId],
          set: {
            currentChunk: 0,
            totalChunks: chunks.length,
            clipStartSec: check.startSec,
            clipEndSec: check.endSec,
            completed: false,
            updatedAt: new Date(),
          },
        }),
    ]);
  }

  revalidatePath("/");
  revalidatePath(`/practice/${input.videoId}`);
  return { ok: true };
}
