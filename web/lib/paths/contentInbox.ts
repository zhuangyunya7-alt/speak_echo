import path from "path";

/** Repo-root `content-inbox/` next to `web/` (when cwd is the Next app). */
export function contentInboxDir(): string {
  return path.join(process.cwd(), "..", "content-inbox");
}

export function isAllowedInboxFilename(name: string): boolean {
  if (!name || name.length > 240) return false;
  if (name.includes("..") || /[/\\]/.test(name)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9_.-]+\.(mp4|webm|mov|m4v|json)$/.test(name);
}
