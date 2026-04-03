# SpeakEcho.top 技术架构文档

## 1. 技术栈 (Tech Stack)
- **前端框架**: Next.js 14 (App Router)
- **样式方案**: Tailwind CSS
- **后端/数据库**: Supabase (PostgreSQL + Auth + Storage)
- **视频托管**: 腾讯云 COS (视频文件) + 腾讯云 CDN (加速)
- **状态管理**: React Hooks (useState, useEffect, useRef)

## 2. 数据库设计 (Supabase Schema)
### 2.1 `videos` 表
- `id`: uuid (PK)
- `title`: text
- `cover_url`: text
- `video_url`: text (指向腾讯云 COS 链接)
- `author`: text
- `level`: text (Beginner/Intermediate/Advanced)
- `category`: text (Tech/Business/Vlog)

### 2.2 `subtitles` 表
- `id`: uuid (PK)
- `video_id`: uuid (FK to videos)
- `content`: jsonb (存储带有时间戳的字幕数据)
  - 格式样例: `[{ "start": 0.5, "end": 2.0, "text": "Hello world", "words": [...] }]`

### 2.3 `activation_codes` 表
- `code`: text (PK)
- `is_used`: boolean
- `used_by`: uuid (FK to users)

## 3. 关键算法逻辑：Time-Sync (时间同步)
- **监听器**: 使用 HTML5 Video 元素的 `onTimeUpdate` 事件。
- **匹配算法**: 
    - 使用 `Array.find()` 在字幕 JSON 数组中寻找 `currentTime` 落在 `[start, end]` 区间的对象。
    - 使用 `requestAnimationFrame` 确保 UI 高亮在单词级别切换时无卡顿。

## 4. 目录结构建议
- `/app`: 页面路由 (Home, Video, Auth)
- `/components`: UI 组件 (Player, SubtitleCard, Sidebar)
- `/lib`: Supabase 客户端配置、工具函数