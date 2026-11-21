"use client";

let audioCtx: AudioContext | null = null;
let trimmedBuffer: AudioBuffer | null = null;
let loadingPromise: Promise<AudioBuffer | null> | null = null;

const MAX_CLICK_DURATION_SEC = 0.09; // ~90ms crisp click
const SILENCE_THRESHOLD = 0.015;
const CLICK_VOLUME = 0.35;

/** Trim leading silence and slice to a short, crisp click with a gentle fade-out. */
function trimClickBuffer(ctx: AudioContext, raw: AudioBuffer): AudioBuffer {
  const sampleRate = raw.sampleRate;
  const channels = raw.numberOfChannels;
  const ch0 = raw.getChannelData(0);

  // Find first non-silent sample.
  let startSample = 0;
  for (let i = 0; i < ch0.length; i++) {
    if (Math.abs(ch0[i]) >= SILENCE_THRESHOLD) {
      startSample = Math.max(0, i - Math.floor(sampleRate * 0.002));
      break;
    }
  }

  const maxSamples = Math.floor(sampleRate * MAX_CLICK_DURATION_SEC);
  const length = Math.max(1, Math.min(maxSamples, raw.length - startSample));
  const out = ctx.createBuffer(channels, length, sampleRate);
  const fadeSamples = Math.min(Math.floor(sampleRate * 0.015), Math.floor(length / 3));

  for (let c = 0; c < channels; c++) {
    const src = raw.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < length; i++) {
      let sample = src[startSample + i] ?? 0;
      const remaining = length - 1 - i;
      if (remaining < fadeSamples) {
        sample *= remaining / fadeSamples;
      }
      dst[i] = sample;
    }
  }

  return out;
}

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  return audioCtx;
}

async function loadClickBuffer(ctx: AudioContext): Promise<AudioBuffer | null> {
  if (trimmedBuffer) return trimmedBuffer;
  loadingPromise ??= fetch("/click.mp3")
    .then((res) => (res.ok ? res.arrayBuffer() : null))
    .then((arr) => (arr ? ctx.decodeAudioData(arr) : null))
    .then((decoded) => {
      if (decoded) trimmedBuffer = trimClickBuffer(ctx, decoded);
      return trimmedBuffer;
    })
    .catch(() => null);
  return loadingPromise;
}

/** Preload `/click.mp3` so the first keystroke has zero latency. */
export function preloadClickSound(): void {
  const ctx = getContext();
  if (ctx) void loadClickBuffer(ctx);
}

/** Play the trimmed click sound with zero latency and overlap support. */
export function playClickSound(): void {
  const ctx = getContext();
  if (!ctx) return;

  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => {});
  }

  const play = (buf: AudioBuffer | null) => {
    if (!buf) return;
    try {
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      gain.gain.value = CLICK_VOLUME;
      source.buffer = buf;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start(0);
    } catch {
      // ignore playback errors
    }
  };

  if (trimmedBuffer) {
    play(trimmedBuffer);
  } else {
    void loadClickBuffer(ctx).then(play);
  }
}
