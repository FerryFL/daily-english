import type { Segment } from "./chunker";

export const MAX_VIDEO_DURATION_SEC = 15 * 60; // 15 minutes
export const MIN_CLIP_DURATION_SEC = 10; // 10 seconds
export const DEFAULT_CLIP_DURATION_SEC = 5 * 60; // 5 minutes

export function needsCrop(durationSec: number | null): boolean {
  return durationSec !== null && durationSec > MAX_VIDEO_DURATION_SEC;
}

/**
 * Filter transcript segments to those starting within `[startSec, endSec)`
 * and clamp trailing segment durations so playback stays inside `endSec`.
 */
export function sliceSegments(
  segments: Segment[],
  startSec: number,
  endSec: number,
): Segment[] {
  if (endSec <= startSec) return [];
  return segments
    .filter((s) => s.start >= startSec && s.start < endSec)
    .map((s) => {
      const maxDur = Math.max(0, endSec - s.start);
      return s.dur > maxDur ? { ...s, dur: maxDur } : s;
    });
}

export interface ClipValidationResult {
  valid: boolean;
  error?: string;
  startSec: number;
  endSec: number;
}

export function validateClipRange(
  rawStart: number,
  rawEnd: number,
  durationSec: number | null,
): ClipValidationResult {
  const startSec = Math.round(rawStart);
  const endSec = Math.round(rawEnd);

  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) {
    return { valid: false, error: "Invalid start or end time.", startSec: 0, endSec: 0 };
  }

  if (startSec < 0) {
    return { valid: false, error: "Start time cannot be negative.", startSec, endSec };
  }

  if (durationSec !== null && endSec > durationSec) {
    return {
      valid: false,
      error: "End time exceeds the video duration.",
      startSec,
      endSec,
    };
  }

  const clipLen = endSec - startSec;
  const minLen =
    durationSec !== null ? Math.min(MIN_CLIP_DURATION_SEC, durationSec) : MIN_CLIP_DURATION_SEC;

  if (clipLen < minLen) {
    return {
      valid: false,
      error: `Clip must be at least ${minLen} seconds long.`,
      startSec,
      endSec,
    };
  }

  if (clipLen > MAX_VIDEO_DURATION_SEC) {
    return {
      valid: false,
      error: "Clip cannot be longer than 15 minutes.",
      startSec,
      endSec,
    };
  }

  return { valid: true, startSec, endSec };
}

/** Format seconds into `MM:SS` or `H:MM:SS`. */
export function formatTimestamp(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Parse `H:MM:SS`, `MM:SS`, or plain seconds string into integer seconds.
 * Returns `null` if the string is invalid.
 */
export function parseTimestamp(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  const parts = trimmed.split(":");
  if (parts.length !== 2 && parts.length !== 3) return null;
  if (!parts.every((p) => /^\d+$/.test(p))) return null;

  const nums = parts.map(Number);
  if (parts.length === 2) {
    const [m, s] = nums;
    if (s >= 60) return null;
    return m * 60 + s;
  }

  const [h, m, s] = nums;
  if (m >= 60 || s >= 60) return null;
  return h * 3600 + m * 60 + s;
}
