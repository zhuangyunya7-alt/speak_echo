"use client";

import { cn } from "@/components/ui/cn";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
  size?: "sm" | "md";
};

export function Button({ className, variant = "primary", size = "md", ...props }: Props) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-lg border text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none",
        size === "sm" ? "h-9 px-3" : "h-10 px-4",
        variant === "primary" &&
          "border-transparent bg-[#602D89] text-white hover:brightness-110 active:brightness-95",
        variant === "ghost" &&
          "border-zinc-200 bg-transparent hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/60",
        variant === "danger" &&
          "border-transparent bg-red-600 text-white hover:bg-red-500 dark:bg-red-500 dark:hover:bg-red-400",
        className,
      )}
      {...props}
    />
  );
}

