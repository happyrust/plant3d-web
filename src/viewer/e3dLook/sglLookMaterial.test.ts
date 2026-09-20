import { describe, expect, it } from 'vitest';

import {
  SGL_DEFAULT_LIGHT,
  SGL_E3D31_VIEW_DEFAULT_LIGHT,
  SGL_LIGHT_STRATEGIES,
  SGL_LOOK_SHADERS,
  SglLookMaterial,
  translucencyToAlpha
} from './sglLookMaterial';
import { SGL_PIPELINE_SHADERS, createDefaultSglPipelineParams } from './sglLookPipeline';

describe('SglLookMaterial —— 与 sglDx11 逆向口径对齐', () => {
  it('默认光照常量等于 CSglSceneLightParams 构造函数里的值（Ks=Specular 0.3，Kr=Reflection 0.35）', () => {
    expect(SGL_DEFAULT_LIGHT).toEqual({
      ambient: 0.5,
      diffuse: 0.8,
      specular: 0.3,
      reflection: 0.35,
      specularExponent: 64,
      lightEyePos: [0, 0, 1],
    });
    // E3D 3.1 PML 出厂视图设置（gphviewopt.default）：无漫反射/高光，0.7 环境 + 0.8 立方体反射
    expect(SGL_E3D31_VIEW_DEFAULT_LIGHT).toEqual({
      ambient: 0.7,
      diffuse: 0,
      specular: 0,
      reflection: 0.8,
      specularExponent: 0,
      lightEyePos: [0, 0, 1],
    });
    expect(SGL_LIGHT_STRATEGIES.flat70.ambient).toBe(0.7);
    expect(SGL_LIGHT_STRATEGIES.unlit.ambient).toBe(1.0);
    for (const s of [SGL_LIGHT_STRATEGIES.flat70, SGL_LIGHT_STRATEGIES.unlit]) {
      expect(s.diffuse + s.specular + s.reflection + s.specularExponent).toBe(0);
    }
  });

  it('材质 uniform 与默认值一致，setLight/getLight 往返', () => {
    const m = new SglLookMaterial({ color: 0xff8000, opacity: 0.4 });
    expect(m.getLight()).toEqual(SGL_DEFAULT_LIGHT);
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.toneMapped).toBe(false);
    m.setLight({ ambient: 0.7, diffuse: 0, lightEyePos: [0.8, 0.8, 1] });
    expect(m.getLight().ambient).toBe(0.7);
    expect(m.getLight().diffuse).toBe(0);
    expect(m.getLight().lightEyePos).toEqual([0.8, 0.8, 1]);
    m.sglOpacity = 1;
    expect(m.transparent).toBe(false);
    expect(m.depthWrite).toBe(true);
    expect(m.color.getHex()).toBe(0xff8000);
  });

  it('半透明百分比 → alpha', () => {
    expect(translucencyToAlpha(0)).toBe(1);
    expect(translucencyToAlpha(60)).toBeCloseTo(0.4);
    expect(translucencyToAlpha(150)).toBe(0);
  });

  it('片元着色器保留 sglDx11 的公式骨架', () => {
    const fs = SGL_LOOK_SHADERS.fragment;
    // 高光带 NdotL 门控与乘子，反射取灰度，最终 c*(Ka+Kd*ndl) + Ks*spec + Kr*envLum
    expect(fs).toContain('pow(max(ndh, 1e-6), uKse) * ndl');
    expect(fs).toContain('(e.r + e.g + e.b) * (1.0 / 3.0)');
    expect(fs).toContain('c * (uKa + uKd * ndl) + uKs * spec + uKr * envLum');
    expect(fs).not.toContain('colorspace_fragment');
  });
});

describe('SglLookPipeline 参数与着色器', () => {
  it('默认阈值来自 sglDx11 HLR 着色器常量（50 / 0.6），效果默认全开', () => {
    const p = createDefaultSglPipelineParams();
    expect(p.hlr.depthThreshold).toBe(50);
    expect(p.hlr.normalThreshold).toBe(0.6);
    expect(p.hlr.enabled && p.ao.enabled && p.background.gradient).toBe(true);
    expect(p.legacyMode).toBe(false);
  });

  it('法线/深度 MRT 用位置导数叉乘，HLR 用二阶深度差分的远侧 + 法线折痕', () => {
    expect(SGL_PIPELINE_SHADERS.normalDepthFragment).toContain('cross(dFdx(vViewPos), dFdy(vViewPos))');
    expect(SGL_PIPELINE_SHADERS.hlr).toContain('(b.a - c.a) - (c.a - a.a)');
    expect(SGL_PIPELINE_SHADERS.hlr).toContain('d2 < -uDepthThreshold');
    expect(SGL_PIPELINE_SHADERS.hlr).toContain('< uNormalThreshold');
    expect(SGL_PIPELINE_SHADERS.composite).toContain('col * hlr * ao');
  });
});
