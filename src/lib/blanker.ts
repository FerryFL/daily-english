import { STOPWORDS } from "./stopwords";

export interface WordToken {
  kind: "word";
  text: string; // original token as displayed
}

export interface BlankToken {
  kind: "blank";
  id: number; // blank index within the chunk
  answer: string; // the word to type (no surrounding punctuation)
  prefix: string; // leading punctuation, e.g. a quote
  suffix: string; // trailing punctuation, e.g. "," or "."
}

export type Token = WordToken | BlankToken;

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic PRNG (mulberry32). */
export function seededRandom(seed: string): () => number {
  let a = hashString(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPLIT_RE = /^([^A-Za-z0-9']*)(.*?)([^A-Za-z0-9']*)$/;

function splitPunct(token: string) {
  const m = token.match(SPLIT_RE)!;
  return { prefix: m[1], core: m[2], suffix: m[3] };
}

function isCandidate(core: string): boolean {
  if (!/^[A-Za-z][A-Za-z'-]*[A-Za-z]$/.test(core)) return false;
  if (core.length < 3) return false;
  return !STOPWORDS.has(core.toLowerCase().replace(/’/g, "'"));
}

/**
 * Turn a chunk's text into tokens with 1–2 blanks on meaningful words.
 * Deterministic for a given seed (e.g. `${videoId}:${chunkIndex}`).
 */
export function makeBlanks(text: string, seed: string): Token[] {
  const raw = text.split(/\s+/).filter(Boolean);
  const parts = raw.map(splitPunct);
  const rand = seededRandom(seed);

  const wanted = raw.length < 8 ? 1 : 2;

  let candidates = parts
    .map((p, i) => ({ i, len: p.core.length, ok: isCandidate(p.core) }))
    .filter((c) => c.ok);

  // Fallback: no meaningful words → use the longest alphabetic word.
  if (candidates.length === 0) {
    const alpha = parts
      .map((p, i) => ({ i, len: p.core.length, ok: /^[A-Za-z'-]{2,}$/.test(p.core) }))
      .filter((c) => c.ok);
    if (alpha.length === 0) return raw.map((t) => ({ kind: "word", text: t }));
    candidates = [alpha.sort((a, b) => b.len - a.len)[0]];
  }

  // Prefer longer words: take the top pool by length, then choose randomly.
  const pool = [...candidates].sort((a, b) => b.len - a.len).slice(0, Math.max(wanted, 5));
  const chosen = new Set<number>();
  while (chosen.size < Math.min(wanted, pool.length)) {
    const pick = pool[Math.floor(rand() * pool.length)];
    // Avoid two adjacent blanks when possible.
    const adjacent = chosen.has(pick.i - 1) || chosen.has(pick.i + 1);
    if (!chosen.has(pick.i) && (!adjacent || pool.length <= wanted + 1)) chosen.add(pick.i);
  }

  let blankId = 0;
  return raw.map((tok, i): Token => {
    if (!chosen.has(i)) return { kind: "word", text: tok };
    const { prefix, core, suffix } = parts[i];
    return { kind: "blank", id: blankId++, answer: core, prefix, suffix };
  });
}
