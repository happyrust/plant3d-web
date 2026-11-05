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
    it(`${name}：非交互与改动前一致`, () => {
      const p = createDefaultSglPipelineParams();
      mutate(p);
      expect(sglFramePasses(p, false)).toEqual(legacyPasses(p));
    });

    it(`${name}：交互中只画颜色，渐变与 FXAA 不变`, () => {
      const p = createDefaultSglPipelineParams();
      mutate(p);
      const full = sglFramePasses(p, false);
      expect(sglFramePasses(p, true)).toEqual({
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
    expect(sglFramePasses(createDefaultSglPipelineParams(), false)).toEqual({
      normalDepth: true, ao: true, hlr: true, declutter: true, gradient: true, fxaa: false,
    });
  });
});
