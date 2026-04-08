# -*- coding: utf-8 -*-

"""字幕词汇难度评估工具 — 图形界面（Tkinter + SiliconFlow）"""

from __future__ import annotations

import json
import os
import queue
import sys
import threading
from pathlib import Path
from tkinter import filedialog, messagebox, scrolledtext, ttk
from typing import Optional, TextIO

import tkinter as tk

from .credentials_store import clear_credentials, load_credentials, save_credentials
from .pipeline import rate_srt_file_best_effort

_null_stdio: Optional[TextIO] = None


def _ensure_stdio_streams() -> None:
    """pythonw 无控制台时 stdout/stderr 为 None，部分库写进度会报错。"""
    global _null_stdio
    if sys.stdout is not None and sys.stderr is not None:
        return
    if _null_stdio is None:
        _null_stdio = open(os.devnull, "w", encoding="utf-8", errors="replace")
    if sys.stdout is None:
        sys.stdout = _null_stdio
    if sys.stderr is None:
        sys.stderr = _null_stdio


class App:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("字幕词汇难度评估")
        self.root.geometry("980x820")
        self.root.minsize(860, 680)

        self.log_q: queue.Queue[tuple[str, object]] = queue.Queue()
        self.worker: threading.Thread | None = None

        self.srt_var = tk.StringVar(value="")
        self.api_key_var = tk.StringVar(value="")
        self.base_url_var = tk.StringVar(value="https://api.siliconflow.cn/v1")
        self.model_var = tk.StringVar(value="")
        self.temp_var = tk.StringVar(value="0.2")

        self._load_saved_credentials()
        self._build_ui()
        self._poll_log()

    def _build_ui(self) -> None:
        pad = {"padx": 8, "pady": 6}

        frm = ttk.Frame(self.root)
        frm.pack(fill="both", expand=True, padx=10, pady=10)

        r = 0
        ttk.Label(frm, text="英文字幕 SRT").grid(row=r, column=0, sticky="w", **pad)
        ttk.Entry(frm, textvariable=self.srt_var, width=78).grid(row=r, column=1, sticky="we", **pad)
        ttk.Button(frm, text="浏览…", command=self._pick_srt).grid(row=r, column=2, **pad)

        r += 1
        ttk.Label(frm, text="SiliconFlow API Key").grid(row=r, column=0, sticky="w", **pad)
        ttk.Entry(frm, textvariable=self.api_key_var, width=78, show="*").grid(row=r, column=1, sticky="we", **pad)
        ttk.Button(frm, text="保存", command=self._save_creds).grid(row=r, column=2, **pad)

        r += 1
        ttk.Label(frm, text="Base URL").grid(row=r, column=0, sticky="w", **pad)
        ttk.Entry(frm, textvariable=self.base_url_var, width=78).grid(row=r, column=1, sticky="we", **pad)
        ttk.Button(frm, text="清除密钥", command=self._clear_creds).grid(row=r, column=2, **pad)

        r += 1
        ttk.Label(frm, text="Model").grid(row=r, column=0, sticky="w", **pad)
        ttk.Entry(frm, textvariable=self.model_var, width=78).grid(row=r, column=1, sticky="we", **pad)
        ttk.Label(frm, text="温度", foreground="#555").grid(row=r, column=2, sticky="w", padx=8, pady=6)

        r += 1
        ttk.Label(frm, text="Temperature").grid(row=r, column=0, sticky="w", **pad)
        ttk.Entry(frm, textvariable=self.temp_var, width=12).grid(row=r, column=1, sticky="w", **pad)

        r += 1
        bf = ttk.Frame(frm)
        bf.grid(row=r, column=0, columnspan=3, sticky="w", **pad)
        self.run_btn = ttk.Button(bf, text="分析字幕", command=self._run_analysis)
        self.run_btn.pack(side="left", padx=4)
        ttk.Button(bf, text="导出 JSON…", command=self._export_json).pack(side="left", padx=10)

        r += 1
        ttk.Label(frm, text="结果").grid(row=r, column=0, sticky="nw", **pad)
        self.result_text = scrolledtext.ScrolledText(frm, height=24, wrap="word", font=("Consolas", 10))
        self.result_text.grid(row=r, column=1, columnspan=2, sticky="nsew", **pad)

        frm.columnconfigure(1, weight=1)
        frm.rowconfigure(r, weight=1)

        self._last_result: dict | None = None

    def _log(self, msg: str) -> None:
        self.log_q.put(("log", msg))

    def _poll_log(self) -> None:
        while True:
            try:
                ev, pl = self.log_q.get_nowait()
            except queue.Empty:
                break
            if ev == "result":
                self._show_result(pl)  # type: ignore[arg-type]
            elif ev == "error":
                messagebox.showerror("失败", str(pl))
            elif ev == "done":
                self._set_busy(False)
        self.root.after(200, self._poll_log)

    def _set_busy(self, busy: bool) -> None:
        self.run_btn.config(state=("disabled" if busy else "normal"))

    def _pick_srt(self) -> None:
        p = filedialog.askopenfilename(
            title="选择英文字幕 SRT",
            filetypes=[("SubRip", "*.srt"), ("All files", "*.*")],
        )
        if p:
            self.srt_var.set(p)

    def _load_saved_credentials(self) -> None:
        api_key, base_url, model = load_credentials()
        if api_key:
            self.api_key_var.set(api_key)
        if base_url:
            self.base_url_var.set(base_url)
        if model:
            self.model_var.set(model)

    def _save_creds(self) -> None:
        save_credentials(
            api_key=self.api_key_var.get(),
            base_url=self.base_url_var.get(),
            model=self.model_var.get(),
        )
        messagebox.showinfo("已保存", "已保存 API Key / Base URL / Model。")

    def _clear_creds(self) -> None:
        if not messagebox.askokcancel("清除", "确定清除本地保存的 API Key？"):
            return
        clear_credentials()
        self.api_key_var.set("")
        messagebox.showinfo("已清除", "已清除。")

    def _run_analysis(self) -> None:
        if self.worker and self.worker.is_alive():
            messagebox.showwarning("正在运行", "上一次分析尚未完成。")
            return
        srt = self.srt_var.get().strip()
        if not srt:
            messagebox.showwarning("缺少文件", "请先选择一个英文 SRT。")
            return
        if not Path(srt).is_file():
            messagebox.showerror("文件不存在", srt)
            return

        try:
            temperature = float(self.temp_var.get().strip() or "0.2")
        except ValueError:
            messagebox.showerror("参数错误", "Temperature 必须是数字。")
            return

        self._set_busy(True)
        self.result_text.delete("1.0", "end")
        self.result_text.insert("end", "分析中…\n")

        def work() -> None:
            try:
                out = rate_srt_file_best_effort(
                    srt_path=Path(srt),
                    api_key=self.api_key_var.get(),
                    base_url=self.base_url_var.get(),
                    model=self.model_var.get(),
                    temperature=temperature,
                )
                self.log_q.put(("result", out))
            except Exception as e:
                self.log_q.put(("error", str(e)))
            finally:
                self.log_q.put(("done", None))

        self.worker = threading.Thread(target=work, daemon=True)
        self.worker.start()

    def _show_result(self, obj: dict) -> None:
        self._last_result = obj
        self.result_text.delete("1.0", "end")
        stars = None
        try:
            stars = obj.get("llm", {}).get("stars_1_5")
        except Exception:
            stars = None
        if stars:
            self.result_text.insert("end", f"推荐难度：{stars} 星\n\n")
        if obj.get("error"):
            self.result_text.insert("end", f"模型侧失败：{obj['error'].get('message','')}\n\n")
        self.result_text.insert("end", json.dumps(obj, ensure_ascii=False, indent=2))
        self.result_text.see("1.0")

    def _export_json(self) -> None:
        if not self._last_result:
            messagebox.showwarning("无结果", "请先分析字幕。")
            return
        p = filedialog.asksaveasfilename(
            title="保存结果 JSON",
            defaultextension=".json",
            filetypes=[("JSON", "*.json"), ("All files", "*.*")],
        )
        if not p:
            return
        Path(p).write_text(json.dumps(self._last_result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        messagebox.showinfo("已保存", p)


def main() -> None:
    _ensure_stdio_streams()
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()

