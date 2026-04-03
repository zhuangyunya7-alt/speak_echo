import Link from "next/link";
import { AuthNav } from "@/components/AuthNav";

export function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-50">
      <header className="sticky top-0 z-20 border-b border-zinc-200/80 bg-zinc-50/80 backdrop-blur dark:border-zinc-800/80 dark:bg-black/60">
        <div className="mx-auto flex w-full max-w-none items-center justify-between px-4 py-3 xl:px-8">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#602D89] text-white">
              SE
            </span>
            <span lang="zh-CN">
              SpeakEcho <span className="text-zinc-800 dark:text-zinc-200">必响</span>
            </span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50" href="/flashcards">
              闪卡
            </Link>
            <Link className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50" href="/record">
              记录
            </Link>
            <AuthNav />
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-none px-4 py-6 xl:px-8">{children}</main>
    </div>
  );
}

