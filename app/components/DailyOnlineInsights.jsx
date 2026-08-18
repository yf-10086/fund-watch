'use client';

import { ExternalLink, Newspaper, ShieldAlert } from 'lucide-react';

const LEVEL_LABELS = {
  critical: '高风险',
  caution: '需关注',
  positive: '偏正面',
  info: '一般信息'
};

function formatReportTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

export default function DailyOnlineInsights({ reportState }) {
  const { report, loading, error, configured, signedIn } = reportState || {};
  const reportData = report?.report_data;
  const insights = Array.isArray(reportData?.insights) ? reportData.insights : [];
  const sourceDisabled = reportData?.sourceStatus === 'disabled';
  const sourceUnavailable = reportData?.sourceStatus === 'unavailable';
  const sourcePartial = reportData?.sourceStatus === 'partial';

  let emptyTitle = '';
  let emptyMessage = '';
  if (!configured) {
    emptyTitle = '等待连接每日分析服务';
    emptyMessage = '完成免费云同步和每日任务配置后，这里会自动显示每天筛出的基金公告、新闻和参考动作。';
  } else if (!signedIn) {
    emptyTitle = '登录后查看每日公开信息';
    emptyMessage = '登录同一个个人账号后，手机和电脑会显示同一份每日分析。';
  } else if (loading) {
    emptyTitle = '正在读取最近一次分析';
    emptyMessage = '稍等片刻，页面正在同步你的个人晚报。';
  } else if (error) {
    emptyTitle = '暂时无法读取每日分析';
    emptyMessage = '请确认数据库脚本已更新；净值和持仓分析仍可正常使用。';
  } else if (!reportData) {
    emptyTitle = '等待第一份每日分析';
    emptyMessage = '每日任务运行并发送晚报后，这里会保存不含持仓金额的公开信息摘要。';
  }

  return (
    <section className="online-insights" aria-labelledby="online-insights-title">
      <div className="decision-section-title online-insights__title">
        <span id="online-insights-title">
          <Newspaper size={16} aria-hidden />
          今日公开信息
        </span>
        <small>
          {reportData ? `${formatReportTime(reportData.generatedAt || report?.sent_at)}更新` : '每日自动筛选'}
        </small>
      </div>

      {emptyTitle ? (
        <div className="online-insights__empty">
          <ShieldAlert size={20} aria-hidden />
          <div>
            <strong>{emptyTitle}</strong>
            <span>{emptyMessage}</span>
          </div>
        </div>
      ) : (
        <>
          <div className="online-insights__summary">
            已检查{Number(reportData.checkedFundCount) || 0}只持仓，收集{Number(reportData.collectedCount) || 0}
            条相关信息，筛出
            <strong>{Number(reportData.usefulCount) || 0}</strong>条有用信息。
            {sourceDisabled
              ? '公开信息分析已关闭。'
              : sourceUnavailable
                ? '本次信息源不可用。'
                : sourcePartial
                  ? '部分信息源读取失败。'
                  : '信息源读取正常。'}
          </div>
          {sourceDisabled ? (
            <div className="online-insights__empty is-quiet">
              <div>
                <strong>公开信息分析已关闭</strong>
                <span>可在“投资设置”中重新开启；当前参考动作只使用净值、趋势和仓位数据。</span>
              </div>
            </div>
          ) : sourceUnavailable ? (
            <div className="online-insights__empty">
              <ShieldAlert size={20} aria-hidden />
              <div>
                <strong>本次公开信息源暂时不可用</strong>
                <span>不能据此判断“今天没有重要事件”；净值和仓位分析仍然有效，请以基金正式公告为准。</span>
              </div>
            </div>
          ) : insights.length === 0 ? (
            <div className="online-insights__empty is-quiet">
              <div>
                <strong>今天暂未筛出重要事件</strong>
                <span>这不等于基金没有风险，系统仍会结合净值、趋势和仓位给出参考动作。</span>
              </div>
            </div>
          ) : (
            <div className="online-insights__list">
              {insights.slice(0, 5).map((item, index) => (
                <article key={`${item.fundCode}-${item.title}-${index}`}>
                  <div className="online-insights__meta">
                    <span className={`online-insights__level is-${item.level}`}>
                      {LEVEL_LABELS[item.level] || '一般信息'}
                    </span>
                    <strong>{item.fundName}</strong>
                    <small>{item.source}</small>
                  </div>
                  <a href={item.url} target="_blank" rel="noreferrer">
                    {item.title}
                    <ExternalLink size={13} aria-hidden />
                  </a>
                  <p>{item.why}</p>
                  <div className="online-insights__suggestion">参考处理：{item.suggestion}</div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
      <p className="online-insights__boundary">公告优先于新闻；标题由规则筛选，点击原文核实后再操作，不会自动买卖。</p>
    </section>
  );
}
