"use client";

import { useState } from "react";
import Image from "next/image";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.4 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z"
      />
    </svg>
  );
}

const PREVIEW_WORD = "practice";

export function LoginForm({ next, authError }: { next: string; authError: boolean }) {
  const [googleLoading, setGoogleLoading] = useState(false);

  async function signInWithGoogle() {
    setGoogleLoading(true);
    const supabase = createClient();
    const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || window.location.origin).replace(/\/$/, "");
    const callbackUrl =
      next && next !== "/"
        ? `${baseUrl}/auth/callback?next=${encodeURIComponent(next)}`
        : `${baseUrl}/auth/callback`;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl },
    });
    if (error) setGoogleLoading(false);
  }

  return (
    <Card className="w-full max-w-sm rounded-2xl border-border/80 shadow-lg">
      <CardContent className="space-y-6 p-7">
        {/* Brand & short copy */}
        <div className="flex flex-col items-center space-y-3 text-center">
          <Image
            src="/logo.png"
            alt="Daily English"
            width={52}
            height={52}
            priority
            className="size-13 rounded-xl object-cover shadow-sm"
          />
          <div className="space-y-1">
            <p className="text-xs font-semibold tracking-wider text-[#10B981] uppercase dark:text-[#34D399]">
              Daily English
            </p>
            <h1 className="text-xl font-bold tracking-tight">Practice English with YouTube</h1>
            <p className="text-sm text-muted-foreground">
              Listen, fill the blanks, train your ear.
            </p>
          </div>
        </div>

        {/* Compact per-letter blank preview */}
        <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-xl border border-[#10B981]/20 bg-[#10B981]/5 px-3 py-3 text-sm text-foreground/90">
          <span>Listen and</span>
          <span className="inline-flex items-center gap-0.5" aria-label={PREVIEW_WORD}>
            {Array.from(PREVIEW_WORD).map((ch, idx) => (
              <span
                key={idx}
                className="inline-flex h-6 w-4 items-center justify-center rounded-t border-b-2 border-[#10B981] bg-[#10B981]/15 font-mono text-xs font-semibold text-[#10B981] dark:text-[#34D399]"
              >
                {ch}
              </span>
            ))}
          </span>
          <span>every day.</span>
        </div>

        {authError && (
          <Alert variant="destructive">
            <AlertDescription>Sign-in failed. Please try again.</AlertDescription>
          </Alert>
        )}

        {/* Google-only auth */}
        <div className="space-y-2.5">
          <Button
            type="button"
            size="lg"
            onClick={signInWithGoogle}
            disabled={googleLoading}
            className="h-11 w-full rounded-md bg-[#10B981] text-sm font-semibold text-zinc-950 hover:bg-[#34D399]"
          >
            {googleLoading ? <Loader2 className="size-4 animate-spin" /> : <GoogleIcon />}
            Continue with Google
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Sign in or sign up with Google.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
