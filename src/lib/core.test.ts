import { describe, expect, it } from "vitest";
import { parseVideoId } from "./youtube";
import { buildChunks, cleanCaption, type Segment } from "./chunker";
import { makeBlanks, type BlankToken } from "./blanker";
import { check } from "./checker";
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
