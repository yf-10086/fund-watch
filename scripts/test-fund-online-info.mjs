import assert from 'node:assert/strict';

import { collectFundOnlineInfo, parseFundPortalNews } from '../app/lib/fundOnlineInfo.mjs';

const fund = { code: '010841', name: '华宝红利精选混合C' };
const portalHtml = `
  <div><h3>基金资讯</h3>
    <ul>
      <li><a href="http://fund.eastmoney.com/a/example.html">
        <span class="newsTit">价值风格占据上风！A股超4400股回落</span>
        <span class="newsData">08-24</span>
      </a></li>
    </ul>
  </div>
  <!-- 基金公告 start -->
`;

const parsed = parseFundPortalNews(portalHtml, fund, '2026-08-25');
assert.equal(parsed.length, 1, '基金专属资讯区块不应因标题未包含基金名称而被丢弃');
assert.equal(parsed[0].publishedAt, '2026-08-24');

const fetchImpl = async (url) => {
  const address = String(url);
  if (address.includes('/f10/JJGG')) {
    return new Response(JSON.stringify({ Data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (address.includes('fund.eastmoney.com/010841.html')) {
    return new Response(portalHtml, { status: 200, headers: { 'Content-Type': 'text/html' } });
  }
  if (address.includes('news.google.com')) throw new Error('模拟扩展新闻源超时');
  throw new Error(`未处理的测试网址：${address}`);
};

const result = await collectFundOnlineInfo([fund], '2026-08-25', { fetchImpl });
assert.equal(result.collectedCount, 1);
assert.equal(result.sourceStatus, 'ok', '两个主要国内来源正常时，不应因扩展来源超时显示主要来源失败');
assert.equal(result.failedSourceCount, 0);
assert.equal(result.optionalFailedSourceCount, 1);

console.log('fund online info tests passed');
