'use client';

import { useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

const INITIAL_STATE = { report: null, loading: false, error: null };

export function useLatestFundWatchReport(userId) {
  const [state, setState] = useState(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;
    if (!isSupabaseConfigured || !userId) {
      setState(INITIAL_STATE);
      return () => {
        cancelled = true;
      };
    }

    setState((current) => ({ ...current, loading: true, error: null }));
    supabase
      .from('fund_watch_reports')
      .select('report_date, sent_at, report_data')
      .eq('user_id', userId)
      .eq('report_mode', 'evening')
      .order('report_date', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setState({ report: null, loading: false, error: error.message || '读取失败' });
          return;
        }
        setState({ report: data || null, loading: false, error: null });
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  return {
    ...state,
    configured: isSupabaseConfigured,
    signedIn: Boolean(userId)
  };
}
