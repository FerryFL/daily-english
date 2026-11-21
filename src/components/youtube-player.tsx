"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Play } from "lucide-react";

export interface YouTubePlayerHandle {
  playSegment: (start: number, end: number, loop?: boolean) => void;
  setRate: (rate: number) => void;
  pause: () => void;
}

interface YTPlayer {
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  setPlaybackRate: (rate: number) => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
  unloadModule?: (moduleName: string) => void;
  setOption?: (module: string, option: string, value: unknown) => void;
  destroy: () => void;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement,
        opts: {
          host?: string;
          videoId: string;
          playerVars?: Record<string, number | string>;
          events?: {
            onReady?: () => void;
            onStateChange?: (e: { data: number }) => void;
            onApiChange?: () => void;
            onError?: (e: { data: number }) => void;
          };
        },
      ) => YTPlayer;
      PlayerState?: { PLAYING: number; PAUSED: number; ENDED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** Force YouTube embedded captions OFF even if the user enabled CC in their YouTube preferences. */
function forceDisableCaptions(player: YTPlayer | null) {
  if (!player) return;
  try {
    player.unloadModule?.("captions");
    player.unloadModule?.("cc");
    player.setOption?.("captions", "track", {});
    player.setOption?.("cc", "track", {});
  } catch {
    // ignore if captions module is not loaded yet
  }
}

let apiPromise: Promise<void> | null = null;
function loadYouTubeApi(timeoutMs = 8000): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<void>((resolve, reject) => {
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
      apiPromise = null;
      reject(new Error("YouTube IFrame API failed to load"));
    };

    // Fallback poll in case the script was already loaded before this promise attached (e.g. HMR).
    const checkId = setInterval(() => {
      if (window.YT?.Player) finish();
    }, 100);

    const timerId = setTimeout(fail, timeoutMs);

    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      finish();
    };

    const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (!existing) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = fail;
      document.head.appendChild(script);
    }
  });
  return apiPromise;
}

interface YouTubePlayerProps {
  videoId: string;
  onReady?: () => void;
  onPlayingChange?: (playing: boolean) => void;
  onSegmentEnd?: () => void;
}

interface ActiveSegment {
  start: number;
  end: number;
  loop: boolean;
}

export const YouTubePlayer = forwardRef<YouTubePlayerHandle, YouTubePlayerProps>(
  function YouTubePlayer({ videoId, onReady, onPlayingChange, onSegmentEnd }, ref) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const playerRef = useRef<YTPlayer | null>(null);
    const segmentRef = useRef<ActiveSegment | null>(null);
    const rateRef = useRef<number>(1);
    const pendingRef = useRef<ActiveSegment | null>(null);
    const [ready, setReady] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [embedError, setEmbedError] = useState<string | null>(null);

    const callbacksRef = useRef({ onReady, onPlayingChange, onSegmentEnd });
    useEffect(() => {
      callbacksRef.current = { onReady, onPlayingChange, onSegmentEnd };
    });

    useEffect(() => {
      let cancelled = false;
      let pollId: ReturnType<typeof setInterval> | null = null;
      let createdPlayer: YTPlayer | null = null;

      let readyTimeoutId: ReturnType<typeof setTimeout> | null = null;

      loadYouTubeApi()
        .then(() => {
          if (cancelled || !hostRef.current || !window.YT?.Player) return;

          // Dedicated mount node so React never conflicts with YouTube's iframe swap.
          const target = document.createElement("div");
          hostRef.current.innerHTML = "";
          hostRef.current.appendChild(target);

          readyTimeoutId = setTimeout(() => {
            if (!cancelled && !playerRef.current) {
              setReady(true);
              setEmbedError(
                "YouTube player did not respond. If you use Firefox/Zen Tracking Protection or an ad blocker, allow YouTube embeds and refresh.",
              );
            }
          }, 8000);

          createdPlayer = new window.YT.Player(target, {
            videoId,
            playerVars: {
              autoplay: 1,
              enablejsapi: 1,
              controls: 0, // disable play/pause, timeline scrubbing, and settings
              disablekb: 1, // disable YouTube keyboard shortcuts
              fs: 0, // disable fullscreen button
              rel: 0,
              modestbranding: 1,
              cc_load_policy: 0, // captions off by default
              iv_load_policy: 3, // hide video annotations
              playsinline: 1,
              origin: window.location.origin,
            },
            events: {
              onReady: () => {
                if (cancelled || !createdPlayer) return;
                if (readyTimeoutId) clearTimeout(readyTimeoutId);
                playerRef.current = createdPlayer;
                forceDisableCaptions(createdPlayer);
                createdPlayer.setPlaybackRate(rateRef.current);
                setEmbedError(null);
                setReady(true);
                callbacksRef.current.onReady?.();
                if (pendingRef.current) {
                  const seg = pendingRef.current;
                  pendingRef.current = null;
                  segmentRef.current = seg;
                  createdPlayer.seekTo(Math.max(0, seg.start), true);
                  createdPlayer.playVideo();
                }
              },
              onApiChange: () => {
                if (cancelled || !createdPlayer) return;
                forceDisableCaptions(createdPlayer);
              },
              onStateChange: (e) => {
                if (cancelled || !createdPlayer) return;
                const isNowPlaying = e.data === (window.YT?.PlayerState?.PLAYING ?? 1);
                if (isNowPlaying) forceDisableCaptions(createdPlayer);
                setPlaying(isNowPlaying);
                callbacksRef.current.onPlayingChange?.(isNowPlaying);
                // If the video naturally reached its end while looping the last chunk, restart chunk.
                if (e.data === (window.YT?.PlayerState?.ENDED ?? 0)) {
                  const seg = segmentRef.current;
                  if (seg?.loop) {
                    createdPlayer.seekTo(Math.max(0, seg.start), true);
                    createdPlayer.playVideo();
                  }
                }
              },
              onError: (e) => {
                if (cancelled) return;
                if (readyTimeoutId) clearTimeout(readyTimeoutId);
                setReady(true);
                setEmbedError(
                  e.data === 101 || e.data === 150
                    ? "This video cannot be embedded by its owner."
                    : "YouTube player failed to load this video.",
                );
              },
            },
          });

          pollId = setInterval(() => {
            const p = playerRef.current;
            const seg = segmentRef.current;
            if (!p || !seg) return;
            if (p.getPlayerState?.() === (window.YT?.PlayerState?.PLAYING ?? 1)) {
              if (p.getCurrentTime() >= seg.end) {
                if (seg.loop) {
                  // Unlimited auto-loop back to the beginning of the current chunk.
                  p.seekTo(Math.max(0, seg.start), true);
                  p.playVideo();
                } else {
                  segmentRef.current = null;
                  p.pauseVideo();
                  callbacksRef.current.onSegmentEnd?.();
                }
              }
            }
          }, 100);
        })
        .catch(() => {
          if (cancelled) return;
          setReady(true);
          setEmbedError(
            "Could not load YouTube player script. Check your browser's Tracking Protection / AdBlocker and refresh.",
          );
        });

      return () => {
        cancelled = true;
        if (pollId) clearInterval(pollId);
        if (readyTimeoutId) clearTimeout(readyTimeoutId);
        try {
          createdPlayer?.destroy();
        } catch {
          // ignore cleanup errors if iframe was already torn down
        }
        if (playerRef.current === createdPlayer) {
          playerRef.current = null;
        }
      };
    }, [videoId]);

    useImperativeHandle(ref, () => ({
      playSegment(start: number, end: number, loop = true) {
        const seg: ActiveSegment = { start: Math.max(0, start), end, loop };
        const p = playerRef.current;
        if (!p) {
          pendingRef.current = seg;
          return;
        }
        segmentRef.current = seg;
        p.setPlaybackRate(rateRef.current);
        p.seekTo(seg.start, true);
        p.playVideo();
      },
      setRate(rate: number) {
        rateRef.current = rate;
        playerRef.current?.setPlaybackRate(rate);
      },
      pause() {
        segmentRef.current = null;
        playerRef.current?.pauseVideo();
      },
    }));

    const handleTogglePlayPause = () => {
      const p = playerRef.current;
      if (!p || !ready) return;
      if (p.getPlayerState?.() === (window.YT?.PlayerState?.PLAYING ?? 1)) {
        p.pauseVideo();
      } else {
        p.playVideo();
      }
    };

    return (
      <div className="relative aspect-video w-full select-none overflow-hidden rounded-2xl border bg-black shadow-sm">
        <div
          ref={hostRef}
          className="pointer-events-none size-full [&>iframe]:pointer-events-none [&>iframe]:size-full"
          aria-label="YouTube video player"
        />
        {/* Click shield: allows only play/pause, blocking scrubbing, captions, and all YouTube controls */}
        {!embedError && (
          <button
            type="button"
            onClick={handleTogglePlayPause}
            aria-label={playing ? "Pause video" : "Play video"}
            className="absolute inset-0 z-10 flex cursor-pointer items-center justify-center bg-transparent transition-colors hover:bg-black/10 focus:outline-none"
          >
            {ready && !playing && (
              <span className="flex size-14 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur-sm transition-transform hover:scale-105">
                <Play className="ml-0.5 size-6 fill-current" />
              </span>
            )}
          </button>
        )}
        {embedError && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/80 p-4 text-center text-sm text-rose-400">
            {embedError}
          </div>
        )}
        {!ready && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/60 text-sm text-white/80">
            Loading player...
          </div>
        )}
      </div>
    );
  },
);
