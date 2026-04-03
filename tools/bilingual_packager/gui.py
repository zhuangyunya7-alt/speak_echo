# -*- coding: utf-8 -*-
"""SpeakEcho 双语字幕打包工具 — 图形界面"""

from __future__ import annotations

import json
import os
import queue
import sys
import threading
from typing import Any, Optional, TextIO
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, scrolledtext, ttk

from .packager_pipeline import build_main_subtitle_json
from .vocab_cards_html import write_word_cards_html
from .pasted_vocab_table import lemmas_in_order, parse_pasted_vocab_table, vocab_paste_sidecar_document
from .pasted_phrase_table import parse_pasted_phrase_table
from .vocab_display_hunyuan import (
    all_lemmas_from_vocab_levels,
    build_vocab_display_from_packager_meta,
    resolve_packager_meta,
)
from .vocab_levels import normalize_lemma, write_vocabulary_levels_hard_only

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


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


class App:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("SpeakEcho 双语字幕打包")
        self.root.geometry("920x820")
        self.root.minsize(860, 700)

        self.log_q: queue.Queue[tuple[str, object]] = queue.Queue()
        self.worker: threading.Thread | None = None

        self.vocab_tree_lemma_row: dict[str, str] = {}
        self.vocab_progress_var = tk.DoubleVar(value=0.0)
        self.vocab_progress_text_var = tk.StringVar(value="未开始")
        self.vocab_cancel_event: threading.Event | None = None
        self.vocab_stop_btn: ttk.Button | None = None
        self.phrase_staged: list[dict[str, Any]] = []

        repo = _repo_root()
        default_out = repo / "content-inbox"
        self.out_dir_var = tk.StringVar(value=str(default_out))
        self.prefix_var = tk.StringVar(value="")
        self.en_srt_var = tk.StringVar()
        self.zh_srt_var = tk.StringVar()
        self.sonix_csv_var = tk.StringVar()

        nb = ttk.Notebook(root)
        nb.pack(fill="both", expand=True, padx=8, pady=8)

        tab_main = ttk.Frame(nb)
        tab_vocab = ttk.Frame(nb)
        tab_phrase = ttk.Frame(nb)
        nb.add(tab_main, text="打包")
        nb.add(tab_vocab, text="生词审核与 vocab_display")
        nb.add(tab_phrase, text="词组标注（英中对照）")

        self._build_tab_main(tab_main)
        self._build_tab_vocab(tab_vocab)
        self._build_tab_phrase(tab_phrase)

        self._poll_log()

    def _log(self, msg: str) -> None:
        self.log_q.put(("log", msg))

    def _build_tab_main(self, frm: ttk.Frame) -> None:
        pad = {"padx": 8, "pady": 4}
        r = 0
        ttk.Label(frm, text="输出目录").grid(row=r, column=0, sticky="nw", **pad)
        ttk.Entry(frm, textvariable=self.out_dir_var, width=72).grid(row=r, column=1, sticky="we", **pad)
        ttk.Button(frm, text="浏览…", command=self._pick_out_dir).grid(row=r, column=2, **pad)
        r += 1
        ttk.Label(frm, text="输出前缀 (video_id)").grid(row=r, column=0, sticky="nw", **pad)
        ttk.Entry(frm, textvariable=self.prefix_var, width=32).grid(row=r, column=1, sticky="w", **pad)
        ttk.Label(frm, text="如 E_7UDaO_YF8，生成 E_7UDaO_YF8.json", foreground="#555").grid(
            row=r, column=1, sticky="w", padx=(240, 8)
        )
        r += 1
        ttk.Label(frm, text="英文 SRT").grid(row=r, column=0, sticky="nw", **pad)
        ttk.Entry(frm, textvariable=self.en_srt_var, width=72).grid(row=r, column=1, sticky="we", **pad)
        ttk.Button(frm, text="浏览…", command=lambda: self._pick_file(self.en_srt_var)).grid(row=r, column=2, **pad)
        r += 1
        ttk.Label(frm, text="中文 SRT").grid(row=r, column=0, sticky="nw", **pad)
        ttk.Entry(frm, textvariable=self.zh_srt_var, width=72).grid(row=r, column=1, sticky="we", **pad)
        ttk.Button(frm, text="浏览…", command=lambda: self._pick_file(self.zh_srt_var)).grid(row=r, column=2, **pad)
        r += 1
        ttk.Label(frm, text="Sonix 词级 CSV (可选)").grid(row=r, column=0, sticky="nw", **pad)
        ttk.Entry(frm, textvariable=self.sonix_csv_var, width=72).grid(row=r, column=1, sticky="we", **pad)
        ttk.Button(frm, text="浏览…", command=lambda: self._pick_sonix_csv()).grid(row=r, column=2, **pad)
        r += 1
        ttk.Label(
            frm,
            text="Sonix 导出列：Word, Start Timecode, End Timecode。时间支持 HH:MM:SS.cc 或四段 HH:MM:SS:微秒（如 00:00:00:10800）。留空则 words[] 为空。",
            foreground="#555",
        ).grid(row=r, column=1, columnspan=2, sticky="w", **pad)
        r += 1
        bf = ttk.Frame(frm)
        bf.grid(row=r, column=0, columnspan=3, sticky="w", **pad)
        ttk.Button(bf, text="① 生成主字幕 JSON", command=self._run_main_json).pack(side="left", padx=4)
        r += 1

        ttk.Label(frm, text="日志").grid(row=r, column=0, sticky="nw", **pad)
        self.log_text = tk.Text(frm, height=14, wrap="word")
        self.log_text.grid(row=r + 1, column=0, columnspan=3, sticky="nsew", **pad)
        sb = ttk.Scrollbar(frm, command=self.log_text.yview)
        sb.grid(row=r + 1, column=3, sticky="ns")
        self.log_text["yscrollcommand"] = sb.set
        frm.columnconfigure(1, weight=1)
        frm.rowconfigure(r + 1, weight=1)

    def _build_tab_vocab(self, frm: ttk.Frame) -> None:
        pad = {"padx": 8, "pady": 4}
        ttk.Label(
            frm,
            text="① 在「打包」页生成主 JSON 后：在此粘贴「序号、单词、音标、中文、语境」表（Tab 分列，与 Excel 一致），"
            "点「② 生成分级词表 JSON」写入 {前缀}_vocabulary_levels.json（仅难词列表，供网页紫下划线）与同前缀的 "
            "{前缀}_vocab_paste_meta.json（仅本机生成③用，勿上传 COS）。"
            "列表中勾选后点「③」生成 {前缀}_vocab_display.json（网页点词释义；音标与中文来自粘贴）。"
            "「导出所选词表」仅用于把当前勾选词条另存为审核用 JSON（不写入 _vocabulary_levels）。",
            wraplength=880,
        ).pack(anchor="w", **pad)
        lf_paste = ttk.Labelframe(frm, text="粘贴生词表", padding=6)
        lf_paste.pack(fill="both", expand=False, padx=8, pady=(0, 4))
        self.vocab_paste = scrolledtext.ScrolledText(lf_paste, height=9, wrap="word", font=("Consolas", 10))
        self.vocab_paste.pack(fill="both", expand=True)
        bar = ttk.Frame(frm)
        bar.pack(fill="x", **pad)
        ttk.Button(bar, text="② 生成分级词表 JSON", command=self._run_vocab_levels_from_paste).pack(side="left", padx=4)
        ttk.Button(bar, text="刷新列表（读难词表）", command=self._refresh_vocab_tree).pack(side="left", padx=4)
        ttk.Button(bar, text="全选", command=lambda: self._vocab_check_all(True)).pack(side="left", padx=4)
        ttk.Button(bar, text="全不选", command=lambda: self._vocab_check_all(False)).pack(side="left", padx=4)
        ttk.Button(bar, text="导出所选词表 JSON", command=self._export_selected_vocab).pack(side="left", padx=4)
        ttk.Button(bar, text="③ 勾选词 → vocab_display", command=self._run_vocab_display).pack(side="left", padx=8)
        ttk.Button(bar, text="④ 全部词 → vocab_display", command=self._run_vocab_display_all).pack(side="left", padx=4)
        bar2 = ttk.Frame(frm)
        bar2.pack(fill="x", **pad)
        ttk.Button(bar2, text="导出单词卡片 HTML", command=self._export_word_cards_html).pack(side="left", padx=4)
        ttk.Label(bar2, text="（需已生成 {前缀}_vocab_display.json，浏览器打开可打印）", foreground="#555").pack(
            side="left", padx=8
        )
        prog = ttk.Frame(frm)
        prog.pack(fill="x", **pad)
        ttk.Label(prog, text="生成进度").pack(side="left", padx=(4, 8))
        ttk.Progressbar(
            prog,
            variable=self.vocab_progress_var,
            maximum=100.0,
            mode="determinate",
            length=260,
        ).pack(side="left")
        ttk.Label(prog, textvariable=self.vocab_progress_text_var, foreground="#555").pack(side="left", padx=10)
        self.vocab_stop_btn = ttk.Button(
            prog,
            text="终止本次生成",
            command=self._cancel_vocab_task,
            state="disabled",
        )
        self.vocab_stop_btn.pack(side="right", padx=(8, 4))

        cols = ("on", "level", "lemma")
        self.vocab_tree = ttk.Treeview(frm, columns=cols, show="headings", height=22, selectmode="browse")
        self.vocab_tree.heading("on", text="选")
        self.vocab_tree.heading("level", text="级别")
        self.vocab_tree.heading("lemma", text="词")
        self.vocab_tree.column("on", width=36, anchor="center")
        self.vocab_tree.column("level", width=64, anchor="center")
        self.vocab_tree.column("lemma", width=280, anchor="w")
        vsb = ttk.Scrollbar(frm, orient="vertical", command=self.vocab_tree.yview)
        self.vocab_tree.configure(yscrollcommand=vsb.set)
        self.vocab_tree.pack(side="left", fill="both", expand=True, padx=(8, 0), pady=4)
        vsb.pack(side="right", fill="y", pady=4, padx=(0, 8))
        self.vocab_tree.bind("<Button-1>", self._on_vocab_tree_click)

    def _build_tab_phrase(self, frm: ttk.Frame) -> None:
        pad = {"padx": 8, "pady": 4}
        ttk.Label(
            frm,
            text="粘贴「序号、词组、中文翻译、语境参考」（Tab 分列）→「导入筛选词组」→「写入词组侧车」生成 {前缀}_phrases.json。"
            "主字幕 {前缀}.json 仍可只保留句级与词级；网页会加载侧车并按英文对齐到各句 words[] 后显示词组紫下划线与点译。",
            wraplength=880,
        ).pack(anchor="w", **pad)

        lf = ttk.Labelframe(frm, text="粘贴筛选词组表", padding=6)
        lf.pack(fill="both", expand=False, padx=8, pady=(0, 4))
        self.phrase_paste = scrolledtext.ScrolledText(lf, height=9, wrap="word", font=("Consolas", 10))
        self.phrase_paste.pack(fill="both", expand=True)

        bar_act = ttk.Frame(frm)
        bar_act.pack(fill="x", **pad)
        ttk.Button(bar_act, text="导入筛选词组", command=self._phrase_import_filtered_table).pack(side="left", padx=4)
        ttk.Button(bar_act, text="写入词组侧车（_phrases.json）", command=self._phrase_write_phrases_sidecar).pack(
            side="left", padx=4
        )
        ttk.Button(bar_act, text="清空待保存列表", command=self._phrase_clear_staged).pack(side="left", padx=4)
        self.phrase_batch_var = tk.StringVar(value="待保存：0 条")
        ttk.Label(bar_act, textvariable=self.phrase_batch_var, foreground="#555").pack(side="left", padx=12)

        ttk.Label(
            frm,
            text="下方：预览/待保存列表（JSON）。写入侧车时仅输出 text / zh / reason；不含 source。",
            foreground="#555",
        ).pack(anchor="w", padx=8, pady=(4, 0))
        self.phrase_meta = tk.Text(frm, height=16, wrap="word", font=("Consolas", 9))
        self.phrase_meta.pack(fill="both", expand=True, padx=8, pady=(0, 8))

        self.phrase_staged.clear()
        self._phrase_refresh_staged_view()

    def _phrase_import_filtered_table(self) -> None:
        text = self.phrase_paste.get("1.0", "end").strip() if hasattr(self, "phrase_paste") else ""
        if not text:
            messagebox.showwarning("粘贴", "请先在上方粘贴词组表（序号、词组、中文翻译、语境参考，Tab 分列）。")
            return
        rows, warnings = parse_pasted_phrase_table(text)
        if not rows:
            messagebox.showwarning("粘贴", "未能解析出任何词组。请确认是 Tab 分列且包含「词组」「中文翻译」列。")
            return
        for w in warnings[:15]:
            self._log(f"词组粘贴解析: {w}")
        added = 0
        seen = {(str(r.get("text", "")).strip().lower(), str(r.get("zh", "")).strip()) for r in self.phrase_staged}
        for r in rows:
            k = (r.phrase.strip().lower(), r.zh.strip())
            if k in seen:
                continue
            seen.add(k)
            self.phrase_staged.append(
                {
                    "text": r.phrase.strip(),
                    "zh": r.zh.strip(),
                    "reason": (r.context.strip() or "学习重点词组"),
                    "source": "pasted_filter",
                }
            )
            added += 1
        self._phrase_refresh_staged_view()
        messagebox.showinfo("导入完成", f"已加入 {added} 条词组到待保存列表。")

    def _pick_out_dir(self) -> None:
        d = filedialog.askdirectory()
        if d:
            self.out_dir_var.set(d)

    def _pick_file(self, var: tk.StringVar) -> None:
        p = filedialog.askopenfilename(filetypes=[("SRT", "*.srt"), ("All", "*.*")])
        if p:
            var.set(p)

    def _pick_sonix_csv(self) -> None:
        p = filedialog.askopenfilename(filetypes=[("CSV", "*.csv"), ("All", "*.*")])
        if p:
            self.sonix_csv_var.set(p)

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
            elif ev == "phrase_refresh":
                self._phrase_refresh_staged_view()
            elif ev == "vocab_progress":
                done, total, lemma = pl  # type: ignore[misc]
                total_n = max(1, int(total))
                done_n = max(0, min(int(done), total_n))
                pct = (done_n / total_n) * 100.0
                self.vocab_progress_var.set(pct)
                if lemma:
                    self.vocab_progress_text_var.set(f"{done_n}/{total_n}（{pct:.1f}%） 当前：{lemma}")
                else:
                    self.vocab_progress_text_var.set(f"{done_n}/{total_n}（{pct:.1f}%）")
            elif ev == "vocab_done":
                outp = str(pl)
                self.vocab_progress_var.set(100.0)
                self.vocab_progress_text_var.set("已完成")
                if self.vocab_stop_btn:
                    self.vocab_stop_btn.config(state="disabled")
                self.vocab_cancel_event = None
                messagebox.showinfo("完成", f"已写入：\n{outp}")
            elif ev == "vocab_cancelled":
                outp = str(pl)
                if self.vocab_stop_btn:
                    self.vocab_stop_btn.config(state="disabled")
                self.vocab_cancel_event = None
                self.vocab_progress_text_var.set("已终止（已保存已完成部分）")
                messagebox.showinfo("已终止", f"已停止继续处理，并写入当前结果：\n{outp}")
            elif ev == "vocab_error":
                if self.vocab_stop_btn:
                    self.vocab_stop_btn.config(state="disabled")
                self.vocab_cancel_event = None
                self.vocab_progress_text_var.set("失败")
                messagebox.showerror("失败", str(pl))
        self.root.after(200, self._poll_log)

    def _cancel_vocab_task(self) -> None:
        if self.vocab_cancel_event is None:
            return
        self.vocab_cancel_event.set()
        self.vocab_progress_text_var.set("已请求终止，等待当前词完成…")

    def _prefix(self) -> str:
        return self.prefix_var.get().strip()

    def _out_dir(self) -> Path:
        return Path(self.out_dir_var.get().strip())

    def _run_in_thread(self, fn, *, done_msg: str | None = None) -> None:
        if self.worker and self.worker.is_alive():
            messagebox.showinfo("忙", "上一任务仍在运行。")
            return

        def wrap() -> None:
            try:
                fn()
                if done_msg:
                    self.log_q.put(("log", done_msg))
            except Exception as e:
                self.log_q.put(("log", f"错误: {e}"))
        self.worker = threading.Thread(target=wrap, daemon=True)
        self.worker.start()

    def _run_main_json(self) -> None:
        px = self._prefix()
        if not px:
            messagebox.showwarning("前缀", "请填写输出前缀。")
            return
        en = Path(self.en_srt_var.get().strip())
        zh = Path(self.zh_srt_var.get().strip())
        if not en.is_file() or not zh.is_file():
            messagebox.showwarning("SRT", "请选择有效的英文与中文 SRT。")
            return
        csv_s = self.sonix_csv_var.get().strip()
        sonix_csv = Path(csv_s) if csv_s else None

        def job() -> None:
            build_main_subtitle_json(
                en_srt=en,
                zh_srt=zh,
                output_dir=self._out_dir(),
                output_prefix=px,
                sonix_csv=sonix_csv,
                logger=lambda m: self.log_q.put(("log", m)),
            )
        self._run_in_thread(job, done_msg="① 完成。")

    def _run_vocab_levels_from_paste(self) -> None:
        """写入 {前缀}_vocabulary_levels.json（仅难词列表）与 {前缀}_vocab_paste_meta.json（释义侧车）。"""
        paste = self.vocab_paste.get("1.0", "end").strip()
        if not paste:
            messagebox.showwarning("粘贴", "请先在上方粘贴生词表（序号、单词、音标、中文、语境，Tab 分列）。")
            return
        px = self._prefix()
        if not px:
            messagebox.showwarning("前缀", "请先在「打包」页填写输出前缀（与主 JSON 同名，如 video_id）。")
            return
        out_dir = self._out_dir()
        out_dir.mkdir(parents=True, exist_ok=True)
        rows, warnings = parse_pasted_vocab_table(paste)
        for w in warnings[:15]:
            self._log(f"粘贴解析: {w}")
        if warnings:
            self._log(f"粘贴解析提示共 {len(warnings)} 条（见上最多 15 条）")
        if not rows:
            messagebox.showwarning(
                "粘贴",
                "未能解析出任何词条。\n请使用 Tab 分列：序号、单词、音标、中文、语境（表头可保留）。",
            )
            return
        lemmas = lemmas_in_order(rows)
        path_levels = out_dir / f"{px}_vocabulary_levels.json"
        path_meta = out_dir / f"{px}_vocab_paste_meta.json"
        write_vocabulary_levels_hard_only(path_levels, lemmas)
        path_meta.write_text(
            json.dumps(vocab_paste_sidecar_document(rows), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        self._log(f"② 难词表（网页）: {path_levels}（{len(lemmas)} 词）")
        self._log(f"② 释义侧车（本机③）: {path_meta}")
        self._refresh_vocab_tree()
        self._vocab_check_all(True)
        messagebox.showinfo(
            "② 完成",
            f"已写入：\n• {path_levels.name}（上传用，无中文重复）\n• {path_meta.name}（仅本机保留，供③）\n"
            f"共 {len(lemmas)} 个词，列表已全选。",
        )

    def _refresh_vocab_tree(self) -> None:
        px = self._prefix()
        if not px:
            messagebox.showwarning("前缀", "请填写输出前缀。")
            return
        path = self._out_dir() / f"{px}_vocabulary_levels.json"
        if not path.is_file():
            messagebox.showwarning(
                "文件",
                f"未找到 {path.name}。\n请先在本页粘贴生词表并点「② 生成分级词表 JSON」，或自行放入该文件。",
            )
            return
        data = json.loads(path.read_text(encoding="utf-8"))
        for x in self.vocab_tree.get_children():
            self.vocab_tree.delete(x)
        self.vocab_tree_lemma_row.clear()
        meta = resolve_packager_meta(path, data)
        order = (
            ("hard", "粘贴"),
            ("words", "粘贴"),
            ("hard_words", "粘贴"),
            ("难词", "粘贴"),
            ("IELTS", "IELTS"),
            ("CET6", "CET6"),
            ("CET4", "CET4"),
        )
        for lvl_key, lvl_label in order:
            words = data.get(lvl_key) or []
            if not isinstance(words, list):
                continue
            if lvl_key in ("hard", "words", "hard_words", "难词"):
                iter_words = [str(x).strip() for x in words if isinstance(x, str) and str(x).strip()]
            else:
                iter_words = sorted(
                    [str(x).strip() for x in words if isinstance(x, str) and str(x).strip()],
                    key=lambda s: s.lower(),
                )
            for w in iter_words:
                lem = normalize_lemma(w)
                if not lem:
                    continue
                mrow = meta.get(lem)
                surface = str(mrow.get("word")).strip() if isinstance(mrow, dict) and mrow.get("word") else w
                row = self.vocab_tree.insert("", "end", values=("☐", lvl_label, surface))
                self.vocab_tree_lemma_row[lem] = row
        self._log(f"已加载难词表 {len(self.vocab_tree_lemma_row)} 条")

    def _on_vocab_tree_click(self, event: tk.Event) -> None:
        region = self.vocab_tree.identify_region(event.x, event.y)
        if region != "cell":
            return
        row = self.vocab_tree.identify_row(event.y)
        col = self.vocab_tree.identify_column(event.x)
        if not row or col != "#1":
            return
        vals = list(self.vocab_tree.item(row, "values"))
        if len(vals) < 3:
            return
        vals[0] = "☑" if vals[0] == "☐" else "☐"
        self.vocab_tree.item(row, values=vals)

    def _vocab_check_all(self, on: bool) -> None:
        sym = "☑" if on else "☐"
        for row in self.vocab_tree.get_children():
            vals = list(self.vocab_tree.item(row, "values"))
            if len(vals) >= 3:
                vals[0] = sym
                self.vocab_tree.item(row, values=vals)

    def _collect_checked_lemmas(self) -> list[str]:
        out: list[str] = []
        for row in self.vocab_tree.get_children():
            vals = self.vocab_tree.item(row, "values")
            if len(vals) >= 3 and vals[0] == "☑":
                surface = str(vals[2])
                out.append(normalize_lemma(surface) or surface.lower().strip())
        return out

    def _export_selected_vocab(self) -> None:
        paste = self.vocab_paste.get("1.0", "end").strip()
        if paste:
            messagebox.showinfo(
                "提示",
                "写入整条难词表到 content-inbox 请点「② 生成分级词表 JSON」。\n"
                "「导出所选词表」仅用于把下方列表里当前勾选的词另存为审核用 JSON。",
            )
            return

        lemmas = self._collect_checked_lemmas()
        if not lemmas:
            messagebox.showinfo(
                "导出",
                "请先在列表中勾选若干词；或先粘贴并点「② 生成分级词表 JSON」生成主难词表。",
            )
            return
        px = self._prefix() or "vocab_subset"
        p = filedialog.asksaveasfilename(
            defaultextension=".json",
            initialfile=f"{px}_vocab_review.json",
            filetypes=[("JSON", "*.json")],
        )
        if not p:
            return
        Path(p).write_text(
            json.dumps({"version": 1, "lemmas": lemmas}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        messagebox.showinfo("导出", f"已保存 {len(lemmas)} 个词")

    def _run_vocab_display(self) -> None:
        lemmas = self._collect_checked_lemmas()
        if not lemmas:
            messagebox.showwarning("生词", "请先在列表中勾选要生成的词。")
            return
        px = self._prefix()
        if not px:
            messagebox.showwarning("前缀", "请填写输出前缀。")
            return
        outd = self._out_dir()
        sub = outd / f"{px}.json"
        voc = outd / f"{px}_vocabulary_levels.json"
        outp = outd / f"{px}_vocab_display.json"
        if not sub.is_file() or not voc.is_file():
            messagebox.showerror(
                "文件",
                "缺少主 JSON 或难词表。\n请先「打包」页生成主 JSON，本页粘贴后点「② 生成分级词表 JSON」。",
            )
            return

        try:
            vdoc = json.loads(voc.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as e:
            messagebox.showerror("文件", f"无法读取难词表：{e}")
            return
        meta = resolve_packager_meta(voc, vdoc)
        if not (
            meta
            and all(normalize_lemma(lem) in meta for lem in lemmas)
        ):
            messagebox.showwarning(
                "词表",
                "当前勾选词在粘贴释义数据中缺少项。\n请用「②」从粘贴重新生成 "
                f"{px}_vocabulary_levels.json 与同前缀的 {px}_vocab_paste_meta.json。",
            )
            return
        self._start_vocab_display_local_task(
            subtitle_path=sub,
            vocab_levels_path=voc,
            out_path=outp,
            selected_lemmas=lemmas,
            done_msg="③ vocab_display 完成。",
        )

    def _run_vocab_display_all(self) -> None:
        px = self._prefix()
        if not px:
            messagebox.showwarning("前缀", "请填写输出前缀。")
            return
        outd = self._out_dir()
        sub = outd / f"{px}.json"
        voc = outd / f"{px}_vocabulary_levels.json"
        outp = outd / f"{px}_vocab_display.json"
        if not sub.is_file() or not voc.is_file():
            messagebox.showerror(
                "文件",
                "缺少主 JSON 或难词表。\n请先「打包」页①生成主 JSON，本页粘贴后点「② 生成分级词表 JSON」。",
            )
            return
        try:
            vdoc = json.loads(voc.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as e:
            messagebox.showerror("文件", f"无法读取难词表：{e}")
            return
        lemmas = all_lemmas_from_vocab_levels(vdoc)
        if not lemmas:
            messagebox.showwarning("生词", "难词表中没有可处理的词。")
            return
        meta = resolve_packager_meta(voc, vdoc)
        if not (meta and all(lem in meta for lem in lemmas)):
            messagebox.showwarning(
                "词表",
                "缺少与难词表配套的粘贴释义数据。\n"
                "请在本页粘贴后重新点「② 生成分级词表 JSON」（会生成 vocabulary_levels + vocab_paste_meta）。",
            )
            return
        if not messagebox.askokcancel(
            "确认",
            f"将为全部 {len(lemmas)} 个词生成 vocab_display（音标与中文来自粘贴元数据）。是否继续？",
        ):
            return
        self._start_vocab_display_local_task(
            subtitle_path=sub,
            vocab_levels_path=voc,
            out_path=outp,
            selected_lemmas=lemmas,
            done_msg="④ 全部词 vocab_display 完成。",
        )

    def _start_vocab_display_local_task(
        self,
        *,
        subtitle_path: Path,
        vocab_levels_path: Path,
        out_path: Path,
        selected_lemmas: list[str],
        done_msg: str,
    ) -> None:
        if self.worker and self.worker.is_alive():
            messagebox.showinfo("忙", "上一任务仍在运行。")
            return
        self.vocab_progress_var.set(0.0)
        self.vocab_progress_text_var.set(f"0/{len(selected_lemmas)}（0.0%）")
        self.vocab_cancel_event = threading.Event()
        if self.vocab_stop_btn:
            self.vocab_stop_btn.config(state="normal")

        def job() -> None:
            try:
                build_vocab_display_from_packager_meta(
                    subtitle_path=subtitle_path,
                    vocab_levels_path=vocab_levels_path,
                    out_path=out_path,
                    selected_lemmas=selected_lemmas,
                    logger=lambda m: self.log_q.put(("log", m)),
                    progress_cb=lambda d, t, lem: self.log_q.put(("vocab_progress", (d, t, lem))),
                    cancel_event=self.vocab_cancel_event,
                )
                self.log_q.put(("log", done_msg))
                if self.vocab_cancel_event and self.vocab_cancel_event.is_set():
                    self.log_q.put(("vocab_cancelled", str(out_path)))
                else:
                    self.log_q.put(("vocab_done", str(out_path)))
            except Exception as e:
                self.log_q.put(("log", f"错误: {e}"))
                self.log_q.put(("vocab_error", str(e)))

        self.worker = threading.Thread(target=job, daemon=True)
        self.worker.start()

    def _export_word_cards_html(self) -> None:
        px = self._prefix()
        if not px:
            messagebox.showwarning("前缀", "请填写输出前缀。")
            return
        outd = self._out_dir()
        vd = outd / f"{px}_vocab_display.json"
        if not vd.is_file():
            messagebox.showerror("文件", f"未找到 {vd.name}，请先运行 ③ 或 ④。")
            return
        outp = outd / f"{px}_word_cards.html"
        try:
            write_word_cards_html(
                vocab_display_path=vd,
                out_path=outp,
                title=f"{px} 单词卡片",
            )
        except (OSError, ValueError) as e:
            messagebox.showerror("导出失败", str(e))
            return
        self._log(f"已导出 {outp}")
        messagebox.showinfo("导出", f"已写入：\n{outp}\n可用浏览器打开并打印。")

    def _phrase_refresh_staged_view(self) -> None:
        self.phrase_meta.delete("1.0", "end")
        self.phrase_meta.insert(
            "1.0",
            json.dumps(self.phrase_staged, ensure_ascii=False, indent=2) + "\n",
        )
        self.phrase_batch_var.set(f"待保存：{len(self.phrase_staged)} 条")

    def _phrase_write_phrases_sidecar(self) -> None:
        px = self._prefix()
        if not px:
            messagebox.showwarning("前缀", "请先在「打包」页填写输出前缀（与主字幕 JSON 同名）。")
            return
        if not self.phrase_staged:
            messagebox.showinfo("提示", "待保存列表为空，请先「导入筛选词组」。")
            return
        out_dir = self._out_dir()
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / f"{px}_phrases.json"
        items: list[dict[str, Any]] = []
        for row in self.phrase_staged:
            text = str(row.get("text", "")).strip()
            if not text:
                continue
            it: dict[str, Any] = {"text": text}
            zh = str(row.get("zh", "")).strip()
            if zh:
                it["zh"] = zh
            r = str(row.get("reason", "")).strip()
            if r:
                it["reason"] = r
            items.append(it)
        doc = {
            "version": 1,
            "video_id": px,
            "note": "词组侧车：与主字幕同目录、同 video_id 前缀；网页加载后按词面并入各句 phrases（需主 JSON 含 words[]）。",
            "items": items,
        }
        path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        self._log(f"词组侧车: {path}（{len(items)} 条）")
        messagebox.showinfo("已写入", f"{path}\n共 {len(items)} 条。")

    def _phrase_clear_staged(self) -> None:
        if not self.phrase_staged:
            return
        if messagebox.askokcancel("清空", "确定清空待保存列表？"):
            self.phrase_staged.clear()
            self._phrase_refresh_staged_view()


def main() -> None:
    _ensure_stdio_streams()
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
