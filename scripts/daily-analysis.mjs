import {
  analyzeFundPortfolio,
  buildFundInvestmentAmountAdvice,
  normalizeFundWatchProfile
} from '../app/lib/fundDecisionEngine.mjs';
import { collectFundOnlineInfo, onlineInfoImpactForFund } from '../app/lib/fundOnlineInfo.mjs';

const REQUIRED_ENV = ['SUPABASE_URL', 'FUND_WATCH_USER_ID', 'SERVERCHAN_SENDKEY'];
const VALUATION_FIELDS = 'FCODE,SHORTNAME,GSZZL,GZTIME,GSZ,NAV,PDATE';
const REPORT_MODE = process.env.REPORT_MODE === 'preclose' ? 'preclose' : 'evening';
const FORCE_SEND = process.env.FORCE_SEND === 'true';
const TIME_ZONE = 'Asia/Shanghai';

function requireEnvironment() {
  const missing = REQUIRED_ENV.filter((key) => !String(process.env[key] || '').trim());
  if (!String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()) {
    missing.push('SUPABASE_SECRET_KEY');
  }
  if (missing.length > 0) {
    throw new Error(`缺少 GitHub Actions 加密变量：${missing.join(', ')}`);
  }
}

function supabaseAdminKey() {
  return String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
}

function supabaseAdminHeaders(extra = {}) {
  const key = supabaseAdminKey();
  return {
    apikey: key,
    ...(key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }),
    ...extra
  };
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function dateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((item) => [item.type, item.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

async function fetchJson(url, options, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function loadUserPayload() {
  const supabaseUrl = process.env.SUPABASE_URL.replace(/\/$/, '');
  const userId = encodeURIComponent(process.env.FUND_WATCH_USER_ID.trim());
  const url = `${supabaseUrl}/rest/v1/user_configs?select=data&user_id=eq.${userId}&limit=1`;
  const rows = await fetchJson(
    url,
    {
      headers: supabaseAdminHeaders({ Accept: 'application/json' })
    },
    'Supabase 同步数据'
  );
  if (!Array.isArray(rows) || !rows[0]?.data) {
    throw new Error('没有找到该用户的同步数据，请先在基金守望登录并完成一次云同步');
  }
  return rows[0].data;
}

function isFormalReportRecord(row, reportDate, reportMode, profile) {
  const sentAt = new Date(row?.sent_at);
  if (Number.isNaN(sentAt.getTime())) return true;
  const sent = dateParts(sentAt);
  if (sent.date !== reportDate) return false;
  if (reportMode === 'evening') return sent.hour >= profile.eveningReportHour;
  const sentMinutes = sent.hour * 60 + sent.minute;
  const cutoffMinutes = 15 * 60;
  return sentMinutes >= cutoffMinutes - profile.reminderLeadMinutes && sentMinutes <= cutoffMinutes;
}

async function hasReportBeenSent(reportDate, reportMode, profile) {
  const supabaseUrl = process.env.SUPABASE_URL.replace(/\/$/, '');
  const userId = encodeURIComponent(process.env.FUND_WATCH_USER_ID.trim());
  const url =
    `${supabaseUrl}/rest/v1/fund_watch_reports?select=sent_at&user_id=eq.${userId}` +
    `&report_date=eq.${encodeURIComponent(reportDate)}&report_mode=eq.${encodeURIComponent(reportMode)}`;
  const rows = await fetchJson(
    url,
    {
      headers: supabaseAdminHeaders({ Accept: 'application/json' })
    },
    '提醒发送记录'
  );
  if (!Array.isArray(rows) || rows.length === 0) return false;
  const hasFormalRecord = rows.some((row) => isFormalReportRecord(row, reportDate, reportMode, profile));
  if (!hasFormalRecord) {
    console.warn('发现早于正式提醒窗口的测试记录，已忽略，不占用当天正式提醒名额。');
  }
  return hasFormalRecord;
}

async function recordReportSent(reportDate, reportMode, reportData) {
  const supabaseUrl = process.env.SUPABASE_URL.replace(/\/$/, '');
  const response = await fetch(
    `${supabaseUrl}/rest/v1/fund_watch_reports?on_conflict=user_id,report_date,report_mode`,
    {
      method: 'POST',
      headers: supabaseAdminHeaders({
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      }),
      body: JSON.stringify({
        user_id: process.env.FUND_WATCH_USER_ID.trim(),
        report_date: reportDate,
        report_mode: reportMode,
        report_data: reportData,
        sent_at: new Date().toISOString()
      })
    }
  );
  if (!response.ok) throw new Error(`写入提醒发送记录失败 HTTP ${response.status}`);
}

function isReportDue(profile, mode, now) {
  if (FORCE_SEND) return true;
  if (mode === 'evening') return now.hour >= profile.eveningReportHour;
  const minutesUntilCutoff = 15 * 60 - (now.hour * 60 + now.minute);
  return minutesUntilCutoff >= 0 && minutesUntilCutoff <= profile.reminderLeadMinutes;
}

function mergeHoldings(payload) {
  const buckets = [payload?.holdings, ...Object.values(payload?.groupHoldings || {})];
  const totals = new Map();
  for (const bucket of buckets) {
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
    for (const [rawCode, holding] of Object.entries(bucket)) {
      const code = String(rawCode).trim();
      const share = finiteNumber(holding?.share);
      const cost = finiteNumber(holding?.cost);
      if (!code || share == null || share <= 0) continue;
      const current = totals.get(code) || { share: 0, totalCost: 0, hasCost: false };
      current.share += share;
      if (cost != null && cost >= 0) {
        current.totalCost += cost * share;
        current.hasCost = true;
      }
      totals.set(code, current);
    }
  }
  return Object.fromEntries(
    [...totals.entries()].map(([code, value]) => [
      code,
      {
        share: value.share,
        cost: value.hasCost && value.share > 0 ? value.totalCost / value.share : null
      }
    ])
  );
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function fetchLatestValuations(codes) {
  const results = [];
  for (const batch of chunks(codes, 40)) {
    const url =
      'https://fundcomapi.tiantianfunds.com/mm/newCore/FundValuationLast' +
      `?FCODES=${encodeURIComponent(batch.join(','))}&FIELDS=${encodeURIComponent(VALUATION_FIELDS)}`;
    const json = await fetchJson(url, { headers: { Accept: 'application/json' } }, '基金估值');
    if (!json?.success || !Array.isArray(json.data)) throw new Error('基金估值接口返回了无效数据');
    for (const item of json.data) {
      const code = String(item?.FCODE || '').trim();
      if (!code) continue;
      results.push({
        code,
        name: String(item?.SHORTNAME || '').trim(),
        gsz: finiteNumber(item?.GSZ),
        gszzl: finiteNumber(item?.GSZZL),
        dwjz: finiteNumber(item?.NAV),
        gztime: item?.GZTIME ? String(item.GZTIME) : null,
        jzrq: item?.PDATE ? String(item.PDATE) : null
      });
    }
  }
  return results;
}

function calculateTrend(points) {
  const valid = (Array.isArray(points) ? points : [])
    .map((item) => ({ x: finiteNumber(item?.x), y: finiteNumber(item?.y) }))
    .filter((item) => item.x != null && item.y != null && item.y > 0)
    .sort((a, b) => a.x - b.x);
  if (valid.length < 3) return {};

  const latest = valid[valid.length - 1].y;
  const returnFor = (count) => {
    if (valid.length <= count) return null;
    const start = valid[valid.length - 1 - count].y;
    return start > 0 ? ((latest - start) / start) * 100 : null;
  };
  const recent = valid.slice(-60);
  let peak = recent[0].y;
  let maxDrawdown60 = 0;
  for (const item of recent) {
    peak = Math.max(peak, item.y);
    maxDrawdown60 = Math.min(maxDrawdown60, ((item.y - peak) / peak) * 100);
  }

  let consecutiveDirection = null;
  let consecutiveDays = 0;
  for (let index = valid.length - 1; index > 0; index -= 1) {
    const direction = valid[index].y > valid[index - 1].y ? 'up' : valid[index].y < valid[index - 1].y ? 'down' : null;
    if (!direction) break;
    if (consecutiveDirection && consecutiveDirection !== direction) break;
    consecutiveDirection = direction;
    consecutiveDays += 1;
  }
  return {
    return20: returnFor(20),
    return60: returnFor(60),
    maxDrawdown60,
    consecutiveDirection,
    consecutiveDays
  };
}

async function fetchFundTrend(code) {
  const url = `https://fund.eastmoney.com/pingzhongdata/${encodeURIComponent(code)}.js`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return {};
    const script = await response.text();
    const match = script.match(/Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/);
    if (!match) return {};
    return calculateTrend(JSON.parse(match[1]));
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

async function mapWithConcurrency(values, limit, mapper) {
  const result = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      result[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return result;
}

function percent(value, digits = 1) {
  return value == null || !Number.isFinite(Number(value)) ? '暂无' : `${Number(value).toFixed(digits)}%`;
}

function money(value) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 0
  }).format(Number(value) || 0);
}

function isFreshValuation(fund, today) {
  return String(fund?.gztime || fund?.jzrq || '').startsWith(today);
}

function buildReport(analysis, mode, today, nowTime, freshCount, onlineInfo) {
  const reportName = mode === 'preclose' ? '交易窗口复核' : '晚间持仓日报';
  const confidence = freshCount === analysis.fundCount ? '较高' : freshCount > 0 ? '中等' : '较低';
  const rows = analysis.decisions.filter((item) => item.hasHolding).slice(0, mode === 'preclose' ? 5 : 8);
  const decisionRows = rows.map((item) => {
    const onlineImpact = onlineInfoImpactForFund(onlineInfo.items, item.code);
    return {
      ...item,
      baseAction: item.action,
      finalAction: onlineImpact?.action || item.action,
      onlineImpact
    };
  });
  const amountAdvice = buildFundInvestmentAmountAdvice({ analysis, decisions: decisionRows });
  const sourceStatusText =
    onlineInfo.sourceStatus === 'disabled'
      ? '已按个人设置关闭'
      : onlineInfo.sourceStatus === 'unavailable'
        ? '公开信息源暂不可用'
        : onlineInfo.sourceStatus === 'partial'
          ? '部分公开信息源读取失败'
          : '公开信息源读取正常';
  const optionalSourceText = onlineInfo.optionalFailedSourceCount > 0 ? '；扩展新闻源暂不可用' : '';
  const summaryLines = analysis.profile.includeAmountsInNotifications
    ? [
        `- 持仓市值：${money(analysis.marketValue)}，持仓收益率：${percent(analysis.profitPct)}`,
        `- 今日估算影响：${money(analysis.dayEstimate)}，风险警戒线：-${analysis.profile.riskLossLimit}%`,
        `- 可用计划资金：${money(analysis.availableBudget)}，需关注项目：${analysis.alertCount}项`
      ]
    : [
        `- 风险警戒线：-${analysis.profile.riskLossLimit}%，需关注项目：${analysis.alertCount}项`,
        '- 隐私保护：已隐藏持仓市值、个人收益、仓位、当日金额变化和可用资金'
      ];
  const lines = [
    `# 基金守望 · ${reportName}`,
    '',
    `- 分析时间：${today} ${nowTime}（北京时间）`,
    `- 数据新鲜度：${freshCount}/${analysis.fundCount}只为当日数据，结论置信度${confidence}`,
    ...summaryLines,
    `- 公开信息：检查${onlineInfo.checkedFundCount}只持仓，收集${onlineInfo.collectedCount}条，筛出${onlineInfo.usefulCount}条有用信息（${sourceStatusText}${optionalSourceText}）`,
    '',
    '## 按计划金额计算的投资建议',
    ''
  ];

  if (amountAdvice.status === 'unconfigured') {
    lines.push('尚未设置计划投资总额。请在基金守望 → 今日决策台 → 投资设置中填写后再计算建议金额。');
  } else if (!analysis.profile.includeAmountsInNotifications) {
    lines.push(`- 本次参考动作：${amountAdvice.status === 'buy' ? '存在分批买入候选' : '暂不加仓，继续观察'}`);
    lines.push('- 具体建议金额已按隐私设置隐藏；如需显示，请开启“微信通知显示金额及建议金额”。');
  } else {
    lines.push(`- 计划投资总额：${money(amountAdvice.totalInvestment)}`);
    lines.push(`- 保留现金：${money(amountAdvice.cashReserve)}`);
    lines.push(`- 当前持仓市值：${money(amountAdvice.marketValue)}`);
    lines.push(`- 可用计划资金：${money(amountAdvice.availableBudget)}`);
    lines.push(`- **本次建议投入上限：${money(amountAdvice.suggestedAmount)}**`);
    if (amountAdvice.items.length === 0) {
      lines.push(`- 处理建议：${amountAdvice.reason}`);
    } else {
      amountAdvice.items.forEach((item) => {
        lines.push(`- ${item.name}（${item.code}）：建议不超过 **${money(item.suggestedAmount)}**`);
      });
      lines.push(`- 计算说明：${amountAdvice.reason}`);
    }
  }
  lines.push('- 金额是本次操作上限，不是必须投入金额；不会自动买入，操作前仍需在支付宝核对。');
  lines.push('');
  lines.push('## 今日参考动作', '');

  if (rows.length === 0) {
    lines.push('尚未读到有效持仓。请先在基金守望中录入份额和成本，并完成一次云同步。');
  } else {
    decisionRows.forEach((item, index) => {
      const trend = `当日${percent(item.dayChange, 2)} / 20日${percent(item.return20)} / 60日${percent(item.return60)}`;
      lines.push(`### ${index + 1}. ${item.name}（${item.code}）`);
      lines.push(`- 参考动作：**${item.finalAction}**`);
      lines.push(`- 触发原因：${item.reasons.slice(0, 3).join('；')}`);
      if (item.onlineImpact) lines.push(`- 公开信息影响：${item.onlineImpact.reason}`);
      if (analysis.profile.includeAmountsInNotifications) {
        lines.push(`- 当前仓位：${percent(item.positionPct)}，持仓收益：${percent(item.profitPct)}，${trend}`);
      } else {
        lines.push(`- 隐私保护：已隐藏个人仓位和持仓收益；${trend}`);
      }
      lines.push(`- 时间提示：${item.tradeWindow}`);
      lines.push('');
    });
  }

  lines.push('## 今日有用公开信息');
  lines.push('');
  if (onlineInfo.sourceStatus === 'disabled') {
    lines.push('已按个人设置关闭公开信息分析，本报告只使用净值、趋势和仓位数据。');
    lines.push('');
  } else if (onlineInfo.sourceStatus === 'unavailable') {
    lines.push('本次公开信息源暂时不可用，不能据此判断“今天没有重要事件”；请以基金正式公告为准。');
    lines.push('');
  } else if (onlineInfo.items.length === 0) {
    lines.push('今天暂未筛出会改变持仓判断的重要公告或相关新闻；这不等于基金没有风险。');
    lines.push('');
  } else {
    onlineInfo.items.slice(0, 8).forEach((item, index) => {
      const levelName = { critical: '高风险', caution: '需关注', positive: '偏正面', info: '一般信息' }[item.level];
      lines.push(`### ${index + 1}. ${item.fundName} · ${levelName}`);
      lines.push(`- 信息：${item.title}`);
      lines.push(`- 筛选原因：${item.why}`);
      lines.push(`- 参考处理：${item.suggestion}`);
      lines.push(`- 来源：[${item.source}](${item.url}) · ${item.publishedAt}`);
      lines.push('');
    });
  }

  lines.push('## 使用边界');
  lines.push(
    '该结果是个人决策辅助，不预测确定涨跌、不自动交易。标题关键词可能误判，必须打开原文核实；公开估值、QDII时差、汇率和平台规则也可能造成偏差，最终以基金正式公告和支付宝页面为准。'
  );
  return {
    title: `基金守望：${reportName} · ${analysis.alertCount}项风险 / ${onlineInfo.usefulCount}条信息`,
    markdown: lines.join('\n'),
    data: {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      reportName,
      checkedFundCount: onlineInfo.checkedFundCount,
      collectedCount: onlineInfo.collectedCount,
      usefulCount: onlineInfo.usefulCount,
      sourceStatus: onlineInfo.sourceStatus,
      successfulSourceCount: onlineInfo.successfulSourceCount,
      failedSourceCount: onlineInfo.failedSourceCount,
      optionalSuccessfulSourceCount: onlineInfo.optionalSuccessfulSourceCount,
      optionalFailedSourceCount: onlineInfo.optionalFailedSourceCount,
      insights: onlineInfo.items,
      decisions: decisionRows.map((item) => ({
        code: item.code,
        name: item.name,
        baseAction: item.baseAction,
        finalAction: item.finalAction,
        onlineLevel: item.onlineImpact?.level || null,
        onlineReason: item.onlineImpact?.reason || null
      })),
      amountAdvice: analysis.profile.includeAmountsInNotifications
        ? amountAdvice
        : {
            status: amountAdvice.status,
            reason: amountAdvice.reason,
            items: amountAdvice.items.map((item) => ({ code: item.code, name: item.name, action: item.action }))
          }
    }
  };
}

async function sendServerChan(title, markdown) {
  const sendKey = process.env.SERVERCHAN_SENDKEY.trim();
  const response = await fetch(`https://sctapi.ftqq.com/${encodeURIComponent(sendKey)}.send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ title, desp: markdown })
  });
  if (!response.ok) throw new Error(`微信提醒 HTTP ${response.status}`);
  const result = await response.json();
  if (Number(result?.code) !== 0) throw new Error(`微信提醒失败：${result?.message || result?.code || '未知错误'}`);
}

async function main() {
  requireEnvironment();
  const payload = await loadUserPayload();
  const profile = normalizeFundWatchProfile(payload?.customSettings?.fundWatchProfile);
  if (REPORT_MODE === 'preclose' && !profile.enablePreCloseReminder) {
    console.log('已按个人设置跳过交易截止前提醒。');
    return;
  }
  if (REPORT_MODE === 'evening' && !profile.enableEveningReport) {
    console.log('已按个人设置跳过晚间日报。');
    return;
  }

  const now = dateParts();
  if (!isReportDue(profile, REPORT_MODE, now)) {
    console.log('尚未到个人设置的提醒时间，本轮检查结束。');
    return;
  }
  if (!FORCE_SEND && (await hasReportBeenSent(now.date, REPORT_MODE, profile))) {
    console.log('今天同类提醒已经发送，本轮不重复推送。');
    return;
  }

  const holdings = mergeHoldings(payload);
  const storedFunds = Array.isArray(payload?.funds) ? payload.funds : [];
  const codes = [
    ...new Set([...storedFunds.map((item) => String(item?.code || '').trim()), ...Object.keys(holdings)])
  ].filter(Boolean);
  if (codes.length === 0) throw new Error('同步数据中没有基金代码，请先添加或截图导入基金');

  let latestFunds = [];
  try {
    latestFunds = await fetchLatestValuations(codes);
  } catch (error) {
    console.warn(`最新估值读取失败，将使用同步缓存：${error.message}`);
  }
  const storedMap = new Map(storedFunds.map((fund) => [String(fund?.code || '').trim(), fund]));
  const latestMap = new Map(latestFunds.map((fund) => [fund.code, fund]));
  const funds = codes.map((code) => ({ ...(storedMap.get(code) || {}), ...(latestMap.get(code) || {}), code }));

  const heldCodes = Object.keys(holdings).slice(0, 30);
  const trendRows = await mapWithConcurrency(heldCodes, 5, async (code) => [code, await fetchFundTrend(code)]);
  const trends = Object.fromEntries(trendRows);
  const analysis = analyzeFundPortfolio({ funds, holdings, profile, trends });
  const freshCount = funds.filter((fund) => isFreshValuation(fund, now.date)).length;
  let onlineInfo = {
    checkedFundCount: heldCodes.length,
    collectedCount: 0,
    usefulCount: 0,
    sourceStatus: profile.enableOnlineInfoAnalysis ? 'unavailable' : 'disabled',
    successfulSourceCount: 0,
    failedSourceCount: 0,
    optionalSuccessfulSourceCount: 0,
    optionalFailedSourceCount: 0,
    items: []
  };
  if (profile.enableOnlineInfoAnalysis) {
    const heldFundSet = new Set(heldCodes);
    try {
      onlineInfo = await collectFundOnlineInfo(
        funds.filter((fund) => heldFundSet.has(fund.code)),
        now.date
      );
    } catch (error) {
      console.warn(`公开信息读取失败，本次继续使用净值和持仓分析：${error.message}`);
    }
  }

  if (REPORT_MODE === 'preclose' && freshCount === 0) {
    console.log('未检测到当日估值，按非交易日或数据未更新处理，跳过交易窗口提醒。');
    return;
  }
  const report = buildReport(analysis, REPORT_MODE, now.date, now.time, freshCount, onlineInfo);
  await sendServerChan(report.title, report.markdown);
  if (!FORCE_SEND) {
    await recordReportSent(now.date, REPORT_MODE, report.data);
  }
  console.log(
    `基金守望${REPORT_MODE === 'preclose' ? '交易窗口提醒' : '晚间日报'}已发送${
      FORCE_SEND ? '（手动测试不占用当天正式提醒）' : ''
    }；未在日志输出持仓明细。`
  );
}

main().catch((error) => {
  console.error(`每日分析失败：${error.message}`);
  process.exitCode = 1;
});
