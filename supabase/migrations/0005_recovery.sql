-- 回復の時間の記録（何をしたか・すっきり度1〜5）。1日に複数回
alter table public.daily_states add column if not exists recoveries jsonb not null default '[]';
