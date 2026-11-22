"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, Loader2, PlayCircle } from "lucide-react";
import { parseVideoId } from "@/lib/youtube";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function VideoUrlForm({ isAuthenticated = true }: { isAuthenticated?: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Reset loading if restored from browser back/forward cache (bfcache).
  useEffect(() => {
    const handlePageShow = () => setLoading(false);
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isAuthenticated) {
      router.push("/login");
      return;
    }

    const videoId = parseVideoId(url);
    if (!videoId) {
      setError("Please paste a valid YouTube link or 11-character video ID.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/transcript?v=${encodeURIComponent(videoId)}`);
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        needsCrop?: boolean;
      };
      if (!res.ok) {
        setError(data.error ?? "Could not load captions for this video.");
        setLoading(false);
        return;
      }
      setUrl("");
      setLoading(false);
      router.push(data.needsCrop ? `/crop/${videoId}` : `/practice/${videoId}`);
    } catch {
      setError("Network error while checking captions. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-2xl space-y-2.5">
      <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <PlayCircle className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-[#10B981]" />
          <Input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Paste a YouTube link (e.g. https://youtube.com/watch?v=...)"
            className="h-12 rounded-xl pl-11 text-base focus-visible:border-[#10B981] focus-visible:ring-[#10B981]/30"
            disabled={loading}
            aria-label="YouTube video URL"
          />
        </div>
        <Button
          type="submit"
          size="lg"
          disabled={loading || !url.trim()}
          className="h-12 rounded-md bg-[#10B981] px-6 font-semibold text-zinc-950 hover:bg-[#34D399]"
        >
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Loading captions...
            </>
          ) : (
            <>
              Start practice
              <ArrowRight className="size-4" />
            </>
          )}
        </Button>
      </form>

      {error ? (
        <p className="flex items-center gap-1.5 text-sm text-rose-500 dark:text-rose-400">
          <AlertCircle className="size-4 shrink-0" />
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Works best with videos that have English captions (manual or auto-generated).
        </p>
      )}
    </div>
  );
}
