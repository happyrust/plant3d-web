/**
 * 查看器面板里「取最新」与「重载」的接线（源码钉）。
 *
 * `ViewerPanel.vue` 挂不进单测（它要真的画布和整套查看器），这几处接线各只有一两行，行为由浏览器回放验证
 * （`docs/verification/model-getwork-2026-11-12/`）；这里钉住的是「这一行还在、还是这个意思」，
 * 免得以后改查看器时悄悄丢掉——丢了单测不会红，只有回放才看得出来。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createDtxLoadViewportState } from '@/components/dock_panels/dtxLoadViewportState';

const source = readFileSync(resolve(__dirname, 'ViewerPanel.vue'), 'utf8');

/** 从 `from` 起到 `to` 之前的那一段源码；找不到就抛（钉的位置挪了要跟着改这里） */
function section(from: string, to: string): string {
  const start = source.indexOf(from);
  if (start < 0) throw new Error(`ViewerPanel.vue 里找不到：${from}`);
  const end = source.indexOf(to, start + from.length);
  if (end < 0) throw new Error(`ViewerPanel.vue 里 ${from} 之后找不到：${to}`);
  return source.slice(start, end);
}

describe('ViewerPanel 接线（源码钉）：取最新登记的三维场景', () => {
  const scene = section('offGetWorkScene = registerGetWorkScene({', 'offGetWorkMbd = registerGetWorkDerived({');

  it('取最新发起的重载：只重载（不生成）、不飞相机、不弹每个节点各自的提示', () => {
    const reload = scene.slice(scene.indexOf('reload:'), scene.indexOf('withdraw:'));
    expect(reload).toMatch(/showModelByRefno\(refno, \{[^}]*\}\)/);
    const options = reload.match(/showModelByRefno\(refno, \{([^}]*)\}\)/)![1]!;
    expect(options).toMatch(/\brefresh: true\b/);
    expect(options).toMatch(/\bflyTo: false\b/);
    expect(options).toMatch(/\bquiet: true\b/);
    expect(options).not.toMatch(/regenerate|update|fill/);
  });
});

describe('ViewerPanel 接线（源码钉）：一次事件重载几个根（状态栏的「重载」、重新部署后的重装）', () => {
  const handler = section('const handleShowModelByRefnos = (ev: Event) => {', 'window.addEventListener(\'showModelByRefnos\', handleShowModelByRefnos);');

  it('带 refreshModel 的事件：这一串根共用一份重载的账——在循环外面开一份，每个根的重载都带着它', () => {
    expect(handler).toContain('const reloadRound = (detail as any)?.refreshModel ? createModelReloadRound() : undefined;');
    const opened = handler.indexOf('const reloadRound =');
    const loop = handler.indexOf('for (const r of unique) {');
    expect(opened).toBeGreaterThan(-1);
    expect(loop).toBeGreaterThan(opened);
    const call = handler.slice(handler.indexOf('await mg.showModelByRefno(r, {'));
    const options = call.slice(0, call.indexOf('});'));
    expect(options).toMatch(/\brefresh: !!\(detail as any\)\?\.refreshModel,/);
    expect(options).toMatch(/\bround: reloadRound,/);
  });

  it('重新部署后的重装派发的就是这个事件（带 refreshModel、不飞相机）', () => {
    const redeploy = section('function reloadLoadedModelsAfterRedeploy(): void {', 'onMounted(async () => {');
    expect(redeploy).toContain('new CustomEvent(\'showModelByRefnos\', { detail: { refnos, refreshModel: true, flyTo: false } })');
  });
});

describe('ViewerPanel 接线（源码钉）：状态栏「数据已更新」提示的场景探针', () => {
  const probe = section('setGenModelV1LoadedProbe(createGenModelV1LoadedProbe({', 'startGenModelV1UpdateNotice();');

  it('页面上装着节点的库都报给提示（不只是最后装的那个库）；原来认的「当前激活的库」照旧报', () => {
    expect(probe).toMatch(/\bloadedDbnums: loadedModelDbnums,/);
    expect(probe).toMatch(/\bactiveDbnum: \(\) => activeDbno,/);
    // `loadedModelDbnums` 是取最新接线里给的那一个（已加载节点表里装着的 + 取最新自己的登记表）
    expect(source).toMatch(/import \{[^}]*\bloadedModelDbnums,[^}]*\} from '@\/composables\/useModelGetWork';/);
  });
});

describe('ViewerPanel 接线与视口状态（#324）：多库同屏 + 取最新重载（flyTo: false）不触发自动对焦拉远镜头', () => {
  const afterLoaded = section('(compat as any).__dtxAfterInstancesLoaded = (', 'compatViewerRef.value = compat;');

  it('源码钉：__dtxAfterInstancesLoaded 透传 autoFit 与 loadedCount 给 fitToDtxLayerBBoxOnce，且地址栏撤下同时收口已加载节点表与场景根', () => {
    expect(afterLoaded).toMatch(/options\?: DtxAfterInstancesLoadedOptions/);
    expect(afterLoaded).toContain('fitToDtxLayerBBoxOnce(_dbno, dtxViewer, dtxLayer, {');
    expect(afterLoaded).toContain('autoFit: options?.autoFit');
    expect(afterLoaded).toContain('loadedCount: loadedRefnos.length');

    const evictSection = section('const removedRoots = delta.evict', 'console.log(\'[show_refno] 撤下\'');
    expect(evictSection).toContain('forgetGetWorkRoot(refno)');
    expect(evictSection).toContain('forgetLoadedNode(refno)');
    expect(evictSection).toContain('forgetLoadedRootInScene(refno)');
  });

  it('先装库 8000、再装库 7998、随后重载库 8000（flyTo: false / autoFit: false）：不触发自动对焦、不重算全局矩阵', () => {
    const state = createDtxLoadViewportState();
    const cfg = { scale: 0.001, recenter: true, autoFitOnLoad: true };

    // 首次装库 8000：应用一次全局矩阵并自动对焦
    expect(state.shouldApplyGlobalTransform(cfg)).toBe(true);
    state.markGlobalTransformApplied(cfg);
    expect(state.shouldAutoFit(8000, cfg, { loadedCount: 5 })).toBe(true);
    state.markAutoFitApplied(8000, cfg);

    // 接着装库 7998：共享同一 DTXLayer 坐标系，不再重算全局矩阵；首次手动装新库仍可自动对焦
    expect(state.shouldApplyGlobalTransform(cfg)).toBe(false);
    expect(state.shouldAutoFit(7998, cfg, { loadedCount: 3 })).toBe(true);
    state.markAutoFitApplied(7998, cfg);

    // 凑近观察后点「取最新」重载库 8000（flyTo: false -> autoFit: false）：不触发自动对焦
    expect(state.shouldAutoFit(8000, cfg, { autoFit: false, loadedCount: 5 })).toBe(false);
    // 即使后续无 autoFit: false 选项再加载库 8000（已对焦过），也不被误判成首次加载
    expect(state.shouldAutoFit(8000, cfg, { loadedCount: 5 })).toBe(false);
    expect(state.shouldApplyGlobalTransform(cfg)).toBe(false);
  });

  it('从未对焦过的新库，在显式 flyTo: false（autoFit: false）或撤下（loadedCount=0）时不移动镜头，后续手动首次加载仍正常对焦', () => {
    const state = createDtxLoadViewportState();
    const cfg = { scale: 0.001, recenter: false, autoFitOnLoad: true };

    expect(state.shouldAutoFit(8000, cfg, { autoFit: false, loadedCount: 2 })).toBe(false);
    expect(state.shouldAutoFit(8000, cfg, { loadedCount: 0 })).toBe(false);
    // 上面两次都没消耗首次对焦资格：用户主动手动勾选加载时照常对焦一次
    expect(state.shouldAutoFit(8000, cfg, { loadedCount: 2 })).toBe(true);
    state.markAutoFitApplied(8000, cfg);
    expect(state.shouldAutoFit(8000, cfg, { loadedCount: 2 })).toBe(false);
  });

  it('autoFitOnLoad 为关时不触发对焦；单位或 recenter 设置变更后允许重算全局矩阵；reset 后恢复初始状态', () => {
    const state = createDtxLoadViewportState();
    const cfgOff = { scale: 0.001, recenter: true, autoFitOnLoad: false };
    expect(state.shouldAutoFit(8000, cfgOff, { loadedCount: 2 })).toBe(false);

    const cfgMm = { scale: 0.001, recenter: true, autoFitOnLoad: true };
    const cfgM = { scale: 1, recenter: true, autoFitOnLoad: true };
    expect(state.shouldApplyGlobalTransform(cfgMm)).toBe(true);
    state.markGlobalTransformApplied(cfgMm);
    expect(state.shouldApplyGlobalTransform(cfgMm)).toBe(false);
    expect(state.shouldApplyGlobalTransform(cfgM)).toBe(true);
    state.markGlobalTransformApplied(cfgM);

    state.markAutoFitApplied(8000, cfgM);
    state.reset();
    expect(state.shouldApplyGlobalTransform(cfgM)).toBe(true);
    expect(state.shouldAutoFit(8000, cfgM, { loadedCount: 1 })).toBe(true);
  });
});
