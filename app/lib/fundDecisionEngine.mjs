export const DEFAULT_FUND_WATCH_PROFILE = Object.freeze({
  riskMode: 'conservative',
  riskLossLimit: 5,
  horizonMonths: 9,
  totalInvestment: 0,
  minCashReserve: 0,
  singleFundCap: 20,
  qdiiCap: 10,
  reminderLeadMinutes: 40,
  eveningReportHour: 21,
  enablePreCloseReminder: true,
  enableEveningReport: true,
  reminderChannel: 'wechat'
});

export const FUND_RISK_MODE_PRESETS = Object.freeze({
  conservative: Object.freeze({
    label: '保守模式',
    shortLabel: '保守',
    description: '5%警戒 · 单只20% · QDII 10%',
    riskLossLimit: 5,
    singleFundCap: 20,
    qdiiCap: 10
  }),
  balanced: Object.freeze({
    label: '稳健模式',
    shortLabel: '稳健',
    description: '8%警戒 · 单只25% · QDII 15%',
    riskLossLimit: 8,
    singleFundCap: 25,
    qdiiCap: 15
  }),
  growth: Object.freeze({
    label: '进取模式',
    shortLabel: '进取',
    description: '12%警戒 · 单只30% · QDII 20%',
    riskLossLimit: 12,
    singleFundCap: 30,
    qdiiCap: 20
  }),
  custom: Object.freeze({
    label: '自定义模式',
    shortLabel: '自定义',
    description: '手动设置警戒线和仓位上限'
  })
});

const QDII_PATTERN = /QDII|全球|海外|纳斯达克|标普|恒生|日经|德国|印度|越南|美国|香港|港股/i;
const BOND_PATTERN = /债|固收|利率|信用|纯债|短债|中短债|同业存单|货币/;
const INDEX_PATTERN = /指数|ETF|联接|沪深|中证|上证|创业板|科创|红利/;
const NUMBER_PROFILE_KEYS = [
  'riskLossLimit',
  'horizonMonths',
  'totalInvestment',
  'minCashReserve',
  'singleFundCap',
  'qdiiCap',
  'reminderLeadMinutes',
  'eveningReportHour'
];

const isPlainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

export function normalizeFundWatchProfile(value) {
  const input = isPlainObject(value) ? value : {};
  const next = { ...DEFAULT_FUND_WATCH_PROFILE, ...input };
  for (const key of NUMBER_PROFILE_KEYS) {
    const number = Number(next[key]);
    next[key] = Number.isFinite(number) && number >= 0 ? number : DEFAULT_FUND_WATCH_PROFILE[key];
  }
  next.riskLossLimit = Math.min(50, Math.max(1, next.riskLossLimit));
  next.horizonMonths = Math.min(120, Math.max(1, next.horizonMonths));
  next.singleFundCap = Math.min(100, Math.max(1, next.singleFundCap));
  next.qdiiCap = Math.min(next.singleFundCap, Math.max(1, next.qdiiCap));
  next.reminderLeadMinutes = Math.min(180, Math.max(5, next.reminderLeadMinutes));
  next.eveningReportHour = Math.min(23, Math.max(18, next.eveningReportHour));
  next.enablePreCloseReminder = next.enablePreCloseReminder !== false;
  next.enableEveningReport = next.enableEveningReport !== false;
  next.reminderChannel = ['wechat', 'browser', 'none'].includes(next.reminderChannel)
    ? next.reminderChannel
    : DEFAULT_FUND_WATCH_PROFILE.reminderChannel;
  const explicitRiskMode = Object.hasOwn(FUND_RISK_MODE_PRESETS, input.riskMode) ? input.riskMode : null;
  next.riskMode = explicitRiskMode || inferFundRiskMode(next);
  return next;
}

export function inferFundRiskMode(profile) {
  for (const [key, preset] of Object.entries(FUND_RISK_MODE_PRESETS)) {
    if (key === 'custom') continue;
    if (
      Number(profile?.riskLossLimit) === preset.riskLossLimit &&
      Number(profile?.singleFundCap) === preset.singleFundCap &&
      Number(profile?.qdiiCap) === preset.qdiiCap
    ) {
      return key;
    }
  }
  return 'custom';
}

export function applyFundRiskMode(profile, riskMode) {
  const mode = Object.hasOwn(FUND_RISK_MODE_PRESETS, riskMode) ? riskMode : 'custom';
  const preset = FUND_RISK_MODE_PRESETS[mode];
  return {
    ...profile,
    riskMode: mode,
    ...(mode === 'custom'
      ? {}
      : {
          riskLossLimit: preset.riskLossLimit,
          singleFundCap: preset.singleFundCap,
          qdiiCap: preset.qdiiCap
        })
  };
}

export function getFundRiskModeLabel(profile) {
  const mode = Object.hasOwn(FUND_RISK_MODE_PRESETS, profile?.riskMode) ? profile.riskMode : inferFundRiskMode(profile);
  return FUND_RISK_MODE_PRESETS[mode].label;
}

export function detectFundCategory(fund) {
  const label = `${fund?.name || ''} ${fund?.code || ''}`;
  if (QDII_PATTERN.test(label)) return 'qdii';
  if (BOND_PATTERN.test(label)) return 'bond';
  if (INDEX_PATTERN.test(label)) return 'index';
  return 'other';
}

function finiteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function holdingForCode(holdings, code) {
  if (!holdings || !code) return null;
  return holdings[code] || holdings[String(code)] || null;
}

function trendForCode(trends, code) {
  if (!trends || !code) return {};
  return trends[code] || trends[String(code)] || {};
}

function categoryName(category) {
  return {
    bond: '债券基金',
    index: '指数基金',
    qdii: 'QDII基金',
    other: '其他基金'
  }[category];
}

function getTradeWindow(category) {
  if (category === 'qdii') {
    return '操作前先核对支付宝显示的截止时间、海外交易日、汇率和限购状态';
  }
  return '如需操作，可在交易日14:20-14:50复核，并以支付宝显示的实际截止时间为准';
}

export function analyzeFundPortfolio({ funds, holdings, profile, trends = {} }) {
  const safeFunds = Array.isArray(funds) ? funds : [];
  const safeProfile = normalizeFundWatchProfile(profile);
  const rows = safeFunds.map((fund) => {
    const code = String(fund?.code || '').trim();
    const holding = holdingForCode(holdings, code);
    const trend = trendForCode(trends, code);
    const share = finiteNumber(holding?.share, 0) || 0;
    const costNav = finiteNumber(holding?.cost);
    const nav = finiteNumber(fund?.gsz, fund?.dwjz, fund?.nav);
    const dayChange = finiteNumber(fund?.gszzl, fund?.zzl);
    const marketValue = nav != null && share > 0 ? nav * share : 0;
    const totalCost = costNav != null && share > 0 ? costNav * share : 0;
    const profit = marketValue - totalCost;
    const profitPct = totalCost > 0 ? (profit / totalCost) * 100 : null;
    const category = detectFundCategory(fund);
    return {
      code,
      name: fund?.name || `基金 ${code}`,
      category,
      categoryName: categoryName(category),
      share,
      marketValue,
      totalCost,
      profit,
      profitPct,
      dayChange,
      nav,
      gztime: fund?.gztime || fund?.jzrq || null,
      return20: finiteNumber(trend?.return20),
      return60: finiteNumber(trend?.return60),
      maxDrawdown60: finiteNumber(trend?.maxDrawdown60),
      consecutiveDirection: trend?.consecutiveDirection || null,
      consecutiveDays: finiteNumber(trend?.consecutiveDays, 0) || 0,
      hasHolding: share > 0
    };
  });

  const holdingRows = rows.filter((row) => row.hasHolding);
  const marketValue = holdingRows.reduce((sum, row) => sum + row.marketValue, 0);
  const totalCost = holdingRows.reduce((sum, row) => sum + row.totalCost, 0);
  const profit = marketValue - totalCost;
  const profitPct = totalCost > 0 ? (profit / totalCost) * 100 : null;
  const dayEstimate = holdingRows.reduce((sum, row) => {
    if (row.dayChange == null) return sum;
    return sum + row.marketValue * (row.dayChange / 100);
  }, 0);
  const investableTarget = Math.max(0, safeProfile.totalInvestment - safeProfile.minCashReserve);
  const availableBudget = Math.max(0, investableTarget - marketValue);

  const allocation = { bond: 0, index: 0, qdii: 0, other: 0 };
  for (const row of holdingRows) allocation[row.category] += row.marketValue;
  for (const key of Object.keys(allocation)) {
    allocation[key] = marketValue > 0 ? (allocation[key] / marketValue) * 100 : 0;
  }

  const decisions = rows.map((row) => {
    const positionPct = marketValue > 0 ? (row.marketValue / marketValue) * 100 : 0;
    const cap = row.category === 'qdii' ? safeProfile.qdiiCap : safeProfile.singleFundCap;
    const reasons = [];
    let action = '继续持有';
    let tone = 'stable';
    let priority = 1;

    if (!row.hasHolding) {
      action = '待录入持仓';
      tone = 'neutral';
      priority = 0;
      reasons.push('尚未录入持有份额和成本，暂不生成买卖判断');
    } else if (row.profitPct != null && row.profitPct <= -safeProfile.riskLossLimit) {
      action = '触发风险警戒';
      tone = 'danger';
      priority = 5;
      reasons.push(`持仓亏损已达到${Math.abs(row.profitPct).toFixed(1)}%，超过${safeProfile.riskLossLimit}%警戒线`);
    } else if (positionPct > cap) {
      action = '评估分批减仓';
      tone = 'warning';
      priority = 4;
      reasons.push(`当前仓位约${positionPct.toFixed(1)}%，超过该类基金${cap}%的单只上限`);
    } else if (row.category === 'bond' && row.dayChange != null && row.dayChange <= -0.5) {
      action = '重点观察';
      tone = 'warning';
      priority = 3;
      reasons.push(`债券基金单日估算${row.dayChange.toFixed(2)}%，波动显著高于常态`);
    } else if (row.maxDrawdown60 != null && row.maxDrawdown60 <= -safeProfile.riskLossLimit) {
      action = '重点观察';
      tone = 'warning';
      priority = 3;
      reasons.push(`近60个净值点最大回撤${row.maxDrawdown60.toFixed(1)}%，已达到风险警戒范围`);
    } else if (
      (row.category === 'index' || row.category === 'qdii') &&
      row.dayChange != null &&
      row.dayChange <= -2.5
    ) {
      action = '重点观察';
      tone = 'warning';
      priority = 3;
      reasons.push(`当日估算${row.dayChange.toFixed(2)}%，需结合连续回撤和海外交易日再判断`);
    } else if (
      availableBudget > 0 &&
      positionPct < cap * 0.7 &&
      row.return20 != null &&
      row.return20 < 0 &&
      row.return60 != null &&
      row.return60 > -safeProfile.riskLossLimit
    ) {
      action = '观察分批买入';
      tone = 'info';
      priority = 2;
      reasons.push('仍有计划资金、仓位未超限，近20日回调但近60日风险尚未越线，可等待止跌后小额分批');
    } else if (availableBudget > 0 && positionPct < cap * 0.5) {
      action = '等待分批条件';
      tone = 'info';
      priority = 2;
      reasons.push('仓位低于上限且仍有计划资金，需等待趋势、估值和交易费率条件同时满足');
    } else {
      reasons.push('当前仓位、亏损和近60日回撤均未触发已设置的风险条件');
    }

    if (row.return20 != null) reasons.push(`近20个净值点涨跌${row.return20.toFixed(1)}%`);
    if (row.return60 != null) reasons.push(`近60个净值点涨跌${row.return60.toFixed(1)}%`);
    if (row.category === 'qdii') reasons.push('QDII需额外核对海外休市、汇率和净值延迟');
    if (row.category === 'bond') reasons.push('债券基金需关注信用、久期和单日异常净值');
    if (row.category === 'index') reasons.push('指数基金需结合跟踪误差、费率和指数估值区间');

    return {
      ...row,
      action,
      tone,
      priority,
      positionPct,
      positionCap: cap,
      tradeWindow: getTradeWindow(row.category),
      reasons
    };
  });

  decisions.sort((a, b) => b.priority - a.priority || b.marketValue - a.marketValue);
  const alertCount = decisions.filter((item) => item.priority >= 3).length;

  return {
    profile: safeProfile,
    marketValue,
    totalCost,
    profit,
    profitPct,
    dayEstimate,
    availableBudget,
    allocation,
    decisions,
    alertCount,
    holdingCount: holdingRows.length,
    fundCount: rows.length
  };
}
