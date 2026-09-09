import assert from 'node:assert/strict';
import { analyzeFundPortfolio, buildFundInvestmentAmountAdvice } from '../app/lib/fundDecisionEngine.mjs';

const baseAnalysis = {
  profile: {
    riskMode: 'conservative',
    totalInvestment: 10000,
    minCashReserve: 1000,
    horizonMonths: 9,
    singleFundCap: 20,
    qdiiCap: 10
  },
  marketValue: 7000,
  availableBudget: 2000
};

const buyAdvice = buildFundInvestmentAmountAdvice({
  analysis: baseAnalysis,
  decisions: [
    {
      code: '000001',
      name: '测试指数基金',
      category: 'index',
      hasHolding: true,
      marketValue: 1000,
      positionCap: 20,
      action: '观察分批买入',
      reasons: ['仓位和趋势满足分批条件']
    }
  ]
});

assert.equal(buyAdvice.status, 'buy');
assert.equal(buyAdvice.availableBudget, 2000);
assert.equal(buyAdvice.suggestedAmount, 500);
assert.equal(buyAdvice.items[0].suggestedAmount, 500);

const waitAdvice = buildFundInvestmentAmountAdvice({
  analysis: baseAnalysis,
  decisions: [{ code: '000002', name: '测试基金', hasHolding: true, action: '继续持有' }]
});
assert.equal(waitAdvice.status, 'wait');
assert.equal(waitAdvice.suggestedAmount, 0);

const noBudgetAdvice = buildFundInvestmentAmountAdvice({
  analysis: { ...baseAnalysis, marketValue: 9000, availableBudget: 0 },
  decisions: []
});
assert.equal(noBudgetAdvice.status, 'no-budget');
assert.equal(noBudgetAdvice.suggestedAmount, 0);

const unconfiguredAdvice = buildFundInvestmentAmountAdvice({
  analysis: { profile: { totalInvestment: 0 }, marketValue: 0, availableBudget: 0 },
  decisions: []
});
assert.equal(unconfiguredAdvice.status, 'unconfigured');

const blankEstimateAnalysis = analyzeFundPortfolio({
  funds: [{ code: '000003', name: '空估值回退测试基金', gsz: '', dwjz: 1.1, gszzl: '' }],
  holdings: { '000003': { share: 100, cost: 1 } },
  profile: {
    riskMode: 'custom',
    riskLossLimit: 50,
    totalInvestment: 10000,
    minCashReserve: 0,
    singleFundCap: 100,
    qdiiCap: 100
  }
});
const blankEstimateDecision = blankEstimateAnalysis.decisions[0];
assert.equal(blankEstimateDecision.nav, 1.1);
assert.ok(Math.abs(blankEstimateDecision.marketValue - 110) < 1e-9);
assert.ok(Math.abs(blankEstimateDecision.profitPct - 10) < 1e-9);
assert.notEqual(blankEstimateDecision.action, '触发风险警戒');

console.log('按计划金额生成投资建议测试通过。');
