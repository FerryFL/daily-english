import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function PracticeLoading() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-4xl flex-col justify-center space-y-6 px-4 py-10 sm:px-6">
      <Skeleton className="aspect-video w-full rounded-2xl" />
      <Card className="rounded-2xl">
        <CardContent className="flex flex-col items-center space-y-4 p-8 text-center">
          <Loader2 className="size-7 animate-spin text-[#10B981]" />
          <div className="space-y-1">
            <p className="font-medium">Preparing your listening session...</p>
            <p className="text-xs text-muted-foreground">
              Fetching English captions, splitting into parts, and choosing blanks.
            </p>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
