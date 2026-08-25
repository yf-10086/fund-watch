import assert from 'node:assert/strict';
import { extractFundNameCandidates, parseFundTextLocally } from '../app/lib/localFundOcrParser.mjs';

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
