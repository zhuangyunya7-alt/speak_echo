import { cn } from "@/components/ui/cn";

const BEIAN_NUMBER = "闽ICP备2026009473号-1";
const BEIAN_URL = "https://beian.miit.gov.cn/";

export function IcpBeianLink({ className }: { className?: string }) {
  return (
    <p className={cn("text-center text-xs text-zinc-500 dark:text-zinc-500", className)}>
      <a
        href={BEIAN_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-zinc-700 hover:underline dark:hover:text-zinc-300"
      >
        {BEIAN_NUMBER}
      </a>
    </p>
  );
}
