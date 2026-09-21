import { describe, expect, it } from 'vitest';

import { Box3, Color, CubeTexture, LinearFilter, Matrix4, NoColorSpace, PerspectiveCamera, Vector2, Vector3 } from 'three';

import {
  SGL31_ENVCUBE_FACE_FILES,
  configureSglEnvCubeTexture,
  envCubeRotationForUp,
  sgl31EnvCubeUrls
} from './sglEnvCube';
import {
  SGL_DEFAULT_LIGHT,
  SGL_E3D31_VIEW_DEFAULT_LIGHT,
  SGL_LIGHT_STRATEGIES,
  SGL_LOOK_SHADERS,
  SglLookMaterial,
  translucencyToAlpha
} from './sglLookMaterial';
import {
  E3D31_HBAO,
  E3D31_MSAA_SAMPLES,
  E3D_BACKGROUND_GREY,
  E3D_GRADIENT_BOTTOM_T,
  E3D_GRADIENT_TOP_T,
  SGL_BACKGROUND_DEPTH,
  SGL_PIPELINE_SHADERS,
  createDefaultSglPipelineParams,
  e3dBlurSharpnessForDepthRange,
  eyeDepthRangeOfBox,
  sglBlurFalloffForRadius,
  sglDefaultGradientEndColour,
  sglHlrSamplesFor,
  sglHlrSupersampleGrid
} from './sglLookPipeline';
import {
  DEFAULT_SGL_LOOK_PRESET,
  SGL_LOOK_PRESETS,
  applySglLookPresetToPipelineParams,
  parseSglLookPresetId
} from './sglLookPresets';

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
    // 高光带 NdotL 门控与乘子，反射采立方体贴图（世界 R 经 uEnvRot 换到贴图空间）逐通道乘 Kr，
    // 最终 c*(Ka+Kd*ndl) + Ks*spec + Kr*env（3.1 dxbc_044：mul r2, env, Kr → mad Ks*spec → mad Ka*c → mad Kd*ndl*c）
    expect(fs).toContain('pow(max(ndh, 1e-6), uKse) * ndl');
    expect(fs).toContain('textureCube(uEnvMap, uEnvRot * Rw).rgb');
    expect(fs).toContain('c * (uKa + uKd * ndl) + uKs * spec + uKr * env');
    expect(fs).not.toContain('colorspace_fragment');
  });

  it('环境贴图：默认没有 → 解析兜底；setEnvMap 切到贴图；setUp 改旋转', () => {
    const m = new SglLookMaterial();
    expect(m.envMap).toBeNull();
    expect(m.sglUniforms.uUseEnvMap.value).toBe(0);
    const tex = new CubeTexture();
    m.setEnvMap(tex);
    expect(m.envMap).toBe(tex);
    expect(m.sglUniforms.uUseEnvMap.value).toBe(1);
    // 默认 Z-up：(x, y, z) → (x, z, −y)
    const r = new Vector3(0.2, 0.5, 0.8).applyMatrix3(m.sglUniforms.uEnvRot.value);
    expect([r.x, r.y, r.z].map((v) => Math.round(v * 1000) / 1000)).toEqual([0.2, 0.8, -0.5]);
    m.setUp(new Vector3(0, 1, 0));
    const r2 = new Vector3(0.2, 0.5, 0.8).applyMatrix3(m.sglUniforms.uEnvRot.value);
    expect([r2.x, r2.y, r2.z]).toEqual([0.2, 0.5, 0.8]);
    m.setEnvMap(null);
    expect(m.sglUniforms.uUseEnvMap.value).toBe(0);
  });
});

describe('sglEnvCube —— sglDx11 内嵌环境立方体贴图的口径', () => {
  it('Z-up 世界的反射向量按 sglDx11 的 (x, z, −y) 换到贴图空间，Y-up 世界不动', () => {
    const zUp = envCubeRotationForUp(new Vector3(0, 0, 1));
    const v = new Vector3(1, 2, 3).applyMatrix3(zUp);
    expect([v.x, v.y, v.z]).toEqual([1, 3, -2]);
    // 世界 +Z（天顶）→ 贴图 +Y；世界 −Z → 贴图 −Y
    const up = new Vector3(0, 0, 1).applyMatrix3(zUp);
    expect([up.x, up.y, up.z]).toEqual([0, 1, 0]);
    const yUp = envCubeRotationForUp(new Vector3(0, 1, 0));
    const w = new Vector3(1, 2, 3).applyMatrix3(yUp);
    expect([w.x, w.y, w.z]).toEqual([1, 2, 3]);
  });

  it('六面顺序 +X −X +Y −Y +Z −Z，URL 挂在 BASE_URL 下', () => {
    expect(SGL31_ENVCUBE_FACE_FILES).toEqual(['px.png', 'nx.png', 'py.png', 'ny.png', 'pz.png', 'nz.png']);
    const urls = sgl31EnvCubeUrls('/app');
    expect(urls).toHaveLength(6);
    expect(urls[0]).toBe('/app/texture/e3d/sgl31-envcube/px.png');
    expect(urls[5]).toBe('/app/texture/e3d/sgl31-envcube/nz.png');
    expect(sgl31EnvCubeUrls()[0]!.endsWith('texture/e3d/sgl31-envcube/px.png')).toBe(true);
  });

  it('贴图按 D3D 采样口径配置：无 mip、双线性、不做 sRGB 解码、不翻 Y', () => {
    const tex = configureSglEnvCubeTexture(new CubeTexture());
    expect(tex.generateMipmaps).toBe(false);
    expect(tex.minFilter).toBe(LinearFilter);
    expect(tex.magFilter).toBe(LinearFilter);
    expect(tex.colorSpace).toBe(NoColorSpace);
    expect(tex.flipY).toBe(false);
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

  it('背景按 E3D 3.1：grey #828282 在上、端色白在下，渐变 t 顶 0.233 / 底 0.9', () => {
    const p = createDefaultSglPipelineParams();
    expect(E3D_BACKGROUND_GREY).toBe(0x828282);
    expect(p.background.top.getHex()).toBe(0x828282);
    expect(p.background.bottom.getHex()).toBe(0xffffff);
    expect(p.background.flat.getHex()).toBe(0x828282);
    expect(p.background.gradientTopT).toBeCloseTo(0.35 / 1.5, 6);
    expect(p.background.gradientBottomT).toBeCloseTo(0.9, 6);
    expect(E3D_GRADIENT_TOP_T).toBeCloseTo(0.2333, 3);
    expect(E3D_GRADIENT_BOTTOM_T).toBeCloseTo(0.9, 6);
    // 端色算法（HLS 亮度拉满）对任何背景色都给白
    expect(sglDefaultGradientEndColour(new Color(0x828282)).getHex()).toBe(0xffffff);
    expect(sglDefaultGradientEndColour(0x0000ff).getHex()).toBe(0xffffff);
  });

  it('HBAO / 模糊默认值 = E3D 3.1 sglDx11 硬编码（HBAO_slot4 / Blur_realctor）', () => {
    expect(E3D31_HBAO).toMatchObject({ radius: 392.7327, numDirs: 8, numSteps: 4, attenuation: 0.2, contrast: 1.25, blurRadius: 12, sharpnessNumerator: 16 });
    expect(E3D31_HBAO.angleBias).toBeCloseTo(0.5236, 4);
    const p = createDefaultSglPipelineParams();
    expect(p.ao.radius).toBe(392.7327);
    expect(p.ao.numDirs).toBe(8);
    expect(p.ao.numSteps).toBe(4);
    expect(p.ao.angleBias).toBeCloseTo(Math.PI / 6, 9);
    expect(p.ao.attenuation).toBe(0.2);
    expect(p.ao.contrast).toBe(1.25);
    expect(p.ao.blurRadius).toBe(12);
    expect(p.ao.blurSharpnessAuto).toBe(true);
    expect(p.ao.halfRes).toBe(false);
    // g_inv_R / g_sqr_R 与反编译常量一致
    expect(1 / p.ao.radius).toBeCloseTo(0.0025463, 6);
    expect(p.ao.radius * p.ao.radius).toBeCloseTo(154238.97, 0);
  });

  it('模糊 Falloff = 1/(2·((R+1)/2)²)（R=12 → 0.01183），锐度 = 16/(深度范围/2)，半范围 ≤ 0.001 沿用上一帧', () => {
    expect(sglBlurFalloffForRadius(12)).toBeCloseTo(0.01183, 5);
    expect(sglBlurFalloffForRadius(4)).toBeCloseTo(1 / (2 * 2.5 * 2.5), 9);
    // 深度范围 20 m（20000 mm）→ 16 / 10000 = 0.0016 /mm；NVIDIA g_Sharpness 是它的平方
    expect(e3dBlurSharpnessForDepthRange(20000)).toBeCloseTo(0.0016, 9);
    expect(e3dBlurSharpnessForDepthRange(2)).toBe(16);
    expect(e3dBlurSharpnessForDepthRange(0.002)).toBeNull();
    expect(e3dBlurSharpnessForDepthRange(0)).toBeNull();
    expect(e3dBlurSharpnessForDepthRange(-5)).toBeNull();
    expect(e3dBlurSharpnessForDepthRange(Number.NaN)).toBeNull();
    // 模糊着色器的权重形式与 sglDx11 dxbc_003 一致：exp(−r²·falloff − (Δz·s)²)
    expect(SGL_PIPELINE_SHADERS.blur).toContain('exp(-fi * fi * uFalloff)');
    expect(SGL_PIPELINE_SHADERS.blur).toContain('exp(-dz * dz)');
    expect(SGL_PIPELINE_SHADERS.blur).toContain('(d - centerDepth) * uSharpness');
  });

  it('eyeDepthRangeOfBox：world 包围盒 8 角点在相机眼空间的 [近, 远]', () => {
    const camera = new PerspectiveCamera(30, 1, 0.5, 1000);
    camera.up.set(0, 0, 1);
    camera.position.set(0, -10, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const view: Matrix4 = camera.matrixWorldInverse;
    const out = new Vector2();
    // 盒子 y ∈ [−2, 3]：相机在 y=−10 朝 +y 看，近 8、远 13
    eyeDepthRangeOfBox(new Box3(new Vector3(-1, -2, -1), new Vector3(1, 3, 1)), view, out);
    expect(out.x).toBeCloseTo(8, 6);
    expect(out.y).toBeCloseTo(13, 6);
    // 相机在盒子里：近端为负（相机后方），由调用方截到 near
    eyeDepthRangeOfBox(new Box3(new Vector3(-1, -20, -1), new Vector3(1, 3, 1)), view, out);
    expect(out.x).toBeCloseTo(-10, 6);
    expect(out.y).toBeCloseTo(13, 6);
  });

  it('抗锯齿默认 4× MSAA（Sgl_View_Parameters +780），HLR 采样档位 = 采样数，FXAA / 关 / legacy 时退回 1', () => {
    expect(E3D31_MSAA_SAMPLES).toBe(4);
    const p = createDefaultSglPipelineParams();
    expect(p.aa).toEqual({ mode: 'msaa', samples: 4 });
    expect(sglHlrSamplesFor(p)).toBe(4);
    expect(sglHlrSamplesFor({ aa: { mode: 'msaa', samples: 8 }, legacyMode: false })).toBe(8);
    expect(sglHlrSamplesFor({ aa: { mode: 'fxaa', samples: 4 }, legacyMode: false })).toBe(1);
    expect(sglHlrSamplesFor({ aa: { mode: 'none', samples: 4 }, legacyMode: false })).toBe(1);
    expect(sglHlrSamplesFor({ aa: { mode: 'msaa', samples: 4 }, legacyMode: true })).toBe(1);
    // 档位 → 法线/深度与 HLR 通道的超采样网格，kx·ky = 档位
    expect(sglHlrSupersampleGrid(1).toArray()).toEqual([1, 1]);
    expect(sglHlrSupersampleGrid(2).toArray()).toEqual([2, 1]);
    expect(sglHlrSupersampleGrid(4).toArray()).toEqual([2, 2]);
    expect(sglHlrSupersampleGrid(8).toArray()).toEqual([4, 2]);
    // HLR 邻居仍是 1 个屏幕像素（× 超采样倍数），合成里对子像素取平均（= sglDx11 MSAA 版 HLR 的 Σ/N）
    expect(SGL_PIPELINE_SHADERS.hlr).toContain('uInvResolution * uRadiusPx * uSupersample');
    expect(SGL_PIPELINE_SHADERS.composite).toContain('texelFetch(tHLR, base + ivec2(i, j), 0)');
    expect(SGL_PIPELINE_SHADERS.composite).toContain('acc / float(uHlrSupersample.x * uHlrSupersample.y)');
  });

  it('法线/深度 MRT 用位置导数叉乘，背景深度哨兵 1e18（AO / 模糊 / HLR 都按它判背景），合成里渐变用 uBgGradT 区间', () => {
    expect(SGL_BACKGROUND_DEPTH).toBe(1e18);
    expect(SGL_PIPELINE_SHADERS.normalDepthFragment).toContain('cross(dFdx(vViewPos), dFdy(vViewPos))');
    for (const s of [SGL_PIPELINE_SHADERS.ao, SGL_PIPELINE_SHADERS.blur, SGL_PIPELINE_SHADERS.hlr]) {
      expect(s).toContain('const float SGL_BG_DEPTH = 1.0e18;');
      expect(s).toContain('sglIsBackground');
      expect(s).not.toContain('<= 0.0) continue');
    }
    expect(SGL_PIPELINE_SHADERS.composite).toContain('col * hlr * ao');
    expect(SGL_PIPELINE_SHADERS.composite).toContain('mix(uBgGradT.y, uBgGradT.x, vUv.y)');
    expect(SGL_PIPELINE_SHADERS.composite).toContain('mix(uBgTop, uBgBottom, t)');
  });

  it('HLR 判据 = sglDx11 dxbc 版：右/下邻居、背景邻接、|Δd| > 50 且梯度方向 |dot| < 0.9999（h = 1000·像素步长）、|N·N′| < 0.6', () => {
    const p = createDefaultSglPipelineParams();
    expect(p.hlr.depthThreshold).toBe(50);
    expect(p.hlr.normalThreshold).toBe(0.6);
    expect(p.hlr.gradientDotThreshold).toBe(0.9999);
    expect(p.hlr.gradientStep).toBe(1000);
    const s = SGL_PIPELINE_SHADERS.hlr;
    // ① / ② 背景邻接
    expect(s).toContain('if (!geoC) return geoN;');
    expect(s).toContain('if (!geoN) return true;');
    // ③ 台阶：|dC − dN| > 阈值、prev 是几何、两梯度向量 (dC−dP, h) / (dC−dN, −h) 归一化后 |dot| < 0.9999
    expect(s).toContain('abs(c.a - next.a) > uDepthThreshold && sglIsGeometry(prev.a)');
    expect(s).toContain('normalize(vec2(c.a - prev.a, h))');
    expect(s).toContain('normalize(vec2(c.a - next.a, -h))');
    expect(s).toContain('abs(dot(v1, v2)) < uGradientDotThreshold');
    expect(s).toContain('vec2 h = uGradientStep * stepUv;');
    // ④ 法线折痕
    expect(s).toContain('< uNormalThreshold');
    // 只看右 / 下（uv −y = 屏幕向下），左 / 上只进梯度判据
    expect(s).toContain('edgeAlong(c, right, left, h.x) || edgeAlong(c, down, up, h.y)');
    expect(s).toContain('vec4 down = texture2D(tND, vUv - vec2(0.0, stepUv.y));');
    // 旧的二阶差分判据已删
    expect(s).not.toContain('(b.a - c.a) - (c.a - a.a)');
  });
});

describe('SglLookPresets —— 出厂 E3D 3.1 与本机真机两套口径', () => {
  it('默认预设是出厂 E3D 3.1：光照 {0.7,0,0,0.8,0}，边线 / 伪阴影 / 渐变 / 抗锯齿全开，背景 grey→白', () => {
    expect(DEFAULT_SGL_LOOK_PRESET).toBe('e3d31-factory');
    const f = SGL_LOOK_PRESETS['e3d31-factory'];
    expect(f.light).toEqual(SGL_E3D31_VIEW_DEFAULT_LIGHT);
    expect(f.hlr && f.ao && f.gradient && f.antiAlias).toBe(true);
    expect(f.background).toBe(0x828282);
    expect(f.gradientEnd).toBe(0xffffff);
  });

  it('本机真机预设：SGL C++ 默认光照，边线 / 伪阴影 / 渐变 / 抗锯齿全关，背景纯灰', () => {
    const m = SGL_LOOK_PRESETS['sgl-machine'];
    expect(m.light).toEqual(SGL_DEFAULT_LIGHT);
    expect(m.hlr || m.ao || m.gradient || m.antiAlias).toBe(false);
    expect(m.background).toBe(0x828282);
  });

  it('applySglLookPresetToPipelineParams 只动开关与背景色，不碰 HBAO / HLR 数值；抗锯齿开 = 4× MSAA', () => {
    const p = createDefaultSglPipelineParams();
    p.ao.radius = 123;
    p.hlr.depthThreshold = 7;
    p.background.top.setHex(0x123456);
    applySglLookPresetToPipelineParams(p, SGL_LOOK_PRESETS['sgl-machine']);
    expect(p.hlr.enabled).toBe(false);
    expect(p.ao.enabled).toBe(false);
    expect(p.background.gradient).toBe(false);
    expect(p.aa.mode).toBe('none');
    expect(p.background.top.getHex()).toBe(0x828282);
    expect(p.background.bottom.getHex()).toBe(0xffffff);
    expect(p.background.flat.getHex()).toBe(0x828282);
    expect(p.ao.radius).toBe(123);
    expect(p.hlr.depthThreshold).toBe(7);
    p.aa.samples = 8;
    applySglLookPresetToPipelineParams(p, SGL_LOOK_PRESETS['e3d31-factory']);
    expect(p.hlr.enabled && p.ao.enabled && p.background.gradient).toBe(true);
    expect(p.aa).toEqual({ mode: 'msaa', samples: 4 });
    expect(p.legacyMode).toBe(false);
  });

  it('URL / localStorage 短写解析', () => {
    expect(parseSglLookPresetId('factory')).toBe('e3d31-factory');
    expect(parseSglLookPresetId('E3D31-Factory')).toBe('e3d31-factory');
    expect(parseSglLookPresetId('machine')).toBe('sgl-machine');
    expect(parseSglLookPresetId('sgl-machine')).toBe('sgl-machine');
    expect(parseSglLookPresetId('nope')).toBeNull();
    expect(parseSglLookPresetId(null)).toBeNull();
  });
});
