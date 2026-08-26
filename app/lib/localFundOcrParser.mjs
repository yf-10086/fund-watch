const FUND_PRODUCT_KEYWORDS = [
  '混合',
  '债券',
  '指数',
  '股票',
  '货币',
  '联接',
  '增强',
  '发起',
  '精选',
  '优选',
  '成长',
  '价值',
  '行业',
  '主题',
  '红利',
  '量化',
  '养老',
  'FOF',
  'QDII',
  'ETF',
  'LOF'
];

const UI_NOISE_WORDS = [
  '持有金额',
  '持有收益',
  '累计收益',
  '昨日收益',
  '收益率',
  '基金详情',
  '交易记录',
  '买入',
  '卖出',
  '定投',
  '自选',
  '全部',
  '资产',
  '首页',
  '理财',
  '市场',
  '消息',
  '我的'
];

const AMOUNT_LABELS = ['持有金额', '持有市值', '当前市值', '参考市值'];
const GAIN_LABELS = ['持有收益', '累计收益', '总收益'];

const normalizeLine = (value) =>
  String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[−–—]/g, '-')
    .replace(/[，]/g, ',')
    .replace(/[。]/g, '.')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeFundName = (value) =>
  normalizeLine(value)
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[·•]/g, '')
    .replace(/[^\u4e00-\u9fa5A-Z0-9()]/g, '');

export const normalizeFundNameForMatch = normalizeFundName;

const normalizeTransactionDate = (value) => {
  const match = String(value || '').match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!match) return '';
  return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
};

const cleanTransactionFundName = (value) =>
  normalizeLine(value)
    .replace(/^(?:买入|定投|卖出|赎回)\s*/i, '')
    .replace(/^基金\s*[|｜丨:]?\s*/i, '')
    .replace(/\s*[￥¥]?\s*\d[\d,.]*\s*元.*$/i, '')
    .replace(/\s*20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}.*$/i, '')
    .replace(/\s*(?:交易进行中|处理中|待确认|交易成功|买入成功|定投成功|已确认).*$/i, '')
    .replace(/[|｜丨]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([A-C])$/i, '$1')
    .trim();

const parseTransactionBlock = (block) => {
  const joined = block.map(normalizeLine).filter(Boolean).join(' ');
  const actionMatch = joined.match(/(?:^|\s)(买入|定投|卖出|赎回)(?=\s|基金|[\u4e00-\u9fa5])/);
  if (!actionMatch) return null;

  const dateTimeMatch = joined.match(/(20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2})(?:日)?\s+(\d{1,2}:\d{2}(?::\d{2})?)/);
  const amountMatches = [...joined.matchAll(/([0-9Oo][0-9Oo,]*(?:\.[0-9Oo]{1,2})?)\s*元/g)];
  const amountToken = amountMatches.at(-1)?.[1] || '';
  const amount = Number(amountToken.replace(/[Oo]/g, '0').replace(/,/g, ''));

  const actionIndex = actionMatch.index + actionMatch[0].lastIndexOf(actionMatch[1]);
  let nameEnd = joined.length;
  const boundaries = [
    amountMatches[0]?.index,
    dateTimeMatch?.index,
    joined.search(/交易进行中|处理中|待确认|交易成功|买入成功|定投成功|已确认/)
  ].filter((index) => Number.isFinite(index) && index >= actionIndex);
  if (boundaries.length > 0) nameEnd = Math.min(...boundaries);
  const fundName = cleanTransactionFundName(joined.slice(actionIndex, nameEnd));

  if (!fundName || !Number.isFinite(amount) || amount <= 0 || !dateTimeMatch) return null;

  const rawStatus = (joined.match(/交易进行中|处理中|待确认|交易成功|买入成功|定投成功|已确认/) || [])[0] || '';
  const action = actionMatch[1];
  return {
    fundName,
    action,
    type: action === '卖出' || action === '赎回' ? 'sell' : 'buy',
    isDca: action === '定投',
    amount,
    date: normalizeTransactionDate(dateTimeMatch[1]),
    time: dateTimeMatch[2].length === 5 ? `${dateTimeMatch[2]}:00` : dateTimeMatch[2],
    status: rawStatus || '待确认',
    pending: !/成功|已确认/.test(rawStatus),
    source: 'local-transaction'
  };
};

/**
 * 解析支付宝“交易记录”截图 OCR 文本。
 * 仅接受同时包含交易动作、金额和完整日期时间的记录，避免把持仓页金额误当成买入。
 */
export const parseFundTransactionTextLocally = (text) => {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean);
  if (lines.length === 0) return [];

  const blocks = [];
  let current = null;
  for (const line of lines) {
    const isStart = /(?:^|\s)(?:买入|定投|卖出|赎回)(?=\s|基金|[\u4e00-\u9fa5])/.test(line);
    if (isStart) {
      if (current?.length) blocks.push(current);
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current?.length) blocks.push(current);

  return blocks.map(parseTransactionBlock).filter(Boolean);
};

const parseMoneyToken = (value) => {
  const normalized = String(value || '')
    .replace(/[￥¥元人民币]/g, '')
    .replace(/[，,\s]/g, '')
    .replace(/[Oo]/g, '0')
    .trim();
  const match = normalized.match(/[+\-]?\d+(?:\.\d{1,4})?/);
  if (!match) return '';
  const num = Number(match[0]);
  if (!Number.isFinite(num)) return '';
  return String(num);
};

const extractMoneyAfterLabels = (lines, labels) => {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const label = labels.find((item) => line.includes(item));
    if (!label) continue;

    const sameLine = line.slice(line.indexOf(label) + label.length);
    if (!sameLine.includes('%')) {
      const value = parseMoneyToken(sameLine);
      if (value !== '') return value;
    }

    for (let offset = 1; offset <= 2; offset += 1) {
      const nextLine = lines[index + offset] || '';
      if (!nextLine || nextLine.includes('%')) continue;
      const value = parseMoneyToken(nextLine);
      if (value !== '') return value;
    }
  }
  return '';
};

const cleanFundNameCandidate = (value) =>
  normalizeLine(value)
    .replace(/(?:基金代码|产品代码|代码)\s*[:：]?\s*\d{0,6}/gi, '')
    .replace(/\b\d{6}\b/g, '')
    .replace(/[￥¥]\s*[+\-]?\d[\d,.]*/g, '')
    .replace(/[+\-]?\d[\d,.]*\s*%/g, '')
    .replace(/[+\-]?\d[\d,.]*/g, '')
    .replace(/[^\u4e00-\u9fa5A-Za-z()（）·•\-]/g, '')
    .replace(/^[\-·•]+|[\-·•]+$/g, '')
    .trim();

const scoreFundNameCandidate = (candidate) => {
  const normalized = normalizeFundName(candidate);
  const chineseLength = (normalized.match(/[\u4e00-\u9fa5]/g) || []).length;
  if (chineseLength < 4 || normalized.length < 5 || normalized.length > 42) return -1;
  if (UI_NOISE_WORDS.some((word) => normalized === normalizeFundName(word))) return -1;

  const keywordHits = FUND_PRODUCT_KEYWORDS.filter((word) => normalized.includes(word)).length;
  if (keywordHits === 0) return -1;

  let score = keywordHits * 4 + Math.min(chineseLength, 20) / 10;
  if (/[A-C]$/i.test(normalized)) score += 2;
  if (/基金/.test(normalized)) score += 1;
  if (UI_NOISE_WORDS.some((word) => normalized.includes(normalizeFundName(word)))) score -= 2;
  return score;
};

export const extractFundNameCandidates = (text, limit = 6) => {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean);
  const candidates = [];

  lines.forEach((line, index) => {
    candidates.push(cleanFundNameCandidate(line));
    const nextLine = lines[index + 1];
    if (nextLine) {
      const first = cleanFundNameCandidate(line);
      const second = cleanFundNameCandidate(nextLine);
      if (first && second && first.length + second.length <= 42) candidates.push(`${first}${second}`);
    }
  });

  const unique = new Map();
  candidates.forEach((candidate) => {
    const normalized = normalizeFundName(candidate);
    const score = scoreFundNameCandidate(candidate);
    if (!normalized || score < 0) return;
    const previous = unique.get(normalized);
    if (!previous || score > previous.score) unique.set(normalized, { value: candidate, score });
  });

  return [...unique.values()]
    .sort((a, b) => b.score - a.score || b.value.length - a.value.length)
    .slice(0, Math.max(1, limit))
    .map((item) => item.value);
};

export const parseFundTextLocally = (text) => {
  const rawText = String(text || '');
  if (!rawText.trim()) return [];

  const lines = rawText.split(/\r?\n/).map(normalizeLine).filter(Boolean);
  const codes = [...new Set(rawText.match(/(?<!\d)\d{6}(?!\d)/g) || [])];
  const names = extractFundNameCandidates(rawText);
  const holdAmounts = extractMoneyAfterLabels(lines, AMOUNT_LABELS);
  const holdGains = extractMoneyAfterLabels(lines, GAIN_LABELS);

  if (codes.length > 0) {
    return codes.map((fundCode, index) => ({
      fundCode,
      fundName: names[index] || (codes.length === 1 ? names[0] || '' : ''),
      holdAmounts: codes.length === 1 ? holdAmounts : '',
      holdGains: codes.length === 1 ? holdGains : '',
      source: 'local'
    }));
  }

  return names.map((fundName, index) => ({
    fundCode: '',
    fundName,
    holdAmounts: index === 0 ? holdAmounts : '',
    holdGains: index === 0 ? holdGains : '',
    source: 'local'
  }));
};

export const mergeFundOcrResults = (...resultGroups) => {
  const merged = new Map();

  resultGroups.flat().forEach((item) => {
    if (!item) return;
    const fundCode = String(item.fundCode || '').trim();
    const fundName = String(item.fundName || '').trim();
    if (!fundCode && !fundName) return;
    const key = fundCode ? `code:${fundCode}` : `name:${normalizeFundName(fundName)}`;
    const previous = merged.get(key) || {};
    merged.set(key, {
      fundCode: fundCode || previous.fundCode || '',
      fundName: fundName || previous.fundName || '',
      holdAmounts: item.holdAmounts !== '' && item.holdAmounts != null ? item.holdAmounts : previous.holdAmounts || '',
      holdGains: item.holdGains !== '' && item.holdGains != null ? item.holdGains : previous.holdGains || '',
      source: previous.source === 'cloud' || item.source === 'cloud' ? 'cloud' : 'local'
    });
  });

  return [...merged.values()];
};
