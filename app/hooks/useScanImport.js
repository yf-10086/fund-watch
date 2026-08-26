import { isArray, isFunction } from 'lodash';
import { useState, useRef } from 'react';
import { toast as sonnerToast } from 'sonner';
import { parseFundTextWithLLM, fetchFundData, searchFunds, fetchFundsBestSources } from '../api/fund';
import { recordValuation } from '../lib/valuationTimeseries';
import {
  mergeFundOcrResults,
  normalizeFundNameForMatch,
  parseFundTextLocally,
  parseFundTransactionTextLocally
} from '../lib/localFundOcrParser.mjs';
import { useFundFuzzyMatcher } from './useFundFuzzyMatcher';
import { useStorageStore, useUserStore, useModalStore } from '../stores';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

/**
 * OCR 扫描导入基金的完整流程
 *
 * @param {{
 *   setCurrentTab: Function,
 *   setValuationSeries: Function,
 *   showToast: Function,
 *   setFundTagRecords: Function
 * }} deps
 */
export function useScanImport({
  setCurrentTab,
  setValuationSeries,
  showToast,
  normalizeCode,
  dedupeByCode,
  setFundTagRecords,
  processPendingQueue
}) {
  const setSuccessModal = (state) => useModalStore.setState({ successModal: state });
  const user = useUserStore((s) => s.user);
  const funds = useStorageStore((s) => s.funds);
  const favorites = useStorageStore((s) => s.favorites);
  const groups = useStorageStore((s) => s.groups);

  const setFunds = useStorageStore((s) => s.setFunds);
  const setHoldings = useStorageStore((s) => s.setHoldings);
  const setFavorites = useStorageStore((s) => s.setFavorites);
  const setGroups = useStorageStore((s) => s.setGroups);
  const setGroupHoldings = useStorageStore((s) => s.setGroupHoldings);
  const setPendingTrades = useStorageStore((s) => s.setPendingTrades);
  const setCollapsedCodes = useStorageStore((s) => s.setCollapsedCodes);
  const setCollapsedTrends = useStorageStore((s) => s.setCollapsedTrends);

  const scanModalOpen = useModalStore((s) => s.scanModalOpen);
  const scanConfirmModalOpen = useModalStore((s) => s.scanConfirmModalOpen);
  const isScanning = useModalStore((s) => s.isScanning);
  const isScanImporting = useModalStore((s) => s.isScanImporting);
  const setScanModalOpen = (v) =>
    useModalStore.setState({ scanModalOpen: isFunction(v) ? v(useModalStore.getState().scanModalOpen) : v });
  const setScanConfirmModalOpen = (v) =>
    useModalStore.setState({
      scanConfirmModalOpen: isFunction(v) ? v(useModalStore.getState().scanConfirmModalOpen) : v
    });
  const setIsScanning = (v) =>
    useModalStore.setState({ isScanning: isFunction(v) ? v(useModalStore.getState().isScanning) : v });
  const setIsScanImporting = (v) =>
    useModalStore.setState({
      isScanImporting: isFunction(v) ? v(useModalStore.getState().isScanImporting) : v
    });
  const scannedFunds = useModalStore((s) => s.scannedFunds);
  const selectedScannedCodes = useModalStore((s) => s.selectedScannedCodes);
  const scanImportProgress = useModalStore((s) => s.scanImportProgress);
  const scanProgress = useModalStore((s) => s.scanProgress);
  const isOcrScan = useModalStore((s) => s.isOcrScan);

  const setScannedFunds = (v) =>
    useModalStore.setState({ scannedFunds: isFunction(v) ? v(useModalStore.getState().scannedFunds) : v });
  const setSelectedScannedCodes = (v) =>
    useModalStore.setState({
      selectedScannedCodes: isFunction(v) ? v(useModalStore.getState().selectedScannedCodes) : v
    });
  const setScanImportProgress = (v) =>
    useModalStore.setState({
      scanImportProgress: isFunction(v) ? v(useModalStore.getState().scanImportProgress) : v
    });
  const setScanProgress = (v) =>
    useModalStore.setState({ scanProgress: isFunction(v) ? v(useModalStore.getState().scanProgress) : v });
  const setIsOcrScan = (v) =>
    useModalStore.setState({ isOcrScan: isFunction(v) ? v(useModalStore.getState().isOcrScan) : v });
  const [lastOcrTexts, setLastOcrTexts] = useState([]);

  const abortScanRef = useRef(false);
  const fileInputRef = useRef(null);
  const ocrWorkerRef = useRef(null);

  const { resolveFundCodeByFuzzy } = useFundFuzzyMatcher();

  const makeTransactionKey = (trade, code = '') =>
    `tx:${code || normalizeFundNameForMatch(trade.fundName)}:${trade.type}:${trade.amount}:${trade.date}:${trade.time}`;

  const stableTransactionId = (key) => {
    let hash = 2166136261;
    for (let index = 0; index < key.length; index += 1) {
      hash ^= key.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `ocr-${(hash >>> 0).toString(16)}`;
  };

  const nameSimilarity = (left, right) => {
    const a = normalizeFundNameForMatch(left);
    const b = normalizeFundNameForMatch(right);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
    const aChars = new Map();
    for (const char of a) aChars.set(char, (aChars.get(char) || 0) + 1);
    let common = 0;
    for (const char of b) {
      const remaining = aChars.get(char) || 0;
      if (remaining > 0) {
        common += 1;
        aChars.set(char, remaining - 1);
      }
    }
    return (2 * common) / (a.length + b.length);
  };

  const handleScanClick = () => {
    if (!user?.id) {
      sonnerToast.error('该功能需登录后使用');
      return;
    }
    setScanModalOpen(true);
  };

  const handleScanPick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const processTextsInternal = async (texts) => {
    const searchFundsWithTimeout = async (val, ms) => {
      let timer = null;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve([]), ms);
      });
      try {
        return await Promise.race([searchFunds(val), timeout]);
      } catch (e) {
        return [];
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    const transactionRows = texts.flatMap((text) => parseFundTransactionTextLocally(text));
    if (transactionRows.length > 0) {
      const currentFunds = useStorageStore.getState().funds || [];
      const results = [];

      for (let index = 0; index < transactionRows.length; index += 1) {
        if (abortScanRef.current) break;
        const trade = transactionRows[index];
        setScanProgress({ stage: 'verify', current: index + 1, total: transactionRows.length });

        let matched = currentFunds
          .map((fund) => ({ fund, score: nameSimilarity(trade.fundName, fund?.name) }))
          .sort((a, b) => b.score - a.score)[0];
        if (!matched || matched.score < 0.68) {
          try {
            const searched = await searchFundsWithTimeout(trade.fundName, 8000);
            const candidate = isArray(searched) ? searched[0] : null;
            if (candidate?.CODE) {
              matched = {
                fund: {
                  code: String(candidate.CODE),
                  name: candidate.NAME || candidate.SHORTNAME || trade.fundName
                },
                score: 0.7
              };
            }
          } catch {}
        }

        const code = matched?.score >= 0.68 ? String(matched.fund.code || '') : '';
        const selectionKey = makeTransactionKey(trade, code);
        results.push({
          ...trade,
          code,
          name: code ? matched.fund.name || trade.fundName : trade.fundName,
          importKind: 'transaction',
          selectionKey,
          status: code ? 'transaction' : 'invalid'
        });
      }

      if (abortScanRef.current) return;
      setScannedFunds(results);
      setSelectedScannedCodes(new Set(results.filter((item) => item.code).map((item) => item.selectionKey)));
      setIsOcrScan(true);
      setScanConfirmModalOpen(true);
      return;
    }

    const allFundsData = [];
    const addedFundCodes = new Set();

    for (let i = 0; i < texts.length; i++) {
      if (abortScanRef.current) break;

      const text = texts[i];
      if (!text) continue;

      setScanProgress((prev) => ({ ...prev, current: i + 1 }));

      let fundsRes = null;
      const localFundsRes = parseFundTextLocally(text);
      if (localFundsRes.length === 0) {
        let fundsResString;
        try {
          fundsResString = await parseFundTextWithLLM(text);
        } catch (e) {
          // 限流错误直接向上传播，中止整个扫描流程
          if (e?.code === 'DAILY_LIMIT_EXCEEDED') throw e;
          fundsResString = null;
        }
        try {
          fundsRes = JSON.parse(fundsResString);
        } catch (e) {
          console.warn('云端 OCR 解析不可用，已保留本地识别结果。');
        }
      }

      const mergedFundsRes = mergeFundOcrResults(
        isArray(fundsRes) ? fundsRes.map((fund) => ({ ...fund, source: 'cloud' })) : [],
        localFundsRes
      );

      if (mergedFundsRes.length > 0) {
        mergedFundsRes.forEach((fund) => {
          const code = fund.fundCode || '';
          const name = (fund.fundName || '').trim();
          if (code && !addedFundCodes.has(code)) {
            addedFundCodes.add(code);
            allFundsData.push({
              fundCode: code,
              fundName: name,
              holdAmounts: fund.holdAmounts || '',
              holdGains: fund.holdGains || ''
            });
          } else if (!code && name) {
            allFundsData.push({
              fundCode: '',
              fundName: name,
              holdAmounts: fund.holdAmounts || '',
              holdGains: fund.holdGains || ''
            });
          }
        });
      }
    }

    if (abortScanRef.current) return;

    // 处理没有基金代码但有名称的情况，通过名称搜索基金代码
    const fundsWithoutCode = allFundsData.filter((f) => !f.fundCode && f.fundName);
    if (fundsWithoutCode.length > 0) {
      setScanProgress({ stage: 'verify', current: 0, total: fundsWithoutCode.length });
      for (let i = 0; i < fundsWithoutCode.length; i++) {
        if (abortScanRef.current) break;
        const fundItem = fundsWithoutCode[i];
        setScanProgress((prev) => ({ ...prev, current: i + 1 }));
        try {
          const list = await searchFundsWithTimeout(fundItem.fundName, 8000);
          if (isArray(list) && list.length === 1) {
            const found = list[0];
            if (found && found.CODE && !addedFundCodes.has(found.CODE)) {
              addedFundCodes.add(found.CODE);
              fundItem.fundCode = found.CODE;
            }
          } else {
            try {
              const fuzzyCode = await resolveFundCodeByFuzzy(fundItem.fundName);
              if (fuzzyCode && !addedFundCodes.has(fuzzyCode)) {
                addedFundCodes.add(fuzzyCode);
                fundItem.fundCode = fuzzyCode;
              }
            } catch (e) {}
          }
        } catch (e) {}
      }
    }

    const validFunds = allFundsData.filter((f) => f.fundCode);
    const codes = validFunds.map((f) => f.fundCode).sort();
    setScanProgress({ stage: 'verify', current: 0, total: codes.length });

    const existingCodes = new Set(funds.map((f) => f.code));
    const results = [];
    for (let i = 0; i < codes.length; i++) {
      if (abortScanRef.current) break;
      const code = codes[i];
      const fundInfo = validFunds.find((f) => f.fundCode === code);
      setScanProgress((prev) => ({ ...prev, current: i + 1 }));

      let found = null;
      try {
        const list = await searchFundsWithTimeout(code, 8000);
        found = isArray(list) ? list.find((d) => d.CODE === code) : null;
      } catch (e) {
        found = null;
      }

      const alreadyAdded = existingCodes.has(code);
      const ok = !!found && !alreadyAdded;
      results.push({
        code,
        name: found ? found.NAME || found.SHORTNAME || '' : fundInfo?.fundName || '',
        status: alreadyAdded ? 'added' : ok ? 'ok' : 'invalid',
        holdAmounts: fundInfo?.holdAmounts || '',
        holdGains: fundInfo?.holdGains || ''
      });
    }

    if (abortScanRef.current) return;

    setScannedFunds(results);
    setSelectedScannedCodes(
      new Set(
        results
          .filter((r) => r.status === 'ok' || (r.status === 'added' && (r.holdAmounts !== '' || r.holdGains !== '')))
          .map((r) => r.code)
      )
    );
    setIsOcrScan(true);
    setScanConfirmModalOpen(true);
  };

  const handleRetryOcr = async () => {
    if (!lastOcrTexts || lastOcrTexts.length === 0) {
      showToast('没有可重试的识别内容', 'error');
      return;
    }
    setScanConfirmModalOpen(false);
    setIsScanning(true);
    abortScanRef.current = false;
    setScanProgress({ stage: 'ocr', current: 0, total: lastOcrTexts.length });

    try {
      await processTextsInternal(lastOcrTexts);
    } catch (err) {
      if (!abortScanRef.current) {
        if (err?.code === 'DAILY_LIMIT_EXCEEDED') {
          showToast(err.message || '今日 OCR 识别次数已达上限', 'error');
        } else {
          console.error('OCR Retry Error:', err);
          showToast('重新识别失败，请重试', 'error');
        }
      }
    } finally {
      setIsScanning(false);
      setScanProgress({ stage: 'ocr', current: 0, total: 0 });
    }
  };

  const cancelScan = () => {
    abortScanRef.current = true;
    setIsScanning(false);
    setScanProgress({ stage: 'ocr', current: 0, total: 0 });
    if (ocrWorkerRef.current) {
      import('../lib/ocr').then(({ terminateOcrWorker }) => terminateOcrWorker());
      ocrWorkerRef.current = null;
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const processFiles = async (files) => {
    if (!files?.length) return;

    setIsScanning(true);
    setScanModalOpen(false);
    abortScanRef.current = false;
    setScanProgress({ stage: 'ocr', current: 0, total: files.length });

    try {
      let worker = ocrWorkerRef.current;
      if (!worker) {
        const { getOcrWorker } = await import('../lib/ocr');
        worker = await getOcrWorker('chi_sim+eng');
        ocrWorkerRef.current = worker;
      }

      const recognizeWithTimeout = async (file, ms) => {
        let timer = null;
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('OCR_TIMEOUT')), ms);
        });
        try {
          return await Promise.race([worker.recognize(file), timeout]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      };

      const extractedTexts = [];
      for (let i = 0; i < files.length; i++) {
        if (abortScanRef.current) break;

        const f = files[i];
        setScanProgress((prev) => ({ ...prev, current: i + 1 }));

        let text = '';
        try {
          const res = await recognizeWithTimeout(f, 30000);
          text = res?.data?.text || '';
        } catch (e) {
          if (String(e?.message || '').includes('OCR_TIMEOUT')) {
            if (worker) {
              const { terminateOcrWorker } = await import('../lib/ocr');
              await terminateOcrWorker();
              ocrWorkerRef.current = null;
            }
            throw e;
          }
          text = '';
        }
        if (text) {
          extractedTexts.push(text);
        }
      }

      if (abortScanRef.current) return;

      setLastOcrTexts(extractedTexts);

      if (extractedTexts.length > 0) {
        setScanProgress({ stage: 'ocr', current: 0, total: extractedTexts.length });
        await processTextsInternal(extractedTexts);
      } else {
        setScannedFunds([]);
        setSelectedScannedCodes(new Set());
        setIsOcrScan(true);
        setScanConfirmModalOpen(true);
      }
    } catch (err) {
      if (!abortScanRef.current) {
        if (err?.code === 'DAILY_LIMIT_EXCEEDED') {
          showToast(err.message || '今日 OCR 识别次数已达上限', 'error');
        } else {
          console.error('OCR Error:', err);
          showToast('图片识别失败，请重试或更换更清晰的截图', 'error');
        }
      }
    } finally {
      setIsScanning(false);
      setScanProgress({ stage: 'ocr', current: 0, total: 0 });
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFilesUpload = (event) => {
    processFiles(Array.from(event.target.files || []));
  };

  const handleFilesDrop = (files) => {
    processFiles(files);
  };

  const toggleScannedCode = (code) => {
    setSelectedScannedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const confirmScanImport = async (
    targetGroupId = 'all',
    expandAfterAdd = true,
    autoDataSource = true,
    autoImportTags = true
  ) => {
    const parseAmount = (val) => {
      if (!val && val !== 0) return null;
      const num = parseFloat(String(val).replace(/,/g, ''));
      return isNaN(num) ? null : num;
    };

    const transactionItems = scannedFunds.filter((item) => item.importKind === 'transaction');
    if (transactionItems.length > 0) {
      const selectedTransactions = transactionItems.filter((item) => selectedScannedCodes.has(item.selectionKey));
      if (selectedTransactions.length === 0) {
        showToast('请先勾选需要导入的交易记录', 'info');
        return;
      }

      const state = useStorageStore.getState();
      const existingIds = new Set((state.pendingTrades || []).map((trade) => String(trade?.id || '')));
      Object.values(state.transactions || {}).forEach((list) => {
        (isArray(list) ? list : []).forEach((trade) => existingIds.add(String(trade?.id || '')));
      });

      const targetGroup = targetGroupId && !['all', 'fav'].includes(targetGroupId) ? targetGroupId : null;
      const newPending = [];
      for (const item of selectedTransactions) {
        const id = stableTransactionId(item.selectionKey);
        if (existingIds.has(id)) continue;
        const hour = Number(String(item.time || '00:00').split(':')[0]);
        newPending.push({
          id,
          fundCode: item.code,
          fundName: item.name || item.fundName,
          type: item.type,
          share: null,
          amount: Number(item.amount),
          feeRate: 0,
          feeMode: 'rate',
          feeValue: 0,
          date: item.date,
          isAfter3pm: Number.isFinite(hour) && hour >= 15,
          isDca: !!item.isDca,
          timestamp: Date.parse(`${item.date}T${item.time || '12:00:00'}+08:00`) || Date.now(),
          source: 'alipay-ocr',
          sourceStatus: item.status,
          ...(targetGroup ? { groupId: targetGroup } : {})
        });
        existingIds.add(id);
      }

      if (newPending.length === 0) {
        showToast('这些交易记录已经导入过，本次没有重复添加', 'info');
        return;
      }

      setScanConfirmModalOpen(false);
      setPendingTrades((previous) => [...(previous || []), ...newPending]);
      if (targetGroup) {
        setGroupHoldings((previous) => {
          const next = { ...(previous || {}), [targetGroup]: { ...(previous?.[targetGroup] || {}) } };
          newPending.forEach((trade) => {
            if (!next[targetGroup][trade.fundCode]) next[targetGroup][trade.fundCode] = { share: 0, cost: 0 };
          });
          return next;
        });
      } else {
        setHoldings((previous) => {
          const next = { ...(previous || {}) };
          newPending.forEach((trade) => {
            if (!next[trade.fundCode]) next[trade.fundCode] = { share: 0, cost: 0 };
          });
          return next;
        });
      }

      showToast(`已导入 ${newPending.length} 笔交易，正在按确认净值更新本金`, 'success');
      try {
        await processPendingQueue?.();
      } catch (error) {
        console.warn('交易截图已进入待处理队列，净值确认后会继续更新：', error);
      }
      setScannedFunds([]);
      setSelectedScannedCodes(new Set());
      return;
    }

    const rawCodes = Array.from(selectedScannedCodes);

    if (rawCodes.length === 0) {
      const hasExistingFundWithoutAmount = scannedFunds.some(
        (item) => item.status === 'added' && parseAmount(item.holdAmounts) === null
      );
      if (hasExistingFundWithoutAmount) {
        showToast('基金已添加，但未识别到持有金额。请换用包含“持有金额”的完整截图，或打开基金详情手动填写', 'info');
      } else {
        showToast('请先勾选需要导入的基金', 'info');
      }
      return;
    }

    const targetExists = (code) => {
      if (!code) return false;
      if (targetGroupId === 'all') return funds.some((f) => f.code === code);
      if (targetGroupId === 'fav') return favorites?.has?.(code);
      const g = groups.find((x) => x.id === targetGroupId);
      return !!(g && isArray(g.codes) && g.codes.includes(code));
    };

    const codes = rawCodes.filter((c) => {
      const exists = targetExists(c);
      const scannedFund = scannedFunds.find((f) => f.code === c);
      const holdAmounts = parseAmount(scannedFund?.holdAmounts);
      const hasHoldingData = holdAmounts !== null;
      return !exists || hasHoldingData;
    });

    if (codes.length === 0) {
      showToast('所选基金已在目标分组中，且没有新的持有金额可更新', 'info');
      return;
    }
    setScanConfirmModalOpen(false);
    setIsScanImporting(true);
    setScanImportProgress({ current: 0, total: codes.length, success: 0, failed: 0 });

    try {
      let bestSources = {};
      if (autoDataSource && codes.length > 0) {
        try {
          bestSources = (await fetchFundsBestSources(codes)) || {};
        } catch (e) {
          console.error('fetchFundsBestSources error:', e);
        }
      }

      const newFunds = [];
      const newHoldings = {};
      let successCount = 0;
      let failedCount = 0;

      for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        setScanImportProgress((prev) => ({ ...prev, current: i + 1 }));

        const existed = funds.some((existing) => existing.code === code);
        try {
          const data = existed ? funds.find((f) => f.code === code) || null : await fetchFundData(code);
          if (!existed && data) {
            const fundToAdd = { ...data };
            if (autoDataSource && bestSources[code]) {
              fundToAdd.autoSource = true;
              fundToAdd.dataSource = bestSources[code];
            }
            newFunds.push(fundToAdd);
          }

          const scannedFund = scannedFunds.find((f) => f.code === code);
          const holdAmounts = parseAmount(scannedFund?.holdAmounts);
          const holdGains = parseAmount(scannedFund?.holdGains);
          const dwjz = data?.dwjz || data?.gsz || 0;

          if (holdAmounts !== null && dwjz > 0) {
            const share = holdAmounts / dwjz;
            const profit = holdGains !== null ? holdGains : 0;
            const principal = holdAmounts - profit;
            const cost = share > 0 ? principal / share : 0;
            newHoldings[code] = {
              share: Number(share.toFixed(2)),
              cost: Number(cost.toFixed(4))
            };
          }

          successCount++;
          setScanImportProgress((prev) => ({ ...prev, success: prev.success + 1 }));
        } catch (e) {
          failedCount++;
          setScanImportProgress((prev) => ({ ...prev, failed: prev.failed + 1 }));
        }
      }

      const newCodesSet = new Set(newFunds.map((f) => f.code));
      const allSelectedSet = new Set(codes);

      if (newFunds.length > 0) {
        setFunds((prev) => dedupeByCode([...newFunds, ...prev]));

        const nextSeries = {};
        newFunds.forEach((u) => {
          if (u?.code != null && !u.noValuation && Number.isFinite(Number(u.gsz))) {
            nextSeries[u.code] = recordValuation(u.code, { gsz: u.gsz, gztime: u.gztime });
          }
        });
        if (Object.keys(nextSeries).length > 0) setValuationSeries((prev) => ({ ...prev, ...nextSeries }));

        // 自动查询并添加推荐标签
        if (isSupabaseConfigured && autoImportTags) {
          try {
            const currentTags = useStorageStore.getState().getItem('tags', []);
            let tagsModified = false;

            for (const f of newFunds) {
              const code = f.code;
              try {
                const { data, error } = await supabase.rpc('get_fund_recommended_tags', { p_fund_code: code });
                if (!error && isArray(data) && data.length > 0) {
                  let tagsAddedForThisFund = 0;
                  for (const row of data) {
                    if (tagsAddedForThisFund >= 2) break;

                    const topicStr = String(row?.topic ?? '').trim();
                    const sectorIdStr = String(row?.sector_id ?? '').trim();
                    if (!topicStr || !sectorIdStr) continue;

                    const topics = topicStr
                      .split(';')
                      .map((t) => t.trim())
                      .filter(Boolean);
                    const sectorIds = sectorIdStr
                      .split(';')
                      .map((t) => t.trim())
                      .filter(Boolean);

                    for (let i = 0; i < topics.length; i++) {
                      if (tagsAddedForThisFund >= 2) break;

                      const topic = topics[i];
                      const sectorId = sectorIds[i];
                      if (!topic || !sectorId) continue;

                      tagsAddedForThisFund++;

                      const targetId = `default_${sectorId}`;
                      const existingInPool = currentTags.find((t) => String(t.id).trim() === targetId);

                      const displayName = existingInPool ? existingInPool.name : topic;
                      const displayTheme = existingInPool ? existingInPool.theme : 'default';

                      const tagIndex = currentTags.findIndex((t) => String(t.id).trim() === targetId);
                      if (tagIndex >= 0) {
                        const tagObj = currentTags[tagIndex];
                        let fCodes = isArray(tagObj.fundCodes) ? [...tagObj.fundCodes] : [];
                        if (!fCodes.includes(code)) {
                          fCodes.push(code);
                          tagObj.fundCodes = fCodes;
                          tagsModified = true;
                        }
                      } else {
                        currentTags.push({
                          id: targetId,
                          name: displayName,
                          theme: displayTheme,
                          fundCodes: [code]
                        });
                        tagsModified = true;
                      }
                    }
                  }
                }
              } catch (e) {
                console.error('fetch recommended tags error:', e);
              }
            }

            if (tagsModified) {
              useStorageStore.getState().setItem('tags', JSON.stringify(currentTags));
              if (isFunction(setFundTagRecords)) {
                setFundTagRecords(currentTags);
              }
            }
          } catch (e) {
            console.error('auto add tags error:', e);
          }
        }
      }

      if (Object.keys(newHoldings).length > 0) {
        if (targetGroupId !== 'all' && targetGroupId !== 'fav') {
          setGroupHoldings((prev) => {
            const bucket = prev[targetGroupId] ? { ...prev[targetGroupId] } : {};
            return { ...prev, [targetGroupId]: { ...bucket, ...newHoldings } };
          });
        } else {
          setHoldings((prev) => ({ ...prev, ...newHoldings }));
        }
      }

      if (!expandAfterAdd) {
        setCollapsedCodes((prev) => {
          const next = new Set(prev);
          codes.forEach((code) => next.add(code));
          return next;
        });
        setCollapsedTrends((prev) => {
          const next = new Set(prev);
          codes.forEach((code) => next.add(code));
          return next;
        });
      }

      if (targetGroupId === 'fav') {
        setFavorites((prev) => {
          const next = new Set(prev);
          codes
            .map(normalizeCode)
            .filter(Boolean)
            .forEach((code) => next.add(code));
          return next;
        });
        setCurrentTab('fav');
      } else if (targetGroupId && targetGroupId !== 'all') {
        setGroups((prev) =>
          prev.map((g) => {
            if (g.id === targetGroupId) {
              return { ...g, codes: Array.from(new Set([...(g.codes || []), ...codes])) };
            }
            return g;
          })
        );
        setCurrentTab(targetGroupId);
      } else {
        setCurrentTab('all');
      }

      if (successCount > 0) {
        setSuccessModal({ open: true, message: `成功导入 ${successCount} 个基金` });
      } else if (allSelectedSet.size > 0 && failedCount === 0) {
        setSuccessModal({ open: true, message: '所选基金已在目标分组中' });
      } else {
        showToast('未能导入任何基金', 'info');
      }
    } catch (e) {
      showToast('导入失败', 'error');
    } finally {
      setIsScanImporting(false);
      setScanImportProgress({ current: 0, total: 0, success: 0, failed: 0 });
      setScannedFunds([]);
      setSelectedScannedCodes(new Set());
    }
  };

  return {
    // 状态
    scanModalOpen,
    setScanModalOpen,
    scanConfirmModalOpen,
    setScanConfirmModalOpen,
    scannedFunds,
    setScannedFunds,
    selectedScannedCodes,
    setSelectedScannedCodes,
    isScanning,
    isScanImporting,
    scanImportProgress,
    scanProgress,
    isOcrScan,
    setIsOcrScan,
    fileInputRef,
    // 操作
    handleScanClick,
    handleScanPick,
    handleRetryOcr,
    cancelScan,
    handleFilesUpload,
    handleFilesDrop,
    toggleScannedCode,
    confirmScanImport
  };
}
