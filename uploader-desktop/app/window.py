from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from PySide6.QtCore import QDateTime, QObject, QThread, Signal
from PySide6.QtWidgets import (
  QApplication,
  QComboBox,
  QDateTimeEdit,
  QDialog,
  QDialogButtonBox,
  QFileDialog,
  QFormLayout,
  QHBoxLayout,
  QHeaderView,
  QInputDialog,
  QLabel,
  QLineEdit,
  QMainWindow,
  QMessageBox,
  QPushButton,
  QPlainTextEdit,
  QSplitter,
  QTableWidget,
  QTableWidgetItem,
  QVBoxLayout,
  QWidget,
)

from core.job_executor import parse_job_time, run_due_jobs
from core.models import AppConfig, AssetRecord, QueuedJob, UploadTask
from core.taxonomy import default_taxonomy_path, load_taxonomy, parse_stored_category, topic_combo
from core.uploader import UploadService
from scheduler.manifest import write_manifest
from storage.repository import LocalRepository


class UploadWorker(QObject):
  progress = Signal(int, int, str)
  finished = Signal(list)

  def __init__(self, service: UploadService, tasks: list[UploadTask], config: AppConfig):
    super().__init__()
    self.service = service
    self.tasks = tasks
    self.config = config

  def run(self) -> None:
    results = self.service.run_batch(self.tasks, self.config, self.progress.emit)
    self.finished.emit(results)


class UploaderWindow(QMainWindow):
  COL_VIDEO = 0
  COL_TITLE = 1
  COL_SUBTITLE = 2
  COL_VOCAB = 3
  COL_VOCAB_DISPLAY = 4
  COL_PHRASES = 5
  COL_LEVEL = 6
  COL_CATEGORY = 7
  COL_DESC = 8
  COL_SCHEDULE = 9
  COL_STATUS = 10
  COL_PROGRESS = 11
  ASSET_ID = 0
  ASSET_TITLE = 1
  ASSET_ACTIVE = 2
  ASSET_CREATED = 3
  ASSET_VIDEO_KEY = 4
  ASSET_SUBTITLE_KEY = 5
  ASSET_VOCAB_KEY = 6
  ASSET_VOCAB_DISPLAY_KEY = 7
  ASSET_PHRASES_KEY = 8
  STAR_LEVELS = ["★☆☆☆☆", "★★☆☆☆", "★★★☆☆", "★★★★☆", "★★★★★"]

  def __init__(self) -> None:
    super().__init__()
    self.repo = LocalRepository()
    self.config = self.repo.load_config()
    self._taxonomy: dict[str, list[str]] = {}
    self.upload_service = UploadService()
    self.thread: QThread | None = None
    self.worker: UploadWorker | None = None
    self._setup_ui()
    self._reload_taxonomy(show_error_dialog=True)

  def _setup_ui(self) -> None:
    self.setWindowTitle("SpeakEcho 网站内容后台")
    self.resize(1440, 860)

    root = QWidget(self)
    self.setCentralWidget(root)
    layout = QVBoxLayout(root)

    self.api_input = QLineEdit(self.config.publish_api_url)
    self.api_token_input = QLineEdit(self.config.publish_api_token)
    self.bucket_input = QLineEdit(self.config.cos_bucket)
    self.region_input = QLineEdit(self.config.cos_region)
    self.secret_id_input = QLineEdit(self.config.cos_secret_id)
    self.secret_key_input = QLineEdit(self.config.cos_secret_key)
    self.cdn_domain_input = QLineEdit(self.config.cdn_domain)
    self.api_token_input.setEchoMode(QLineEdit.EchoMode.Password)
    self.secret_key_input.setEchoMode(QLineEdit.EchoMode.Password)
    self.api_input.setPlaceholderText("发布 API URL（可选）")
    self.api_token_input.setPlaceholderText("发布 API Token（可选）")
    self.bucket_input.setPlaceholderText("COS Bucket 名称（必填）")
    self.region_input.setPlaceholderText("COS Region（例如 ap-shanghai）")
    self.secret_id_input.setPlaceholderText("COS SecretId")
    self.secret_key_input.setPlaceholderText("COS SecretKey")
    self.cdn_domain_input.setPlaceholderText("CDN 域名（可选，例 cdn.speakecho.top）")

    top_row = QHBoxLayout()
    top_row.addWidget(QLabel("发布 API"))
    top_row.addWidget(self.api_input, 2)
    top_row.addWidget(QLabel("发布Token"))
    top_row.addWidget(self.api_token_input, 1)
    top_row.addWidget(QLabel("Bucket"))
    top_row.addWidget(self.bucket_input, 1)
    top_row.addWidget(QLabel("Region"))
    top_row.addWidget(self.region_input, 1)
    top_row.addWidget(QLabel("SecretId"))
    top_row.addWidget(self.secret_id_input, 1)
    top_row.addWidget(QLabel("SecretKey"))
    top_row.addWidget(self.secret_key_input, 1)
    top_row.addWidget(QLabel("CDN"))
    top_row.addWidget(self.cdn_domain_input, 1)
    save_cfg_btn = QPushButton("保存配置")
    save_cfg_btn.clicked.connect(self.save_config)
    top_row.addWidget(save_cfg_btn)
    layout.addLayout(top_row)

    path_row = QHBoxLayout()
    self.taxonomy_path_input = QLineEdit(self.config.taxonomy_json_path)
    self.taxonomy_path_input.setPlaceholderText("留空 = web/lib/domain/taxonomy.json")
    reload_tax_btn = QPushButton("重载话题表")
    reload_tax_btn.clicked.connect(lambda: self._reload_taxonomy(show_error_dialog=True))
    path_row.addWidget(QLabel("话题表 JSON"))
    path_row.addWidget(self.taxonomy_path_input, 2)
    path_row.addWidget(reload_tax_btn)
    layout.addLayout(path_row)

    splitter = QSplitter()
    layout.addWidget(splitter, 1)

    upload_area = QWidget()
    upload_layout = QVBoxLayout(upload_area)
    self.table = QTableWidget(0, 12)
    self.table.setHorizontalHeaderLabels(
      [
        "视频文件",
        "标题",
        "字幕 JSON",
        "难度 JSON",
        "释义 JSON",
        "词组 JSON",
        "难度",
        "分类",
        "简介",
        "计划执行(可选)",
        "状态",
        "进度",
      ]
    )
    self.table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
    self.table.setAlternatingRowColors(True)
    upload_layout.addWidget(self.table, 1)
    self.table.currentCellChanged.connect(self._on_current_row_changed)

    row_tools = QHBoxLayout()
    add_btn = QPushButton("新增任务行")
    del_btn = QPushButton("删除选中行")
    browse_video_btn = QPushButton("选视频")
    browse_sub_btn = QPushButton("选字幕 JSON")
    browse_vocab_btn = QPushButton("选难度 JSON")
    browse_vocab_display_btn = QPushButton("选释义 JSON")
    browse_phrases_btn = QPushButton("选词组 JSON")
    add_btn.clicked.connect(self.add_row)
    del_btn.clicked.connect(self.remove_selected_rows)
    browse_video_btn.clicked.connect(lambda: self.pick_file_for_selected(self.COL_VIDEO, "视频文件 (*.mp4 *.mov *.mkv *.webm)"))
    browse_sub_btn.clicked.connect(lambda: self.pick_file_for_selected(self.COL_SUBTITLE, "JSON 文件 (*.json)"))
    browse_vocab_btn.clicked.connect(lambda: self.pick_file_for_selected(self.COL_VOCAB, "JSON 文件 (*.json)"))
    browse_vocab_display_btn.clicked.connect(
      lambda: self.pick_file_for_selected(self.COL_VOCAB_DISPLAY, "JSON 文件 (*.json)")
    )
    browse_phrases_btn.clicked.connect(
      lambda: self.pick_file_for_selected(self.COL_PHRASES, "JSON 文件 (*.json)")
    )
    row_tools.addWidget(add_btn)
    row_tools.addWidget(del_btn)
    row_tools.addWidget(browse_video_btn)
    row_tools.addWidget(browse_sub_btn)
    row_tools.addWidget(browse_vocab_btn)
    row_tools.addWidget(browse_vocab_display_btn)
    row_tools.addWidget(browse_phrases_btn)
    row_tools.addStretch(1)
    upload_layout.addLayout(row_tools)

    # Detail form panel for selected row (more intuitive than inline table editing).
    form_box = QWidget()
    form_layout = QFormLayout(form_box)
    form_layout.setLabelAlignment(form_layout.labelAlignment())
    self.form_title = QLineEdit()
    self.form_level = QComboBox()
    self.form_level.addItems(self.STAR_LEVELS)
    self.form_l1 = QComboBox()
    self.form_l2 = QComboBox()
    self.form_l1.currentIndexChanged.connect(self._on_form_l1_changed)
    self.form_desc = QPlainTextEdit()
    self.form_desc.setPlaceholderText("填写视频简介（支持多行）")
    self.form_desc.setFixedHeight(84)
    topic_row = QHBoxLayout()
    topic_row.addWidget(self.form_l1, 1)
    topic_row.addWidget(self.form_l2, 1)
    topic_wrap = QWidget()
    topic_wrap.setLayout(topic_row)
    form_layout.addRow("视频标题", self.form_title)
    form_layout.addRow("视频难度", self.form_level)
    form_layout.addRow("话题（一级 / 二级）", topic_wrap)
    form_layout.addRow("视频简介", self.form_desc)
    apply_form_btn = QPushButton("保存到当前任务行")
    apply_form_btn.clicked.connect(self.apply_form_to_current_row)
    form_layout.addRow("", apply_form_btn)
    upload_layout.addWidget(form_box)

    actions = QHBoxLayout()
    save_tpl_btn = QPushButton("保存模板")
    load_tpl_btn = QPushButton("加载模板")
    manifest_btn = QPushButton("导出定时任务清单")
    upload_btn = QPushButton("立即上传全部行")
    actions.addWidget(QLabel("默认计划"))
    self.enqueue_dt = QDateTimeEdit(QDateTime.currentDateTime())
    self.enqueue_dt.setDisplayFormat("yyyy-MM-dd HH:mm")
    self.enqueue_dt.setCalendarPopup(True)
    enqueue_btn = QPushButton("加入定时队列")
    enqueue_btn.setToolTip("将当前表格每一行作为 upload_new 任务写入 data/job_queue.json；计划时间=该列或左侧默认时间")
    enqueue_btn.clicked.connect(self.enqueue_current_rows)
    run_due_btn = QPushButton("立即执行到点任务")
    run_due_btn.setToolTip("手动测试：执行所有已到点且未取消的队列任务（任务计划也会每分钟跑一次）")
    run_due_btn.clicked.connect(self.run_due_jobs_now)
    save_tpl_btn.clicked.connect(self.save_template)
    load_tpl_btn.clicked.connect(self.load_template)
    manifest_btn.clicked.connect(self.export_manifest)
    upload_btn.clicked.connect(self.start_upload)
    actions.addWidget(save_tpl_btn)
    actions.addWidget(load_tpl_btn)
    actions.addWidget(manifest_btn)
    actions.addWidget(self.enqueue_dt, 1)
    actions.addWidget(enqueue_btn)
    actions.addWidget(run_due_btn)
    actions.addStretch(1)
    actions.addWidget(upload_btn)
    upload_layout.addLayout(actions)
    splitter.addWidget(upload_area)

    assets_area = QWidget()
    assets_layout = QVBoxLayout(assets_area)
    assets_layout.addWidget(QLabel("已上传资产（本地索引）"))
    self.assets_table = QTableWidget(0, 10)
    self.assets_table.setHorizontalHeaderLabels(
      [
        "asset_id",
        "标题",
        "状态",
        "创建时间",
        "video_key",
        "subtitle_key",
        "vocab_key",
        "vocab_display_key",
        "phrases_key",
        "meta_key",
      ]
    )
    self.assets_table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
    assets_layout.addWidget(self.assets_table, 1)
    asset_actions = QHBoxLayout()
    refresh_btn = QPushButton("刷新索引")
    soft_delete_btn = QPushButton("下架选中（软删·默认）")
    hard_delete_btn = QPushButton("删除 COS 并下架（硬删）")
    rep_sub_btn = QPushButton("排队替换字幕JSON")
    rep_sub_btn.clicked.connect(self.queue_replace_subtitle)
    rep_vocab_btn = QPushButton("排队替换难度JSON")
    rep_vocab_btn.clicked.connect(self.queue_replace_vocab)
    rep_phrases_btn = QPushButton("排队替换词组JSON")
    rep_phrases_btn.clicked.connect(self.queue_replace_phrases)
    meta_btn = QPushButton("排队更新元数据")
    meta_btn.clicked.connect(self.queue_meta_update_dialog)
    refresh_btn.clicked.connect(self.reload_assets_table)
    soft_delete_btn.clicked.connect(self.soft_delete_selected_asset)
    hard_delete_btn.clicked.connect(self.hard_delete_selected_asset)
    asset_actions.addWidget(refresh_btn)
    asset_actions.addWidget(soft_delete_btn)
    asset_actions.addWidget(hard_delete_btn)
    asset_actions.addWidget(rep_sub_btn)
    asset_actions.addWidget(rep_vocab_btn)
    asset_actions.addWidget(rep_phrases_btn)
    asset_actions.addWidget(meta_btn)
    assets_layout.addLayout(asset_actions)

    assets_layout.addWidget(QLabel("任务队列（data/job_queue.json，Windows 计划任务每分钟：python -m cli.run_due_jobs）"))
    self.jobs_table = QTableWidget(0, 5)
    self.jobs_table.setHorizontalHeaderLabels(["job_id", "类型", "计划时间", "状态", "错误"])
    self.jobs_table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
    self.jobs_table.setMaximumHeight(280)
    assets_layout.addWidget(self.jobs_table)
    job_row = QHBoxLayout()
    refresh_jobs_btn = QPushButton("刷新队列")
    refresh_jobs_btn.clicked.connect(self.reload_jobs_table)
    cancel_job_btn = QPushButton("取消选中队列任务")
    cancel_job_btn.clicked.connect(self.cancel_selected_job)
    job_row.addWidget(refresh_jobs_btn)
    job_row.addWidget(cancel_job_btn)
    job_row.addStretch(1)
    assets_layout.addLayout(job_row)
    splitter.addWidget(assets_area)
    splitter.setStretchFactor(0, 3)
    splitter.setStretchFactor(1, 2)
    self.reload_assets_table()
    self.reload_jobs_table()

  def add_row(self, task: UploadTask | None = None) -> None:
    t = task or UploadTask("", "", "", "", "", "", "")
    row = self.table.rowCount()
    self.table.insertRow(row)
    values = [
      t.video_path,
      t.title,
      t.subtitle_json_path,
      t.vocab_json_path,
      t.vocab_display_json_path,
      t.phrases_json_path,
      t.level,
      t.category,
      t.description,
      "",
      t.status,
      str(t.progress),
    ]
    for col, value in enumerate(values):
      self.table.setItem(row, col, QTableWidgetItem(value))
    if row == 0:
      self.table.setCurrentCell(0, self.COL_TITLE)
      self._load_row_into_form(0)

  def remove_selected_rows(self) -> None:
    selected = sorted({i.row() for i in self.table.selectedIndexes()}, reverse=True)
    for r in selected:
      self.table.removeRow(r)

  def pick_file_for_selected(self, col: int, filter_text: str) -> None:
    row = self.table.currentRow()
    if row < 0:
      QMessageBox.information(self, "提示", "请先选中一行任务")
      return
    file_path, _ = QFileDialog.getOpenFileName(self, "选择文件", "", filter_text)
    if not file_path:
      return
    self.table.setItem(row, col, QTableWidgetItem(file_path))
    if col == self.COL_VIDEO and not (self.table.item(row, self.COL_TITLE) and self.table.item(row, self.COL_TITLE).text().strip()):
      stem = Path(file_path).stem
      self.table.setItem(row, self.COL_TITLE, QTableWidgetItem(stem))
      self._load_row_into_form(row)

  def _on_current_row_changed(self, current_row: int, _current_col: int, _prev_row: int, _prev_col: int) -> None:
    if current_row < 0:
      return
    self._load_row_into_form(current_row)

  def _item_text(self, row: int, col: int) -> str:
    item = self.table.item(row, col)
    return item.text().strip() if item else ""

  def _resolved_taxonomy_path(self) -> Path:
    raw = self.taxonomy_path_input.text().strip()
    return Path(raw) if raw else default_taxonomy_path()

  def _reload_taxonomy(self, show_error_dialog: bool) -> None:
    try:
      self._taxonomy = load_taxonomy(self._resolved_taxonomy_path())
    except Exception as exc:
      self._taxonomy = {}
      if show_error_dialog:
        QMessageBox.warning(self, "话题表", f"加载失败: {exc}\n路径: {self._resolved_taxonomy_path()}")
    self.form_l1.blockSignals(True)
    self.form_l1.clear()
    self.form_l1.addItem("（请选择一级话题）", "")
    for k in self._taxonomy.keys():
      self.form_l1.addItem(k, k)
    self.form_l1.blockSignals(False)
    self.form_l1.setCurrentIndex(0)
    self._repopulate_l2("", "")

  def _repopulate_l2(self, l1_key: str, preferred_l2: str = "") -> None:
    self.form_l2.blockSignals(True)
    self.form_l2.clear()
    self.form_l2.addItem("（不限二级）", "")
    for l2 in self._taxonomy.get(l1_key, []):
      self.form_l2.addItem(l2, l2)
    self.form_l2.blockSignals(False)
    if preferred_l2:
      idx = self.form_l2.findData(preferred_l2)
      self.form_l2.setCurrentIndex(idx if idx >= 0 else 0)
    else:
      self.form_l2.setCurrentIndex(0)

  def _on_form_l1_changed(self) -> None:
    l1 = (self.form_l1.currentData() or "").strip()
    self._repopulate_l2(l1, "")

  def _load_row_into_form(self, row: int) -> None:
    if row < 0 or row >= self.table.rowCount():
      return
    self.form_title.setText(self._item_text(row, self.COL_TITLE))
    level = self._item_text(row, self.COL_LEVEL) or self.STAR_LEVELS[2]
    idx = self.form_level.findText(level)
    self.form_level.setCurrentIndex(idx if idx >= 0 else 2)
    cat = self._item_text(row, self.COL_CATEGORY)
    l1, l2 = parse_stored_category(cat, self._taxonomy)
    self.form_l1.blockSignals(True)
    pidx = self.form_l1.findData(l1)
    if pidx < 0 and l1:
      self.form_l1.addItem(l1, l1)
      pidx = self.form_l1.findData(l1)
    self.form_l1.setCurrentIndex(max(0, pidx))
    self.form_l1.blockSignals(False)
    eff_l1 = (self.form_l1.currentData() or "").strip()
    self._repopulate_l2(eff_l1, l2)
    self.form_desc.setPlainText(self._item_text(row, self.COL_DESC))

  def apply_form_to_current_row(self) -> None:
    row = self.table.currentRow()
    if row < 0:
      QMessageBox.information(self, "提示", "请先选中一条任务行")
      return
    l1 = (self.form_l1.currentData() or "").strip()
    l2 = (self.form_l2.currentData() or "").strip()
    if not l1:
      QMessageBox.warning(self, "提示", "请选择一级话题")
      return
    cat = topic_combo(l1, l2)
    self.table.setItem(row, self.COL_TITLE, QTableWidgetItem(self.form_title.text().strip()))
    self.table.setItem(row, self.COL_LEVEL, QTableWidgetItem(self.form_level.currentText().strip()))
    self.table.setItem(row, self.COL_CATEGORY, QTableWidgetItem(cat))
    self.table.setItem(row, self.COL_DESC, QTableWidgetItem(self.form_desc.toPlainText().strip()))
    QMessageBox.information(self, "成功", "当前任务行已更新")

  def _read_tasks(self) -> list[UploadTask]:
    tasks: list[UploadTask] = []
    for row in range(self.table.rowCount()):
      item = lambda c: (self.table.item(row, c).text().strip() if self.table.item(row, c) else "")
      tasks.append(
        UploadTask(
          video_path=item(self.COL_VIDEO),
          title=item(self.COL_TITLE),
          subtitle_json_path=item(self.COL_SUBTITLE),
          vocab_json_path=item(self.COL_VOCAB),
          vocab_display_json_path=item(self.COL_VOCAB_DISPLAY),
          phrases_json_path=item(self.COL_PHRASES),
          level=item(self.COL_LEVEL),
          category=item(self.COL_CATEGORY),
          description=item(self.COL_DESC),
          status=item(self.COL_STATUS) or "pending",
          progress=int(item(self.COL_PROGRESS) or "0"),
        )
      )
    return tasks

  def _write_status(self, row: int, progress: int, status: str) -> None:
    self.table.setItem(row, self.COL_PROGRESS, QTableWidgetItem(str(progress)))
    self.table.setItem(row, self.COL_STATUS, QTableWidgetItem(status))

  def save_config(self) -> None:
    cfg = replace(
      self.config,
      publish_api_url=self.api_input.text().strip(),
      publish_api_token=self.api_token_input.text().strip(),
      cos_bucket=self.bucket_input.text().strip(),
      cos_region=self.region_input.text().strip(),
      cos_secret_id=self.secret_id_input.text().strip(),
      cos_secret_key=self.secret_key_input.text().strip(),
      cdn_domain=self.cdn_domain_input.text().strip(),
      taxonomy_json_path=self.taxonomy_path_input.text().strip(),
    )
    self.repo.save_config(cfg)
    self.config = cfg
    QMessageBox.information(self, "成功", "配置已保存（若改了话题表路径，可点「重载话题表」）")

  def save_template(self) -> None:
    tasks = self._read_tasks()
    if not tasks:
      QMessageBox.warning(self, "提示", "没有任务可保存")
      return
    name, ok = QInputDialog.getText(self, "保存模板", "模板名称")
    if not ok or not name.strip():
      return
    out = self.repo.save_template(name.strip(), tasks)
    QMessageBox.information(self, "成功", f"模板已保存: {out}")

  def load_template(self) -> None:
    names = self.repo.list_templates()
    if not names:
      QMessageBox.information(self, "提示", "暂无模板")
      return
    name, ok = QInputDialog.getItem(self, "加载模板", "选择模板", names, 0, False)
    if not ok or not name:
      return
    tasks = self.repo.load_template(name)
    self.table.setRowCount(0)
    for t in tasks:
      self.add_row(t)

  def export_manifest(self) -> None:
    tasks = self._read_tasks()
    if not tasks:
      QMessageBox.warning(self, "提示", "没有任务可导出")
      return
    out_file, _ = QFileDialog.getSaveFileName(self, "导出清单", str(Path.cwd() / "upload_manifest.json"), "JSON 文件 (*.json)")
    if not out_file:
      return
    out = write_manifest(tasks, Path(out_file))
    QMessageBox.information(self, "成功", f"清单已导出: {out}")

  def start_upload(self) -> None:
    tasks = self._read_tasks()
    if not tasks:
      QMessageBox.warning(self, "提示", "请先添加至少一条任务")
      return
    self.save_config()
    self.thread = QThread(self)
    self.worker = UploadWorker(self.upload_service, tasks, self.config)
    self.worker.moveToThread(self.thread)
    self.thread.started.connect(self.worker.run)
    self.worker.progress.connect(self._write_status)
    self.worker.finished.connect(self._on_upload_finished)
    self.worker.finished.connect(self.thread.quit)
    self.thread.start()

  def _on_upload_finished(self, results: list) -> None:
    ok = len([r for r in results if r.ok])
    failed = len(results) - ok
    records: list[AssetRecord] = []
    for r in results:
      if not r.ok:
        continue
      if not (r.video_url and r.subtitle_url and r.vocab_url and r.vocab_display_url and r.meta_url):
        continue
      records.append(
        AssetRecord(
          asset_id=uuid4().hex,
          title=r.task.title,
          level=r.task.level,
          category=r.task.category,
          description=r.task.description,
          video_url=r.video_url,
          subtitle_url=r.subtitle_url,
          vocab_url=r.vocab_url,
          vocab_display_url=r.vocab_display_url,
          phrases_url=r.phrases_url or "",
          meta_url=r.meta_url,
          video_key=r.video_key or "",
          subtitle_key=r.subtitle_key or "",
          vocab_key=r.vocab_key or "",
          vocab_display_key=r.vocab_display_key or "",
          phrases_key=r.phrases_key or "",
          meta_key=r.meta_key or "",
          source_video_path=r.task.video_path,
          created_at=datetime.utcnow().isoformat(),
          active=True,
        )
      )
    if records:
      self.repo.upsert_assets(records)
      self.reload_assets_table()
    QMessageBox.information(self, "上传完成", f"成功 {ok} 条，失败 {failed} 条")

  def reload_assets_table(self) -> None:
    assets = self.repo.load_assets()
    self.assets_table.setRowCount(0)
    for a in assets:
      row = self.assets_table.rowCount()
      self.assets_table.insertRow(row)
      vals = [
        a.asset_id,
        a.title,
        "在线" if a.active else "已下架",
        a.created_at,
        a.video_key,
        a.subtitle_key,
        a.vocab_key,
        a.vocab_display_key,
        a.phrases_key,
        a.meta_key,
      ]
      for col, val in enumerate(vals):
        self.assets_table.setItem(row, col, QTableWidgetItem(val))

  def _selected_asset_id(self) -> str | None:
    row = self.assets_table.currentRow()
    if row < 0:
      return None
    item = self.assets_table.item(row, self.ASSET_ID)
    return item.text().strip() if item else None

  def soft_delete_selected_asset(self) -> None:
    asset_id = self._selected_asset_id()
    if not asset_id:
      QMessageBox.information(self, "提示", "请先选中一条资产")
      return
    self.repo.mark_asset_active(asset_id, False)
    self.reload_assets_table()
    QMessageBox.information(self, "完成", "已下架（软删除）")

  def hard_delete_selected_asset(self) -> None:
    asset_id = self._selected_asset_id()
    if not asset_id:
      QMessageBox.information(self, "提示", "请先选中一条资产")
      return
    assets = self.repo.load_assets()
    target = next((a for a in assets if a.asset_id == asset_id), None)
    if not target:
      QMessageBox.warning(self, "错误", "未找到该资产")
      return
    try:
      self.save_config()
      keys = [
        k
        for k in [
          target.video_key,
          target.subtitle_key,
          target.vocab_key,
          target.vocab_display_key,
          target.phrases_key,
          target.meta_key,
        ]
        if k
      ]
      self.upload_service.delete_asset_objects(self.config, keys)
      self.repo.mark_asset_active(asset_id, False)
      self.reload_assets_table()
      QMessageBox.information(self, "完成", "已删除 COS 对象并下架")
    except Exception as exc:
      QMessageBox.warning(self, "删除失败", str(exc))

  def _default_schedule_iso(self) -> str:
    return self.enqueue_dt.dateTime().toPython().replace(microsecond=0).isoformat()

  def enqueue_current_rows(self) -> None:
    self.save_config()
    self.config = self.repo.load_config()
    default_iso = self._default_schedule_iso()
    new_jobs: list[QueuedJob] = []
    skipped = 0
    for row in range(self.table.rowCount()):

      def cell(c: int) -> str:
        it = self.table.item(row, c)
        return it.text().strip() if it else ""

      if not cell(self.COL_VIDEO):
        skipped += 1
        continue
      sched_txt = cell(self.COL_SCHEDULE)
      iso = default_iso
      if sched_txt:
        parsed = parse_job_time(sched_txt)
        if parsed:
          iso = parsed.replace(microsecond=0).isoformat()
        else:
          QMessageBox.warning(
            self,
            "计划时间",
            f"第 {row + 1} 行「计划执行」无法解析，已用默认时间。\n可填本地时间 ISO，例如：2026-03-21T18:30:00",
          )
      new_jobs.append(
        QueuedJob(
          job_id=uuid4().hex,
          kind="upload_new",
          scheduled_at=iso,
          video_path=cell(self.COL_VIDEO),
          title=cell(self.COL_TITLE),
          subtitle_json_path=cell(self.COL_SUBTITLE),
          vocab_json_path=cell(self.COL_VOCAB),
          vocab_display_json_path=cell(self.COL_VOCAB_DISPLAY),
          phrases_json_path=cell(self.COL_PHRASES),
          level=cell(self.COL_LEVEL),
          category=cell(self.COL_CATEGORY),
          description=cell(self.COL_DESC),
        )
      )
    if not new_jobs:
      QMessageBox.warning(self, "提示", "没有可入队的行（每行需填写视频文件路径）")
      return
    self.repo.append_jobs(new_jobs)
    self.reload_jobs_table()
    QMessageBox.information(
      self,
      "已入队",
      f"已加入 {len(new_jobs)} 条定时任务（跳过空视频行 {skipped} 条）。\n\n"
      "请在「任务计划程序」里每分钟运行一次（工作目录设为 uploader-desktop 的文件夹）：\n"
      "  python -m cli.run_due_jobs\n"
      "或使用虚拟环境里的 python 亦可。",
    )

  def run_due_jobs_now(self) -> None:
    self.save_config()
    self.config = self.repo.load_config()
    ok_n, fail_n = run_due_jobs(self.repo, self.config, self.upload_service)
    self.reload_jobs_table()
    self.reload_assets_table()
    QMessageBox.information(self, "执行结果", f"成功 {ok_n} 条，失败 {fail_n} 条")

  def reload_jobs_table(self) -> None:
    jobs = self.repo.load_jobs()
    self.jobs_table.setRowCount(0)
    for j in sorted(jobs, key=lambda x: (x.scheduled_at, x.created_at), reverse=True):
      r = self.jobs_table.rowCount()
      self.jobs_table.insertRow(r)
      for col, val in enumerate([j.job_id, j.kind, j.scheduled_at, j.status, j.error or ""]):
        self.jobs_table.setItem(r, col, QTableWidgetItem(str(val)))

  def cancel_selected_job(self) -> None:
    row = self.jobs_table.currentRow()
    if row < 0:
      QMessageBox.information(self, "提示", "请先选中一条队列任务")
      return
    item = self.jobs_table.item(row, 0)
    if not item:
      return
    jid = item.text().strip()
    jobs = self.repo.load_jobs()
    changed = False
    for j in jobs:
      if j.job_id == jid and j.status == "scheduled":
        j.status = "cancelled"
        changed = True
        break
    if not changed:
      QMessageBox.information(self, "提示", "只能取消状态为 scheduled 的任务")
      return
    self.repo.save_jobs(jobs)
    self.reload_jobs_table()

  def queue_replace_subtitle(self) -> None:
    aid = self._selected_asset_id()
    if not aid:
      QMessageBox.information(self, "提示", "请在「已上传资产」表中选中一条")
      return
    path, _ = QFileDialog.getOpenFileName(self, "选择新的字幕 JSON", "", "JSON (*.json)")
    if not path:
      return
    job = QueuedJob(
      job_id=uuid4().hex,
      kind="replace_json",
      scheduled_at=self._default_schedule_iso(),
      replace_asset_id=aid,
      replace_subtitle_path=path,
    )
    self.repo.append_jobs([job])
    self.reload_jobs_table()
    QMessageBox.information(self, "已入队", "字幕替换任务已加入队列（到点后覆盖原 COS key，URL 不变）")

  def queue_replace_vocab(self) -> None:
    aid = self._selected_asset_id()
    if not aid:
      QMessageBox.information(self, "提示", "请在「已上传资产」表中选中一条")
      return
    vocab_path, _ = QFileDialog.getOpenFileName(self, "选择新的难度 JSON", "", "JSON (*.json)")
    if not vocab_path:
      return
    replace_display = QMessageBox.question(
      self,
      "是否同时替换释义 JSON",
      "是否同时替换 vocab_display（释义）JSON？\n选择“是”将继续选择释义 JSON 文件。",
      QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
      QMessageBox.StandardButton.No,
    )
    vocab_display_path = ""
    if replace_display == QMessageBox.StandardButton.Yes:
      vocab_display_path, _ = QFileDialog.getOpenFileName(self, "选择新的释义 JSON", "", "JSON (*.json)")
      if not vocab_display_path:
        QMessageBox.information(self, "提示", "未选择释义 JSON，本次仅替换难度 JSON。")

    job = QueuedJob(
      job_id=uuid4().hex,
      kind="replace_json",
      scheduled_at=self._default_schedule_iso(),
      replace_asset_id=aid,
      replace_vocab_path=vocab_path,
      replace_vocab_display_path=vocab_display_path,
    )
    self.repo.append_jobs([job])
    self.reload_jobs_table()
    if vocab_display_path:
      QMessageBox.information(self, "已入队", "难度 JSON + 释义 JSON 替换任务已加入队列")
    else:
      QMessageBox.information(self, "已入队", "难度 JSON 替换任务已加入队列")

  def queue_replace_phrases(self) -> None:
    aid = self._selected_asset_id()
    if not aid:
      QMessageBox.information(self, "提示", "请在「已上传资产」表中选中一条")
      return
    path, _ = QFileDialog.getOpenFileName(self, "选择新的词组 JSON", "", "JSON (*.json)")
    if not path:
      return
    job = QueuedJob(
      job_id=uuid4().hex,
      kind="replace_json",
      scheduled_at=self._default_schedule_iso(),
      replace_asset_id=aid,
      replace_phrases_path=path,
    )
    self.repo.append_jobs([job])
    self.reload_jobs_table()
    QMessageBox.information(
      self,
      "已入队",
      "词组 JSON 替换任务已加入队列（覆盖与主字幕同目录下的「字幕主名_phrases.json」COS 键）。",
    )

  def queue_meta_update_dialog(self) -> None:
    aid = self._selected_asset_id()
    if not aid:
      QMessageBox.information(self, "提示", "请先选中一条资产")
      return
    assets = self.repo.load_assets()
    target = next((a for a in assets if a.asset_id == aid), None)
    if not target:
      QMessageBox.warning(self, "错误", "未找到资产")
      return
    dlg = QDialog(self)
    dlg.setWindowTitle("排队更新元数据（执行后写入本地索引）")
    form = QFormLayout(dlg)
    t_title = QLineEdit(target.title)
    t_level = QLineEdit(target.level)
    t_cat = QLineEdit(target.category)
    t_desc = QPlainTextEdit(target.description or "")
    t_desc.setFixedHeight(80)
    form.addRow("标题", t_title)
    form.addRow("难度", t_level)
    form.addRow("分类/话题", t_cat)
    form.addRow("简介", t_desc)
    buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
    form.addRow(buttons)
    buttons.accepted.connect(dlg.accept)
    buttons.rejected.connect(dlg.reject)
    if dlg.exec() != QDialog.DialogCode.Accepted:
      return
    job = QueuedJob(
      job_id=uuid4().hex,
      kind="update_meta",
      scheduled_at=self._default_schedule_iso(),
      meta_asset_id=aid,
      meta_title=t_title.text().strip(),
      meta_level=t_level.text().strip(),
      meta_category=t_cat.text().strip(),
      meta_description=t_desc.toPlainText().strip(),
    )
    self.repo.append_jobs([job])
    self.reload_jobs_table()
    QMessageBox.information(
      self,
      "已入队",
      "元数据更新已加入队列。\n执行时会先同步发布 API（若已配置），再更新本地 assets_index.json。",
    )


def run_app() -> None:
  app = QApplication([])
  window = UploaderWindow()
  window.show()
  app.exec()
