"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, isDbConfigured } from "@/db";
import { settings, videos } from "@/db/schema";
import { isAdminEmail } from "@/lib/demo";
import { createClient } from "@/lib/supabase/server";
import { DEMO_SETTING_KEY } from "@/lib/video-service";
import { isValidVideoId } from "@/lib/youtube";

export async function setDemoVideo(videoId: string): Promise<{ ok: boolean; error?: string }> {
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
  const [exists] = await db
    .select({ id: videos.id })
    .from(videos)
    .where(eq(videos.id, videoId))
    .limit(1);

  if (!exists) {
    return { ok: false, error: "Video not found in uploaded videos." };
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

  revalidatePath("/");
  revalidatePath("/admin");
  return { ok: true };
}
