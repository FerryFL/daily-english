"use client";

import { useEffect } from "react";

interface ShortcutHandlers {
  onRepeat: () => void;
  onReveal: () => void;
  onSubmitOrNext: () => void;
  enabled?: boolean;
}

/**
 * Keyboard shortcuts for the practice screen:
 * - Ctrl+Space: repeat current chunk
 * - Alt+R: reveal answers
 * - Enter: check answers (or go to next chunk when unlocked)
 */
export function useShortcuts({
  onRepeat,
  onReveal,
  onSubmitOrNext,
  enabled = true,
}: ShortcutHandlers) {
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.code === "Space") {
        e.preventDefault();
        onRepeat();
        return;
      }

      if (e.altKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        onReveal();
        return;
      }

      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        // Don't hijack button clicks via Enter; handle input or body focus.
        if (tag === "BUTTON" || tag === "A") return;
        e.preventDefault();
        onSubmitOrNext();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, onRepeat, onReveal, onSubmitOrNext]);
}
