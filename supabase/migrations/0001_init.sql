-- 生活管理アプリ「冒険の書」初期スキーマ
-- すべての表：本人のデータだけを読み書きできる（行単位セキュリティ RLS）
-- 同期：クライアントは updated_at（端末時刻）で新旧を判定し、synced_at（サーバー時刻）で差分を取得する

create or replace function public.touch_synced_at() returns trigger
language plpgsql as $$
begin
  new.synced_at := now();
  return new;
end $$;

-- 共通の列を持つ表を作り、RLSとトリガーを設定する
create or replace function public._setup_table(t text) returns void
language plpgsql as $$
begin
  execute format('alter table public.%I enable row level security', t);
  execute format('drop policy if exists own_rows on public.%I', t);
  execute format('create policy own_rows on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  execute format('drop trigger if exists touch on public.%I', t);
  execute format('create trigger touch before insert or update on public.%I for each row execute function public.touch_synced_at()', t);
  execute format('create index if not exists %I on public.%I (user_id, synced_at)', t || '_sync_idx', t);
end $$;

-- ユーザー設定（呼び名・表示など）
create table if not exists public.user_settings (
  id uuid primary key, user_id uuid not null default auth.uid() references auth.users on delete cascade,
  prefs jsonb not null default '{}', onboarded boolean not null default false,
  updated_at timestamptz not null default now(), synced_at timestamptz not null default now(), deleted boolean not null default false);

-- 理想の生活
create table if not exists public.ideal_life (
  id uuid primary key, user_id uuid not null default auth.uid() references auth.users on delete cascade,
  wake_time text, bed_time text, sleep_hours numeric, meals jsonb not null default '[]',
  exercise_time text, exercise_min int, rest_every_min int, rest_min int,
  free_time text, free_min int, focus_period text, work_start text, work_end text,
  goals jsonb not null default '[]', priorities jsonb not null default '[]',
  updated_at timestamptz not null default now(), synced_at timestamptz not null default now(), deleted boolean not null default false);

-- 習慣（食事・運動・独自の習慣など。項目は追加できる）
create table if not exists public.habits (
  id uuid primary key, user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null, kind text not null default 'custom', target text, sort int not null default 0, active boolean not null default true,
  updated_at timestamptz not null default now(), synced_at timestamptz not null default now(), deleted boolean not null default false);

-- 習慣の実績
create table if not exists public.habit_logs (
  id uuid primary key, user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null, habit_id uuid not null, done boolean not null default true, at timestamptz, value numeric,
  updated_at timestamptz not null default now(), synced_at timestamptz not null default now(), deleted boolean not null default false);

-- 日々の状態（起床・就寝・睡眠・元気・充実度など）
create table if not exists public.daily_states (
  id uuid primary key, user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null, wake_at timestamptz, bed_at timestamptz, sleep_hours numeric,
  energy int, fulfill int, rest_count int not null default 0, note text,
  updated_at timestamptz not null default now(), synced_at timestamptz not null default now(), deleted boolean not null default false);

-- 毎週の固定予定（大学・仕事など）
create table if not exists public.recurring_events (
  id uuid primary key, user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null, weekdays int[] not null default '{}', start_min int not null, dur int not null, kind text not null default 'fixed', active boolean not null default true,
  updated_at timestamptz not null default now(), synced_at timestamptz not null default now(), deleted boolean not null default false);

-- 予定（その日の時間割）
create table if not exists public.schedule_blocks (
  id uuid primary key, user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null, start_min int not null, dur int not null, kind text not null, title text,
  task_id uuid, fixed boolean not null default false, status text not null default 'planned', actual_min int, source text not null default 'user',
  updated_at timestamptz not null default now(), synced_at timestamptz not null default now(), deleted boolean not null default false);

-- プロジェクト
create table if not exists public.projects (
  id uuid primary key, user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null, active boolean not null default true,
  updated_at timestamptz not null default now(), synced_at timestamptz not null default now(), deleted boolean not null default false);

-- タスク（完了させる仕事そのもの）
create table if not exists public.tasks (
  id uuid primary key, user_id uuid not null default auth.uid() references auth.users on delete cascade,
  project_id uuid, title text not null, goal text, done_when text, estimate_min int not null default 30,
  priority int not null default 2, due_date date, status text not null default 'open', completed_at timestamptz, sort int not null default 0,
  updated_at timestamptz not null default now(), synced_at timestamptz not null default now(), deleted boolean not null default false);

-- 作業セッション（タスクに取り組んだ1回分）
create table if not exists public.work_sessions (
  id uuid primary key, user_id uuid not null default auth.uid() references auth.users on delete cascade,
  task_id uuid not null, block_id uuid, started_at timestamptz not null, ended_at timestamptz,
  paused_at timestamptz, paused_ms bigint not null default 0, minutes int, status text,
  focus int, energy int, problem text, memo text,
  updated_at timestamptz not null default now(), synced_at timestamptz not null default now(), deleted boolean not null default false);

-- 引き継ぎ（次回の開始時に表示する）
create table if not exists public.handoffs (
  id uuid primary key, user_id uuid not null default auth.uid() references auth.users on delete cascade,
  task_id uuid not null, session_id uuid, progress text, remaining text, next_step text,
  updated_at timestamptz not null default now(), synced_at timestamptz not null default now(), deleted boolean not null default false);

-- 改善提案（予定変更の提案・生活改善の提案。AI/ルールの推測であり記録とは区別する）
create table if not exists public.improvement_proposals (
  id uuid primary key, user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null, text text not null, basis text, payload jsonb not null default '{}',
  status text not null default 'new', source text not null default 'rule', date date,
  updated_at timestamptz not null default now(), synced_at timestamptz not null default now(), deleted boolean not null default false);

-- 改善実験
create table if not exists public.experiments (
  id uuid primary key, user_id uuid not null default auth.uid() references auth.users on delete cascade,
  proposal_id uuid, title text not null, change text, start_date date not null, days int not null default 7,
  status text not null default 'running', decision text, note text,
  updated_at timestamptz not null default now(), synced_at timestamptz not null default now(), deleted boolean not null default false);

-- 実験の結果
create table if not exists public.experiment_results (
  id uuid primary key, user_id uuid not null default auth.uid() references auth.users on delete cascade,
  experiment_id uuid not null, metrics jsonb not null default '{}', summary text,
  updated_at timestamptz not null default now(), synced_at timestamptz not null default now(), deleted boolean not null default false);

-- AI相談の履歴
create table if not exists public.ai_messages (
  id uuid primary key, user_id uuid not null default auth.uid() references auth.users on delete cascade,
  role text not null, content text not null, context jsonb not null default '{}',
  updated_at timestamptz not null default now(), synced_at timestamptz not null default now(), deleted boolean not null default false);

select public._setup_table(t) from unnest(array[
  'user_settings','ideal_life','habits','habit_logs','daily_states','recurring_events','schedule_blocks','projects',
  'tasks','work_sessions','handoffs','improvement_proposals','experiments','experiment_results','ai_messages']) as t;

drop function public._setup_table(text);

-- 匿名ロールからは一切アクセスさせない
revoke all on all tables in schema public from anon;
