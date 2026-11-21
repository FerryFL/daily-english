"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, isDbConfigured } from "@/db";
import { chunkAttempts, progress } from "@/db/schema";
import { createClient } from "@/lib/supabase/server";

export interface SaveChunkInput {
  videoId: string;
  chunkIndex: number;
  totalChunks: number;
  blanksTotal: number;
  blanksCorrect: number;
  revealedCount: number;
  attempts: number;
  missedWords: string[];
  isLastChunk: boolean;
}

export async function saveChunkResult(input: SaveChunkInput) {
  if (!isDbConfigured()) return { ok: false };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const db = getDb();
  const nextChunk = input.isLastChunk
    ? input.totalChunks - 1
    : Math.min(input.chunkIndex + 1, input.totalChunks - 1);

  await Promise.all([
    db.insert(chunkAttempts).values({
      userId: user.id,
      videoId: input.videoId,
      chunkIndex: input.chunkIndex,
      blanksTotal: input.blanksTotal,
      blanksCorrect: input.blanksCorrect,
      revealedCount: input.revealedCount,
      attempts: input.attempts,
      missedWords: input.missedWords,
    }),
    db
      .insert(progress)
      .values({
        userId: user.id,
        videoId: input.videoId,
        currentChunk: nextChunk,
        totalChunks: input.totalChunks,
        completed: input.isLastChunk,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [progress.userId, progress.videoId],
        set: {
          currentChunk: sql`GREATEST(${progress.currentChunk}, ${nextChunk})`,
          totalChunks: input.totalChunks,
          completed: sql`${progress.completed} OR ${input.isLastChunk}`,
          updatedAt: new Date(),
        },
      }),
  ]);

  revalidatePath("/");
  return { ok: true };
}

export async function resetVideoProgress(videoId: string, totalChunks: number) {
  if (!isDbConfigured()) return { ok: false };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const db = getDb();
  await db
    .update(progress)
    .set({
      currentChunk: 0,
      totalChunks,
      completed: false,
      updatedAt: new Date(),
    })
    .where(and(eq(progress.userId, user.id), eq(progress.videoId, videoId)));

  revalidatePath("/");
  return { ok: true };
}
