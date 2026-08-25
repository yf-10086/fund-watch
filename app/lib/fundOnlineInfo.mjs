const ANNOUNCEMENT_API = 'https://api.fund.eastmoney.com/f10/JJGG';
const ANNOUNCEMENT_PAGE = 'https://fundf10.eastmoney.com/jjgg_';
const GOOGLE_NEWS_RSS = 'https://news.google.com/rss/search';
const FUND_PORTAL_PAGE = 'https://fund.eastmoney.com/';

const CRITICAL_PATTERNS = [
  /清算/,
  /终止(?:基金合同|上市|运作)/,
  /暂停赎回/,
  /延期赎回/,
  /无法赎回/,
  /债券违约/,
  /重大诉讼/,
  /立案调查/
];
const CAUTION_PATTERNS = [
  /暂停申购/,
  /限制(?:大额)?申购/,
  /限购/,
  /基金经理.{0,4}(?:变更|离任|卸任)/,
  /估值调整/,
  /净值更正/,
  /风险提示/,
  /溢价风险/,
  /持有人大会/,
  /管理人变更/,
  /托管人变更/,
  /评级下调/,
  /规模.{0,8}(?:缩水|下降|低于)/,
  /份额.{0,8}(?:减少|下降)/,
  /净赎回/,
  /大额赎回/,
  /暴跌/,
  /处罚/,
  /退市/,
  /制裁/
];
const POSITIVE_PATTERNS = [
  /恢复申购/,
  /恢复赎回/,
  /放宽限购/,
  /评级上调/,
  /份额.{0,8}(?:增加|增长)/,
  /资金.{0,8}净流入/,
  /增持/,
  /回购/
];
const MARKET_PATTERNS = [/降息/, /加息/, /利率/, /汇率/, /关税/, /通胀/, /央行/, /美联储/, /债市/, /分红/];
const ROUTINE_PATTERNS = [/产品资料概要/, /招募说明书/, /年度报告/, /中期报告/, /季度报告/, /托管协议/, /基金合同/];
const IRRELEVANT_ANNOUNCEMENT_PATTERNS = [/网上交易平台系统维护/, /直销业务/, /客服.{0,4}维护/, /银行卡.{0,6}业务/];
const THEME_PATTERNS = [
  /沪深\s*\d+/i,
  /中证\s*\d+/i,
  /上证\s*\d+/i,
  /创业板/i,
  /科创\s*\d*/i,
  /恒生[\u4e00-\u9fa5A-Za-z0-9]*/i,
  /纳斯达克\s*\d*/i,
  /标普\s*\d+/i,
  /日经\s*\d+/i,
  /黄金|原油|红利|半导体|芯片|人工智能|新能源|医药|消费|军工|证券|银行|纯债|短债|同业存单/i
];

function cleanText(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function safeHttpUrl(value) {
  try {
    const url = new URL(cleanText(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function fieldFromXml(xml, tag) {
  const match = String(xml || '').match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return cleanText(match?.[1]);
}

function normalizeFundName(value) {
  return cleanText(value)
    .replace(/[（(]?[A-Z](?:类)?[）)]?$/i, '')
    .replace(/(?:型)?证券投资基金/g, '')
    .replace(/发起式/g, '')
    .replace(/ETF联接/g, 'ETF')
    .replace(/\s+/g, '')
    .trim();
}

function fundThemes(name) {
  const normalized = normalizeFundName(name);
  return [
    ...new Set(THEME_PATTERNS.map((pattern) => normalized.match(pattern)?.[0]?.replace(/\s+/g, '')).filter(Boolean))
  ];
}

function isRelevantTitle(title, fund) {
  const compactTitle = cleanText(title).replace(/\s+/g, '');
  const code = String(fund?.code || '').trim();
  const name = normalizeFundName(fund?.name);
  if (code && compactTitle.includes(code)) return true;
  if (name.length >= 5 && compactTitle.includes(name)) return true;
  return fundThemes(name).some((theme) => theme.length >= 3 && compactTitle.includes(theme));
}

function firstMatch(title, patterns) {
  return patterns.find((pattern) => pattern.test(title));
}

export function classifyFundOnlineItem(item) {
  const title = cleanText(item?.title);
  const isAnnouncement = item?.sourceType === 'announcement';

  if (!title || (isAnnouncement && firstMatch(title, IRRELEVANT_ANNOUNCEMENT_PATTERNS))) {
    return { useful: false, level: 'ignored', why: '与支付宝持仓决策关系较弱', suggestion: '忽略' };
  }

  if (firstMatch(title, CRITICAL_PATTERNS)) {
    return {
      useful: true,
      level: 'critical',
      why: '识别到清算、赎回或重大合规风险信号',
      suggestion: '暂停加仓，优先打开基金公告核实；如属实再评估分批减仓'
    };
  }
  if (firstMatch(title, CAUTION_PATTERNS)) {
    return {
      useful: true,
      level: 'caution',
      why: '识别到限购、人员变动、规模或风险提示信号',
      suggestion: '列入重点观察；同时触发亏损或仓位警戒时再复核减仓'
    };
  }
  if (firstMatch(title, POSITIVE_PATTERNS)) {
    return {
      useful: true,
      level: 'positive',
      why: '识别到恢复申赎、资金流入或其他偏正面信号',
      suggestion: '不追涨；只有仓位和估值条件同时满足时才考虑分批买入'
    };
  }
  if (firstMatch(title, MARKET_PATTERNS)) {
    return {
      useful: true,
      level: 'info',
      why: '识别到可能影响该类基金的市场或政策事件',
      suggestion: '暂不改变原建议，继续观察净值、汇率和后续公告'
    };
  }
  if (isAnnouncement && !firstMatch(title, ROUTINE_PATTERNS)) {
    return {
      useful: true,
      level: 'info',
      why: '持仓基金发布了新的非例行公告',
      suggestion: '阅读原公告后再决定是否调整，单条公告不直接构成买卖依据'
    };
  }
  return { useful: false, level: 'routine', why: '例行披露或未识别到决策信号', suggestion: '无需单独操作' };
}

export function analyzeFundOnlineItems(items) {
  const deduped = new Map();
  for (const raw of Array.isArray(items) ? items : []) {
    const title = cleanText(raw?.title);
    const code = String(raw?.fundCode || '').trim();
    if (!title || !code) continue;
    const key = `${code}:${title.replace(/\s+/g, '').toLowerCase()}`;
    if (deduped.has(key)) continue;
    const classification = classifyFundOnlineItem(raw);
    deduped.set(key, { ...raw, title, ...classification });
  }
  const all = [...deduped.values()];
  const rank = { critical: 4, caution: 3, positive: 2, info: 1, routine: 0, ignored: -1 };
  const useful = all
    .filter((item) => item.useful)
    .sort(
      (a, b) =>
        (rank[b.level] || 0) - (rank[a.level] || 0) || String(b.publishedAt).localeCompare(String(a.publishedAt))
    );
  return { all, useful };
}

async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function recentDate(value, referenceDate, lookbackDays) {
  const itemDate = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(itemDate) || !/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) return false;
  const difference = (Date.parse(`${referenceDate}T00:00:00Z`) - Date.parse(`${itemDate}T00:00:00Z`)) / 86400000;
  return difference >= 0 && difference <= lookbackDays;
}

export async function fetchFundAnnouncements(fund, referenceDate, { fetchImpl = fetch, lookbackDays = 1 } = {}) {
  const code = String(fund?.code || '').trim();
  if (!/^\d{6}$/.test(code)) return [];
  const query = new URLSearchParams({ fundcode: code, pageIndex: '1', pageSize: '20', type: '0' });
  const response = await fetchWithTimeout(
    fetchImpl,
    `${ANNOUNCEMENT_API}?${query}`,
    { headers: { Accept: 'application/json', Referer: 'https://fundf10.eastmoney.com/' } },
    7000
  );
  if (!response.ok) throw new Error(`基金公告 HTTP ${response.status}`);
  const payload = await response.json();
  return (Array.isArray(payload?.Data) ? payload.Data : [])
    .filter((item) => recentDate(item?.PUBLISHDATE, referenceDate, lookbackDays))
    .map((item) => ({
      fundCode: code,
      fundName: cleanText(fund?.name || item?.ShortTitle),
      title: cleanText(item?.TITLE),
      publishedAt: String(item?.PUBLISHDATE || '').slice(0, 10),
      source: '基金公开公告',
      sourceType: 'announcement',
      url: `${ANNOUNCEMENT_PAGE}${encodeURIComponent(code)}.html`
    }));
}

export function parseGoogleNewsRss(xml, fund) {
  const items = [...String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/gi)];
  return items
    .map((match) => {
      const itemXml = match[1];
      return {
        fundCode: String(fund?.code || '').trim(),
        fundName: cleanText(fund?.name),
        title: fieldFromXml(itemXml, 'title'),
        publishedAt: fieldFromXml(itemXml, 'pubDate'),
        source: fieldFromXml(itemXml, 'source') || '公开新闻',
        sourceType: 'news',
        url: safeHttpUrl(fieldFromXml(itemXml, 'link'))
      };
    })
    .filter((item) => item.url && isRelevantTitle(item.title, fund));
}

export async function fetchFundNews(fund, { fetchImpl = fetch } = {}) {
  const code = String(fund?.code || '').trim();
  const searchName = normalizeFundName(fund?.name);
  if (!searchName && !code) return [];
  const directTerms = [...new Set([searchName, ...fundThemes(searchName)].filter(Boolean))];
  const directQuery = directTerms.map((term) => `\"${term}\"`).join(' OR ');
  const queryText = `(${directQuery}${directQuery && code ? ' OR ' : ''}${code ? `(\"${code}\" 基金)` : ''}) when:1d`;
  const query = new URLSearchParams({ q: queryText, hl: 'zh-CN', gl: 'CN', ceid: 'CN:zh-Hans' });
  const response = await fetchWithTimeout(fetchImpl, `${GOOGLE_NEWS_RSS}?${query}`, {}, 12000);
  if (!response.ok) throw new Error(`公开新闻 HTTP ${response.status}`);
  return parseGoogleNewsRss(await response.text(), fund);
}

function monthDayToDate(value, referenceDate) {
  const match = String(value || '').match(/^(\d{2})-(\d{2})$/);
  if (!match || !/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) return '';
  let year = Number(referenceDate.slice(0, 4));
  const monthDay = `${match[1]}-${match[2]}`;
  if (monthDay > referenceDate.slice(5)) year -= 1;
  return `${year}-${monthDay}`;
}

export function parseFundPortalNews(html, fund, referenceDate) {
  const source = String(html || '');
  const start = source.indexOf('基金资讯');
  const end = source.indexOf('基金公告 start', start);
  if (start < 0) return [];
  const block = source.slice(start, end > start ? end : start + 12000);
  return (
    [
      ...block.matchAll(
        /<li><a\s+href=["']([^"']+)["'][^>]*>[\s\S]*?<span\s+class=["']newsTit["']>([\s\S]*?)<\/span>[\s\S]*?<span\s+class=["']newsData["']>([\s\S]*?)<\/span>[\s\S]*?<\/a>\s*<\/li>/gi
      )
    ]
      .map((match) => ({
        fundCode: String(fund?.code || '').trim(),
        fundName: cleanText(fund?.name),
        title: cleanText(match[2]),
        publishedAt: monthDayToDate(cleanText(match[3]), referenceDate),
        source: '天天基金资讯',
        sourceType: 'news',
        url: safeHttpUrl(String(match[1]).replace(/^http:/i, 'https:'))
      }))
      // “基金资讯”区块已经由天天基金按当前基金筛选。部分市场类标题不会重复
      // 基金名称或代码，继续套用全网搜索的严格相关性规则会把有效条目全部丢掉。
      .filter((item) => recentDate(item.publishedAt, referenceDate, 1))
  );
}

export async function fetchFundPortalNews(fund, referenceDate, { fetchImpl = fetch } = {}) {
  const code = String(fund?.code || '').trim();
  if (!/^\d{6}$/.test(code)) return [];
  const response = await fetchWithTimeout(
    fetchImpl,
    `${FUND_PORTAL_PAGE}${encodeURIComponent(code)}.html`,
    { headers: { Accept: 'text/html', Referer: FUND_PORTAL_PAGE } },
    7000
  );
  if (!response.ok) throw new Error(`基金资讯 HTTP ${response.status}`);
  return parseFundPortalNews(await response.text(), fund, referenceDate);
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

export async function collectFundOnlineInfo(funds, referenceDate, { fetchImpl = fetch } = {}) {
  const heldFunds = (Array.isArray(funds) ? funds : []).filter((fund) => fund?.code).slice(0, 30);
  const rows = await mapWithConcurrency(heldFunds, 5, async (fund) => {
    const [announcements, portalNews, publicNews] = await Promise.allSettled([
      fetchFundAnnouncements(fund, referenceDate, { fetchImpl }),
      fetchFundPortalNews(fund, referenceDate, { fetchImpl }),
      fetchFundNews(fund, { fetchImpl })
    ]);
    const primarySources = [announcements, portalNews];
    const optionalSources = [publicNews];
    return {
      items: [...primarySources, ...optionalSources].flatMap((source) =>
        source.status === 'fulfilled' ? source.value : []
      ),
      successfulSourceCount: primarySources.filter((source) => source.status === 'fulfilled').length,
      failedSourceCount: primarySources.filter((source) => source.status === 'rejected').length,
      optionalSuccessfulSourceCount: optionalSources.filter((source) => source.status === 'fulfilled').length,
      optionalFailedSourceCount: optionalSources.filter((source) => source.status === 'rejected').length
    };
  });
  const successfulSourceCount = rows.reduce((total, row) => total + row.successfulSourceCount, 0);
  const failedSourceCount = rows.reduce((total, row) => total + row.failedSourceCount, 0);
  const optionalSuccessfulSourceCount = rows.reduce((total, row) => total + row.optionalSuccessfulSourceCount, 0);
  const optionalFailedSourceCount = rows.reduce((total, row) => total + row.optionalFailedSourceCount, 0);
  const analyzed = analyzeFundOnlineItems(rows.flatMap((row) => row.items));
  return {
    checkedFundCount: heldFunds.length,
    collectedCount: analyzed.all.length,
    usefulCount: analyzed.useful.length,
    sourceStatus: successfulSourceCount === 0 ? 'unavailable' : failedSourceCount > 0 ? 'partial' : 'ok',
    successfulSourceCount,
    failedSourceCount,
    optionalSuccessfulSourceCount,
    optionalFailedSourceCount,
    items: analyzed.useful.slice(0, 20)
  };
}

export function onlineInfoImpactForFund(items, fundCode) {
  const related = (Array.isArray(items) ? items : []).filter((item) => String(item?.fundCode) === String(fundCode));
  if (related.some((item) => item.level === 'critical')) {
    return {
      level: 'critical',
      action: '暂停加仓并复核公告',
      reason: related.find((item) => item.level === 'critical')?.why
    };
  }
  if (related.some((item) => item.level === 'caution')) {
    return { level: 'caution', action: '重点观察', reason: related.find((item) => item.level === 'caution')?.why };
  }
  if (related.some((item) => item.level === 'positive')) {
    return { level: 'positive', action: null, reason: '有偏正面信息，但不单独构成买入依据' };
  }
  if (related.length > 0) return { level: 'info', action: null, reason: related[0].why };
  return null;
}
