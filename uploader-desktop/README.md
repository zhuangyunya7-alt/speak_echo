# SpeakEcho 网站内容后台

PySide6 桌面工具：批量**上传**视频与配套 JSON、**排期发布**、对已上传资源做**覆盖替换（同 COS key）**与元数据维护（本地索引）。与站点共用话题表 `web/lib/domain/taxonomy.json`。

## 功能概览

- **上传任务表**：视频、字幕 JSON、难度 JSON、标题、难度、话题（一级/二级）、简介；支持「立即上传」或「加入定时队列」。
- **计划执行**：表头列「计划执行(可选)」可填 ISO 本地时间（如 `2026-03-21T18:30:00`）；不填则使用工具栏「默认计划」时间。
- **任务队列**：保存在 `data/job_queue.json`。由 CLI **每分钟**执行一次，自动跑所有**已到点**且状态为 `scheduled` 的任务（你选定的方案 **1A**）。
- **已上传资产**：本地索引 `data/assets_index.json`。
  - **软删（默认）**：仅标记下架，不删 COS。
  - **硬删**：删除 COS 上对象并下架。
  - **排队替换字幕/难度 JSON**：到点后向 **原 subtitle_key / vocab_key 覆盖上传**，公开 URL 不变（方案 **2A**）。
  - **排队更新元数据**：到点后更新本地索引中的标题/难度/分类/简介（线上 Supabase 如需同步，请自备发布 API）。
- **配置**：`data/config.json`（COS、发布 API、CDN、话题表路径可选）。首次可复制 [`data/config.example.json`](data/config.example.json) 为 `config.json` 并填入密钥（`config.json` 勿提交仓库）。

## 定时执行（Windows 任务计划程序）

1. 操作：`创建基本任务` → 触发器：**每天**，高级：**重复任务间隔 1 分钟**（或等价「每分钟」）。
2. 程序：`d:\speak_echo\uploader-desktop\.venv\Scripts\python.exe`（或本机 `python.exe`）。
3. 参数：`-m cli.run_due_jobs`
4. **起始于**：`d:\speak_echo\uploader-desktop`

## 目录结构

- `app/window.py` — GUI
- `core/models.py` — `UploadTask`、`QueuedJob`、`AssetRecord` 等
- `core/job_executor.py` — 队列任务执行
- `core/uploader.py` — COS / Mock 上传与覆盖
- `core/validator.py` — 校验
- `core/taxonomy.py` — 加载话题表
- `storage/repository.py` — 配置、模板、资产索引、**任务队列**
- `scheduler/manifest.py` — 旧版一次性 manifest（仍可导出）
- `cli/run_manifest.py` — 从 manifest 跑一次上传
- `cli/run_due_jobs.py` — **每分钟建议运行**：执行到点队列

## 安装与运行 GUI

```bash
cd d:\speak_echo\uploader-desktop
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

## CLI

```bash
# 执行 job_queue 里到点的任务（任务计划每分钟调用）
python -m cli.run_due_jobs

# 从 manifest 跑一次（兼容旧流程）
python -m cli.run_manifest --manifest d:\path\to\upload_manifest.json
```

## 后续可扩展

- 队列失败自动重试、日志文件
- 元数据与 Supabase 双向同步（PATCH 发布 API）
- 恢复上架（软删恢复）
