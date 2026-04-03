from __future__ import annotations

import argparse
from pathlib import Path

from core.uploader import UploadService
from scheduler.manifest import read_manifest
from storage.repository import LocalRepository


def main() -> int:
  parser = argparse.ArgumentParser(description="Run uploader tasks from manifest file.")
  parser.add_argument("--manifest", required=True, help="Path to manifest JSON")
  args = parser.parse_args()

  manifest_path = Path(args.manifest).resolve()
  if not manifest_path.exists():
    print(f"Manifest not found: {manifest_path}")
    return 2

  repo = LocalRepository()
  config = repo.load_config()
  tasks = read_manifest(manifest_path)
  service = UploadService()

  print(f"Loaded {len(tasks)} tasks from {manifest_path}")

  def on_progress(idx: int, progress: int, message: str) -> None:
    print(f"[{idx + 1}/{len(tasks)}] {progress:>3}% {message}")

  results = service.run_batch(tasks, config, on_progress)
  failures = [r for r in results if not r.ok]
  if failures:
    print(f"Finished with {len(failures)} failed tasks.")
    for f in failures:
      print(f"- {f.task.title}: {f.message}")
    return 1

  print("All tasks finished successfully.")
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
