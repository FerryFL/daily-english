"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Play, RotateCcw, Trophy } from "lucide-react";
import type { Chunk } from "@/lib/chunker";
import { thumbnailUrl } from "@/lib/youtube";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export interface CompletedChunkRecord {
  chunkIndex: number;
  blanksTotal: number;
  blanksCorrect: number;
  revealedCount: number;
  missedWords: string[];
}

interface PracticeSummaryProps {
  videoId: string;
  title: string;
  chunks: Chunk[];
  records: CompletedChunkRecord[];
  onReplayChunk: (chunkIndex: number) => void;
  onPracticeAgain: () => void;
}

export function PracticeSummary({
  videoId,
  title,
  chunks,
  records,
  onReplayChunk,
  onPracticeAgain,
}: PracticeSummaryProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const byChunk = new Map<number, CompletedChunkRecord>();
  for (const r of records) byChunk.set(r.chunkIndex, r);

  const uniqueRecords = Array.from(byChunk.values());
  const totalBlanks = uniqueRecords.reduce((sum, r) => sum + r.blanksTotal, 0);
  const totalCorrect = uniqueRecords.reduce((sum, r) => sum + r.blanksCorrect, 0);
  const totalRevealed = uniqueRecords.reduce((sum, r) => sum + r.revealedCount, 0);
  const accuracy = totalBlanks > 0 ? Math.round((totalCorrect / totalBlanks) * 100) : 100;

  const missedItems = uniqueRecords
    .flatMap((r) =>
      r.missedWords.map((word) => ({
        word,
        chunkIndex: r.chunkIndex,
        text: chunks[r.chunkIndex]?.text ?? "",
      })),
    )
    .filter((item, idx, arr) => arr.findIndex((x) => x.word === item.word && x.chunkIndex === item.chunkIndex) === idx);

  return (
    <div className="space-y-6">
      {/* Celebration header */}
      <div className="flex flex-col items-center space-y-3 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-[#10B981]/15 text-[#10B981] dark:text-[#34D399]">
          <Trophy className="size-7" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Video complete!</h1>
        <div className="flex max-w-lg items-center gap-3 rounded-xl border bg-card p-2.5 text-left">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumbnailUrl(videoId)}
            alt={title}
            className="h-12 w-20 shrink-0 rounded-lg object-cover"
          />
          <p className="line-clamp-2 text-sm font-medium">{title}</p>
        </div>
      </div>

      {/* Score summary */}
      <Card className="rounded-2xl">
        <CardContent className="grid gap-6 p-6 sm:grid-cols-4 sm:items-center">
          <div className="flex flex-col items-center justify-center text-center">
            <span className="text-4xl font-bold text-[#10B981] dark:text-[#34D399]">
              {accuracy}%
            </span>
            <span className="text-xs text-muted-foreground">Accuracy</span>
          </div>
          <div className="text-center sm:text-left">
            <p className="text-2xl font-bold">
              {totalCorrect} / {totalBlanks}
            </p>
            <p className="text-xs text-muted-foreground">Blanks correct</p>
          </div>
          <div className="text-center sm:text-left">
            <p className="text-2xl font-bold">{totalRevealed}</p>
            <p className="text-xs text-muted-foreground">Blanks revealed</p>
          </div>
          <div className="text-center sm:text-left">
            <p className="text-2xl font-bold">{chunks.length}</p>
            <p className="text-xs text-muted-foreground">Chunks completed</p>
          </div>
        </CardContent>
      </Card>

      {/* Chunk timeline */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Chunk timeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {chunks.map((c) => {
              const rec = byChunk.get(c.index);
              const allGood = rec && rec.revealedCount === 0 && rec.blanksCorrect === rec.blanksTotal;
              const someRevealed = rec && rec.revealedCount > 0;
              return (
                <button
                  key={c.index}
                  type="button"
                  onClick={() => onReplayChunk(c.index)}
                  title={`Chunk ${c.index + 1}: click to replay`}
                  className={cn(
                    "size-7 rounded-md text-xs font-mono font-medium transition-transform hover:scale-110",
                    allGood &&
                      "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
                    someRevealed &&
                      "bg-slate-500/20 text-slate-700 dark:text-slate-300",
                    !rec && "bg-muted text-muted-foreground",
                  )}
                >
                  {c.index + 1}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-emerald-500/40" /> All correct
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-slate-500/40" /> Revealed
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Words to review */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Words to review ({missedItems.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {missedItems.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-4" />
              Perfect score! No missed words in this video.
            </div>
          ) : (
            <div className="space-y-2.5">
              {missedItems.map((item, i) => (
                <div
                  key={`${item.chunkIndex}-${item.word}-${i}`}
                  className="flex items-start justify-between gap-3 rounded-xl border bg-muted/40 p-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="font-semibold">
                        {item.word}
                      </Badge>
                      <span className="font-mono text-xs text-muted-foreground">
                        Chunk {item.chunkIndex + 1}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">&ldquo;{item.text}&rdquo;</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onReplayChunk(item.chunkIndex)}
                    className="shrink-0"
                  >
                    <Play className="size-3.5" />
                    Listen
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Footer actions */}
      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogTrigger asChild>
            <Button
              type="button"
              className="rounded-md bg-[#10B981] font-semibold text-zinc-950 hover:bg-[#34D399]"
            >
              <RotateCcw className="size-4" />
              Reset progress
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Reset progress?</DialogTitle>
              <DialogDescription>
                Are you sure? The progress will be reset to 0.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmOpen(false)}
                className="rounded-md"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setConfirmOpen(false);
                  onPracticeAgain();
                }}
                className="rounded-md bg-red-500 font-semibold text-white hover:bg-red-600"
              >
                Yes, reset
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Button asChild variant="outline" className="rounded-md">
          <Link href="/">
            <ArrowLeft className="size-4" />
            Back to dashboard
          </Link>
        </Button>
      </div>
    </div>
  );
}
