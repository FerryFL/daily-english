"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Clock,
  Loader2,
  Play,
  Scissors,
  Square,
} from "lucide-react";
import { toast } from "sonner";
import { saveVideoClip } from "@/app/crop/actions";
import { buildChunks, type Segment } from "@/lib/chunker";
import {
  DEFAULT_CLIP_DURATION_SEC,
  formatTimestamp,
  MAX_VIDEO_DURATION_SEC,
  MIN_CLIP_DURATION_SEC,
  parseTimestamp,
  sliceSegments,
  validateClipRange,
} from "@/lib/clip";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface YTPreviewPlayer {
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
  destroy: () => void;
}

let ytApiPromise: Promise<void> | null = null;
function loadYouTubeApi(timeoutMs = 8000): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearInterval(checkId);
      clearTimeout(timerId);
      resolve();
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      clearInterval(checkId);
      clearTimeout(timerId);
      ytApiPromise = null;
      reject(new Error("YouTube IFrame API failed to load"));
    };

    const checkId = setInterval(() => {
      if (window.YT?.Player) finish();
    }, 100);
    const timerId = setTimeout(fail, timeoutMs);

    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      finish();
    };

    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = fail;
      document.head.appendChild(script);
    }
  });
  return ytApiPromise;
}

interface VideoCropperProps {
  videoId: string;
  title: string;
  channel: string | null;
  durationSec: number;
  segments: Segment[];
  initialStartSec?: number | null;
  initialEndSec?: number | null;
  hasExistingProgress?: boolean;
}

type DragMode = "start" | "end" | "window" | null;

export function VideoCropper({
  videoId,
  title,
  channel,
  durationSec,
  segments,
  initialStartSec,
  initialEndSec,
  hasExistingProgress = false,
}: VideoCropperProps) {
  const router = useRouter();
  const minClipLen = Math.min(MIN_CLIP_DURATION_SEC, durationSec);
  const maxClipLen = Math.min(MAX_VIDEO_DURATION_SEC, durationSec);

  const defaultStart =
    initialStartSec != null && initialStartSec >= 0 && initialStartSec < durationSec
      ? Math.round(initialStartSec)
      : 0;
  const defaultEnd =
    initialEndSec != null &&
    initialEndSec > defaultStart &&
    initialEndSec <= durationSec &&
    initialEndSec - defaultStart <= MAX_VIDEO_DURATION_SEC
      ? Math.round(initialEndSec)
      : Math.min(durationSec, defaultStart + DEFAULT_CLIP_DURATION_SEC);

  const [startSec, setStartSec] = useState(defaultStart);
  const [endSec, setEndSec] = useState(defaultEnd);
  const [startText, setStartText] = useState(formatTimestamp(defaultStart));
  const [endText, setEndText] = useState(formatTimestamp(defaultEnd));
  const [currentTime, setCurrentTime] = useState(defaultStart);
  const [playerReady, setPlayerReady] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPreviewPlayer | null>(null);
  const previewBoundsRef = useRef<{ end: number } | null>(null);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    mode: DragMode;
    originX: number;
    origStart: number;
    origEnd: number;
  }>({ mode: null, originX: 0, origStart: 0, origEnd: 0 });

  // Sync text inputs when slider or buttons change numeric range.
  const applyRange = useCallback(
    (nextStart: number, nextEnd: number, seekToSec?: number) => {
      const clampedStart = Math.max(0, Math.min(Math.round(nextStart), durationSec - minClipLen));
      let clampedEnd = Math.max(clampedStart + minClipLen, Math.min(Math.round(nextEnd), durationSec));
      if (clampedEnd - clampedStart > maxClipLen) {
        clampedEnd = Math.min(durationSec, clampedStart + maxClipLen);
      }
      setStartSec(clampedStart);
      setEndSec(clampedEnd);
      setStartText(formatTimestamp(clampedStart));
      setEndText(formatTimestamp(clampedEnd));
      setError(null);
      if (seekToSec !== undefined && playerRef.current) {
        playerRef.current.seekTo(seekToSec, true);
        setCurrentTime(seekToSec);
      }
    },
    [durationSec, maxClipLen, minClipLen],
  );

  // Initialize interactive YouTube preview player.
  useEffect(() => {
    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | null = null;
    let created: YTPreviewPlayer | null = null;

    loadYouTubeApi()
      .then(() => {
        if (cancelled || !hostRef.current || !window.YT?.Player) return;
        const target = document.createElement("div");
        hostRef.current.innerHTML = "";
        hostRef.current.appendChild(target);

        created = new window.YT.Player(target, {
          videoId,
          playerVars: {
            autoplay: 0,
            controls: 1,
            enablejsapi: 1,
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            start: defaultStart,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              if (cancelled || !created) return;
              playerRef.current = created;
              setPlayerReady(true);
            },
            onStateChange: (e) => {
              if (cancelled) return;
              const playing = e.data === (window.YT?.PlayerState?.PLAYING ?? 1);
              if (!playing && previewBoundsRef.current) {
                previewBoundsRef.current = null;
                setPreviewing(false);
              }
            },
          },
        }) as unknown as YTPreviewPlayer;

        pollId = setInterval(() => {
          const p = playerRef.current;
          if (!p) return;
          const t = p.getCurrentTime?.();
          if (typeof t === "number" && Number.isFinite(t)) {
            setCurrentTime(t);
            const bounds = previewBoundsRef.current;
            if (bounds && t >= bounds.end) {
              previewBoundsRef.current = null;
              setPreviewing(false);
              p.pauseVideo();
            }
          }
        }, 200);
      })
      .catch(() => {
        // Player preview is optional; user can still crop by timestamps.
      });

    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
      try {
        created?.destroy();
      } catch {
        // ignore cleanup errors
      }
      if (playerRef.current === created) playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  // Compute live chunks & first caption preview for selected range.
  const slicedChunks = useMemo(() => {
    const sliced = sliceSegments(segments, startSec, endSec);
    return buildChunks(sliced);
  }, [segments, startSec, endSec]);

  const clipDuration = endSec - startSec;
  const validation = useMemo(
    () => validateClipRange(startSec, endSec, durationSec),
    [startSec, endSec, durationSec],
  );

  // Pointer drag handlers for the custom dual-handle timeline.
  const startDrag = (mode: DragMode, e: React.PointerEvent<HTMLElement>) => {
    if (!trackRef.current) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      mode,
      originX: e.clientX,
      origStart: startSec,
      origEnd: endSec,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const { mode, originX, origStart, origEnd } = dragRef.current;
    if (!mode || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;

    const deltaSec = Math.round(((e.clientX - originX) / rect.width) * durationSec);

    if (mode === "window") {
      const len = origEnd - origStart;
      const nextStart = Math.max(0, Math.min(durationSec - len, origStart + deltaSec));
      applyRange(nextStart, nextStart + len);
      return;
    }

    if (mode === "start") {
      const nextStart = Math.max(0, Math.min(durationSec - minClipLen, origStart + deltaSec));
      let nextEnd = origEnd;
      if (nextEnd - nextStart > maxClipLen) {
        nextEnd = Math.min(durationSec, nextStart + maxClipLen);
      } else if (nextEnd - nextStart < minClipLen) {
        nextEnd = Math.min(durationSec, nextStart + minClipLen);
      }
      applyRange(nextStart, nextEnd);
      return;
    }

    if (mode === "end") {
      const nextEnd = Math.max(minClipLen, Math.min(durationSec, origEnd + deltaSec));
      let nextStart = origStart;
      if (nextEnd - nextStart > maxClipLen) {
        nextStart = Math.max(0, nextEnd - maxClipLen);
      } else if (nextEnd - nextStart < minClipLen) {
        nextStart = Math.max(0, nextEnd - minClipLen);
      }
      applyRange(nextStart, nextEnd);
    }
  };

  const handlePointerUp = () => {
    const mode = dragRef.current.mode;
    if (!mode) return;
    dragRef.current.mode = null;
    if (playerRef.current) {
      const target = mode === "end" ? Math.max(startSec, endSec - 3) : startSec;
      playerRef.current.seekTo(target, true);
      setCurrentTime(target);
    }
  };

  const commitStartInput = () => {
    const parsed = parseTimestamp(startText);
    if (parsed === null) {
      setStartText(formatTimestamp(startSec));
      return;
    }
    const nextStart = Math.max(0, Math.min(parsed, durationSec - minClipLen));
    let nextEnd = endSec;
    if (nextEnd <= nextStart + minClipLen) {
      nextEnd = Math.min(durationSec, nextStart + Math.min(DEFAULT_CLIP_DURATION_SEC, maxClipLen));
    } else if (nextEnd - nextStart > maxClipLen) {
      nextEnd = Math.min(durationSec, nextStart + maxClipLen);
    }
    applyRange(nextStart, nextEnd, nextStart);
  };

  const commitEndInput = () => {
    const parsed = parseTimestamp(endText);
    if (parsed === null) {
      setEndText(formatTimestamp(endSec));
      return;
    }
    const nextEnd = Math.max(minClipLen, Math.min(parsed, durationSec));
    let nextStart = startSec;
    if (nextEnd - nextStart < minClipLen) {
      nextStart = Math.max(0, nextEnd - minClipLen);
    } else if (nextEnd - nextStart > maxClipLen) {
      nextStart = Math.max(0, nextEnd - maxClipLen);
    }
    applyRange(nextStart, nextEnd, Math.max(nextStart, nextEnd - 3));
  };

  const handleSetStartFromPlayer = () => {
    const t = Math.floor(playerRef.current?.getCurrentTime?.() ?? currentTime);
    const nextStart = Math.max(0, Math.min(t, durationSec - minClipLen));
    let nextEnd = endSec;
    if (nextEnd - nextStart < minClipLen || nextEnd - nextStart > maxClipLen) {
      nextEnd = Math.min(durationSec, nextStart + Math.min(DEFAULT_CLIP_DURATION_SEC, maxClipLen));
    }
    applyRange(nextStart, nextEnd);
  };

  const handleSetEndFromPlayer = () => {
    const t = Math.ceil(playerRef.current?.getCurrentTime?.() ?? currentTime);
    const nextEnd = Math.max(minClipLen, Math.min(t, durationSec));
    let nextStart = startSec;
    if (nextEnd - nextStart < minClipLen || nextEnd - nextStart > maxClipLen) {
      nextStart = Math.max(0, nextEnd - Math.min(DEFAULT_CLIP_DURATION_SEC, maxClipLen));
    }
    applyRange(nextStart, nextEnd);
  };

  const handlePresetDuration = (minutes: number) => {
    const targetLen = Math.min(minutes * 60, maxClipLen);
    let nextStart = startSec;
    let nextEnd = nextStart + targetLen;
    if (nextEnd > durationSec) {
      nextEnd = durationSec;
      nextStart = Math.max(0, nextEnd - targetLen);
    }
    applyRange(nextStart, nextEnd, nextStart);
  };

  const handleTogglePreview = () => {
    const p = playerRef.current;
    if (!p || !playerReady) return;
    if (previewing) {
      previewBoundsRef.current = null;
      setPreviewing(false);
      p.pauseVideo();
    } else {
      previewBoundsRef.current = { end: endSec };
      setPreviewing(true);
      p.seekTo(startSec, true);
      p.playVideo();
    }
  };

  const handleSubmit = async () => {
    setError(null);
    if (!validation.valid) {
      setError(validation.error ?? "Invalid clip range.");
      return;
    }
    if (slicedChunks.length === 0) {
      setError("No English captions were found in this section. Try adjusting the range.");
      return;
    }

    setSaving(true);
    try {
      const res = await saveVideoClip({ videoId, startSec, endSec });
      if (!res.ok) {
        setError(res.error ?? "Failed to save clip.");
        setSaving(false);
        return;
      }
      toast.success("Clip saved! Starting practice...");
      router.push(`/practice/${videoId}`);
    } catch {
      setError("Network error while saving clip. Please try again.");
      setSaving(false);
    }
  };

  const startPct = (startSec / durationSec) * 100;
  const endPct = (endSec / durationSec) * 100;
  const playheadPct = Math.max(0, Math.min(100, (currentTime / durationSec) * 100));

  return (
    <div className="flex min-h-svh flex-col">
      {/* Sticky top bar */}
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <Button asChild variant="ghost" size="icon-sm" className="shrink-0">
              <Link href="/" aria-label="Back to dashboard">
                <ArrowLeft className="size-4" />
              </Link>
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Scissors className="size-4 shrink-0 text-[#10B981]" />
                <h1 className="truncate text-sm font-semibold sm:text-base">Crop video</h1>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="secondary" className="font-mono text-xs">
              Total {formatTimestamp(durationSec)}
            </Badge>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        {/* Video info */}
        <div className="space-y-1">
          <h2 className="text-lg font-bold tracking-tight sm:text-xl">{title}</h2>
          <p className="text-sm text-muted-foreground">
            {channel ? `${channel} · ` : ""}
            This video is longer than 15 minutes. Select a section up to{" "}
            <span className="font-medium text-foreground">15 minutes</span> to practice.
          </p>
        </div>

        {/* YouTube Preview Player */}
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl border bg-black shadow-sm">
          <div
            ref={hostRef}
            className="size-full [&>iframe]:size-full"
            aria-label="YouTube preview player"
          />
          {!playerReady && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-white/80">
              Loading preview player...
            </div>
          )}
        </div>

        {/* Crop Controls Card */}
        <Card className="rounded-2xl">
          <CardContent className="space-y-6 p-5 sm:p-6">
            {/* Header row with selected duration + presets */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Clock className="size-4 text-[#10B981]" />
                <span className="text-sm font-semibold">
                  Selected clip:{" "}
                  <span className="font-mono text-[#10B981] dark:text-[#34D399]">
                    {formatTimestamp(clipDuration)}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">/ 15:00 max</span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs text-muted-foreground">Quick length:</span>
                {[5, 10, 15].map((mins) => (
                  <Button
                    key={mins}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handlePresetDuration(mins)}
                    className={cn(
                      "h-7 rounded-md px-2.5 text-xs",
                      clipDuration === mins * 60 &&
                        "border-[#10B981] bg-[#10B981]/10 text-[#10B981] dark:text-[#34D399]",
                    )}
                  >
                    {mins}m
                  </Button>
                ))}
              </div>
            </div>

            {/* Dual-handle Interactive Timeline */}
            <div className="space-y-2">
              <div
                ref={trackRef}
                className="relative h-12 w-full select-none rounded-xl bg-muted/80"
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              >
                {/* Playhead line */}
                <div
                  className="pointer-events-none absolute inset-y-1 z-10 w-0.5 bg-foreground/50"
                  style={{ left: `${playheadPct}%` }}
                />

                {/* Selected Window */}
                <div
                  role="slider"
                  tabIndex={0}
                  aria-label="Move selected clip window"
                  aria-valuemin={0}
                  aria-valuemax={durationSec}
                  aria-valuenow={startSec}
                  onPointerDown={(e) => startDrag("window", e)}
                  className="absolute inset-y-0 z-20 cursor-grab rounded-xl border-2 border-[#10B981] bg-[#10B981]/20 active:cursor-grabbing"
                  style={{
                    left: `${startPct}%`,
                    width: `${Math.max(1, endPct - startPct)}%`,
                  }}
                />

                {/* Start Handle */}
                <button
                  type="button"
                  aria-label="Drag clip start time"
                  onPointerDown={(e) => startDrag("start", e)}
                  className="absolute top-1/2 z-30 flex h-12 w-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-md bg-[#10B981] text-zinc-950 shadow-sm hover:bg-[#34D399]"
                  style={{ left: `${startPct}%` }}
                >
                  <span className="h-5 w-0.5 rounded-full bg-zinc-950/70" />
                </button>

                {/* End Handle */}
                <button
                  type="button"
                  aria-label="Drag clip end time"
                  onPointerDown={(e) => startDrag("end", e)}
                  className="absolute top-1/2 z-30 flex h-12 w-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-md bg-[#10B981] text-zinc-950 shadow-sm hover:bg-[#34D399]"
                  style={{ left: `${endPct}%` }}
                >
                  <span className="h-5 w-0.5 rounded-full bg-zinc-950/70" />
                </button>
              </div>

              <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground">
                <span>00:00</span>
                <span>Player: {formatTimestamp(currentTime)}</span>
                <span>{formatTimestamp(durationSec)}</span>
              </div>
            </div>

            {/* Start / End Inputs */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="clip-start" className="text-xs font-medium">
                    Start time
                  </Label>
                  <button
                    type="button"
                    onClick={handleSetStartFromPlayer}
                    disabled={!playerReady}
                    className="text-xs font-medium text-[#10B981] hover:underline disabled:opacity-40 dark:text-[#34D399]"
                  >
                    Use player time ({formatTimestamp(currentTime)})
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => applyRange(startSec - 10, endSec, Math.max(0, startSec - 10))}
                    className="h-9 px-2.5 font-mono text-xs"
                  >
                    -10s
                  </Button>
                  <Input
                    id="clip-start"
                    value={startText}
                    onChange={(e) => setStartText(e.target.value)}
                    onBlur={commitStartInput}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitStartInput();
                      }
                    }}
                    className="h-9 text-center font-mono text-sm"
                    aria-label="Clip start time"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      applyRange(
                        Math.min(startSec + 10, endSec - minClipLen),
                        endSec,
                        Math.min(startSec + 10, endSec - minClipLen),
                      )
                    }
                    className="h-9 px-2.5 font-mono text-xs"
                  >
                    +10s
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="clip-end" className="text-xs font-medium">
                    End time
                  </Label>
                  <button
                    type="button"
                    onClick={handleSetEndFromPlayer}
                    disabled={!playerReady}
                    className="text-xs font-medium text-[#10B981] hover:underline disabled:opacity-40 dark:text-[#34D399]"
                  >
                    Use player time ({formatTimestamp(currentTime)})
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      applyRange(
                        startSec,
                        Math.max(startSec + minClipLen, endSec - 10),
                        Math.max(startSec, endSec - 13),
                      )
                    }
                    className="h-9 px-2.5 font-mono text-xs"
                  >
                    -10s
                  </Button>
                  <Input
                    id="clip-end"
                    value={endText}
                    onChange={(e) => setEndText(e.target.value)}
                    onBlur={commitEndInput}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitEndInput();
                      }
                    }}
                    className="h-9 text-center font-mono text-sm"
                    aria-label="Clip end time"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const nextEnd = Math.min(durationSec, endSec + 10);
                      const nextStart =
                        nextEnd - startSec > maxClipLen ? nextEnd - maxClipLen : startSec;
                      applyRange(nextStart, nextEnd, Math.max(nextStart, nextEnd - 3));
                    }}
                    className="h-9 px-2.5 font-mono text-xs"
                  >
                    +10s
                  </Button>
                </div>
              </div>
            </div>

            {/* Live transcript / chunk summary */}
            <div className="rounded-xl border bg-muted/40 p-3.5 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {slicedChunks.length > 0
                    ? `${slicedChunks.length} listening ${slicedChunks.length === 1 ? "part" : "parts"} in this clip`
                    : "No English captions in this range"}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {formatTimestamp(startSec)} – {formatTimestamp(endSec)}
                </span>
              </div>
              {slicedChunks.length > 0 && (
                <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                  Starts with: &ldquo;{slicedChunks[0].text}&rdquo;
                </p>
              )}
            </div>

            {hasExistingProgress && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Note: You already have progress on this video. Saving a new clip range will reset
                your progress for this video.
              </p>
            )}

            {error && (
              <p className="flex items-center gap-1.5 text-sm text-rose-500 dark:text-rose-400">
                <AlertCircle className="size-4 shrink-0" />
                {error}
              </p>
            )}

            {/* Action buttons */}
            <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:items-center sm:justify-between">
              <Button
                type="button"
                variant="outline"
                onClick={handleTogglePreview}
                disabled={!playerReady}
                className="h-11 rounded-md"
              >
                {previewing ? (
                  <>
                    <Square className="size-4 fill-current" />
                    Stop preview
                  </>
                ) : (
                  <>
                    <Play className="size-4" />
                    Preview clip
                  </>
                )}
              </Button>

              <Button
                type="button"
                onClick={handleSubmit}
                disabled={saving || !validation.valid || slicedChunks.length === 0}
                className="h-11 rounded-md bg-[#10B981] px-6 font-semibold text-zinc-950 hover:bg-[#34D399]"
              >
                {saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Preparing session...
                  </>
                ) : (
                  <>
                    Start practice
                    <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
