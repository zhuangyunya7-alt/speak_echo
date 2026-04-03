"use client";

import { cn } from "@/components/ui/cn";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string;
};

export function Input({ label, hint, error, className, ...props }: Props) {
  return (
    <label className="block">
      {label ? <div className="mb-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</div> : null}
      <input
        className={cn(
          "h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600",
          error ? "border-red-400 focus:border-red-500" : null,
          props.disabled ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300" : null,
          className,
        )}
        {...props}
      />
      {error ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
      {!error && hint ? <div className="mt-1 text-xs text-zinc-500">{hint}</div> : null}
    </label>
  );
}

