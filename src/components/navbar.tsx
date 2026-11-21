import Image from "next/image";
import Link from "next/link";
import { LogOut, Shield } from "lucide-react";
import { signOut } from "@/app/auth/actions";
import { isAdminEmail } from "@/lib/demo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NavbarProps {
  user: {
    email?: string | null;
    name?: string | null;
  } | null;
}

function getInitials(name?: string | null, email?: string | null): string {
  const source = (name?.trim() || email?.split("@")[0] || "U").trim();
  const parts = source.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function Navbar({ user }: NavbarProps) {
  const initials = user ? getInitials(user.name, user.email) : "";

  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 font-semibold tracking-tight text-foreground"
        >
          <Image
            src="/logo.png"
            alt="Daily English"
            width={36}
            height={36}
            priority
            className="size-9 rounded-lg object-cover"
          />
          <span>Daily English</span>
        </Link>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative size-9 rounded-full p-0">
                  <Avatar className="size-8">
                    <AvatarFallback className="bg-[#10B981]/15 text-xs font-medium text-[#10B981] dark:text-[#34D399]">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    {user.name && <p className="text-sm font-medium leading-none">{user.name}</p>}
                    {user.email && (
                      <p className="truncate text-xs leading-none text-muted-foreground">
                        {user.email}
                      </p>
                    )}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {isAdminEmail(user.email) && (
                  <>
                    <DropdownMenuItem asChild>
                      <Link href="/admin" className="flex w-full cursor-pointer items-center gap-2">
                        <Shield className="size-4 text-[#10B981]" />
                        Manage Demo
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <form action={signOut}>
                  <DropdownMenuItem asChild>
                    <button type="submit" className="flex w-full cursor-pointer items-center gap-2">
                      <LogOut className="size-4" />
                      Sign out
                    </button>
                  </DropdownMenuItem>
                </form>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              asChild
              size="sm"
              className="rounded-md bg-[#10B981] px-4 font-semibold text-zinc-950 hover:bg-[#34D399]"
            >
              <Link href="/login">Sign in</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
