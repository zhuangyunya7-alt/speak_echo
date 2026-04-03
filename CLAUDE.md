# SpeakEcho — AI context (CLAUDE.md)

This file is a **short entrypoint** for AI assistants working in this repo. It does **not** replace product/tech docs; it points to the authoritative ones.

## Project snapshot

SpeakEcho (MVP): curated videos → interactive English practice.

Key UX (see web README for details):
- Word-level dual highlight + scroll sync
- Click subtitle to jump
- Click word for lookup + pronunciation + save to flashcards
- Flashcards list + simple practice mode
- Local study record (watch time + 7-day chart) as MVP

## Where to read docs (authoritative)

- Web app: setup, env, architecture notes  
  `web/README.md`
- Local content format (video/subtitle/vocab sidecars)  
  `content-inbox/README.md`
- Bilingual subtitle packager (SRT + optional Sonix CSV → JSON + vocab artifacts)  
  `tools/bilingual_packager/README.md`
- Desktop uploader (PySide6), scheduling/queue runner  
  `uploader-desktop/README.md`

## Do / Don’t (for AI changes)

### Do
- Read the relevant README above **before** changing code.
- Keep edits scoped to the correct subproject (`web/`, `tools/`, `uploader-desktop/`).
- Prefer small, coherent changes; keep module sizes small (web README notes a target of ~<300 lines per file).

### Don’t
- Don’t scan or modify dependency/vendor folders:
  - `web/node_modules/`
  - `uploader-desktop/.venv/`
- Don’t commit secrets. If you need env vars, rely on `.env.example` and local `.env.local`.

## Common commands (Windows)

### Web app (Next.js)

```powershell
cd d:\speak_echo\web
npm i
npm run dev
```

Open `http://localhost:3000`.

### Subtitle tooling (examples)

Merge Sonix word-level timestamps into an existing subtitle JSON:

```powershell
cd d:\speak_echo\tools
python -m bilingual_packager.merge_sonix_words "C:\path\export.csv" "D:\path\video_id.json"
```

### Desktop uploader (PySide6)

```powershell
cd d:\speak_echo\uploader-desktop
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

Run due scheduled jobs (e.g., from Windows Task Scheduler):

```powershell
cd d:\speak_echo\uploader-desktop
python -m cli.run_due_jobs
```

### Push monorepo to GitHub (private)

1. Install [GitHub CLI](https://cli.github.com/) if needed.
2. Sign in (interactive, one-time): `gh auth login`
3. From repo root:

```powershell
cd d:\speak_echo
powershell -ExecutionPolicy Bypass -File .\scripts\push-to-github.ps1
```

Creates a **private** GitHub repo (default name `speak_echo`; use `-RepoName other_name` to override) and pushes `main`. If `origin` is already set, the script only runs `git push -u origin main`. If you already created an empty repo on github.com, add `origin` and push manually (the script prints an example).

