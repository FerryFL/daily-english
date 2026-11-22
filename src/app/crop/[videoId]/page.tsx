import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { getDb, isDbConfigured } from "@/db";
import { progress } from "@/db/schema";
import { getOptionalUser } from "@/lib/supabase/server";
import { TranscriptError } from "@/lib/transcript";
import { getOrFetchVideo } from "@/lib/video-service";
import { isValidVideoId } from "@/lib/youtube";
import { VideoCropper } from "@/components/video-cropper";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import CropLoading from "./loading";

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

async function CropContent({
  params,
}: {
  params: PageProps<"/crop/[videoId]">["params"];
}) {
  const user = await getOptionalUser();
  const { videoId } = await params;

  if (!isValidVideoId(videoId)) {
    return <ErrorView message="Invalid YouTube video ID." />;
  }

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/crop/${videoId}`)}`);
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
      : 0);

  if (effectiveDuration <= 0 || video.segments.length === 0) {
    return <ErrorView message="No usable English speech was found in this video's captions." />;
  }

  let initialStartSec: number | null = null;
  let initialEndSec: number | null = null;
  let hasExistingProgress = false;

  if (isDbConfigured()) {
    const db = getDb();
    const [prog] = await db
      .select({
        clipStartSec: progress.clipStartSec,
        clipEndSec: progress.clipEndSec,
        currentChunk: progress.currentChunk,
        completed: progress.completed,
      })
      .from(progress)
      .where(and(eq(progress.userId, user.id), eq(progress.videoId, videoId)))
      .limit(1);

    if (prog) {
      initialStartSec = prog.clipStartSec;
      initialEndSec = prog.clipEndSec;
      hasExistingProgress = prog.currentChunk > 0 || prog.completed;
    }
  }

  return (
    <VideoCropper
      videoId={video.id}
      title={video.title}
      channel={video.channel}
      durationSec={effectiveDuration}
      segments={video.segments}
      initialStartSec={initialStartSec}
      initialEndSec={initialEndSec}
      hasExistingProgress={hasExistingProgress}
    />
  );
}

export default function CropPage(props: PageProps<"/crop/[videoId]">) {
  return (
    <Suspense fallback={<CropLoading />}>
      <CropContent params={props.params} />
    </Suspense>
  );
}
