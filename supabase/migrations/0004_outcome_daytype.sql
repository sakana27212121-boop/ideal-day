-- 作業の成果の言語化と、時間に見合う進み具合の自己評価
alter table public.work_sessions add column if not exists outcome text;
alter table public.work_sessions add column if not exists value_rating int;
-- その日に使った型（曜日の型を切り替えた記録）
alter table public.daily_states add column if not exists template_wd int;
alter table public.daily_states add column if not exists template_switched_at timestamptz;
