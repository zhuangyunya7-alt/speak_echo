-- SpeakEcho minimal schema (Supabase / Postgres)
-- Run in Supabase SQL editor.

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  cover_url text not null,
  video_url text not null,
  author text not null,
  level text not null,
  category text not null,
  duration_sec integer,
  published_at timestamptz default now()
);

create table if not exists public.subtitles (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  content jsonb not null
);

create table if not exists public.activation_codes (
  code text primary key,
  is_used boolean not null default false,
  expire_days integer not null default 365,
  used_by uuid references auth.users(id),
  used_at timestamptz
);

-- Backfill columns when table already exists (idempotent migrations)
alter table public.activation_codes add column if not exists expire_days integer not null default 365;
alter table public.activation_codes add column if not exists used_by uuid references auth.users(id);
alter table public.activation_codes add column if not exists used_at timestamptz;

-- seed first code
insert into public.activation_codes(code, is_used, expire_days)
values ('G1C7D5', false, 365)
on conflict (code) do nothing;

-- User subscription/activation state
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  phone text,
  active_until timestamptz
);

-- Backfill columns when table already exists
alter table public.users add column if not exists email text;
alter table public.users add column if not exists phone text;
alter table public.users add column if not exists active_until timestamptz;

alter table public.users enable row level security;

create unique index if not exists users_phone_unique on public.users(phone);

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'users' and policyname = 'users_select_own'
  ) then
    create policy users_select_own on public.users
      for select using (auth.uid() = id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'users' and policyname = 'users_update_own'
  ) then
    create policy users_update_own on public.users
      for update using (auth.uid() = id);
  end if;
end $$;

-- Admin allowlist (route A for admin authorization)
create table if not exists public.admins (
  phone text primary key
);

alter table public.admins enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='admins' and policyname='admins_select_authed'
  ) then
    create policy admins_select_authed on public.admins
      for select to authenticated using (true);
  end if;
end $$;

-- Learning calendar (learned dates)
create table if not exists public.learning_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  learned_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.learning_days enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'learning_days' and policyname = 'learning_days_select_own'
  ) then
    create policy learning_days_select_own on public.learning_days
      for select using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'learning_days' and policyname = 'learning_days_insert_own'
  ) then
    create policy learning_days_insert_own on public.learning_days
      for insert with check (auth.uid() = user_id);
  end if;
end $$;

-- Learning time (daily aggregated seconds)
create table if not exists public.learning_time_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  seconds integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.learning_time_daily enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'learning_time_daily' and policyname = 'learning_time_daily_select_own'
  ) then
    create policy learning_time_daily_select_own on public.learning_time_daily
      for select using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'learning_time_daily' and policyname = 'learning_time_daily_upsert_own'
  ) then
    create policy learning_time_daily_upsert_own on public.learning_time_daily
      for insert with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'learning_time_daily' and policyname = 'learning_time_daily_update_own'
  ) then
    create policy learning_time_daily_update_own on public.learning_time_daily
      for update using (auth.uid() = user_id);
  end if;
end $$;

-- Flashcards: user saved words
create table if not exists public.flashcards (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  word text not null,
  phonetic text,
  part_of_speech text,
  meaning_zh text,
  example text,
  video_id uuid references public.videos(id),
  video_title text,
  segment_start double precision,
  segment_end double precision,
  word_start double precision,
  word_end double precision,
  created_at timestamptz not null default now()
);

alter table public.flashcards enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'flashcards' and policyname = 'flashcards_select_own'
  ) then
    create policy flashcards_select_own on public.flashcards
      for select using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'flashcards' and policyname = 'flashcards_insert_own'
  ) then
    create policy flashcards_insert_own on public.flashcards
      for insert with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'flashcards' and policyname = 'flashcards_delete_own'
  ) then
    create policy flashcards_delete_own on public.flashcards
      for delete using (auth.uid() = user_id);
  end if;
end $$;

-- Optional media / sidecar URLs on videos (COS). Safe to re-run.
alter table public.videos add column if not exists description text;
alter table public.videos add column if not exists subtitle_url text;
alter table public.videos add column if not exists vocab_url text;
alter table public.videos add column if not exists vocab_display_url text;
alter table public.videos add column if not exists phrases_url text;
alter table public.videos add column if not exists meta_url text;
alter table public.videos add column if not exists categories text[];

