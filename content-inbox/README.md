# content-inbox



待审核的本地素材放在这里（与 `web/public` 分离）：每个视频一条 basename，配套文件同名：



- `<id>.mp4`（或 `.webm` / `.mov` / `.m4v`）

- `<id>.json` — 字幕；每条 `segments[]` 内与 `en_text` 同级填写 **`zh_text`** 作为该句中文（网站会映射为展示用的 `zh`）。可用 [tools/fill_subtitle_zh.py](../tools/fill_subtitle_zh.py) 批量补全：

  - **`--engine openai`**（推荐）：按 **连续多句成批** 调用 LLM，并自动读取同目录 **`<id>.meta.json`** 里的 `title` / `description` 作语境；设置 **`OPENAI_API_KEY`**（OpenAI）或 **`DASHSCOPE_API_KEY`**（阿里云百炼），百炼需同时设 **`OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`** 与 **`--openai-model qwen-plus`**（或控制台可用模型）；并 `pip install openai`（见 [tools/requirements-subtitle-fill.txt](../tools/requirements-subtitle-fill.txt)）。修正旧错译时用 **`--overwrite`**。可调 `--chunk-size`（默认 14）、`--openai-model`。

  - **`--engine google` / `auto`**：逐句机翻（无句间语境；遇 MyMemory 429 可改用 Google 后备）。建议加 `--max 25` 分多次运行以免终端超时。

- `<id>.meta.json` — 标题、难度、分类、简介、`video_url` / `subtitle_url` / `vocab_url` 等

- `<id>_vocabulary_levels.json` — **难词集合**（决定字幕里哪些 token 算作难词、紫下划线等）。前端**不再按四六级/雅思档位区分样式**，而是把所有来源**合并成一个规范化 lemma 集合**：

  - 可直接使用顶层 **`hard`**、`words`、`hard_words`、`vocab`、`difficult_words`、**`难词`** 等**字符串数组**（与 [tools/bilingual_packager](../tools/bilingual_packager/)「②」生成的一致：**仅 lemma 列表，不含中文**）；

  - **兼容旧格式**：`CET4` / `CET6` / `IELTS` 三个数组里的词会**全部并入同一难词集**；

  - 也支持文件根节点就是**单词字符串数组**的 JSON。  

  词形规则与弹层一致：小写、去掉首尾非标点字母外符号（与 `*_vocab_display.json` 的 lemma 键对齐）。

- `<id>_vocab_display.json` — **难词展示包（网页点词释义）**：`entries` 内键为 **lemma**，值为 `zh` / `ipa` / `en_definition` / `pos` 等；**播放器读此文件展示中文与音标**。由打包工具「③ / ④」从粘贴表生成。
- `<id>_vocab_paste_meta.json` — **可选、仅本机**：与「②」同时生成，内含粘贴时的音标/中文/语境，供再次点③时不必重贴；**上传 COS 时可不传**（线上只需 `*_vocabulary_levels.json` + `*_vocab_display.json`）。

- `<id>_phrases.json` — **词组侧车（可选）**：与 [tools/bilingual_packager](../tools/bilingual_packager/)「词组」页「写入词组侧车」一致，形如 `{ "version": 1, "video_id": "<id>", "items": [ { "text": "...", "zh": "...", "reason": "..." } ] }`。  
  **不并入**主字幕 `<id>.json`；本地/inbox 与线上若把该文件放在与主字幕**同目录、同 basename**，则播放器会先加载主字幕再按英文词面把词条对齐到各句 `words[]`，与句内 `phrases[]` 行为一致（紫下划线、点译）。主 JSON 须含非空 `words[]` 才能对齐。

- 正式环境可在 `<id>.meta.json` 中增加 **`vocab_display_url`** 指向 COS 上该 JSON；若不填，且存在 **`vocab_url`**，则会自动把 `_vocabulary_levels.json` 换成 `_vocab_display.json` 同路径拉取。  
  词组侧车：把 `<id>_phrases.json` 上传到与 **`<id>.json` 同路径前缀**（例如主字幕为 `https://bucket/.../foo.json`，则词组为 `https://bucket/.../foo_phrases.json`），站点会随主字幕 URL 自动尝试拉取 `_phrases.json`。



开发环境下，Next 应用通过 `/api/content-inbox/<文件名>` 读取这些文件；审完后请上传到腾讯云 COS，并在 Supabase 中更新正式 URL（含可选的 `vocab_display_url` 列）。

