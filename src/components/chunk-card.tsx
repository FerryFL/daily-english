"use client";

import { useEffect, useMemo, useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import {
  ArrowRight,
  Check,
  Eye,
  Lightbulb,
  Lock,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import type { BlankToken, Token } from "@/lib/blanker";
import type { CheckResult } from "@/lib/checker";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type BlankStatus = "idle" | CheckResult | "revealed";

export interface ChunkCardProps {
  chunkIndex: number;
  start: number;
  end: number;
  fullText: string;
  tokens: Token[];
  values: Record<number, string>;
  statuses: Record<number, BlankStatus>;
  attempts: number;
  unlocked: boolean;
  isLastChunk: boolean;
  isDemo?: boolean;
  rate: number;
  onValueChange: (blankId: number, value: string) => void;
  onRateChange: (rate: number) => void;
  onRepeat: () => void;
  onCheck: () => void;
  onReveal: () => void;
  onNext: () => void;
}

const SLOT_CHAR_RE = /[A-Za-z0-9]/;

interface AnswerSlot {
  kind: "input" | "fixed";
  char: string;
  slotIdx: number; // -1 for fixed separators like ' or -
}

function parseAnswerSlots(answer: string): AnswerSlot[] {
  let slotIdx = 0;
  return Array.from(answer).map((char) =>
    SLOT_CHAR_RE.test(char)
      ? { kind: "input", char, slotIdx: slotIdx++ }
      : { kind: "fixed", char, slotIdx: -1 },
  );
}

/** Extract typed characters for each input slot from the stored string value. */
function getSlotValues(answer: string, stored: string): string[] {
  const slots = parseAnswerSlots(answer);
  const inputCount = slots.filter((s) => s.kind === "input").length;
  const out = Array<string>(inputCount).fill("");
  if (!stored) return out;

  // Stored value aligns 1-to-1 with `answer` characters (spaces = empty).
  for (let i = 0; i < slots.length && i < stored.length; i++) {
    const slot = slots[i];
    if (slot.kind === "input") {
      const ch = stored[i];
      out[slot.slotIdx] = ch && ch !== " " ? ch : "";
    }
  }
  return out;
}

/** Rebuild the stored string value from slot characters, preserving fixed separators. */
function buildStoredValue(answer: string, slotChars: string[]): string {
  const slots = parseAnswerSlots(answer);
  if (slotChars.every((c) => !c)) return "";
  return slots
    .map((s) => (s.kind === "fixed" ? s.char : slotChars[s.slotIdx] || " "))
    .join("");
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}

export function ChunkCard({
  chunkIndex,
  start,
  end,
  fullText,
  tokens,
  values,
  statuses,
  attempts,
  unlocked,
  isLastChunk,
  isDemo = false,
  rate,
  onValueChange,
  onRateChange,
  onRepeat,
  onCheck,
  onReveal,
  onNext,
}: ChunkCardProps) {
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const blanks = useMemo(
    () => tokens.filter((t): t is BlankToken => t.kind === "blank"),
    [tokens],
  );

  // Ordered list of all editable letter slots across all open blanks.
  const openSlots = useMemo(() => {
    const list: { blankId: number; slotIdx: number; answer: string }[] = [];
    for (const b of blanks) {
      const st = statuses[b.id] ?? "idle";
      if (st === "correct" || st === "almost" || st === "revealed") continue;
      for (const s of parseAnswerSlots(b.answer)) {
        if (s.kind === "input") {
          list.push({ blankId: b.id, slotIdx: s.slotIdx, answer: b.answer });
        }
      }
    }
    return list;
  }, [blanks, statuses]);

  const firstOpenKey =
    openSlots.length > 0 ? `${openSlots[0].blankId}:${openSlots[0].slotIdx}` : null;

  useEffect(() => {
    if (!firstOpenKey) return;
    const t = setTimeout(() => {
      inputRefs.current.get(firstOpenKey)?.focus();
    }, 60);
    return () => clearTimeout(t);
  }, [chunkIndex, firstOpenKey]);

  const focusSlot = (blankId: number, slotIdx: number) => {
    inputRefs.current.get(`${blankId}:${slotIdx}`)?.focus();
  };

  const isBlankLocked = (blankId: number) => {
    const st = statuses[blankId] ?? "idle";
    return st === "correct" || st === "almost" || st === "revealed";
  };

  const handleSlotChange = (blank: BlankToken, slotIdx: number, raw: string) => {
    if (isBlankLocked(blank.id)) return;
    const cleaned = raw.replace(/[^A-Za-z0-9]/g, "");
    const ch = cleaned.slice(-1);
    const chars = getSlotValues(blank.answer, values[blank.id] ?? "");
    chars[slotIdx] = ch;
    onValueChange(blank.id, buildStoredValue(blank.answer, chars));

    if (!ch) return;

    // Move to the next letter slot, or the first slot of the next open blank.
    // On the very last slot of the last blank, do NOT auto-check — let the user click Check.
    const pos = openSlots.findIndex(
      (s) => s.blankId === blank.id && s.slotIdx === slotIdx,
    );
    if (pos >= 0 && pos + 1 < openSlots.length) {
      const next = openSlots[pos + 1];
      focusSlot(next.blankId, next.slotIdx);
    }
  };

  const handleSlotKeyDown = (
    blank: BlankToken,
    slotIdx: number,
    e: KeyboardEvent<HTMLInputElement>,
  ) => {
    if (isBlankLocked(blank.id)) {
      e.preventDefault();
      return;
    }
    const pos = openSlots.findIndex(
      (s) => s.blankId === blank.id && s.slotIdx === slotIdx,
    );

    if (e.key === "Backspace") {
      const chars = getSlotValues(blank.answer, values[blank.id] ?? "");
      if (chars[slotIdx]) {
        e.preventDefault();
        chars[slotIdx] = "";
        onValueChange(blank.id, buildStoredValue(blank.answer, chars));
      } else if (pos > 0) {
        e.preventDefault();
        const prev = openSlots[pos - 1];
        const prevChars = getSlotValues(prev.answer, values[prev.blankId] ?? "");
        prevChars[prev.slotIdx] = "";
        onValueChange(prev.blankId, buildStoredValue(prev.answer, prevChars));
        focusSlot(prev.blankId, prev.slotIdx);
      }
      return;
    }

    if (e.key === "ArrowLeft" && pos > 0) {
      e.preventDefault();
      const prev = openSlots[pos - 1];
      focusSlot(prev.blankId, prev.slotIdx);
      return;
    }

    if (e.key === "ArrowRight" && pos >= 0 && pos + 1 < openSlots.length) {
      e.preventDefault();
      const next = openSlots[pos + 1];
      focusSlot(next.blankId, next.slotIdx);
    }
  };

  const handleSlotPaste = (
    blank: BlankToken,
    slotIdx: number,
    e: ClipboardEvent<HTMLInputElement>,
  ) => {
    if (isBlankLocked(blank.id)) {
      e.preventDefault();
      return;
    }
    const pasted = e.clipboardData.getData("text").replace(/[^A-Za-z0-9]/g, "");
    if (!pasted) return;
    e.preventDefault();

    const chars = getSlotValues(blank.answer, values[blank.id] ?? "");
    let lastFilled = slotIdx;
    for (let i = 0; i < pasted.length && slotIdx + i < chars.length; i++) {
      chars[slotIdx + i] = pasted[i];
      lastFilled = slotIdx + i;
    }
    onValueChange(blank.id, buildStoredValue(blank.answer, chars));

    const pos = openSlots.findIndex(
      (s) => s.blankId === blank.id && s.slotIdx === lastFilled,
    );
    if (pos >= 0 && pos + 1 < openSlots.length) {
      const next = openSlots[pos + 1];
      focusSlot(next.blankId, next.slotIdx);
    }
  };

  const wrongCount = blanks.filter((b) => statuses[b.id] === "wrong").length;
  const correctCount = blanks.filter(
    (b) => statuses[b.id] === "correct" || statuses[b.id] === "almost",
  ).length;

  return (
    <div className="space-y-4">
      {/* Playback controls + Reveal (Lightbulb) next to speed */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            type="button"
            onClick={onRepeat}
            className="rounded-md bg-[#10B981] px-4 font-semibold text-zinc-950 hover:bg-[#34D399]"
          >
            <RotateCcw className="size-4" />
            Repeat chunk
          </Button>

          <ToggleGroup
            type="single"
            value={String(rate)}
            onValueChange={(val) => {
              if (val) onRateChange(Number(val));
            }}
            variant="outline"
            size="sm"
            aria-label="Playback speed"
          >
            <ToggleGroupItem value="0.5" className="px-2.5 font-mono text-xs">
              0.5×
            </ToggleGroupItem>
            <ToggleGroupItem value="0.75" className="px-2.5 font-mono text-xs">
              0.75×
            </ToggleGroupItem>
            <ToggleGroupItem value="1" className="px-2.5 font-mono text-xs">
              1×
            </ToggleGroupItem>
          </ToggleGroup>

          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-block">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={unlocked}
                  onClick={onReveal}
                  className="rounded-md border-amber-500/40 text-amber-500 hover:bg-amber-500/10 hover:text-amber-400"
                >
                  <Lightbulb className="size-4" />
                  Reveal
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {unlocked ? "Answers already completed" : "Reveal answers (Alt + R)"}
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="flex items-center gap-2">
          {attempts > 0 && !unlocked && (
            <Badge variant="secondary" className="font-mono text-xs">
              Attempt {attempts}
            </Badge>
          )}
          <span className="font-mono text-xs text-muted-foreground">
            {formatTime(start)} – {formatTime(end)}
          </span>
        </div>
      </div>

      {/* Main sentence card */}
      <Card className="rounded-2xl shadow-sm">
        <CardContent className="space-y-5 p-6 sm:p-8">
          {unlocked && (
            <div className="flex items-center gap-2 rounded-xl bg-[#10B981]/15 px-3.5 py-2 text-sm font-medium text-[#10B981] dark:text-[#34D399]">
              <Sparkles className="size-4 shrink-0" />
              {correctCount === blanks.length
                ? "Great ear! All blanks correct."
                : `Nice! ${correctCount} of ${blanks.length} correct.`}
            </div>
          )}

          <p className="text-xl leading-[2.6] font-medium tracking-tight text-foreground sm:text-2xl sm:leading-[2.7]">
            {tokens.map((tok, i) => {
              if (tok.kind === "word") {
                return (
                  <span key={`w-${i}`} className="mr-2 inline-block">
                    {tok.text}
                  </span>
                );
              }

              const status = statuses[tok.id] ?? "idle";
              const locked =
                status === "correct" || status === "almost" || status === "revealed";
              const slots = parseAnswerSlots(tok.answer);
              const typedChars = getSlotValues(tok.answer, values[tok.id] ?? "");

              return (
                <span
                  key={`b-${tok.id}`}
                  className="mr-2 inline-flex flex-col align-baseline"
                >
                  <span className="inline-flex items-baseline gap-0.5">
                    {tok.prefix && <span>{tok.prefix}</span>}

                    <span className="inline-flex items-baseline gap-1">
                      {slots.map((slot, idx) => {
                        if (slot.kind === "fixed") {
                          return (
                            <span
                              key={`f-${idx}`}
                              className="px-0.5 font-mono text-lg text-muted-foreground"
                            >
                              {slot.char}
                            </span>
                          );
                        }

                        const cellVal =
                          status === "revealed"
                            ? slot.char
                            : (typedChars[slot.slotIdx] ?? "");
                        const key = `${tok.id}:${slot.slotIdx}`;
                        const isLetterMatch =
                          status === "wrong" &&
                          cellVal.length > 0 &&
                          cellVal.toLowerCase() === slot.char.toLowerCase();

                        return (
                          <input
                            key={key}
                            ref={(el) => {
                              if (el) inputRefs.current.set(key, el);
                              else inputRefs.current.delete(key);
                            }}
                            type="text"
                            inputMode="text"
                            maxLength={2}
                            value={cellVal}
                            readOnly={locked}
                            disabled={locked}
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="off"
                            spellCheck={false}
                            onChange={(e) =>
                              handleSlotChange(tok, slot.slotIdx, e.target.value)
                            }
                            onKeyDown={(e) => handleSlotKeyDown(tok, slot.slotIdx, e)}
                            onPaste={(e) => handleSlotPaste(tok, slot.slotIdx, e)}
                            aria-label={`Blank ${tok.id + 1} letter ${slot.slotIdx + 1}`}
                            className={cn(
                              "h-9 w-6 rounded-t-md border-b-2 bg-muted/40 text-center font-mono text-xl font-semibold outline-none transition-colors disabled:cursor-default disabled:opacity-100 sm:h-10 sm:w-7 sm:text-2xl",
                              status === "idle" &&
                                "border-muted-foreground/50 text-foreground focus:border-[#10B981] focus:bg-[#10B981]/10 focus:text-[#34D399]",
                              (status === "correct" || isLetterMatch) &&
                                "border-[#10B981] bg-[#10B981]/15 text-[#10B981] dark:text-[#34D399]",
                              status === "almost" &&
                                "border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400",
                              status === "wrong" &&
                                !isLetterMatch &&
                                "border-rose-500 bg-rose-500/15 text-rose-500 focus:border-rose-400 dark:text-rose-400",
                              status === "revealed" &&
                                "border-slate-500 bg-slate-500/15 text-slate-600 dark:text-slate-300",
                            )}
                          />
                        );
                      })}
                    </span>

                    {status === "correct" && (
                      <Check className="ml-1 size-4 self-center text-[#10B981]" aria-hidden />
                    )}
                    {status === "wrong" && (
                      <X className="ml-1 size-4 self-center text-rose-500" aria-hidden />
                    )}
                    {status === "revealed" && (
                      <Eye className="ml-1 size-4 self-center text-slate-400" aria-hidden />
                    )}
                    {tok.suffix && <span>{tok.suffix}</span>}
                  </span>

                  {status === "almost" && (
                    <span className="mt-0.5 text-center text-xs font-normal leading-tight text-amber-500 dark:text-amber-400">
                      Almost — &ldquo;{tok.answer}&rdquo;
                    </span>
                  )}
                </span>
              );
            })}
          </p>

          {wrongCount > 0 && !unlocked && (
            <p className="text-sm text-rose-500 dark:text-rose-400">
              {wrongCount === 1
                ? "1 blank is not right yet. Listen again and try."
                : `${wrongCount} blanks are not right yet. Listen again and try.`}
            </p>
          )}

          {unlocked && (
            <p className="border-t pt-3 text-sm text-muted-foreground">
              Full caption: &ldquo;{fullText}&rdquo;
            </p>
          )}
        </CardContent>
      </Card>

      {/* Full-width Check / Next action area */}
      <div className="space-y-2.5">
        {!unlocked ? (
          <>
            <Button
              type="button"
              size="lg"
              onClick={onCheck}
              className="h-12 w-full rounded-md bg-[#10B981] text-base font-semibold text-zinc-950 shadow-sm hover:bg-[#34D399]"
            >
              <Check className="size-5" />
              Check
            </Button>

            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="block w-full">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled
                    className="h-10 w-full rounded-md"
                  >
                    <Lock className="size-3.5" />
                    {isLastChunk ? "Finish" : "Next chunk"}
                    <ArrowRight className="size-4" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Fill all blanks correctly or reveal to continue</TooltipContent>
            </Tooltip>
          </>
        ) : (
          <Button
            type="button"
            size="lg"
            onClick={onNext}
            className="h-12 w-full rounded-md bg-[#10B981] text-base font-semibold text-zinc-950 shadow-sm hover:bg-[#34D399]"
          >
            {isLastChunk
              ? isDemo
                ? "Finish demo"
                : "Finish & view summary"
              : "Next chunk"}
            <ArrowRight className="size-5" />
          </Button>
        )}
      </div>

      {/* Keyboard shortcut hints */}
      <div className="hidden flex-wrap items-center justify-center gap-x-5 gap-y-2 pt-1 text-xs text-muted-foreground sm:flex">
        <span className="flex items-center gap-1.5">
          <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">Enter</kbd>
          {unlocked ? "Next" : "Check"}
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
            Ctrl + Space
          </kbd>
          Repeat
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
            Alt + R
          </kbd>
          Reveal
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
            ← / →
          </kbd>
          Move letter
        </span>
      </div>
    </div>
  );
}
