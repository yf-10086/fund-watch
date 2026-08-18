-- 只用于已经运行过旧版 doc/supabase.sql 的个人项目。
-- 新建 Supabase 项目不需要单独运行本文件，最新版 doc/supabase.sql 已包含同一字段。

ALTER TABLE public.fund_watch_reports
ADD COLUMN IF NOT EXISTS report_data jsonb null;
