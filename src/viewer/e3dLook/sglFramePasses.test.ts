import { describe, expect, it } from 'vitest';

import { createDefaultSglPipelineParams, sglFramePasses, type SglLookPipelineParams } from './sglLookPipeline';

/** 改动前 render() 开头的判定（非交互），作为对照 */
function legacyPasses(p: SglLookPipelineParams) {
  const effectsOn = !p.legacyMode;
  const hlr = effectsOn && p.hlr.enabled;
  return {
    normalDepth: true,
    ao: effectsOn && p.ao.enabled,
    hlr,
    declutter: hlr && p.hlr.declutter,
    gradient: effectsOn && p.background.gradient,
    fxaa: p.aa.mode === 'fxaa',
  };
}

const cases: [string, (p: SglLookPipelineParams) => void][] = [
  ['默认参数', () => {}],
  ['legacyMode', (p) => { p.legacyMode = true; }],
  ['AO 关', (p) => { p.ao.enabled = false; }],
  ['HLR 关', (p) => { p.hlr.enabled = false; }],
  ['去杂关', (p) => { p.hlr.declutter = false; }],
  ['FXAA', (p) => { p.aa.mode = 'fxaa'; }],
  ['渐变关', (p) => { p.background.gradient = false; }],
];

describe('sglFramePasses', () => {
  for (const [name, mutate] of cases) {
    it(`${name}：L0 与改动前非交互一致`, () => {
      const p = createDefaultSglPipelineParams();
      mutate(p);
      expect(sglFramePasses(p, 0)).toEqual(legacyPasses(p));
    });

    it(`${name}：L1 关 HLR 与去杂，保留法线/深度与 AO`, () => {
      const p = createDefaultSglPipelineParams();
      mutate(p);
      const full = sglFramePasses(p, 0);
      expect(sglFramePasses(p, 1)).toEqual({
        normalDepth: true,
        ao: full.ao,
        hlr: false,
        declutter: false,
        gradient: full.gradient,
        fxaa: full.fxaa,
      });
    });

    it(`${name}：L2 只画颜色，渐变与 FXAA 不变`, () => {
      const p = createDefaultSglPipelineParams();
      mutate(p);
      const full = sglFramePasses(p, 0);
      expect(sglFramePasses(p, 2)).toEqual({
        normalDepth: false,
        ao: false,
        hlr: false,
        declutter: false,
        gradient: full.gradient,
        fxaa: full.fxaa,
      });
    });
  }

  it('默认参数下全画质所有趟都开', () => {
    expect(sglFramePasses(createDefaultSglPipelineParams(), 0)).toEqual({
      normalDepth: true, ao: true, hlr: true, declutter: true, gradient: true, fxaa: false,
    });
  });

  it('L1 必须有 normalDepth：它是 AO / HLR / 去杂的共同前置', () => {
    const p = createDefaultSglPipelineParams();
    const l1 = sglFramePasses(p, 1);
    expect(l1.normalDepth).toBe(true);
    expect(l1.hlr).toBe(false);
  });

  it('档位单调：L2 的趟数不多于 L1，L1 不多于 L0', () => {
    const p = createDefaultSglPipelineParams();
    const count = (passes: ReturnType<typeof sglFramePasses>) =>
      [passes.normalDepth, passes.ao, passes.hlr, passes.declutter].filter(Boolean).length;
    expect(count(sglFramePasses(p, 2))).toBeLessThanOrEqual(count(sglFramePasses(p, 1)));
    expect(count(sglFramePasses(p, 1))).toBeLessThanOrEqual(count(sglFramePasses(p, 0)));
  });

  it('不传档位等于 L0（默认全画质）', () => {
    const p = createDefaultSglPipelineParams();
    expect(sglFramePasses(p)).toEqual(sglFramePasses(p, 0));
  });
});
