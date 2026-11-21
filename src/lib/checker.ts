export type CheckResult = "correct" | "almost" | "wrong";

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[^a-z0-9']/g, "")
    .replace(/^'+|'+$/g, "");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Lenient answer check: case/punctuation-insensitive, 1 typo allowed for words of 5+ letters. */
export function check(input: string, answer: string): CheckResult {
  const a = normalize(input);
  const b = normalize(answer);
  if (!a) return "wrong";
  if (a === b) return "correct";
  // Treat apostrophe-less spelling as correct ("dont" == "don't").
  if (a.replace(/'/g, "") === b.replace(/'/g, "")) return "correct";
  if (b.length >= 5 && levenshtein(a, b) <= 1) return "almost";
  return "wrong";
}

export function isPassing(r: CheckResult | "revealed" | undefined): boolean {
  return r === "correct" || r === "almost" || r === "revealed";
}
