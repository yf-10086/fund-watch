-- 基金守望：用 Supabase Cron 触发 GitHub Actions，绕过 GitHub schedule 延迟/丢任务问题。
-- 使用前：
-- 1. 在 GitHub 创建仅限 yf-10086/fund-watch、仅有 Actions: Read and write 的 Fine-grained token。
-- 2. 在 Supabase SQL Editor 单独执行下面这一行，把占位文字替换为 token；不要把真实 token 保存进本文件。
-- select vault.create_secret('PASTE_GITHUB_TOKEN_HERE', 'fund_watch_github_token');

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'fund_watch_github_token'
  ) then
    raise exception '请先把 GitHub Fine-grained token 写入 Supabase Vault';
  end if;
end
$$;

-- 重复执行本文件时先移除旧任务，避免重复触发。
select cron.unschedule(jobid)
from cron.job
where jobname in ('fund-watch-preclose-primary', 'fund-watch-evening-primary');

-- 北京时间14:00-14:55每5分钟检查一次（UTC 06:00-06:55）。
-- 程序按页面设置的“提前提醒分钟数”判断，并按日期去重，只正式发送一次。
select cron.schedule(
  'fund-watch-preclose-primary',
  '*/5 6 * * 1-5',
  $job$
  select net.http_post(
    url := 'https://api.github.com/repos/yf-10086/fund-watch/actions/workflows/daily-analysis.yml/dispatches',
    headers := jsonb_build_object(
      'Accept', 'application/vnd.github+json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'fund_watch_github_token'
      ),
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'fund-watch-supabase-cron'
    ),
    body := '{"ref":"main","inputs":{"report_mode":"preclose","formal_run":"true"}}'::jsonb,
    timeout_milliseconds := 10000
  ) as request_id;
  $job$
);

-- 北京时间18:05-23:35每半小时触发；程序按页面设置的晚报小时判断，并按日期去重，只正式发送一次。
select cron.schedule(
  'fund-watch-evening-primary',
  '5,35 10-15 * * *',
  $job$
  select net.http_post(
    url := 'https://api.github.com/repos/yf-10086/fund-watch/actions/workflows/daily-analysis.yml/dispatches',
    headers := jsonb_build_object(
      'Accept', 'application/vnd.github+json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'fund_watch_github_token'
      ),
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'fund-watch-supabase-cron'
    ),
    body := '{"ref":"main","inputs":{"report_mode":"evening","formal_run":"true"}}'::jsonb,
    timeout_milliseconds := 10000
  ) as request_id;
  $job$
);

-- 验收：应返回两行 active=true。运行历史可在 Supabase Integrations -> Cron 查看。
select jobid, jobname, schedule, active
from cron.job
where jobname in ('fund-watch-preclose-primary', 'fund-watch-evening-primary')
order by jobname;
