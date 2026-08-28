const SHANGHAI_OFFSET = '+08:00';

export function shiftCalendarDate(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(value.getTime())) return date;
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function parseGithubSchedule(expression) {
  const parts = String(expression || '')
    .trim()
    .split(/\s+/);
  if (parts.length !== 5) return null;
  const [minuteField, hourField] = parts;
  const hourStart = Number(hourField.match(/^\d+/)?.[0]);
  if (!Number.isFinite(hourStart)) return null;

  const mode = hourStart >= 10 ? 'evening' : 'preclose';
  const exactMinute = /^\d+$/.test(minuteField) ? Number(minuteField) : null;
  const exactUtcHour = /^\d+$/.test(hourField) ? Number(hourField) : null;
  return {
    mode,
    localHour: exactUtcHour == null ? null : (exactUtcHour + 8) % 24,
    localMinute: exactMinute
  };
}

export function resolveReportTiming({
  forceSend,
  isScheduledTrigger,
  mode,
  now,
  eveningReportHour,
  reminderLeadMinutes,
  scheduledTime
}) {
  if (forceSend) return { due: true, reportDate: now.date, isCatchUp: false };

  if (mode === 'preclose') {
    const minutesUntilCutoff = 15 * 60 - (now.hour * 60 + now.minute);
    return {
      due: minutesUntilCutoff >= 0 && minutesUntilCutoff <= reminderLeadMinutes,
      reportDate: now.date,
      isCatchUp: false
    };
  }

  if (isScheduledTrigger && scheduledTime?.localHour != null) {
    const scheduledMinutes = scheduledTime.localHour * 60 + (scheduledTime.localMinute || 0);
    const nowMinutes = now.hour * 60 + now.minute;
    const reportDate = nowMinutes < scheduledMinutes ? shiftCalendarDate(now.date, -1) : now.date;
    return {
      due: scheduledTime.localHour >= eveningReportHour,
      reportDate,
      isCatchUp: reportDate !== now.date
    };
  }

  // 兼容工作流更新前已经进入 GitHub 延迟队列的旧 cron：凌晨/白天才到达时补发前一日晚报。
  if (isScheduledTrigger && now.hour < 18) {
    return { due: true, reportDate: shiftCalendarDate(now.date, -1), isCatchUp: true };
  }

  return { due: now.hour >= eveningReportHour, reportDate: now.date, isCatchUp: false };
}

export function isFormalReportSentAt({ sentAt, reportDate, mode, eveningReportHour, reminderLeadMinutes }) {
  const sentTime = new Date(sentAt).getTime();
  if (!Number.isFinite(sentTime)) return true;

  if (mode === 'evening') {
    const formalStart = new Date(
      `${reportDate}T${String(eveningReportHour).padStart(2, '0')}:00:00${SHANGHAI_OFFSET}`
    ).getTime();
    return sentTime >= formalStart && sentTime < formalStart + 24 * 60 * 60 * 1000;
  }

  const cutoff = new Date(`${reportDate}T15:00:00${SHANGHAI_OFFSET}`).getTime();
  const formalStart = cutoff - reminderLeadMinutes * 60 * 1000;
  return sentTime >= formalStart && sentTime <= cutoff;
}
