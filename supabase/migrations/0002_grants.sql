-- ログイン済みユーザーに表の読み書きを許可する（どの行を扱えるかは RLS で本人の行だけに制限）
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
