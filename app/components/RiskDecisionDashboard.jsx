'use client';

import { useEffect, useMemo, useState } from 'react';
import { BellRing, Clock3, Settings2, ShieldCheck, WalletCards, X } from 'lucide-react';
import {
  FUND_RISK_MODE_PRESETS,
  analyzeFundPortfolio,
  applyFundRiskMode,
  normalizeFundWatchProfile
} from '../lib/fundDecisionEngine.mjs';

const money = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
  maximumFractionDigits: 0
});

const pct = (value) => `${Number(value || 0).toFixed(1)}%`;

const RISK_SETTING_KEYS = new Set(['riskLossLimit', 'singleFundCap', 'qdiiCap']);

export default function RiskDecisionDashboard({
  funds,
  holdings,
  profile,
  onProfileChange,
  settingsOpen,
  onSettingsOpenChange
}) {
  const safeProfile = useMemo(() => normalizeFundWatchProfile(profile), [profile]);
  const analysis = useMemo(
    () => analyzeFundPortfolio({ funds, holdings, profile: safeProfile }),
    [funds, holdings, safeProfile]
  );
  const [draft, setDraft] = useState(safeProfile);
  const editing = Boolean(settingsOpen);

  useEffect(() => setDraft(safeProfile), [safeProfile]);

  const updateDraft = (key, value) => {
    setDraft((current) => ({
      ...current,
      [key]: value,
      ...(RISK_SETTING_KEYS.has(key) ? { riskMode: 'custom' } : {})
    }));
  };

  const setEditing = (nextOpen) => {
    if (!nextOpen) setDraft(safeProfile);
    onSettingsOpenChange?.(nextOpen);
  };

  const saveProfile = () => {
    onProfileChange?.(normalizeFundWatchProfile(draft));
    setEditing(false);
  };

  const allocationItems = [
    ['bond', '债券', analysis.allocation.bond],
    ['index', '指数', analysis.allocation.index],
    ['qdii', 'QDII', analysis.allocation.qdii],
    ['other', '其他', analysis.allocation.other]
  ];

  return (
    <section className="decision-dashboard glass" aria-labelledby="decision-dashboard-title">
      <div className="decision-dashboard__header">
        <div>
          <div className="decision-dashboard__eyebrow">
            <ShieldCheck size={16} aria-hidden />
            个人决策辅助
          </div>
          <h2 id="decision-dashboard-title">今日决策台</h2>
          <p>先看风险和仓位，再决定是否需要打开支付宝操作。</p>
        </div>
        <button
          type="button"
          className="decision-dashboard__settings"
          onClick={() => setEditing(!editing)}
          aria-expanded={editing}
        >
          {editing ? <X size={17} /> : <Settings2 size={17} />}
          {editing ? '关闭设置' : '投资设置'}
        </button>
      </div>

      {editing && (
        <div className="decision-profile" role="group" aria-label="投资与风险设置">
          <div className="decision-profile__risk-mode">
            <div>
              <strong>风险模式</strong>
              <span>选择预设或手动修改下方警戒线；模式只是阈值设置，不代表收益承诺。</span>
            </div>
            <div className="decision-profile__risk-mode-options" role="radiogroup" aria-label="选择风险模式">
              {Object.entries(FUND_RISK_MODE_PRESETS).map(([key, preset]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={draft.riskMode === key}
                  className={draft.riskMode === key ? 'is-active' : ''}
                  onClick={() => setDraft((current) => applyFundRiskMode(current, key))}
                >
                  <strong>{preset.shortLabel}</strong>
                  <small>{preset.description}</small>
                </button>
              ))}
            </div>
          </div>
          <label>
            <span>计划投资总额</span>
            <input
              type="number"
              min="0"
              step="100"
              value={draft.totalInvestment}
              onChange={(event) => updateDraft('totalInvestment', event.target.value)}
            />
          </label>
          <label>
            <span>保留现金</span>
            <input
              type="number"
              min="0"
              step="100"
              value={draft.minCashReserve}
              onChange={(event) => updateDraft('minCashReserve', event.target.value)}
            />
          </label>
          <label>
            <span>亏损警戒线</span>
            <div className="decision-profile__suffix">
              <input
                type="number"
                min="1"
                max="50"
                step="1"
                value={draft.riskLossLimit}
                onChange={(event) => updateDraft('riskLossLimit', event.target.value)}
              />
              <span>%</span>
            </div>
          </label>
          <label>
            <span>投资期限</span>
            <div className="decision-profile__suffix">
              <input
                type="number"
                min="1"
                max="120"
                step="1"
                value={draft.horizonMonths}
                onChange={(event) => updateDraft('horizonMonths', event.target.value)}
              />
              <span>个月</span>
            </div>
          </label>
          <label>
            <span>单只基金仓位上限</span>
            <div className="decision-profile__suffix">
              <input
                type="number"
                min="1"
                max="100"
                step="1"
                value={draft.singleFundCap}
                onChange={(event) => updateDraft('singleFundCap', event.target.value)}
              />
              <span>%</span>
            </div>
          </label>
          <label>
            <span>QDII仓位上限</span>
            <div className="decision-profile__suffix">
              <input
                type="number"
                min="1"
                max="100"
                step="1"
                value={draft.qdiiCap}
                onChange={(event) => updateDraft('qdiiCap', event.target.value)}
              />
              <span>%</span>
            </div>
          </label>
          <label>
            <span>交易截止前提醒</span>
            <div className="decision-profile__suffix">
              <input
                type="number"
                min="5"
                max="180"
                step="5"
                value={draft.reminderLeadMinutes}
                onChange={(event) => updateDraft('reminderLeadMinutes', event.target.value)}
              />
              <span>分钟</span>
            </div>
          </label>
          <label>
            <span>晚间日报时间</span>
            <div className="decision-profile__suffix">
              <input
                type="number"
                min="18"
                max="23"
                step="1"
                value={draft.eveningReportHour}
                onChange={(event) => updateDraft('eveningReportHour', event.target.value)}
              />
              <span>时</span>
            </div>
          </label>
          <label className="decision-profile__toggle">
            <span>截止前微信提醒</span>
            <input
              type="checkbox"
              checked={draft.enablePreCloseReminder}
              onChange={(event) => updateDraft('enablePreCloseReminder', event.target.checked)}
            />
          </label>
          <label className="decision-profile__toggle">
            <span>每日微信报告</span>
            <input
              type="checkbox"
              checked={draft.enableEveningReport}
              onChange={(event) => updateDraft('enableEveningReport', event.target.checked)}
            />
          </label>
          <button type="button" className="button decision-profile__save" onClick={saveProfile}>
            保存设置
          </button>
        </div>
      )}

      <div className="decision-metrics">
        <article>
          <WalletCards size={18} aria-hidden />
          <span>计划投资</span>
          <strong>{money.format(analysis.profile.totalInvestment)}</strong>
        </article>
        <article>
          <span className="decision-metrics__dot decision-metrics__dot--cyan" />
          <span>当前持仓</span>
          <strong>{money.format(analysis.marketValue)}</strong>
        </article>
        <article>
          <span className="decision-metrics__dot decision-metrics__dot--green" />
          <span>可用计划资金</span>
          <strong>{money.format(analysis.availableBudget)}</strong>
        </article>
        <article className={analysis.alertCount > 0 ? 'is-alert' : ''}>
          <ShieldCheck size={18} aria-hidden />
          <span>风险警戒</span>
          <strong>{analysis.profile.riskLossLimit}%</strong>
          <small>{analysis.alertCount > 0 ? `${analysis.alertCount}项需关注` : '暂未触发'}</small>
        </article>
      </div>

      <div className="decision-dashboard__body">
        <div className="decision-allocation">
          <div className="decision-section-title">
            <span>持仓结构</span>
            <small>{analysis.holdingCount}只持仓</small>
          </div>
          <div className="decision-allocation__bar" aria-label="基金类型仓位分布">
            {allocationItems.map(([key, label, value]) => (
              <span key={key} className={`is-${key}`} style={{ width: `${value}%` }} title={`${label} ${pct(value)}`} />
            ))}
          </div>
          <div className="decision-allocation__legend">
            {allocationItems.map(([key, label, value]) => (
              <span key={key}>
                <i className={`is-${key}`} />
                {label} {pct(value)}
              </span>
            ))}
          </div>
          <div className="decision-reminder">
            <Clock3 size={17} aria-hidden />
            <div>
              <strong>交易窗口提醒</strong>
              <span>
                截止前{analysis.profile.reminderLeadMinutes}分钟汇总提醒，{analysis.profile.eveningReportHour}
                :00生成晚间日报
              </span>
            </div>
            <span className="decision-reminder__status">微信优先 · 待连接</span>
          </div>
        </div>

        <div className="decision-list">
          <div className="decision-section-title">
            <span>基金状态</span>
            <small>结论均附触发原因</small>
          </div>
          {analysis.decisions.length === 0 ? (
            <div className="decision-empty">
              <BellRing size={22} aria-hidden />
              <div>
                <strong>还没有基金数据</strong>
                <span>先设置投资金额，再使用顶部搜索或截图按钮导入支付宝持仓。</span>
              </div>
            </div>
          ) : (
            <div className="decision-list__items">
              {analysis.decisions.slice(0, 5).map((item) => (
                <article key={item.code}>
                  <div>
                    <strong>{item.name}</strong>
                    <span>
                      {item.categoryName} · {item.code}
                    </span>
                  </div>
                  <div className={`decision-action is-${item.tone}`}>{item.action}</div>
                  <p>{item.reasons[0]}</p>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="decision-dashboard__notice">
        当前结论属于个人决策辅助，不承诺收益。估算净值、QDII时差和公开接口延迟都可能影响结果，最终交易须由你在支付宝确认。
      </p>
    </section>
  );
}
