import { describe, expect, it } from "vitest";
import { parseVideoId } from "./youtube";
import { buildChunks, cleanCaption, type Segment } from "./chunker";
import { makeBlanks, type BlankToken } from "./blanker";
import { check } from "./checker";
import {
  formatTimestamp,
  MAX_VIDEO_DURATION_SEC,
  needsCrop,
  parseTimestamp,
  sliceSegments,
  validateClipRange,
} from "./clip";
import { STOPWORDS } from "./stopwords";

describe("parseVideoId", () => {
  const id = "dQw4w9WgXcQ";
  it.each([
    id,
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&t=42s`,
    `https://youtu.be/${id}?si=abc`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://m.youtube.com/watch?v=${id}`,
    `youtube.com/watch?v=${id}`,
  ])("parses %s", (input) => expect(parseVideoId(input)).toBe(id));

  it.each(["", "hello", "https://vimeo.com/123", "https://youtube.com/watch?v=short"])(
    "rejects %s",
    (input) => expect(parseVideoId(input)).toBeNull(),
  );
});

describe("cleanCaption", () => {
  it("removes noise and decodes single and double-encoded entities", () => {
    expect(cleanCaption("[Music] &gt;&gt; it&#39;s  fine\nreally")).toBe("it's fine really");
    expect(cleanCaption("Now, let&amp;#39;s look at &amp;quot;get the hang of&amp;quot;")).toBe(
      'Now, let\'s look at "get the hang of"',
    );
  });
});

describe("buildChunks", () => {
  const seg = (start: number, dur: number, text: string): Segment => ({ start, dur, text });

  it("closes punctuated chunks on sentence ends after min duration", () => {
    const chunks = buildChunks([
      seg(0, 3, "Hello everyone and welcome"),
      seg(3, 3, "to the show today."),
      seg(6, 3, "We will talk about"),
      seg(9, 3, "learning English fast."),
    ]);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toBe("Hello everyone and welcome to the show today.");
    expect(chunks[0].start).toBe(0);
    expect(chunks[1].start).toBe(6);
  });

  it("caps chunks at max duration", () => {
    const segs = Array.from({ length: 10 }, (_, i) => seg(i * 3, 3, `word${i} goes on.`.replace(".", "")));
    segs[0].text = "Start."; // make it look punctuated enough
    segs[1].text = "Another one.";
    const chunks = buildChunks(segs);
    for (const c of chunks) expect(c.end - c.start).toBeLessThanOrEqual(12.5);
  });

  it("uses target duration for unpunctuated captions", () => {
    const segs = Array.from({ length: 12 }, (_, i) => seg(i * 2, 2.5, `some words here number ${i}`));
    const chunks = buildChunks(segs);
    expect(chunks.length).toBeGreaterThan(2);
    // overlapping auto captions must not create overlap past next start
    expect(chunks[0].end).toBeCloseTo(8 + 0.3);
  });

  it("merges a tiny trailing chunk", () => {
    const chunks = buildChunks([seg(0, 6, "This is a full sentence."), seg(6, 1, "Bye.")]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain("Bye.");
  });
});

describe("makeBlanks", () => {
  const text = "So the most important thing you can do is practice your listening every single day.";

  it("is deterministic for the same seed", () => {
    expect(makeBlanks(text, "v:1")).toEqual(makeBlanks(text, "v:1"));
  });

  it("never blanks stopwords and keeps punctuation outside the blank", () => {
    for (let s = 0; s < 30; s++) {
      const blanks = makeBlanks(text, `seed${s}`).filter((t): t is BlankToken => t.kind === "blank");
      expect(blanks).toHaveLength(2);
      for (const b of blanks) {
        expect(STOPWORDS.has(b.answer.toLowerCase())).toBe(false);
        expect(b.answer).toMatch(/^[A-Za-z'-]+$/);
      }
    }
  });

  it("uses one blank for short chunks", () => {
    const blanks = makeBlanks("Learning languages is wonderful.", "x").filter((t) => t.kind === "blank");
    expect(blanks).toHaveLength(1);
  });

  it("falls back when every word is a stopword", () => {
    const blanks = makeBlanks("I am so so", "x").filter((t) => t.kind === "blank");
    expect(blanks).toHaveLength(1);
  });
});

describe("check", () => {
  it("is case and punctuation insensitive", () => {
    expect(check("Practice", "practice")).toBe("correct");
    expect(check("practice.", "practice")).toBe("correct");
    expect(check("dont", "don't")).toBe("correct");
    expect(check("don’t", "don't")).toBe("correct");
  });
  it("accepts one typo for longer words as almost", () => {
    expect(check("habbit", "habit")).toBe("almost");
    expect(check("listning", "listening")).toBe("almost");
  });
  it("is strict for short words and big mistakes", () => {
    expect(check("cat", "car")).toBe("wrong");
    expect(check("lisening", "listing")).toBe("wrong");
    expect(check("", "word")).toBe("wrong");
  });
});

describe("clip helpers", () => {
  it("detects videos longer than 15 minutes", () => {
    expect(needsCrop(null)).toBe(false);
    expect(needsCrop(900)).toBe(false);
    expect(needsCrop(901)).toBe(true);
  });

  it("slices segments within [startSec, endSec) and clamps trailing duration", () => {
    const segs: Segment[] = [
      { start: 5, dur: 4, text: "before" },
      { start: 10, dur: 4, text: "first" },
      { start: 18, dur: 5, text: "last" },
      { start: 20, dur: 3, text: "after" },
    ];
    const sliced = sliceSegments(segs, 10, 20);
    expect(sliced).toEqual([
      { start: 10, dur: 4, text: "first" },
      { start: 18, dur: 2, text: "last" },
    ]);
  });

  it("validates clip range against min/max/video duration", () => {
    expect(validateClipRange(0, 600, 1800).valid).toBe(true);
    expect(validateClipRange(0, MAX_VIDEO_DURATION_SEC, 1800).valid).toBe(true);
    expect(validateClipRange(0, MAX_VIDEO_DURATION_SEC + 1, 1800).valid).toBe(false);
    expect(validateClipRange(100, 105, 1800).valid).toBe(false);
    expect(validateClipRange(100, 2000, 1800).valid).toBe(false);
    expect(validateClipRange(-5, 100, 1800).valid).toBe(false);
  });

  it("formats and parses timestamps", () => {
    expect(formatTimestamp(65)).toBe("01:05");
    expect(formatTimestamp(3665)).toBe("1:01:05");
    expect(parseTimestamp("05:30")).toBe(330);
    expect(parseTimestamp("1:02:03")).toBe(3723);
    expect(parseTimestamp("90")).toBe(90);
    expect(parseTimestamp("05:75")).toBeNull();
    expect(parseTimestamp("abc")).toBeNull();
  });
});
