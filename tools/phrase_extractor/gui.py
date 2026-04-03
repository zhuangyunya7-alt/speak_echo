# -*- coding: utf-8 -*-
"""SpeakEcho 词组候选提取 — 图形界面（离线生成 *_phrases_candidates.json）"""

from __future__ import annotations

import os
import queue
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from typing import Optional, TextIO

from .run_extract import extract_to_candidates_file

_null_stdio: Optional[TextIO] = None


def _ensure_stdio_streams() -> None:
    global _null_stdio
    if sys.stdout is not None and sys.stderr is not None:
        return
    if _null_stdio is None:
        _null_stdio = open(os.devnull, "w", encoding="utf-8", errors="replace")
    if sys.stdout is None:
        sys.stdout = _null_stdio
    if sys.stderr is None:
        sys.stderr = _null_stdio


class PhraseExtractorApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("SpeakEcho 词组候选提取")
        self.root.geometry("720x560")
        self.root.minsize(640, 480)

        self.log_q: queue.Queue[tuple[str, object]] = queue.Queue()
        self.worker: threading.Thread | None = None

        self.input_var = tk.StringVar()
        self.output_var = tk.StringVar()
        self.strategy_var = tk.StringVar(value="balanced")
        self.max_sent_var = tk.IntVar(value=0)
        self.min_words_var = tk.IntVar(value=0)
        self.min_score_var = tk.IntVar(value=0)
        self.business_mode_var = tk.StringVar(value="preset")

        pad = {"padx": 8, "pady": 4}
        frm = ttk.Frame(root, padding=8)
        frm.pack(fill="both", expand=True)

        ttk.Label(
            frm,
            text="从主字幕 JSON（含 segments[] / words[]）生成候选词组文件，供「双语打包」词组页「导入候选词组 JSON」使用。",
            wraplength=680,
        ).pack(anchor="w", **pad)

        row1 = ttk.Frame(frm)
        row1.pack(fill="x", **pad)
        ttk.Label(row1, text="输入主字幕 JSON").pack(side="left")
        ttk.Entry(row1, textvariable=self.input_var, width=56).pack(side="left", fill="x", expand=True, padx=4)
        ttk.Button(row1, text="浏览…", command=self._pick_input).pack(side="left")

        row2 = ttk.Frame(frm)
        row2.pack(fill="x", **pad)
        ttk.Label(row2, text="输出路径（可空）").pack(side="left")
        ttk.Entry(row2, textvariable=self.output_var, width=56).pack(side="left", fill="x", expand=True, padx=4)
        ttk.Button(row2, text="浏览…", command=self._pick_output).pack(side="left")
        ttk.Label(
            frm,
            text="留空则与输入同目录，文件名为 {video_id 或文件名前缀}_phrases_candidates.json",
            foreground="#555",
        ).pack(anchor="w", padx=8)

        row3 = ttk.Frame(frm)
        row3.pack(fill="x", **pad)
        ttk.Label(row3, text="策略档位").pack(side="left", padx=(0, 8))
        cb = ttk.Combobox(
            row3,
            textvariable=self.strategy_var,
            values=("aggressive", "balanced", "conservative"),
            state="readonly",
            width=14,
        )
        cb.pack(side="left")

        adv = ttk.Labelframe(frm, text="可选覆盖（0 表示不覆盖，沿用档位默认值）", padding=6)
        adv.pack(fill="x", **pad)
        g = ttk.Frame(adv)
        g.pack(fill="x")
        ttk.Label(g, text="每句最多候选").grid(row=0, column=0, sticky="w", padx=4, pady=2)
        ttk.Spinbox(g, from_=0, to=12, textvariable=self.max_sent_var, width=6).grid(row=0, column=1, sticky="w")
        ttk.Label(g, text="最小词数").grid(row=0, column=2, sticky="w", padx=(16, 4), pady=2)
        ttk.Spinbox(g, from_=0, to=8, textvariable=self.min_words_var, width=6).grid(row=0, column=3, sticky="w")
        ttk.Label(g, text="最低分数").grid(row=0, column=4, sticky="w", padx=(16, 4), pady=2)
        ttk.Spinbox(g, from_=0, to=30, textvariable=self.min_score_var, width=6).grid(row=0, column=5, sticky="w")

        row_b = ttk.Frame(adv)
        row_b.pack(fill="x", pady=(6, 0))
        ttk.Label(row_b, text="商务术语加权").pack(side="left", padx=(4, 8))
        ttk.Radiobutton(row_b, text="跟随档位", variable=self.business_mode_var, value="preset").pack(side="left", padx=4)
        ttk.Radiobutton(row_b, text="强制开启", variable=self.business_mode_var, value="on").pack(side="left", padx=4)
        ttk.Radiobutton(row_b, text="强制关闭", variable=self.business_mode_var, value="off").pack(side="left", padx=4)

        bar = ttk.Frame(frm)
        bar.pack(fill="x", **pad)
        self.run_btn = ttk.Button(bar, text="开始提取并保存", command=self._run_extract)
        self.run_btn.pack(side="left", padx=4)
        ttk.Button(bar, text="打开输出文件所在文件夹", command=self._open_output_dir).pack(side="left", padx=4)

        ttk.Label(frm, text="日志").pack(anchor="w", **pad)
        log_fr = ttk.Frame(frm)
        log_fr.pack(fill="both", expand=True)
        self.log_text = tk.Text(log_fr, height=16, wrap="word", font=("Consolas", 9))
        sb = ttk.Scrollbar(log_fr, command=self.log_text.yview)
        self.log_text.pack(side="left", fill="both", expand=True)
        sb.pack(side="right", fill="y")
        self.log_text["yscrollcommand"] = sb.set

        self._poll_log()

    def _append_log(self, s: str) -> None:
        self.log_text.insert("end", s + "\n")
        self.log_text.see("end")

    def _poll_log(self) -> None:
        while True:
            try:
                ev, pl = self.log_q.get_nowait()
            except queue.Empty:
                break
            if ev == "log":
                self._append_log(str(pl))
            elif ev == "done":
                path, err = pl  # type: ignore[misc]
                self.run_btn.config(state="normal")
                self.worker = None
                if err is not None:
                    messagebox.showerror("失败", str(err))
                else:
                    messagebox.showinfo("完成", f"已写入：\n{path}")
        self.root.after(150, self._poll_log)

    def _pick_input(self) -> None:
        p = filedialog.askopenfilename(filetypes=[("JSON", "*.json"), ("All", "*.*")])
        if p:
            self.input_var.set(p)

    def _pick_output(self) -> None:
        p = filedialog.asksaveasfilename(
            defaultextension=".json",
            filetypes=[("JSON", "*.json")],
            initialfile=Path(self.input_var.get().strip() or "out").stem + "_phrases_candidates.json",
        )
        if p:
            self.output_var.set(p)

    def _open_output_dir(self) -> None:
        out = self.output_var.get().strip()
        inp = self.input_var.get().strip()
        d = Path(out).parent if out else (Path(inp).parent if inp else None)
        if d and d.is_dir():
            try:
                os.startfile(str(d))  # type: ignore[attr-defined]
            except Exception as e:
                messagebox.showwarning("打开文件夹", str(e))
        else:
            messagebox.showinfo("提示", "请先选择有效的输入或输出路径。")

    def _run_extract(self) -> None:
        if self.worker and self.worker.is_alive():
            messagebox.showinfo("忙", "上一任务仍在运行。")
            return
        inp_s = self.input_var.get().strip()
        if not inp_s:
            messagebox.showwarning("输入", "请选择主字幕 JSON。")
            return
        inp = Path(inp_s)
        if not inp.is_file():
            messagebox.showerror("输入", f"文件不存在：{inp}")
            return

        out_s = self.output_var.get().strip()
        outp = Path(out_s) if out_s else None

        max_n = int(self.max_sent_var.get() or 0)
        min_w = int(self.min_words_var.get() or 0)
        min_sc = int(self.min_score_var.get() or 0)
        biz_mode = self.business_mode_var.get()
        biz: bool | None = None
        if biz_mode == "on":
            biz = True
        elif biz_mode == "off":
            biz = False

        strategy = self.strategy_var.get().strip() or "balanced"

        self.run_btn.config(state="disabled")
        self.log_text.delete("1.0", "end")

        def job() -> None:
            try:

                def log(m: str) -> None:
                    self.log_q.put(("log", m))

                path, doc = extract_to_candidates_file(
                    inp,
                    outp,
                    strategy,
                    max_per_sentence=max_n if max_n > 0 else None,
                    min_words=min_w if min_w > 0 else None,
                    min_score=min_sc if min_sc > 0 else None,
                    business_boost=biz,
                    logger=log,
                )
                st = doc.get("stats", {})
                log(
                    f"统计：aligned={st.get('aligned_added')} raw={st.get('raw_candidates')} "
                    f"deduped={st.get('deduped_candidates')} filtered={st.get('filtered_out')}"
                )
                self.log_q.put(("done", (str(path), None)))
            except Exception as e:
                self.log_q.put(("log", f"错误: {e}"))
                self.log_q.put(("done", ("", e)))

        self.worker = threading.Thread(target=job, daemon=True)
        self.worker.start()


def main() -> None:
    _ensure_stdio_streams()
    root = tk.Tk()
    PhraseExtractorApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
