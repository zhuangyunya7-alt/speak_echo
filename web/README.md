## SpeakEcho (MVP)

Curated videos → interactive English practice:

- Word-level dual highlight (static difficulty + dynamic current word)
- Click subtitle to jump; scroll sync follows playback
- Click word for lookup + pronunciation + save to flashcards
- Flashcards list + simple practice mode
- Local study record (watch time + 7-day chart) as MVP

## Getting Started

### 1) Install & run

```bash
npm i
npm run dev
```

Open `http://localhost:3000`.

### 2) Supabase (optional but recommended)

1. Create a Supabase project
2. Run `supabase/schema.sql` in the SQL editor
3. Create `.env.local` based on `.env.example`:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

When Supabase env is not configured, the app falls back to **mock videos/subtitles** and **localStorage flashcards** (so you can still demo the core UX).

### 3) Tencent COS (optional, private media)

If `COS_SECRET_ID` and `COS_SECRET_KEY` are set (see `.env.example`), the app replaces `*.cos.*.myqcloud.com` links on videos with **short-lived presigned URLs** so the raw object URLs in Supabase are not long-lived public reads. Set the bucket to **private** (no anonymous read) so only signed requests work.

This does not stop a determined user from recording or grabbing bytes from the network tab while a link is valid; it mainly blocks **stable bookmark/shareable URLs**.

### 4) Activation codes

Insert rows into `activation_codes` before inviting users to sign up:

```sql
insert into public.activation_codes(code, is_used) values
  ('SPEAKECHO-0001', false),
  ('SPEAKECHO-0002', false);
```

## Production deploy (Tencent Lighthouse + 1Panel)

Step-by-step: [docs/deploy-tencent-lighthouse-1panel.md](docs/deploy-tencent-lighthouse-1panel.md) — Node build, reverse proxy, HTTPS for `speakecho.top`, env vars, uploader `publish_api_url`. PM2: [ecosystem.config.cjs](ecosystem.config.cjs).

## Notes

- **Low coupling / high cohesion**: data access lives in `lib/data/*`, UI in `components/*`, pages are thin.
- **File size**: modules are split to keep files small (target <300 lines).
