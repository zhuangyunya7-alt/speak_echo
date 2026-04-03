from __future__ import annotations

"""每分钟由 Windows 任务计划程序运行一次：执行已到点的本地任务队列。"""

from storage.repository import LocalRepository
from core.job_executor import run_due_jobs
from core.uploader import UploadService


def main() -> int:
  repo = LocalRepository()
  config = repo.load_config()
  service = UploadService()

  lines: list[str] = []

  def on_log(msg: str) -> None:
    lines.append(msg)
    print(msg)

  ok_n, fail_n = run_due_jobs(repo, config, service, on_log)
  print(f"完成：成功 {ok_n}，失败 {fail_n}")
  return 0 if fail_n == 0 else 1


if __name__ == "__main__":
  raise SystemExit(main())
