import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { getDb, isDbConfigured } from "@/db";
import { chunkAttempts, progress } from "@/db/schema";
import { buildChunks } from "@/lib/chunker";
import { MAX_VIDEO_DURATION_SEC, needsCrop, sliceSegments } from "@/lib/clip";
import { getOptionalUser } from "@/lib/supabase/server";
import { TranscriptError } from "@/lib/transcript";
import {
  ensureInitialProgress,
  getActiveDemoVideo,
  getOrFetchVideo,
} from "@/lib/video-service";
import { isValidVideoId } from "@/lib/youtube";
import { PracticeSession } from "@/components/practice-session";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import PracticeLoading from "./loading";

function ErrorView({ message }: { message: string }) {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-md rounded-2xl">
        <CardContent className="flex flex-col items-center space-y-4 p-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
            <AlertCircle className="size-6" />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Cannot load this video</h1>
            <p className="text-sm text-muted-foreground">{message}</p>
          </div>
          <Button asChild variant="outline" className="rounded-md">
            <Link href="/">
              <ArrowLeft className="size-4" />
              Back to dashboard
            </Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

async function PracticeContent({
  params,
}: {
  params: PageProps<"/practice/[videoId]">["params"];
}) {
  const user = await getOptionalUser();
  const { videoId } = await params;

  if (!isValidVideoId(videoId)) {
    return <ErrorView message="Invalid YouTube video ID." />;
  }

  const isDemo = !user;
  let demoClip: { startSec: number; endSec: number } | null = null;
  if (isDemo) {
    const activeDemo = await getActiveDemoVideo();
    if (videoId !== activeDemo.id) {
      redirect(`/login?next=${encodeURIComponent(`/practice/${videoId}`)}`);
    }
    if (
      activeDemo.clipStartSec !== null &&
      activeDemo.clipEndSec !== null &&
      activeDemo.clipEndSec > activeDemo.clipStartSec &&
      activeDemo.clipEndSec - activeDemo.clipStartSec <= MAX_VIDEO_DURATION_SEC
    ) {
      demoClip = {
        startSec: activeDemo.clipStartSec,
        endSec: activeDemo.clipEndSec,
      };
    }
  }

  let video;
  try {
    video = await getOrFetchVideo(videoId);
  } catch (err) {
    const msg =
      err instanceof TranscriptError
        ? err.message
        : "Failed to load captions for this video. Please try another one.";
    return <ErrorView message={msg} />;
  }

  const effectiveDuration =
    video.durationSec ??
    (video.segments.length > 0
      ? Math.ceil(Math.max(...video.segments.map((s) => s.start + s.dur)))
      : null);

  let initialChunkIndex = 0;
  let initialCompleted = false;
  let initialRecords: {
    chunkIndex: number;
    blanksTotal: number;
    blanksCorrect: number;
    revealedCount: number;
    missedWords: string[];
  }[] = [];
  let progRow: {
    currentChunk: number;
    completed: boolean;
    clipStartSec: number | null;
    clipEndSec: number | null;
  } | null = null;

  if (user && isDbConfigured()) {
    const db = getDb();
    const [[prog], attemptRows] = await Promise.all([
      db
        .select({
          currentChunk: progress.currentChunk,
          completed: progress.completed,
          clipStartSec: progress.clipStartSec,
          clipEndSec: progress.clipEndSec,
        })
        .from(progress)
        .where(and(eq(progress.userId, user.id), eq(progress.videoId, videoId)))
        .limit(1),
      db
        .select()
        .from(chunkAttempts)
        .where(and(eq(chunkAttempts.userId, user.id), eq(chunkAttempts.videoId, videoId)))
        .orderBy(asc(chunkAttempts.createdAt)),
    ]);

    if (prog) {
      progRow = prog;
      initialChunkIndex = prog.currentChunk;
      initialCompleted = prog.completed;
    }

    initialRecords = attemptRows.map((a) => ({
      chunkIndex: a.chunkIndex,
      blanksTotal: a.blanksTotal,
      blanksCorrect: a.blanksCorrect,
      revealedCount: a.revealedCount,
      missedWords: a.missedWords,
    }));
  }

  const hasValidUserClip =
    progRow?.clipStartSec != null &&
    progRow?.clipEndSec != null &&
    progRow.clipEndSec > progRow.clipStartSec &&
    progRow.clipEndSec - progRow.clipStartSec <= MAX_VIDEO_DURATION_SEC;

  const clipRange = isDemo
    ? demoClip
    : hasValidUserClip
      ? { startSec: progRow!.clipStartSec!, endSec: progRow!.clipEndSec! }
      : null;

  if (needsCrop(effectiveDuration) && !clipRange) {
    if (user) {
      redirect(`/crop/${videoId}`);
    }
    return (
      <ErrorView message="This video is longer than 15 minutes and must be cropped before practicing." />
    );
  }

  const effectiveSegments = clipRange
    ? sliceSegments(video.segments, clipRange.startSec, clipRange.endSec)
    : video.segments;

  const chunks = buildChunks(effectiveSegments);
  if (chunks.length === 0) {
    return <ErrorView message="No usable English speech was found in this video's captions." />;
  }

  if (user && isDbConfigured() && !progRow) {
    await ensureInitialProgress(user.id, videoId, chunks.length);
  }

  return (
    <PracticeSession
      videoId={video.id}
      title={video.title}
      isAutoGenerated={video.isAutoGenerated}
      chunks={chunks}
      initialChunkIndex={initialChunkIndex}
      initialCompleted={initialCompleted}
      initialRecords={initialRecords}
      isDemo={isDemo}
      clipRange={clipRange}
    />
  );
}

export default function PracticePage(props: PageProps<"/practice/[videoId]">) {
  return (
    <Suspense fallback={<PracticeLoading />}>
      <PracticeContent params={props.params} />
    </Suspense>
  );
}
