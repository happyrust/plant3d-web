/** 库内结果点到了哪一层：层次怎么进退，地址栏参数怎么读写。 */
import { beforeEach, describe, expect, it } from 'vitest';

import { parseRvmStoreUrl, standaloneStoreUrl, useRvmStoreBrowser, writeRvmStoreUrl } from './useRvmStoreBrowser';
import { RVM_STORE_PAGE_RUNS } from './useRvmStoreQueries';

const browser = useRvmStoreBrowser();

beforeEach(() => {
  browser.openBatches();
  browser.view.value = 'check';
});

describe('层次', () => {
  it('一路点下去：批次 → 上级根 → 单元', () => {
    expect(browser.level.value).toBe('batches');
    browser.openBatch('accept-20261110/7999-zone');
    expect(browser.level.value).toBe('batch');
    browser.openRoot('24383/80211', 'fail');
    expect(browser.level.value).toBe('root');
    expect(browser.place.unitStatus).toBe('fail');
    browser.openRun({ refno: '24383/97823', runId: 'accept-20261110/7999-zone/ams7999/24383_97823' });
    expect(browser.level.value).toBe('run');
    expect(browser.runIsRoot.value).toBe(false);
    // 进单元时终态筛选留着，退回列表还是原来那一组
    expect(browser.place).toMatchObject({ rootRefno: '24383/80211', unitStatus: 'fail' });
    browser.openRoot('24383/80211', browser.place.unitStatus);
    expect(browser.level.value).toBe('root');
    expect(browser.place.run).toBeNull();
  });

  it('整根只有一次运行：从批次直接进那次运行', () => {
    browser.openBatch('rvm-check-fused/all');
    browser.openRun({ refno: '24384/22399', runId: null }, '24384/22399');
    expect(browser.level.value).toBe('run');
    expect(browser.runIsRoot.value).toBe(true);
  });

  it('换批次时上级根、单元、终态筛选都清掉', () => {
    browser.openBatch('a');
    browser.openRoot('1/2', 'fail');
    browser.openBatch('b');
    expect(browser.place).toEqual({ batchId: 'b', rootRefno: null, run: null, unitStatus: null });
  });

  it('没选批次时进不了上级根和单元', () => {
    browser.openRoot('1/2');
    browser.openRun({ refno: '1/3', runId: null });
    expect(browser.level.value).toBe('batches');
  });

  it('页面单根核对是一个没有上级根的伪批次', () => {
    browser.openBatch(RVM_STORE_PAGE_RUNS);
    expect(browser.isPageRuns.value).toBe(true);
    browser.openRun({ refno: '24383/66456', runId: 'rvm-check-1' });
    expect(browser.level.value).toBe('run');
    expect(browser.place.rootRefno).toBeNull();
  });

  it('别的面板可以直接带到某个位置', () => {
    browser.showInStore({ batchId: RVM_STORE_PAGE_RUNS, run: { refno: '1/2', runId: 'rvm-check-9' } });
    expect(browser.view.value).toBe('store');
    expect(browser.level.value).toBe('run');
  });
});

describe('地址栏参数', () => {
  it('写出当前位置，别的参数原样留着', () => {
    const search = writeRvmStoreUrl('?page=rvm-check&backendPort=8022', 'store', {
      batchId: 'accept-20261110/7999-zone',
      rootRefno: '24383/80211',
      run: { refno: '24383/97823', runId: null },
      unitStatus: 'fail',
    });
    const params = new URLSearchParams(search);
    expect(params.get('page')).toBe('rvm-check');
    expect(params.get('backendPort')).toBe('8022');
    expect(params.get('rvm_view')).toBe('store');
    expect(params.get('rvm_batch')).toBe('accept-20261110/7999-zone');
    expect(params.get('rvm_root')).toBe('24383/80211');
    expect(params.get('rvm_unit')).toBe('24383/97823');
    // 已经点进单元了，列表的终态筛选不进地址栏
    expect(params.has('rvm_status')).toBe(false);
    expect(params.has('rvm_run')).toBe(false);
  });

  it('读回来是同一个位置', () => {
    const place = { batchId: 'b/1', rootRefno: '1/2', run: null, unitStatus: 'no-baseline' };
    const parsed = parseRvmStoreUrl(writeRvmStoreUrl('?page=rvm-check', 'store', place));
    expect(parsed).toEqual({ view: 'store', place });

    const inRun = { batchId: RVM_STORE_PAGE_RUNS, rootRefno: null, run: { refno: '1/2', runId: 'rvm-check-7' }, unitStatus: null };
    expect(parseRvmStoreUrl(writeRvmStoreUrl('', 'store', inRun))).toEqual({ view: 'store', place: inRun });
  });

  it('回到节点核对时把库内结果的参数都摘掉', () => {
    const search = writeRvmStoreUrl('?page=rvm-check&rvm_view=store&rvm_batch=b&rvm_root=1/2', 'check', {
      batchId: 'b',
      rootRefno: '1/2',
      run: null,
      unitStatus: null,
    });
    expect(search).toBe('?page=rvm-check');
  });

  it('从工作台带着当前位置开到独立页', () => {
    const url = new URL(standaloneStoreUrl('http://localhost:3101/?output_project=AvevaMarineSample', {
      batchId: 'rvm-check-fused/all',
      rootRefno: '24384/22399',
      run: { refno: '24384/22399', runId: null },
      unitStatus: null,
    }));
    expect(url.origin + url.pathname).toBe('http://localhost:3101/');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      output_project: 'AvevaMarineSample',
      page: 'rvm-check',
      rvm_view: 'store',
      rvm_batch: 'rvm-check-fused/all',
      rvm_root: '24384/22399',
      rvm_unit: '24384/22399',
    });
  });

  it('没有批次时上级根、单元参数不作数', () => {
    expect(parseRvmStoreUrl('?rvm_view=store&rvm_root=1/2&rvm_unit=1/3')).toEqual({
      view: 'store',
      place: { batchId: null, rootRefno: null, run: null, unitStatus: null },
    });
    expect(parseRvmStoreUrl('')).toEqual({ view: 'check', place: { batchId: null, rootRefno: null, run: null, unitStatus: null } });
  });
});
