import assert from 'node:assert/strict';
import { isFormalReportSentAt, parseGithubSchedule, resolveReportTiming } from '../app/lib/fundReportSchedule.mjs';

const profile = { eveningReportHour: 21, reminderLeadMinutes: 40 };

assert.deepEqual(parseGithubSchedule('17 13 * * *'), {
  mode: 'evening',
  localHour: 21,
  localMinute: 17
});
assert.equal(parseGithubSchedule('40 6 * * 1-5')?.mode, 'preclose');

const delayed = resolveReportTiming({
  forceSend: false,
  isScheduledTrigger: true,
  mode: 'evening',
  now: { date: '2026-08-28', hour: 4, minute: 28 },
  ...profile,
  scheduledTime: parseGithubSchedule('17 13 * * *')
});
assert.deepEqual(delayed, { due: true, reportDate: '2026-08-27', isCatchUp: true });

const earlyEveningCheck = resolveReportTiming({
  forceSend: false,
  isScheduledTrigger: true,
  mode: 'evening',
  now: { date: '2026-08-28', hour: 18, minute: 20 },
  ...profile,
  scheduledTime: parseGithubSchedule('17 10 * * *')
});
assert.equal(earlyEveningCheck.due, false);

assert.equal(
  isFormalReportSentAt({
    sentAt: '2026-08-27T14:20:00Z',
    reportDate: '2026-08-27',
    mode: 'evening',
    ...profile
  }),
  true
);
assert.equal(
  isFormalReportSentAt({
    sentAt: '2026-08-27T06:22:00Z',
    reportDate: '2026-08-27',
    mode: 'evening',
    ...profile
  }),
  false
);
assert.equal(
  isFormalReportSentAt({
    sentAt: '2026-08-27T20:28:00Z',
    reportDate: '2026-08-27',
    mode: 'evening',
    ...profile
  }),
  true
);

console.log('定时报告日期、补发和去重测试通过。');
