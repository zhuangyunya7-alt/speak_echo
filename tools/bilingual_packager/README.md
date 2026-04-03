# 双语字幕打包工具（SpeakEcho）

从**同一视频的英/中 SRT**（时间与条数一致）生成 `content-inbox` 用的主 JSON；**难词表与 vocab_display** 由你在「生词审核」页**粘贴**「单词、音标、中文、语境」后生成（不再从仓库 `levels/` 自动抽 CET 词表，也不依赖腾讯混元）。

**词级时间轴**由外部工具提供（推荐 [Sonix.ai](https://sonix.ai) 等导出 CSV），本工具负责合并进 `segments[].words[]`。不再内置 Whisper / Wav2Vec2 对齐。

## 输入约定

| 输入 | 说明 |
|------|------|
| 英文 SRT | 句级时间轴与文本；与中文 SRT **条数、顺序一致**。 |
| 中文 SRT | 同上。 |
| Sonix CSV（可选） | 列名：`Word`, `Start Timecode`, `End Timecode`（及 `Speaker` 等均可）。时间支持 **`HH:MM:SS.cc`**（秒可为小数）或 **四段 `HH:MM:SS:微秒`**（第四段为整数微秒，如 `00:00:00:10800` → 0.0108s）。与音视频应为**同一版本**对白。 |

**流程**：英 SRT + 中 SRT → 句级主 JSON；若同时选择 Sonix CSV → 自动合并词级。也可事后命令行合并：

```powershell
cd D:\speak_echo\tools
python -m bilingual_packager.merge_sonix_words "C:\path\export.csv" "D:\path\video_id.json"
```

## 依赖

- Python 3.10+
- 图形界面默认**仅需标准库**（见 `requirements.txt` 说明）。

无需 ffmpeg、无需 whisper-timestamped。

## 启动

**方式一**：在 `bilingual_packager` 目录下双击 **`启动双语打包.bat`**（会先切换到上级 `tools` 再启动模块）。

**方式二**：

```powershell
cd D:\speak_echo\tools
pythonw -m bilingual_packager.gui
```

上级目录 `D:\speak_echo\tools\启动双语打包.bat` 亦可继续沿用。

## 界面流程

1. **打包**页：输出目录（默认 `content-inbox`）、**输出前缀**即 `video_id`；选择英/中 SRT 与可选 Sonix CSV；**① 生成主字幕 JSON**。
2. **生词审核与 vocab_display**页：粘贴 Tab 分列生词表 → **②** 写入 `{前缀}_vocabulary_levels.json`（仅难词列表，供网页下划线）与 `{前缀}_vocab_paste_meta.json`（本机释义侧车，可不提交仓库）→ 列表勾选 → **③ / ④** 生成 `{前缀}_vocab_display.json`（**网页点词用**，含中文与音标）→ 可选导出单词卡片 HTML。
3. **词组标注（英中对照）**页：粘贴「序号、词组、中文、语境」Tab 表 → **导入筛选词组** → **写入词组侧车** 得到 `{前缀}_phrases.json`。**不写入**主 `{前缀}.json`；网页加载主字幕后按 `words[]` 对齐侧车词条（主 JSON 须有词级）。
