# SpeakEcho

将精选高质量英语视频转化为**交互式听力练习**的平台。通过词级高亮、双语字幕、点词查义与闪卡记忆，帮助用户在真实语境中提升听力和词汇量。

> MVP 阶段 · 主站：[speakecho.top](https://speakecho.top)

---

## 核心功能

- **交互式播放器**：词级双轨高亮（难词标记 + 当前播放词）、字幕滚动同步、点击字幕跳转
- **点词学习**：发音、释义、音标；一键加入闪卡
- **闪卡练习**：生词列表与简单复习模式
- **学习记录**：本地观看时长与 7 日学习曲线（MVP）
- **多维筛选**：话题、难度、博主、时长等维度浏览内容
- **邀请制注册**：激活码控制用户准入

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 16 (App Router) · React 19 · Tailwind CSS 4 · TypeScript |
| 后端 / 数据库 | Supabase (PostgreSQL · Auth) |
| 媒体存储 | 腾讯云 COS + CDN（私有桶 + 短时签名 URL） |
| 桌面工具 | Python 3.10+ · PySide6 |
| 字幕工具链 | Python（SRT 解析 · Sonix 词级时间轴合并） |

---

## 仓库结构

本仓库为 **monorepo**，各子项目职责独立：

```
speak_echo/
├── web/                    # Next.js 网站（播放器、闪卡、认证、管理后台）
├── content-inbox/          # 本地待审核素材（视频 + 字幕 + 词汇侧车）
├── tools/                  # 内容生产工具链
│   ├── bilingual_packager/ # 双语字幕打包（SRT → JSON + 词汇包）
│   ├── phrase_extractor/   # 词组候选提取
│   └── subtitle_lexical_rater/ # 字幕词汇难度评估
├── uploader-desktop/       # PySide6 桌面后台（上传 COS、排期发布、资产维护）
├── scripts/                # 运维脚本（如 push-to-github.ps1）
└── .github/workflows/      # CI / 部署工作流
```

各子目录均有独立 README，详见下方「文档索引」。

---

## 快速开始

### 1. Web 应用

```powershell
cd web
npm i
npm run dev
```

浏览器打开 `http://localhost:3000`。

**环境变量**（复制 `web/.env.example` 为 `web/.env.local`）：

| 变量 | 说明 |
|------|------|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 连接（未配置时使用 mock 数据 + localStorage 闪卡，仍可体验核心 UX） |
| `COS_SECRET_ID` / `COS_SECRET_KEY` | 腾讯云 COS 签名（私有桶媒体访问） |
| `PUBLISH_API_TOKEN` | 与 uploader-desktop 对接的发布 API 令牌 |

Supabase 初始化：在 SQL Editor 中执行 `web/supabase/schema.sql`，并向 `activation_codes` 表插入邀请码。

详细说明 → [web/README.md](web/README.md)

### 2. 双语字幕打包

从英/中 SRT 生成 `content-inbox` 所需的主字幕 JSON 与词汇侧车文件；可选合并 Sonix 词级时间轴。

```powershell
cd tools
pythonw -m bilingual_packager.gui
```

或双击 `tools/启动双语打包.bat`。

详细说明 → [tools/bilingual_packager/README.md](tools/bilingual_packager/README.md)

### 3. 桌面上传后台

批量上传视频与配套 JSON 到 COS，支持定时发布与资产覆盖替换。

```powershell
cd uploader-desktop
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

定时任务（Windows 任务计划程序，建议每分钟执行）：

```powershell
cd uploader-desktop
python -m cli.run_due_jobs
```

详细说明 → [uploader-desktop/README.md](uploader-desktop/README.md)

---

## 内容生产流程

```
英/中 SRT (+ Sonix CSV)
        │
        ▼
  bilingual_packager        →  content-inbox/<id>.json
  （打包 + 生词审核）              <id>_vocabulary_levels.json
                                   <id>_vocab_display.json
                                   <id>_phrases.json（可选）
        │
        ▼
  本地预览（/api/content-inbox）  或  uploader-desktop 上传 COS
        │
        ▼
  Supabase videos 表更新 URL  →  线上发布
```

本地素材格式约定 → [content-inbox/README.md](content-inbox/README.md)

---

## 部署

生产环境部署指南（腾讯云 Lighthouse + 1Panel）：

→ [web/docs/deploy-tencent-lighthouse-1panel.md](web/docs/deploy-tencent-lighthouse-1panel.md)

GitHub Actions 工作流：`.github/workflows/deploy-lighthouse.yml`

---

## 推送到 GitHub

```powershell
# 安装 GitHub CLI 并登录（一次性）
gh auth login

# 从仓库根目录执行
powershell -ExecutionPolicy Bypass -File .\scripts\push-to-github.ps1
```

默认创建私有仓库 `speak_echo` 并推送 `main` 分支。若 `origin` 已存在，则仅执行 push。

---

## 文档索引

| 文档 | 内容 |
|------|------|
| [web/README.md](web/README.md) | Web 应用安装、环境变量、架构说明 |
| [content-inbox/README.md](content-inbox/README.md) | 本地素材文件格式与侧车约定 |
| [tools/bilingual_packager/README.md](tools/bilingual_packager/README.md) | 双语字幕打包工具使用说明 |
| [uploader-desktop/README.md](uploader-desktop/README.md) | 桌面上传后台功能与 CLI |
| [prd_speakecho_v1.md](prd_speakecho_v1.md) | 产品需求文档 V1 |
| [tech-stack.md](tech-stack.md) | 技术架构概要 |
| [CLAUDE.md](CLAUDE.md) | AI 助手上下文入口（开发者参考） |

---

## 注意事项

- **勿提交密钥**：`.env.local`、`uploader-desktop/data/config.json` 等已在 `.gitignore` 中排除；请使用各目录下的 `*.example` 模板
- **大文件**：`content-inbox/` 下的视频二进制不会入库，仅保留 `README.md`
- **依赖目录**：不要修改 `web/node_modules/` 或 `uploader-desktop/.venv/`

---

## License

暂未指定开源协议。如需二次使用或贡献，请先联系项目维护者。
