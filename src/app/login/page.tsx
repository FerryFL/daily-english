import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { LoginForm } from "./login-form";

async function LoginFormSlot({
  searchParams,
}: {
  searchParams: PageProps<"/login">["searchParams"];
}) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  const authError = sp.error === "auth";
  return <LoginForm next={next} authError={authError} />;
}

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden bg-background px-4 py-12">
      {/* Subtle emerald ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 -z-10 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#10B981]/10 blur-3xl"
      />

      <Suspense fallback={<Skeleton className="h-[380px] w-full max-w-md rounded-2xl" />}>
        <LoginFormSlot searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
