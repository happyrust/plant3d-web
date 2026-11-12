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
