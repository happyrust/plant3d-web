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
