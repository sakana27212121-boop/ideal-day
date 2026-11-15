-- 週の型（曜日ごとの時間割）と定例タスク
-- recurring_events：kind='fixed' は固定予定、それ以外は動かせる「週の型」の予定。task_id で作業枠と定例タスクを結ぶ
alter table public.recurring_events add column if not exists task_id uuid;
-- tasks.recurring：定例タスク（「完了」にしても次回の枠に残る。続きの再配置の提案を出さない）
alter table public.tasks add column if not exists recurring boolean not null default false;
