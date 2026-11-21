export interface Segment {
  start: number; // seconds
  dur: number; // seconds
  text: string;
}

export interface Chunk {
  index: number;
  start: number;
  end: number;
  text: string;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function decodeHtmlEntities(input: string): string {
  let out = input;
  // Run twice because YouTube timedtext XML often double-encodes entities (e.g. `&amp;#39;`).
  for (let pass = 0; pass < 2; pass++) {
    const next = out
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&[a-z]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e);
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Clean a raw caption line: decode entities, drop [Music]/(Applause), speaker markers, newlines. */
export function cleanCaption(text: string): string {
  return decodeHtmlEntities(text)
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ") // [Music], (Applause)
    .replace(/>>|♪|-{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SENTENCE_END = /[.?!…]["')\]]*$/;

function isPunctuated(segs: Segment[]): boolean {
  if (segs.length === 0) return false;
  const ends = segs.filter((s) => /[.?!]/.test(s.text)).length;
  return ends / segs.length > 0.1;
}

/**
 * Group caption segments into listening chunks of roughly `min`–`max` seconds.
 * Punctuated captions close on sentence ends; unpunctuated (auto) captions close near `target`.
 */
export function buildChunks(
  raw: Segment[],
  opts: { min?: number; max?: number; target?: number; pad?: number } = {},
): Chunk[] {
  const { min = 5, max = 10, target = 7, pad = 0.3 } = opts;

  const segs = raw
    .map((s) => ({ ...s, text: cleanCaption(s.text) }))
    .filter((s) => s.text.length > 0)
    .sort((a, b) => a.start - b.start);

  const punctuated = isPunctuated(segs);
  const chunks: Chunk[] = [];
  let cur: { start: number; end: number; parts: string[] } | null = null;

  const flush = () => {
    if (!cur) return;
    const text = cur.parts.join(" ").replace(/\s+/g, " ").trim();
    if (/[A-Za-z]/.test(text)) {
      chunks.push({ index: chunks.length, start: cur.start, end: cur.end, text });
    }
    cur = null;
  };

  segs.forEach((seg, i) => {
    const next = segs[i + 1];
    // Avoid overlapping into the next caption (auto captions overlap heavily).
    let segEnd = seg.start + seg.dur;
    if (next && next.start > seg.start) segEnd = Math.min(segEnd, next.start);

    if (!cur) cur = { start: seg.start, end: segEnd, parts: [] };
    cur.parts.push(seg.text);
    cur.end = Math.max(cur.end, segEnd);

    const dur = cur.end - cur.start;
    if (punctuated) {
      if ((dur >= min && SENTENCE_END.test(seg.text)) || dur >= max) flush();
    } else if (dur >= target) {
      flush();
    }
  });
  flush();

  // Merge a very short trailing chunk into the previous one.
  if (chunks.length > 1) {
    const last = chunks[chunks.length - 1];
    if (last.end - last.start < 2) {
      const prev = chunks[chunks.length - 2];
      prev.text = `${prev.text} ${last.text}`;
      prev.end = last.end;
      chunks.pop();
    }
  }

  return chunks.map((c) => ({ ...c, end: c.end + pad }));
}
