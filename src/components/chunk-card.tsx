"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
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
import { playClickSound, preloadClickSound } from "@/lib/sound";
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

/** Extract only the alphanumeric typed letters from stored value. */
function extractLetters(stored: string, maxLen: number): string {
  return stored.replace(/[^A-Za-z0-9]/g, "").slice(0, maxLen);
}

/** Reconstruct stored value with fixed separators (e.g. apostrophe in "don't"). */
function formatWithSeparators(answer: string, letters: string): string {
  if (!letters) return "";
  const slots = parseAnswerSlots(answer);
  let out = "";
  for (const s of slots) {
    if (s.kind === "input") {
      if (s.slotIdx < letters.length) {
        out += letters[s.slotIdx];
      } else {
        break;
      }
    } else if (out.length > 0) {
      out += s.char;
    }
  }
  return out;
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
  const inputRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const [focusedBlankId, setFocusedBlankId] = useState<number | null>(null);

  const blanks = useMemo(
    () => tokens.filter((t): t is BlankToken => t.kind === "blank"),
    [tokens],
  );

  const openBlankIds = useMemo(
    () =>
      blanks
        .filter((b) => {
          const st = statuses[b.id] ?? "idle";
          return st !== "correct" && st !== "almost" && st !== "revealed";
        })
        .map((b) => b.id),
    [blanks, statuses],
  );

  const firstOpenBlankId = openBlankIds[0] ?? null;

  useEffect(() => {
    preloadClickSound();
  }, []);

  useEffect(() => {
    if (firstOpenBlankId === null) return;
    const t = setTimeout(() => {
      inputRefs.current.get(firstOpenBlankId)?.focus();
    }, 60);
    return () => clearTimeout(t);
  }, [chunkIndex, firstOpenBlankId]);

  const isBlankLocked = (blankId: number) => {
    const st = statuses[blankId] ?? "idle";
    return st === "correct" || st === "almost" || st === "revealed";
  };

  const handleWordChange = (blank: BlankToken, raw: string, inputCount: number) => {
    if (isBlankLocked(blank.id)) return;
    const prevLetters = extractLetters(values[blank.id] ?? "", inputCount);
    const letters = extractLetters(raw, inputCount);
    if (letters !== prevLetters) playClickSound();
    onValueChange(blank.id, formatWithSeparators(blank.answer, letters));

    // Only move focus once the entire word is filled; never auto-check on the last blank.
    if (letters.length === inputCount) {
      const idx = openBlankIds.indexOf(blank.id);
      if (idx >= 0 && idx + 1 < openBlankIds.length) {
        const nextBlankId = openBlankIds[idx + 1];
        inputRefs.current.get(nextBlankId)?.focus();
      }
    }
  };

  const handleWordKeyDown = (
    blank: BlankToken,
    letters: string,
    e: KeyboardEvent<HTMLInputElement>,
  ) => {
    if (isBlankLocked(blank.id)) {
      e.preventDefault();
      return;
    }

    if (e.key === "Backspace" && letters.length === 0) {
      const idx = openBlankIds.indexOf(blank.id);
      if (idx > 0) {
        e.preventDefault();
        const prevBlankId = openBlankIds[idx - 1];
        inputRefs.current.get(prevBlankId)?.focus();
      }
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
            Repeat part
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
            {(["0.5", "0.75", "1"] as const).map((val) => (
              <ToggleGroupItem
                key={val}
                value={val}
                className="px-2.5 font-mono text-xs aria-pressed:border-[#10B981] aria-pressed:bg-[#10B981] aria-pressed:font-semibold aria-pressed:text-zinc-950 data-[state=on]:border-[#10B981] data-[state=on]:bg-[#10B981] data-[state=on]:font-semibold data-[state=on]:text-zinc-950 data-[state=on]:hover:bg-[#34D399] data-[state=on]:hover:text-zinc-950"
              >
                {val}×
              </ToggleGroupItem>
            ))}
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
        <CardContent className="space-y-4 p-5 sm:p-6">
          {unlocked && (
            <div className="flex items-center gap-2 rounded-xl bg-[#10B981]/15 px-3.5 py-2 text-sm font-medium text-[#10B981] dark:text-[#34D399]">
              <Sparkles className="size-4 shrink-0" />
              {correctCount === blanks.length
                ? "Great ear! All blanks correct."
                : `Nice! ${correctCount} of ${blanks.length} correct.`}
            </div>
          )}

          <p className="text-lg leading-[1.9] font-medium tracking-tight text-foreground sm:text-xl sm:leading-[2]">
            {tokens.map((tok, i) => {
              if (tok.kind === "word") {
                return (
                  <span key={`w-${i}`} className="mr-1.5 inline-block">
                    {tok.text}
                  </span>
                );
              }

              const status = statuses[tok.id] ?? "idle";
              const locked =
                status === "correct" || status === "almost" || status === "revealed";
              const slots = parseAnswerSlots(tok.answer);
              const inputCount = slots.filter((s) => s.kind === "input").length;
              const typedLetters = extractLetters(values[tok.id] ?? "", inputCount);
              const isFocused = focusedBlankId === tok.id && !locked;
              const activeSlotIdx = Math.min(typedLetters.length, Math.max(0, inputCount - 1));
              const isLastOpen = openBlankIds[openBlankIds.length - 1] === tok.id;

              return (
                <span
                  key={`b-${tok.id}`}
                  className="mr-1.5 inline-flex flex-col align-baseline"
                >
                  <span className="inline-flex items-baseline gap-0.5">
                    {tok.prefix && <span>{tok.prefix}</span>}

                    {/* Single native input per word overlaid on per-letter visual boxes (smooth on mobile IME) */}
                    <span className="relative inline-flex items-baseline gap-0.5">
                      <input
                        ref={(el) => {
                          if (el) inputRefs.current.set(tok.id, el);
                          else inputRefs.current.delete(tok.id);
                        }}
                        type="text"
                        inputMode="text"
                        enterKeyHint={isLastOpen ? "done" : "next"}
                        maxLength={inputCount}
                        value={status === "revealed" ? extractLetters(tok.answer, inputCount) : typedLetters}
                        readOnly={locked}
                        disabled={locked}
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        onFocus={() => setFocusedBlankId(tok.id)}
                        onBlur={() =>
                          setFocusedBlankId((cur) => (cur === tok.id ? null : cur))
                        }
                        onChange={(e) => handleWordChange(tok, e.target.value, inputCount)}
                        onKeyDown={(e) => handleWordKeyDown(tok, typedLetters, e)}
                        aria-label={`Blank ${tok.id + 1}`}
                        className="absolute inset-0 z-10 size-full cursor-text opacity-0 disabled:cursor-default"
                      />

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
                            : (typedLetters[slot.slotIdx] ?? "");
                        const isLetterMatch =
                          status === "wrong" &&
                          cellVal.length > 0 &&
                          cellVal.toLowerCase() === slot.char.toLowerCase();
                        const isActiveCell = isFocused && slot.slotIdx === activeSlotIdx;

                        return (
                          <span
                            key={`s-${idx}`}
                            aria-hidden
                            className={cn(
                              "inline-flex h-8 w-5 items-center justify-center rounded-t-md border-b-2 bg-muted/40 font-mono text-lg font-semibold transition-colors sm:h-9 sm:w-6 sm:text-xl",
                              status === "idle" &&
                                !isActiveCell &&
                                "border-muted-foreground/50 text-foreground",
                              status === "idle" &&
                                isActiveCell &&
                                "border-[#10B981] bg-[#10B981]/10 text-[#34D399]",
                              (status === "correct" || isLetterMatch) &&
                                "border-[#10B981] bg-[#10B981]/15 text-[#10B981] dark:text-[#34D399]",
                              status === "almost" &&
                                "border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400",
                              status === "wrong" &&
                                !isLetterMatch &&
                                "border-rose-500 bg-rose-500/15 text-rose-500 dark:text-rose-400",
                              status === "revealed" &&
                                "border-slate-500 bg-slate-500/15 text-slate-600 dark:text-slate-300",
                            )}
                          >
                            {cellVal}
                          </span>
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
                    {isLastChunk ? "Finish" : "Next part"}
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
              : "Next part"}
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
          <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">Tab</kbd>
          Next blank
        </span>
      </div>
    </div>
  );
}
