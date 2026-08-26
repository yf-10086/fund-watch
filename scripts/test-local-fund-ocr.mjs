import assert from 'node:assert/strict';
import {
  extractFundNameCandidates,
  parseFundTextLocally,
  parseFundTransactionTextLocally
} from '../app/lib/localFundOcrParser.mjs';

const withCode = parseFundTextLocally(`
永赢先进制造智选混合发起A
基金代码 018124
持有金额（元） 12,345.67
持有收益 -123.45
`);

assert.equal(withCode.length, 1);
assert.equal(withCode[0].fundCode, '018124');
assert.equal(withCode[0].fundName, '永赢先进制造智选混合发起A');
assert.equal(withCode[0].holdAmounts, '12345.67');
assert.equal(withCode[0].holdGains, '-123.45');

const nameOnly = parseFundTextLocally(`
基金详情
永赢先进制造智选混合发起A
持有金额
8888.88
累计收益
+66.66
`);

assert.equal(nameOnly[0].fundCode, '');
assert.equal(nameOnly[0].fundName, '永赢先进制造智选混合发起A');
assert.equal(nameOnly[0].holdAmounts, '8888.88');
assert.equal(nameOnly[0].holdGains, '66.66');

assert.deepEqual(extractFundNameCandidates('首页\n持有收益\n永赢先进制造智选混合发起A\n交易记录').slice(0, 1), [
  '永赢先进制造智选混合发起A'
]);

console.log('本地基金 OCR 解析测试通过。');

const transactionText = `
全部持有 收益明细 交易记录
买入 基金 | 国泰黄金ETF联接A 100.00元
2026-08-25 13:55:41 交易进行中
定投 基金 | 永赢先进制造智选混合
A 10.00元
2026-08-25 09:32:54 交易进行中
定投 基金 | 招商中证香港科技ETF联接(QDII)C 10.00元
2026-08-25 09:32:23 交易成功
`;

assert.deepEqual(parseFundTransactionTextLocally(transactionText), [
  {
    fundName: '国泰黄金ETF联接A',
    action: '买入',
    type: 'buy',
    isDca: false,
    amount: 100,
    date: '2026-08-25',
    time: '13:55:41',
    status: '交易进行中',
    pending: true,
    source: 'local-transaction'
  },
  {
    fundName: '永赢先进制造智选混合A',
    action: '定投',
    type: 'buy',
    isDca: true,
    amount: 10,
    date: '2026-08-25',
    time: '09:32:54',
    status: '交易进行中',
    pending: true,
    source: 'local-transaction'
  },
  {
    fundName: '招商中证香港科技ETF联接(QDII)C',
    action: '定投',
    type: 'buy',
    isDca: true,
    amount: 10,
    date: '2026-08-25',
    time: '09:32:23',
    status: '交易成功',
    pending: false,
    source: 'local-transaction'
  }
]);

console.log('交易记录 OCR 解析测试通过。');
