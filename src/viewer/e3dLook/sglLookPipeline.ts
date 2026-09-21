/**
 * SglLookPipeline —— 复刻 AVEVA E3D（SGL DX11 后端）的后处理链：
 *
 *   ① 场景一趟正常着色（SglLookMaterial）→ colorRT
 *   ② 场景一趟 overrideMaterial → ndRT：rgb = 眼空间「面」法线（位置导数叉乘，同 sglDx11 MRT1），a = 线性深度（背景 = 哨兵 1e18，同 sglDx11）
 *   ③ HBAO（NVIDIA 同款参数：R / NumDirs / NumSteps / AngleBias / Attenuation / Contrast，法线模式）→ aoRT
 *   ④ 双边模糊 X/Y（BlurRadius / BlurFalloff / Sharpness）
 *   ⑤ HLR 边线：逐句照 sglDx11 HLR PS —— 背景/几何邻接、|Δ深度| > 50 且深度梯度方向变了（|dot| < 0.9999）、法线 |cos| < 0.6 → 边
 *   ⑥ 合成 final = colour × HLR × AO；背景处填纵向渐变（effect_bg_gradient）
 *   ⑦ 抗锯齿：出厂 4× MSAA —— 颜色通道用硬件 MSAA 目标，法线/深度 + HLR 通道按采样数超采样后在合成里取平均
 *      （sglDx11 的 HLR PS 按采样数分 1/2/4/8 四档，逐采样判边再 Σ/N）；或 3.1 新增的 FXAA（此时 HLR 档位 1）
 *
 * `legacyMode` 对应 SGL 的 `Sgl_View_Effects_Parameters::_legacy_mode`：一把关掉所有效果。
 * 参数默认值来自 3.1 sglDx11 逆向（HBAO / 模糊见 `E3D31_HBAO`，HLR 阈值见 `SglHlrParams`）；`halfRes` 等 E3D 没有的项默认关。
 */

import {
  Box3,
  type BufferGeometry,
  Camera,
  Color,
  FloatType,
  HalfFloatType,
  type IUniform,
  type InstancedMesh,
  LinearFilter,
  type MagnificationTextureFilter,
  Material,
  Matrix4,
  type MinificationTextureFilter,
  NearestFilter,
  NoBlending,
  Object3D,
  PerspectiveCamera,
  RGBAFormat,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  Texture,
  type TextureDataType,
  UniformsUtils,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

export interface SglHlrParams {
  /** SGL_ENHANCED_EDGES（E3D 默认 ON） */
  enabled: boolean;
  /** 深度差阈值，模型单位（sglDx11 HLR ps 里的常量 50，E3D 单位 mm） */
  depthThreshold: number;
  /** 法线夹角阈值：|cos| < 该值判边（sglDx11 常量 0.6） */
  normalThreshold: number;
  /**
   * 深度梯度方向判据：|dot(normalize(dC−dPrev, h), normalize(dC−dNext, −h))| < 该值 → 台阶（sglDx11 常量 0.9999）。
   * 平面无论多陡两向量反向平行、|dot| = 1；只有梯度方向变了（真台阶）才判边。
   */
  gradientDotThreshold: number;
  /**
   * 梯度向量里的像素步长常量 h = gradientStep · 屏幕 InvResolution：sglDx11 用 1000（深度单位 mm）。
   * 深度不是 mm 时按比例给（米场景 → 1），否则 h 与深度差不在一个量级、判据失真。
   */
  gradientStep: number;
  /** 邻居距离（屏幕像素）；sglDx11 固定 1，这里留作可调 */
  radiusPx: number;
  /**
   * SGL_ENHANCED_EDGES_TRANSLUCENT（视图属性 13，E3D 默认 ON）：半透明几何（材质 transparent）是否参与边线。
   * 不参与的几何仍写深度，只是法线/深度里的「参与」标记为 0：它自己不会被描边，但挡在它前面的参与几何仍会在轮廓处画线（同 sglDx11）。
   */
  translucentEdges: boolean;
  /**
   * SGL_ENHANCED_EDGES_HANDLES（视图属性 12，E3D 默认 OFF）：辅助对象（handles / aids，`object.userData.sglEdges === false` 的 Mesh）是否参与边线。
   */
  handleEdges: boolean;
  /** 边线颜色（与颜色相乘；黑 = 纯黑线） */
  edgeColor: Color;
}

export interface SglAoParams {
  /** SGL_PSEUDO_SHADOWS（E3D 叫「伪阴影」，默认 ON） */
  enabled: boolean;
  /** g_R：采样半径，模型单位（E3D 3.1：392.7327，场景单位 mm） */
  radius: number;
  /** g_NumDir（E3D 3.1：8） */
  numDirs: number;
  /** g_NumSteps（E3D 3.1：4） */
  numSteps: number;
  /** g_AngleBias（弧度；E3D 3.1：30°） */
  angleBias: number;
  /** g_Attenuation（E3D 3.1：0.2） */
  attenuation: number;
  /** g_Contrast（E3D 3.1：1.25） */
  contrast: number;
  /** g_BlurRadius（像素；E3D 3.1：12，Falloff 由它算：1/(2·((R+1)/2)²)） */
  blurRadius: number;
  /**
   * 模糊的深度权重 exp(−(Δz·sharpness)²)，模型单位的倒数（= NVIDIA g_Sharpness 的平方根）。
   * `blurSharpnessAuto` 开着时这是兜底值（算不出深度范围的帧用）。
   */
  blurSharpness: number;
  /**
   * 按 E3D 3.1 每帧算模糊锐度（`Blur_slot4`）：sharpness = 16 / (depthRange / 2)，depthRange = 本帧几何的线性深度范围
   * （可渲染 Mesh 的包围盒 + `SglLookPipelineOptions.extraSceneBounds`，在相机眼空间取 [近, 远]）。见 `e3dBlurSharpnessForDepthRange`。
   */
  blurSharpnessAuto: boolean;
  /** 半分辩率算 AO（省时间；E3D 没有这项，默认关） */
  halfRes: boolean;
}

/**
 * E3D 3.1 sglDx11 硬编码的 HBAO / 双边模糊数值：`HBAO_slot4_100084d0.c` 每帧写进常量缓冲
 * （NumSteps 4、NumDir 8、R 392.7327、AngleBias 0.5236、Attenuation 0.2、Contrast 1.25），
 * `Blur_realctor_sub_10006E50.c` 构造（BlurRadius 12、Sharpness 分子 16）。半径按场景单位，E3D 场景单位是 mm。
 */
export const E3D31_HBAO = Object.freeze({
  radius: 392.7327,
  numDirs: 8,
  numSteps: 4,
  angleBias: Math.PI / 6,
  attenuation: 0.2,
  contrast: 1.25,
  blurRadius: 12,
  /** g_Sharpness = (sharpnessNumerator / (depthRange / 2))² */
  sharpnessNumerator: 16,
} as const);

/** NVIDIA HBAO 同款：g_BlurFalloff = 1 / (2·σ²)，σ = (R + 1) / 2 */
export function sglBlurFalloffForRadius(blurRadius: number): number {
  const sigma = (blurRadius + 1) / 2;
  return 1 / (2 * sigma * sigma);
}

/**
 * E3D 3.1 每帧的模糊深度锐度（`Blur_slot4_10007260.c`）：半深度范围 h = depthRange × 0.5，h > 0.001 时
 * g_Sharpness = (16 / h)²，否则沿用上一帧（返回 null）。返回本管线口径的值（权重 exp(−(Δz·s)²)，即 g_Sharpness 的平方根 = 16 / h）。
 */
export function e3dBlurSharpnessForDepthRange(depthRange: number): number | null {
  const half = depthRange * 0.5;
  if (!(half > 0.001)) return null;
  return E3D31_HBAO.sharpnessNumerator / half;
}

const _rangeCorner = new Vector3();

/** world 空间包围盒在相机眼空间的线性深度区间（8 个角点到相机平面的距离 −z，可能含负值 = 相机后方），写进 out.x/y = [min, max] */
export function eyeDepthRangeOfBox(box: Box3, viewMatrix: Matrix4, out: Vector2): Vector2 {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < 8; i++) {
    _rangeCorner
      .set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z)
      .applyMatrix4(viewMatrix);
    const d = -_rangeCorner.z;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return out.set(min, max);
}

/** PDMS 颜色表 `grey`（索引 1）= #828282，E3D 3.1 出厂背景色（真机截图 130,130,130） */
export const E3D_BACKGROUND_GREY = 0x828282;

/**
 * 背景渐变端色未显式设置时 sglDx11 的算法（`bucketbg_10075b00.c`）：
 * 背景色 → Windows HLS（0..240），`S ← S×0.1`，`L ← 255`，再 HLS→RGB。
 * L ≥ 240 时 HLS→RGB 三个分量都 ≥ 240，×255/240 后 ≥ 255 → 任何背景色都得到纯白。
 */
export function sglDefaultGradientEndColour(_background: Color | number = E3D_BACKGROUND_GREY): Color {
  return new Color(0xffffff);
}

/**
 * E3D 3.1 用 Direct2D 画渐变（`DrawBackground_0x10021500.c`）：渐变线从视口上方 0.35H 到下方 1.15H
 * （上 = 背景色，下 = 端色），所以可见区里的渐变参数 t 从顶部 0.35/1.5 ≈ 0.233 到底部 1.35/1.5 = 0.9。
 */
export const E3D_GRADIENT_TOP_T = 0.35 / 1.5;
export const E3D_GRADIENT_BOTTOM_T = 1.35 / 1.5;

export interface SglBackgroundParams {
  /** SGL_BACKGROUND_GRADIENT（E3D 默认 ON） */
  gradient: boolean;
  /** 渐变起点色 = 背景色，在上（E3D 3.1 出厂 grey #828282） */
  top: Color;
  /** 渐变端色，在下（E3D 3.1 未设端色时 = 白，见 sglDefaultGradientEndColour） */
  bottom: Color;
  /** 关掉渐变时的纯色背景 */
  flat: Color;
  /** 渐变参数 t 在视口顶部的取值（E3D 3.1：0.35/1.5） */
  gradientTopT: number;
  /** 渐变参数 t 在视口底部的取值（E3D 3.1：1.35/1.5） */
  gradientBottomT: number;
}

export type SglAaMode = 'none' | 'msaa' | 'fxaa';
export type SglMsaaSamples = 1 | 2 | 4 | 8;

/**
 * 抗锯齿（`Sgl_View_Parameters`：多重采样开、采样数 4 @+780；FXAA 关 @+764；两者互斥）。
 * 出厂 `gphviewopt` `antiAlias = true(4)` → 4× MSAA。
 */
export interface SglAaParams {
  /** 'msaa' = 多重采样（E3D 出厂）；'fxaa' = 3.1 新增的 FXAA 后处理（HLR 采样档位退回 1）；'none' = 关 */
  mode: SglAaMode;
  /**
   * MSAA 采样数（`MULTISAMPLING_COUNT`，1/2/4/8，出厂 4）。颜色通道用硬件 MSAA；
   * HLR 采样档位 = 同一个数：sglDx11 的 HLR PS 对每个采样点各判一次边再取平均（dxbc_027/028/029 的 Texture2DMS 版本），
   * WebGL2 读不到多重采样纹理的单个采样点，这里改成把法线/深度与 HLR 通道按 `sglHlrSupersampleGrid()` 超采样、合成时盒式平均，效果等价（有序网格）。
   */
  samples: SglMsaaSamples;
}

export interface SglLookPipelineParams {
  hlr: SglHlrParams;
  ao: SglAoParams;
  background: SglBackgroundParams;
  aa: SglAaParams;
  /** Sgl_View_Effects_Parameters::_legacy_mode：全部效果关闭 */
  legacyMode: boolean;
}

/** 构造时可只给部分字段，其余用默认 */
export interface SglLookPipelineParamsInit {
  hlr?: Partial<SglHlrParams>;
  ao?: Partial<SglAoParams>;
  background?: Partial<SglBackgroundParams>;
  aa?: Partial<SglAaParams>;
  legacyMode?: boolean;
}

/** E3D 3.1 出厂抗锯齿：4× 多重采样 */
export const E3D31_MSAA_SAMPLES: SglMsaaSamples = 4;

/**
 * HLR 采样档位（= MSAA 采样数；FXAA / 关抗锯齿时为 1）→ 法线/深度与 HLR 通道每轴的超采样倍数 (kx, ky)：
 * 1 → 1×1，2 → 2×1，4 → 2×2，8 → 4×2。合成时对 kx×ky 个子像素的边线结果取平均，对应 sglDx11 HLR PS 的 Σ/N。
 */
export function sglHlrSupersampleGrid(samples: number, out: Vector2 = new Vector2()): Vector2 {
  if (samples >= 8) return out.set(4, 2);
  if (samples >= 4) return out.set(2, 2);
  if (samples >= 2) return out.set(2, 1);
  return out.set(1, 1);
}

/** 本轮 HLR 实际用的采样档位：MSAA 时 = 采样数，FXAA / 无抗锯齿 / legacy 时 1（同 sglDx11 的档位选择） */
export function sglHlrSamplesFor(params: Pick<SglLookPipelineParams, 'aa' | 'legacyMode'>): number {
  if (params.legacyMode) return 1;
  return params.aa.mode === 'msaa' ? params.aa.samples : 1;
}

/**
 * 自己能输出「眼空间面法线 + 线性深度」的材质（如 DTXMaterial：顶点来自纹理，没法用 overrideMaterial）。
 * 管线在法线/深度通道前调 `setSglNormalDepthOutput(true)`，画完调 `false`。
 */
export interface SglNormalDepthProvider {
  setSglNormalDepthOutput(enabled: boolean): void;
  /**
   * 可选：法线/深度输出里的「参与边线」标记（sglDx11 法线纹理 .w 的 bit0；这里约定不参与的把法线缩到 0.5 长）。
   * 管线在法线/深度通道前按 `SglHlrParams.translucentEdges / handleEdges` 决定后调用。
   */
  setSglEdgeParticipation?(participates: boolean): void;
  /** 可选：材质本来是不是半透明通道（setSglNormalDepthOutput(true) 期间 `transparent` 会被临时关掉，所以单独给） */
  readonly sglIsTranslucentPass?: boolean;
}

/**
 * 一个可渲染 Mesh 这一帧是否参与 HLR 边线（sglDx11 法线纹理 .w bit0 的取值规则）：
 * `userData.sglEdges === false` 的是辅助对象（handles / aids）→ 看 `handleEdges`；半透明材质 → 看 `translucentEdges`；其余参与。
 */
export function sglEdgeParticipationFor(
  hlr: Pick<SglHlrParams, 'translucentEdges' | 'handleEdges'>,
  object: { userData?: Record<string, unknown> },
  translucent: boolean,
): boolean {
  if (object.userData?.sglEdges === false) return hlr.handleEdges;
  if (translucent) return hlr.translucentEdges;
  return true;
}

/** 法线/深度纹理里「参与边线」标记的编码：参与 = 单位法线，不参与 = 法线 × 该值 */
export const SGL_EDGE_FLAG_OFF_SCALE = 0.5;

export function isSglNormalDepthProvider(material: unknown): material is Material & SglNormalDepthProvider {
  return !!material && typeof (material as SglNormalDepthProvider).setSglNormalDepthOutput === 'function';
}

export interface SglLookPipelineOptions {
  /**
   * 颜色通道是否保留 `scene.background`（三维视图自己管背景时用）。
   * false（默认）= 管线自己按 params.background 画渐变 / 纯色。
   */
  useSceneBackground?: boolean;
  /**
   * 法线/深度从哪来：
   * - 'override'：scene.overrideMaterial 画所有普通 Mesh（默认，给 BufferGeometry 场景）
   * - 'providers'：只画实现了 SglNormalDepthProvider 的材质（DTX 场景）
   * - 'both'：两者都画
   */
  normalDepthSource?: 'override' | 'providers' | 'both';
  /**
   * 额外的 world 空间场景包围盒（每帧回调，写进 target 并返回；返回 null / 空盒 = 没有）。
   * 给几何存在纹理里、Mesh 自身没有包围盒的层（DTXLayer）用：`blurSharpnessAuto` 的深度范围 = 可渲染 Mesh 包围盒 ∪ 这里给的盒。
   */
  extraSceneBounds?: (target: Box3) => Box3 | null;
}

export function createDefaultSglPipelineParams(): SglLookPipelineParams {
  return {
    hlr: {
      enabled: true,
      depthThreshold: 50,
      normalThreshold: 0.6,
      gradientDotThreshold: 0.9999,
      gradientStep: 1000,
      radiusPx: 1,
      translucentEdges: true,
      handleEdges: false,
      edgeColor: new Color(0x000000),
    },
    ao: {
      enabled: true,
      radius: E3D31_HBAO.radius,
      numDirs: E3D31_HBAO.numDirs,
      numSteps: E3D31_HBAO.numSteps,
      angleBias: E3D31_HBAO.angleBias,
      attenuation: E3D31_HBAO.attenuation,
      contrast: E3D31_HBAO.contrast,
      blurRadius: E3D31_HBAO.blurRadius,
      blurSharpness: 0.01,
      blurSharpnessAuto: true,
      halfRes: false,
    },
    background: {
      gradient: true,
      top: new Color(E3D_BACKGROUND_GREY),
      bottom: sglDefaultGradientEndColour(E3D_BACKGROUND_GREY),
      flat: new Color(E3D_BACKGROUND_GREY),
      gradientTopT: E3D_GRADIENT_TOP_T,
      gradientBottomT: E3D_GRADIENT_BOTTOM_T,
    },
    aa: {
      mode: 'msaa',
      samples: E3D31_MSAA_SAMPLES,
    },
    legacyMode: false,
  };
}

// ---------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------

/**
 * sglDx11 深度纹理的背景哨兵：1e18（dxbc 里的 `999999984306749440.0`）。法线/深度目标清成 (0,0,0,1e18)，
 * 几何写线性深度；半浮点目标里 1e18 存成 inf，所以判背景用 ≥ 1e17 而不是 ==。
 */
export const SGL_BACKGROUND_DEPTH = 1e18;

const SGL_BG_DEPTH_GLSL = /* glsl */ `
const float SGL_BG_DEPTH = 1.0e18;
bool sglIsBackground(float d) { return d >= 1.0e17; }
bool sglIsGeometry(float d) { return d < 1.0e17; }
`;

const FSQ_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** 眼空间位置 → 面法线 + 线性深度（sglDx11 MRT1/MRT2 的等价物） */
const ND_VERTEX = /* glsl */ `
varying vec3 vViewPos;
void main() {
  #ifdef USE_INSTANCING
    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  #else
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  #endif
  vViewPos = mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const ND_FRAGMENT = /* glsl */ `
varying vec3 vViewPos;
// 「参与边线」标记：1 = 参与（单位法线），0.5 = 不参与（法线缩到 0.5 长；sglDx11 是法线纹理 .w 的 bit0）
uniform float uEdgeFlag;
void main() {
  vec3 n = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
  gl_FragColor = vec4(n * uEdgeFlag, -vViewPos.z);
}
`;

/** 法线/深度纹理里的「参与边线」标记：法线长度 > 0.75 即参与（不参与的被缩到 0.5） */
const SGL_EDGE_FLAG_GLSL = /* glsl */ `
bool sglEdgeParticipant(vec3 n) { return dot(n, n) > 0.5625; }
`;

/** 深度重建 + HBAO（法线模式） */
const AO_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tND;
uniform vec2 uResolution;
uniform vec2 uInvResolution;
uniform vec2 uFocalLen;
uniform vec2 uInvFocalLen;
uniform vec2 uOrthoOffset;
uniform float uIsPerspective;
uniform float uR;
uniform float uInvSqrR;
uniform float uNumDirs;
uniform float uNumSteps;
uniform float uAngleBias;
uniform float uAttenuation;
uniform float uContrast;
varying vec2 vUv;
${SGL_BG_DEPTH_GLSL}

vec3 viewPos(vec2 uv, float depth) {
  vec2 ndc = uv * 2.0 - 1.0;
  if (uIsPerspective > 0.5) return vec3(ndc * depth * uInvFocalLen, -depth);
  return vec3((ndc - uOrthoOffset) * uInvFocalLen, -depth);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec4 nd = texture2D(tND, vUv);
  float depth = nd.a;
  if (sglIsBackground(depth)) { gl_FragColor = vec4(1.0); return; }
  vec3 P = viewPos(vUv, depth);
  vec3 N = normalize(nd.rgb);

  float rPix = (uIsPerspective > 0.5)
    ? uR * uFocalLen.y / depth * uResolution.y * 0.5
    : uR * uFocalLen.y * uResolution.y * 0.5;
  if (rPix < 1.0) { gl_FragColor = vec4(1.0); return; }

  float numSteps = min(uNumSteps, rPix);
  float stepPix = rPix / (numSteps + 1.0);
  float jitter = hash12(gl_FragCoord.xy);
  float alpha = 6.28318530718 / uNumDirs;
  float ao = 0.0;

  for (int d = 0; d < 32; d++) {
    if (float(d) >= uNumDirs) break;
    float ang = alpha * (float(d) + jitter);
    vec2 dir = vec2(cos(ang), sin(ang));
    // 屏幕方向投到切平面 → 切线仰角（NVIDIA HBAO 的 useNormal 路）
    vec3 T = vec3(dir, 0.0);
    T -= N * dot(T, N);
    float tanAngle = atan(T.z, max(length(T.xy), 1e-5)) + uAngleBias;
    float sinH = sin(tanAngle);
    for (int s = 0; s < 32; s++) {
      if (float(s) >= numSteps) break;
      vec2 uvS = vUv + dir * (stepPix * (float(s) + 1.0 + 0.5 * jitter)) * uInvResolution;
      if (uvS.x < 0.0 || uvS.y < 0.0 || uvS.x > 1.0 || uvS.y > 1.0) break;
      vec4 ndS = texture2D(tND, uvS);
      if (sglIsBackground(ndS.a)) continue;
      vec3 S = viewPos(uvS, ndS.a);
      vec3 H = S - P;
      float len2 = dot(H, H);
      if (len2 * uInvSqrR > 1.0) continue;
      float sinS = H.z * inversesqrt(max(len2, 1e-8));
      if (sinS > sinH) {
        float att = 1.0 - len2 * uInvSqrR * uAttenuation;
        ao += (sinS - sinH) * att;
        sinH = sinS;
      }
    }
  }
  ao = 1.0 - ao / uNumDirs * uContrast;
  gl_FragColor = vec4(vec3(clamp(ao, 0.0, 1.0)), 1.0);
}
`;

/** 深度感知的可分离模糊 */
const BLUR_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tSource;
uniform sampler2D tND;
uniform vec2 uStep;
uniform float uRadius;
uniform float uFalloff;
uniform float uSharpness;
varying vec2 vUv;
${SGL_BG_DEPTH_GLSL}

void main() {
  float centerDepth = texture2D(tND, vUv).a;
  if (sglIsBackground(centerDepth)) { gl_FragColor = vec4(1.0); return; }
  float total = 0.0;
  float wsum = 0.0;
  for (int i = -16; i <= 16; i++) {
    float fi = float(i);
    if (abs(fi) > uRadius) continue;
    vec2 uvS = vUv + uStep * fi;
    float d = texture2D(tND, uvS).a;
    if (sglIsBackground(d)) continue;
    float dz = (d - centerDepth) * uSharpness;
    float w = exp(-fi * fi * uFalloff) * exp(-dz * dz);
    total += texture2D(tSource, uvS).r * w;
    wsum += w;
  }
  float v = wsum > 0.0 ? total / wsum : 1.0;
  gl_FragColor = vec4(vec3(v), 1.0);
}
`;

/**
 * HLR：逐句照 sglDx11 的 HLR PS（dxbc_045 单采样；dxbc_029 / 028 / 027 是 2 / 4 / 8 采样版，每个采样点同一判据再 Σ/N）。
 * 那边的输入是深度纹理（背景哨兵 1e18）+ 法线纹理（.w 的 bit0 = 「参与边线」标记）；这里深度 ≠ 哨兵 即几何，
 * 法线长度 > 0.75 即参与（不参与的几何 —— 半透明关了 EnhancedEdgesTranslucent、handles 关了 EnhancedEdgesHandles —— 法线被缩到 0.5 长）。
 * 只看 右(+1 px) 与 下(+1 px) 两个邻居，左 / 上 只在梯度方向判据里用：
 *   ① 中心无标记（背景或不参与的几何）：邻居有标记 且（中心是背景 或 dC − dN > 50）→ 边
 *      （参与几何的轮廓画在它左 / 上外侧的背景 / 不参与几何像素上；不参与几何自己不会被描边）；
 *   ② 中心有标记、邻居无标记：邻居是背景 → 边；否则 dC − dN < −50（中心更近）→ 边（参与几何右 / 下侧的轮廓画在几何像素上）；
 *   ③ 都有标记：|dC − dN| > 50 且 左/上 邻居也有标记 且 |dot(normalize(dC − dP, h), normalize(dC − dN, −h))| < 0.9999 → 边。
 *      h = 1000 · 屏幕 InvResolution（sglDx11 的 `cb1[0] × (0, −1000, 0, 1000)`，深度单位 mm）：平面无论多陡两向量反向平行、|dot| = 1，
 *      只有深度梯度方向变了（真台阶）才判边，且画在台阶左 / 上侧那个像素上；
 *   ④ 否则 |N·N'| < 0.6 → 边（盒子这类 90° 折边由它负责）。
 * 超采样（HLR 采样档位 > 1）时本通道跑在 kx×ky 倍分辨率上，邻居仍取 1 个屏幕像素远（= kx / ky 个子像素），
 * 同 sglDx11 MSAA 版对每个采样点用同一采样序号读 ±1 像素邻居。uv 的 −y 是屏幕向下（= D3D 纹理坐标的 +y）。
 */
const HLR_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tND;
uniform vec2 uInvResolution;
uniform float uRadiusPx;
uniform vec2 uSupersample;
uniform float uDepthThreshold;
uniform float uNormalThreshold;
uniform float uGradientDotThreshold;
uniform float uGradientStep;
uniform vec3 uEdgeColor;
varying vec2 vUv;
${SGL_BG_DEPTH_GLSL}
${SGL_EDGE_FLAG_GLSL}

// 「有标记」= 是几何且参与边线（sglDx11 法线纹理 .w bit0）
bool flagged(vec4 s) { return sglIsGeometry(s.a) && sglEdgeParticipant(s.rgb); }

// 一个方向的判边：next = 右 / 下，prev = 左 / 上，h = 该轴的 1000·像素步长。true = 边
bool edgeAlong(vec4 c, vec4 next, vec4 prev, float h) {
  bool flagC = flagged(c);
  bool flagN = flagged(next);
  // ① 中心无标记（sglDx11: flag(C)==0 → flag(N) && (dC == 1e18 || dC − dN > 50)）
  if (!flagC) return flagN && (sglIsBackground(c.a) || c.a - next.a > uDepthThreshold);
  // ② 邻居无标记（sglDx11: flag(N)==0 → dN == 1e18 || dC − dN < −50）
  if (!flagN) return sglIsBackground(next.a) || c.a - next.a < -uDepthThreshold;
  // ③ 深度台阶 + 梯度方向变化（sglDx11: lt 50 < |dC − dN|，|dot| < 0.9999，且 prev 有标记）
  if (abs(c.a - next.a) > uDepthThreshold && flagged(prev)) {
    vec2 v1 = normalize(vec2(c.a - prev.a, h));
    vec2 v2 = normalize(vec2(c.a - next.a, -h));
    if (abs(dot(v1, v2)) < uGradientDotThreshold) return true;
  }
  // ④ 法线折痕（sglDx11: |dot(nC, nN)| < 0.6）
  return abs(dot(normalize(c.rgb), normalize(next.rgb))) < uNormalThreshold;
}

void main() {
  vec4 c = texture2D(tND, vUv);
  // 1 个屏幕像素（超采样时 = kx / ky 个子像素）；h 按屏幕像素步长算，不随超采样变
  vec2 stepUv = uInvResolution * uRadiusPx * uSupersample;
  vec2 h = uGradientStep * stepUv;
  vec4 right = texture2D(tND, vUv + vec2(stepUv.x, 0.0));
  vec4 left = texture2D(tND, vUv - vec2(stepUv.x, 0.0));
  vec4 down = texture2D(tND, vUv - vec2(0.0, stepUv.y));
  vec4 up = texture2D(tND, vUv + vec2(0.0, stepUv.y));
  bool edge = edgeAlong(c, right, left, h.x) || edgeAlong(c, down, up, h.y);
  gl_FragColor = edge ? vec4(uEdgeColor, 1.0) : vec4(1.0);
}
`;

/**
 * 合成：colour × HLR × AO，背景处填渐变。
 * 渐变照 E3D 3.1 的 D2D 线性渐变：上 = 背景色（uBgTop）、下 = 端色（uBgBottom），
 * 渐变参数 t 在视口顶/底取 uBgGradT.x / uBgGradT.y（出厂 0.233 / 0.9，渐变线伸到视口外）。
 * HLR 通道若是超采样的（uHlrSupersample > 1），对本像素对应的 kx×ky 个子像素取平均 —— 即 sglDx11 MSAA 版 HLR 的 Σ/N。
 */
const COMPOSITE_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tND;
uniform sampler2D tHLR;
uniform sampler2D tAO;
uniform float uUseHlr;
uniform float uUseAo;
uniform float uUseGradient;
uniform ivec2 uHlrSupersample;
uniform vec3 uBgTop;
uniform vec3 uBgBottom;
uniform vec3 uBgFlat;
uniform vec2 uBgGradT;
varying vec2 vUv;

vec3 hlrAverage() {
  ivec2 base = ivec2(gl_FragCoord.xy) * uHlrSupersample;
  vec3 acc = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    if (j >= uHlrSupersample.y) break;
    for (int i = 0; i < 4; i++) {
      if (i >= uHlrSupersample.x) break;
      acc += texelFetch(tHLR, base + ivec2(i, j), 0).rgb;
    }
  }
  return acc / float(uHlrSupersample.x * uHlrSupersample.y);
}

void main() {
  vec4 c = texture2D(tColor, vUv);
  float t = mix(uBgGradT.y, uBgGradT.x, vUv.y);
  vec3 bg = (uUseGradient > 0.5) ? mix(uBgTop, uBgBottom, t) : uBgFlat;
  vec3 col = mix(bg, c.rgb, c.a);
  vec3 hlr = (uUseHlr > 0.5) ? hlrAverage() : vec3(1.0);
  float ao = (uUseAo > 0.5) ? texture2D(tAO, vUv).r : 1.0;
  gl_FragColor = vec4(col * hlr * ao, 1.0);
}
`;

// ---------------------------------------------------------------------------

type RtFilter = MinificationTextureFilter & MagnificationTextureFilter;

const _srgbTmp = { r: 0, g: 0, b: 0 };

/**
 * E3D 的颜色表是 sRGB 字节直接写进 8-bit 目标、不做任何转换；three 的 Color 内部存线性值，
 * 所以上传前要取回 sRGB 分量，才能让 `#828282` 真的显示成 (130,130,130)。
 */
function setSrgb(target: Vector3, color: Color): void {
  color.getRGB(_srgbTmp, SRGBColorSpace);
  target.set(_srgbTmp.r, _srgbTmp.g, _srgbTmp.b);
}

function makeRT(w: number, h: number, type: TextureDataType, filter: RtFilter, depthBuffer: boolean, samples = 0): WebGLRenderTarget {
  return new WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type,
    format: RGBAFormat,
    minFilter: filter,
    magFilter: filter,
    depthBuffer,
    stencilBuffer: false,
    generateMipmaps: false,
    samples,
  });
}

interface AoUniforms {
  tND: IUniform<Texture | null>;
  uResolution: IUniform<Vector2>;
  uInvResolution: IUniform<Vector2>;
  uFocalLen: IUniform<Vector2>;
  uInvFocalLen: IUniform<Vector2>;
  uOrthoOffset: IUniform<Vector2>;
  uIsPerspective: IUniform<number>;
  uR: IUniform<number>;
  uInvSqrR: IUniform<number>;
  uNumDirs: IUniform<number>;
  uNumSteps: IUniform<number>;
  uAngleBias: IUniform<number>;
  uAttenuation: IUniform<number>;
  uContrast: IUniform<number>;
}

interface BlurUniforms {
  tSource: IUniform<Texture | null>;
  tND: IUniform<Texture | null>;
  uStep: IUniform<Vector2>;
  uRadius: IUniform<number>;
  uFalloff: IUniform<number>;
  uSharpness: IUniform<number>;
}

interface HlrUniforms {
  tND: IUniform<Texture | null>;
  uInvResolution: IUniform<Vector2>;
  uRadiusPx: IUniform<number>;
  uSupersample: IUniform<Vector2>;
  uDepthThreshold: IUniform<number>;
  uNormalThreshold: IUniform<number>;
  uGradientDotThreshold: IUniform<number>;
  uGradientStep: IUniform<number>;
  uEdgeColor: IUniform<Vector3>;
}

interface CompositeUniforms {
  tColor: IUniform<Texture | null>;
  tND: IUniform<Texture | null>;
  tHLR: IUniform<Texture | null>;
  tAO: IUniform<Texture | null>;
  uUseHlr: IUniform<number>;
  uUseAo: IUniform<number>;
  uUseGradient: IUniform<number>;
  uHlrSupersample: IUniform<Vector2>;
  uBgTop: IUniform<Vector3>;
  uBgBottom: IUniform<Vector3>;
  uBgFlat: IUniform<Vector3>;
  uBgGradT: IUniform<Vector2>;
}

interface RenderableRecord {
  object: Object3D;
  visible: boolean;
  isProviderMesh: boolean;
  isMesh: boolean;
  /** 这一帧参与 HLR 边线（法线/深度里的标记）；非 Mesh 恒 true（它们本来就不进法线/深度通道） */
  edgeParticipant: boolean;
}

export class SglLookPipeline {
  readonly params: SglLookPipelineParams;
  readonly options: Required<SglLookPipelineOptions>;

  private readonly _renderer: WebGLRenderer;
  private readonly _size = new Vector2(1, 1);
  private readonly _ndType: TextureDataType;
  private readonly _renderables: RenderableRecord[] = [];
  private readonly _providerMaterials = new Set<Material & SglNormalDepthProvider>();
  /** 本帧是否有不参与边线的普通 Mesh（决定 overrideMaterial 的法线/深度通道要不要画第二趟） */
  private _hasNonParticipantMesh = false;
  /** 本帧可渲染 Mesh 的 world 包围盒 ∪ extraSceneBounds（blurSharpnessAuto 用） */
  private readonly _frameBounds = new Box3();
  private readonly _tmpBox = new Box3();
  private readonly _tmpRange = new Vector2();
  private _lastDepthRange: number | null = null;
  private _lastBlurSharpness: number | null = null;

  private _colorRT: WebGLRenderTarget;
  private _ndRT: WebGLRenderTarget;
  private _aoRT: WebGLRenderTarget;
  private _blurRTa: WebGLRenderTarget;
  private _blurRTb: WebGLRenderTarget;
  private _hlrRT: WebGLRenderTarget;
  /** FXAA 时合成先落到这里，再做 FXAA 到 target */
  private _compositeRT: WebGLRenderTarget;
  /** 颜色通道当前的 MSAA 采样数（0 = 无） */
  private _colorSamples = 0;
  /** 法线/深度与 HLR 通道当前的超采样倍数 */
  private readonly _hlrSupersample = new Vector2(1, 1);

  private readonly _aoUniforms: AoUniforms = {
    tND: { value: null },
    uResolution: { value: new Vector2(1, 1) },
    uInvResolution: { value: new Vector2(1, 1) },
    uFocalLen: { value: new Vector2(1, 1) },
    uInvFocalLen: { value: new Vector2(1, 1) },
    uOrthoOffset: { value: new Vector2(0, 0) },
    uIsPerspective: { value: 1 },
    uR: { value: E3D31_HBAO.radius },
    uInvSqrR: { value: 1 / (E3D31_HBAO.radius * E3D31_HBAO.radius) },
    uNumDirs: { value: E3D31_HBAO.numDirs },
    uNumSteps: { value: E3D31_HBAO.numSteps },
    uAngleBias: { value: E3D31_HBAO.angleBias },
    uAttenuation: { value: E3D31_HBAO.attenuation },
    uContrast: { value: E3D31_HBAO.contrast },
  };

  private readonly _blurUniforms: BlurUniforms = {
    tSource: { value: null },
    tND: { value: null },
    uStep: { value: new Vector2(0, 0) },
    uRadius: { value: E3D31_HBAO.blurRadius },
    uFalloff: { value: sglBlurFalloffForRadius(E3D31_HBAO.blurRadius) },
    uSharpness: { value: 0.01 },
  };

  private readonly _hlrUniforms: HlrUniforms = {
    tND: { value: null },
    uInvResolution: { value: new Vector2(1, 1) },
    uRadiusPx: { value: 1 },
    uSupersample: { value: new Vector2(1, 1) },
    uDepthThreshold: { value: 50 },
    uNormalThreshold: { value: 0.6 },
    uGradientDotThreshold: { value: 0.9999 },
    uGradientStep: { value: 1000 },
    uEdgeColor: { value: new Vector3(0, 0, 0) },
  };

  /** 法线/深度目标的清屏值：法线 0、深度 = 背景哨兵 1e18（gl.clearColor 会截到 [0,1]，浮点附件得走 clearBufferfv） */
  private readonly _ndClear = new Float32Array([0, 0, 0, SGL_BACKGROUND_DEPTH]);

  private readonly _compositeUniforms: CompositeUniforms = {
    tColor: { value: null },
    tND: { value: null },
    tHLR: { value: null },
    tAO: { value: null },
    uUseHlr: { value: 1 },
    uUseAo: { value: 1 },
    uUseGradient: { value: 1 },
    uHlrSupersample: { value: new Vector2(1, 1) },
    uBgTop: { value: new Vector3() },
    uBgBottom: { value: new Vector3() },
    uBgFlat: { value: new Vector3() },
    uBgGradT: { value: new Vector2(E3D_GRADIENT_TOP_T, E3D_GRADIENT_BOTTOM_T) },
  };

  private readonly _ndMaterial: ShaderMaterial;
  private readonly _aoMaterial: ShaderMaterial;
  private readonly _blurMaterial: ShaderMaterial;
  private readonly _hlrMaterial: ShaderMaterial;
  private readonly _compositeMaterial: ShaderMaterial;
  private readonly _fxaaMaterial: ShaderMaterial;
  private readonly _fsq: FullScreenQuad;

  private readonly _tmpColor = new Color();

  constructor(renderer: WebGLRenderer, params?: SglLookPipelineParamsInit, options?: SglLookPipelineOptions) {
    this._renderer = renderer;
    const defaults = createDefaultSglPipelineParams();
    this.params = {
      hlr: { ...defaults.hlr, ...(params?.hlr ?? {}) },
      ao: { ...defaults.ao, ...(params?.ao ?? {}) },
      background: { ...defaults.background, ...(params?.background ?? {}) },
      aa: { ...defaults.aa, ...(params?.aa ?? {}) },
      legacyMode: params?.legacyMode ?? defaults.legacyMode,
    };
    this.options = {
      useSceneBackground: options?.useSceneBackground ?? false,
      normalDepthSource: options?.normalDepthSource ?? 'override',
      extraSceneBounds: options?.extraSceneBounds ?? (() => null),
    };

    // 线性深度按模型单位存，mm 级模型轻松过 65504 → 有浮点色附件就用 32 位
    const canFloat = renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
    this._ndType = canFloat ? FloatType : HalfFloatType;

    const dpr = renderer.getPixelRatio();
    const w = Math.round(this._size.x * dpr);
    const h = Math.round(this._size.y * dpr);
    this._colorSamples = this._wantedColorSamples();
    this._colorRT = makeRT(w, h, UnsignedByteType, LinearFilter, true, this._colorSamples);
    this._ndRT = makeRT(w, h, this._ndType, NearestFilter, true);
    this._aoRT = makeRT(w, h, UnsignedByteType, LinearFilter, false);
    this._blurRTa = makeRT(w, h, UnsignedByteType, LinearFilter, false);
    this._blurRTb = makeRT(w, h, UnsignedByteType, LinearFilter, false);
    this._hlrRT = makeRT(w, h, UnsignedByteType, NearestFilter, false);
    this._compositeRT = makeRT(w, h, UnsignedByteType, LinearFilter, false);

    this._ndMaterial = new ShaderMaterial({
      vertexShader: ND_VERTEX,
      fragmentShader: ND_FRAGMENT,
      blending: NoBlending,
      toneMapped: false,
      uniforms: { uEdgeFlag: { value: 1 } },
    });
    this._ndMaterial.name = 'SglLookNormalDepth';

    const fsqMaterial = (fragmentShader: string, uniforms: Record<string, IUniform>): ShaderMaterial =>
      new ShaderMaterial({
        vertexShader: FSQ_VERTEX,
        fragmentShader,
        blending: NoBlending,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        uniforms,
      });

    this._aoMaterial = fsqMaterial(AO_FRAGMENT, this._aoUniforms as unknown as Record<string, IUniform>);
    this._blurMaterial = fsqMaterial(BLUR_FRAGMENT, this._blurUniforms as unknown as Record<string, IUniform>);
    this._hlrMaterial = fsqMaterial(HLR_FRAGMENT, this._hlrUniforms as unknown as Record<string, IUniform>);
    this._compositeMaterial = fsqMaterial(COMPOSITE_FRAGMENT, this._compositeUniforms as unknown as Record<string, IUniform>);
    // FXAA 3.11（three 的 FXAAShader 移植版；sglDx11 3.1 用的也是 FXAA 3.11，参数 gQualitySubPix / EdgeThreshold / EdgeThresholdMin）
    this._fxaaMaterial = new ShaderMaterial({
      vertexShader: FXAAShader.vertexShader,
      fragmentShader: FXAAShader.fragmentShader,
      uniforms: UniformsUtils.clone(FXAAShader.uniforms),
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this._fxaaMaterial.name = 'SglLookFxaa';

    this._fsq = new FullScreenQuad(this._compositeMaterial);
  }

  /** 以 CSS 像素给尺寸；内部按 renderer 的 pixelRatio 放大 */
  setSize(width: number, height: number): void {
    this._size.set(Math.max(1, width), Math.max(1, height));
    this._ensureTargets();
  }

  /** 颜色通道要的 MSAA 采样数：'msaa' 模式下取 params.aa.samples（截到设备上限），其余 0 */
  private _wantedColorSamples(): number {
    if (this.params.aa.mode !== 'msaa') return 0;
    const max = this._renderer.capabilities.maxSamples ?? 0;
    const want = Math.max(1, Math.min(8, Math.round(this.params.aa.samples)));
    const s = Math.min(want, max);
    return s > 1 ? s : 0;
  }

  /**
   * 按当前尺寸 / 抗锯齿参数整理各目标：颜色 RT 的 MSAA 采样数变了就重建；
   * 法线/深度与 HLR 通道按 HLR 采样档位超采样（kx×ky）；AO 目标按 halfRes。尺寸没变时 setSize 是空操作。
   */
  private _ensureTargets(): void {
    const dpr = this._renderer.getPixelRatio();
    const w = Math.round(this._size.x * dpr);
    const h = Math.round(this._size.y * dpr);
    const samples = this._wantedColorSamples();
    if (samples !== this._colorSamples) {
      this._colorRT.dispose();
      this._colorRT = makeRT(w, h, UnsignedByteType, LinearFilter, true, samples);
      this._colorSamples = samples;
    } else {
      this._colorRT.setSize(w, h);
    }
    sglHlrSupersampleGrid(sglHlrSamplesFor(this.params), this._hlrSupersample);
    this._ndRT.setSize(w * this._hlrSupersample.x, h * this._hlrSupersample.y);
    this._hlrRT.setSize(w * this._hlrSupersample.x, h * this._hlrSupersample.y);
    this._compositeRT.setSize(w, h);
    const aw = this.params.ao.halfRes ? Math.max(1, Math.round(w / 2)) : w;
    const ah = this.params.ao.halfRes ? Math.max(1, Math.round(h / 2)) : h;
    this._aoRT.setSize(aw, ah);
    this._blurRTa.setSize(aw, ah);
    this._blurRTb.setSize(aw, ah);
  }

  /**
   * 清法线/深度目标：颜色附件写 (0,0,0,1e18)，深度附件清 1。
   * 目标已由 setRenderTarget 绑定；浮点附件用 clearBufferfv 才能写进 > 1 的哨兵（WebGL1 没有它时退回 clear 到 0 —— 那时 sglIsBackground 判不出，
   * 但本管线本来就要求 WebGL2）。
   */
  private _clearNormalDepth(): void {
    const gl = this._renderer.getContext() as WebGL2RenderingContext;
    if (typeof gl.clearBufferfv === 'function') {
      gl.clearBufferfv(gl.COLOR, 0, this._ndClear);
      this._renderer.clear(false, true, false);
    } else {
      this._renderer.clear(true, true, false);
    }
  }

  /** 颜色通道实际用的 MSAA 采样数（0 = 无；设备上限见 renderer.capabilities.maxSamples） */
  get colorSamples(): number {
    return this._colorSamples;
  }

  /** HLR 通道实际用的超采样倍数 (kx, ky)，kx·ky = HLR 采样档位 */
  get hlrSupersample(): Vector2 {
    return this._hlrSupersample.clone();
  }

  /** 画一帧到 target（null = 屏幕） */
  render(scene: Scene, camera: Camera, target: WebGLRenderTarget | null = null): void {
    const renderer = this._renderer;
    const p = this.params;
    const effectsOn = !p.legacyMode;
    const useAo = effectsOn && p.ao.enabled;
    const useHlr = effectsOn && p.hlr.enabled;
    const useGradient = effectsOn && p.background.gradient;
    const useFxaa = p.aa.mode === 'fxaa';

    // 目标尺寸 / MSAA 采样数 / HLR 超采样随参数变（尺寸没变时是空操作）
    this._ensureTargets();
    const w = this._colorRT.width;
    const h = this._colorRT.height;
    const aw = this._aoRT.width;
    const ah = this._aoRT.height;
    const ss = this._hlrSupersample;

    const prevTarget = renderer.getRenderTarget();
    const prevClearColor = renderer.getClearColor(this._tmpColor).clone();
    const prevClearAlpha = renderer.getClearAlpha();
    const prevAutoClear = renderer.autoClear;
    const prevOverride: Material | null = scene.overrideMaterial;
    const prevBackground = scene.background;

    renderer.autoClear = false;
    // 法线/深度通道绝不画背景（背景像素要留深度 0）
    scene.background = null;

    // ② 面法线 + 线性深度（背景深度 = 哨兵 1e18，同 sglDx11）
    this._collectRenderables(scene, useAo && p.ao.blurSharpnessAuto);
    const source = this.options.normalDepthSource;
    renderer.setRenderTarget(this._ndRT);
    renderer.setClearColor(0x000000, 0);
    this._clearNormalDepth();
    if (source !== 'providers') {
      // 普通 Mesh 走 overrideMaterial；provider 网格与线/点/精灵先藏起来。
      // 「参与边线」标记是 overrideMaterial 的 uniform，所以参与 / 不参与的 Mesh 分两趟画（共用深度缓冲，遮挡关系不变）
      for (const r of this._renderables) {
        if (r.visible && (r.isProviderMesh || !r.isMesh || !r.edgeParticipant)) r.object.visible = false;
      }
      scene.overrideMaterial = this._ndMaterial;
      this._ndMaterial.uniforms.uEdgeFlag!.value = 1;
      renderer.render(scene, camera);
      if (this._hasNonParticipantMesh) {
        for (const r of this._renderables) {
          r.object.visible = r.visible && r.isMesh && !r.isProviderMesh && !r.edgeParticipant;
        }
        this._ndMaterial.uniforms.uEdgeFlag!.value = SGL_EDGE_FLAG_OFF_SCALE;
        renderer.render(scene, camera);
        this._ndMaterial.uniforms.uEdgeFlag!.value = 1;
      }
      scene.overrideMaterial = prevOverride;
      for (const r of this._renderables) r.object.visible = r.visible;
    }
    if (source !== 'override' && this._providerMaterials.size > 0) {
      // provider 网格自己输出法线/深度；其它可渲染对象全部藏起来
      for (const r of this._renderables) {
        if (r.visible && !r.isProviderMesh) r.object.visible = false;
      }
      for (const m of this._providerMaterials) m.setSglNormalDepthOutput(true);
      renderer.render(scene, camera);
      for (const m of this._providerMaterials) m.setSglNormalDepthOutput(false);
      for (const r of this._renderables) r.object.visible = r.visible;
    }

    // ① 正常着色（自绘背景时清透明，合成用 alpha 与渐变混；沿用场景背景时由 three 画背景）
    scene.background = this.options.useSceneBackground ? prevBackground : null;
    renderer.setRenderTarget(this._colorRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    scene.background = null;

    // ③④ HBAO + 模糊
    let aoTexture: Texture | null = null;
    if (useAo) {
      this._updateCameraUniforms(camera, aw, ah);
      const u = this._aoUniforms;
      u.tND.value = this._ndRT.texture;
      u.uR.value = p.ao.radius;
      u.uInvSqrR.value = 1 / Math.max(1e-6, p.ao.radius * p.ao.radius);
      u.uNumDirs.value = Math.max(1, Math.min(32, Math.round(p.ao.numDirs)));
      u.uNumSteps.value = Math.max(1, Math.min(32, Math.round(p.ao.numSteps)));
      u.uAngleBias.value = p.ao.angleBias;
      u.uAttenuation.value = p.ao.attenuation;
      u.uContrast.value = p.ao.contrast;
      this._fsq.material = this._aoMaterial;
      renderer.setRenderTarget(this._aoRT);
      this._fsq.render(renderer);

      aoTexture = this._aoRT.texture;
      const radius = Math.max(0, Math.min(16, Math.round(p.ao.blurRadius)));
      if (radius > 0) {
        const bu = this._blurUniforms;
        bu.tND.value = this._ndRT.texture;
        bu.uRadius.value = radius;
        bu.uFalloff.value = sglBlurFalloffForRadius(radius);
        bu.uSharpness.value = p.ao.blurSharpnessAuto ? this._autoBlurSharpness(camera) : p.ao.blurSharpness;
        this._fsq.material = this._blurMaterial;

        bu.tSource.value = this._aoRT.texture;
        bu.uStep.value.set(1 / aw, 0);
        renderer.setRenderTarget(this._blurRTa);
        this._fsq.render(renderer);

        bu.tSource.value = this._blurRTa.texture;
        bu.uStep.value.set(0, 1 / ah);
        renderer.setRenderTarget(this._blurRTb);
        this._fsq.render(renderer);
        aoTexture = this._blurRTb.texture;
      }
    }

    // ⑤ HLR（在 kx×ky 倍分辨率上跑，邻居距离仍是 1 个屏幕像素）
    if (useHlr) {
      const u = this._hlrUniforms;
      u.tND.value = this._ndRT.texture;
      u.uInvResolution.value.set(1 / this._ndRT.width, 1 / this._ndRT.height);
      u.uRadiusPx.value = Math.max(1, p.hlr.radiusPx);
      u.uSupersample.value.copy(ss);
      u.uDepthThreshold.value = p.hlr.depthThreshold;
      u.uNormalThreshold.value = p.hlr.normalThreshold;
      u.uGradientDotThreshold.value = p.hlr.gradientDotThreshold;
      u.uGradientStep.value = p.hlr.gradientStep;
      setSrgb(u.uEdgeColor.value, p.hlr.edgeColor);
      this._fsq.material = this._hlrMaterial;
      renderer.setRenderTarget(this._hlrRT);
      this._fsq.render(renderer);
    }

    // ⑥ 合成（HLR 子像素取平均 = sglDx11 MSAA 版 HLR 的 Σ/N）；FXAA 时先落中间目标
    const cu = this._compositeUniforms;
    cu.tColor.value = this._colorRT.texture;
    cu.tND.value = this._ndRT.texture;
    cu.tHLR.value = useHlr ? this._hlrRT.texture : null;
    cu.tAO.value = aoTexture;
    cu.uUseHlr.value = useHlr ? 1 : 0;
    cu.uUseAo.value = useAo && aoTexture ? 1 : 0;
    cu.uUseGradient.value = useGradient ? 1 : 0;
    cu.uHlrSupersample.value.copy(ss);
    setSrgb(cu.uBgTop.value, p.background.top);
    setSrgb(cu.uBgBottom.value, p.background.bottom);
    setSrgb(cu.uBgFlat.value, p.background.flat);
    cu.uBgGradT.value.set(p.background.gradientTopT, p.background.gradientBottomT);
    this._fsq.material = this._compositeMaterial;
    if (useFxaa) {
      renderer.setRenderTarget(this._compositeRT);
      this._fsq.render(renderer);
      // ⑦ FXAA（3.1 的可选后处理，与 MSAA 互斥；开着时 HLR 档位已是 1）
      const fu = this._fxaaMaterial.uniforms;
      fu.tDiffuse!.value = this._compositeRT.texture;
      (fu.resolution!.value as Vector2).set(1 / w, 1 / h);
      this._fsq.material = this._fxaaMaterial;
    }
    renderer.setRenderTarget(target);
    if (target) renderer.clear(true, true, false);
    this._fsq.render(renderer);

    // 还原
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClearColor, prevClearAlpha);
    renderer.autoClear = prevAutoClear;
    scene.background = prevBackground;
  }

  /** 中间结果，供调试面板看 */
  get debugTextures(): { color: Texture; normalDepth: Texture; ao: Texture; aoBlurred: Texture; hlr: Texture } {
    return {
      color: this._colorRT.texture,
      normalDepth: this._ndRT.texture,
      ao: this._aoRT.texture,
      aoBlurred: this._blurRTb.texture,
      hlr: this._hlrRT.texture,
    };
  }

  /** 线性深度附件的实际类型（FloatType 或退化的 HalfFloatType） */
  get normalDepthType(): TextureDataType {
    return this._ndType;
  }

  /** 最近一次按 E3D 口径算出的本帧线性深度范围（模型单位；还没算出来过为 null） */
  get lastDepthRange(): number | null {
    return this._lastDepthRange;
  }

  /** 最近一次实际用在模糊里的深度锐度（`blurSharpnessAuto` 开着时 = 16 / (depthRange / 2)） */
  get lastBlurSharpness(): number | null {
    return this._lastBlurSharpness;
  }

  /**
   * E3D 3.1 `Blur_slot4` 的每帧锐度：本帧几何在眼空间的线性深度范围 → 16 / (range / 2)。
   * 范围来自 `_collectRenderables` 累的 Mesh 包围盒 ∪ `extraSceneBounds`；相机后方的部分截到 near；
   * 算不出（没有包围盒 / 范围 ≤ 0.002）时沿用上一帧，再没有就用 params.ao.blurSharpness。
   */
  private _autoBlurSharpness(camera: Camera): number {
    const extra = this.options.extraSceneBounds(this._tmpBox.makeEmpty());
    if (extra && !extra.isEmpty()) this._frameBounds.union(extra);
    if (!this._frameBounds.isEmpty()) {
      eyeDepthRangeOfBox(this._frameBounds, camera.matrixWorldInverse, this._tmpRange);
      const near = (camera as PerspectiveCamera).near ?? 0;
      const min = Math.max(this._tmpRange.x, near > 0 ? near : 0);
      const range = this._tmpRange.y - min;
      const sharpness = e3dBlurSharpnessForDepthRange(range);
      if (sharpness !== null) {
        this._lastDepthRange = range;
        this._lastBlurSharpness = sharpness;
      }
    }
    if (this._lastBlurSharpness === null) this._lastBlurSharpness = this.params.ao.blurSharpness;
    return this._lastBlurSharpness;
  }

  dispose(): void {
    for (const rt of [this._colorRT, this._ndRT, this._aoRT, this._blurRTa, this._blurRTb, this._hlrRT, this._compositeRT]) rt.dispose();
    for (const m of [this._ndMaterial, this._aoMaterial, this._blurMaterial, this._hlrMaterial, this._compositeMaterial, this._fxaaMaterial]) m.dispose();
    this._fsq.dispose();
  }

  /**
   * 一次遍历：记下所有可渲染对象的可见性，找出实现了 SglNormalDepthProvider 的材质；
   * collectBounds 时顺带把普通 Mesh 的 world 包围盒并进 _frameBounds（provider 网格的几何在纹理里，包围盒靠 extraSceneBounds）
   */
  private _collectRenderables(scene: Scene, collectBounds = false): void {
    this._renderables.length = 0;
    this._providerMaterials.clear();
    this._frameBounds.makeEmpty();
    this._hasNonParticipantMesh = false;
    const hlr = this.params.hlr;
    scene.traverseVisible((object) => {
      const anyObj = object as Object3D & {
        isMesh?: boolean;
        isLine?: boolean;
        isPoints?: boolean;
        isSprite?: boolean;
        isInstancedMesh?: boolean;
        material?: Material | Material[];
        geometry?: BufferGeometry;
      };
      const isMesh = anyObj.isMesh === true;
      if (!isMesh && !anyObj.isLine && !anyObj.isPoints && !anyObj.isSprite) return;
      let isProviderMesh = false;
      let translucent = false;
      if (isMesh && anyObj.material) {
        const mats = Array.isArray(anyObj.material) ? anyObj.material : [anyObj.material];
        for (const m of mats) {
          if (isSglNormalDepthProvider(m)) {
            isProviderMesh = true;
            this._providerMaterials.add(m);
            translucent = translucent || (m.sglIsTranslucentPass ?? m.transparent);
          } else {
            translucent = translucent || m.transparent;
          }
        }
      }
      // 这一帧参与 HLR 边线吗（sglDx11 法线纹理 .w bit0）：辅助对象看 handleEdges，半透明看 translucentEdges
      const edgeParticipant = !isMesh || sglEdgeParticipationFor(hlr, object, translucent);
      if (isMesh && !edgeParticipant && !isProviderMesh) this._hasNonParticipantMesh = true;
      if (isProviderMesh && anyObj.material) {
        const mats = Array.isArray(anyObj.material) ? anyObj.material : [anyObj.material];
        for (const m of mats) {
          if (isSglNormalDepthProvider(m)) m.setSglEdgeParticipation?.(edgeParticipant);
        }
      }
      if (collectBounds && isMesh && !isProviderMesh) {
        let local: Box3 | null = null;
        if (anyObj.isInstancedMesh) {
          const im = anyObj as unknown as InstancedMesh;
          if (!im.boundingBox) im.computeBoundingBox();
          local = im.boundingBox;
        } else if (anyObj.geometry) {
          if (!anyObj.geometry.boundingBox) anyObj.geometry.computeBoundingBox();
          local = anyObj.geometry.boundingBox;
        }
        if (local && !local.isEmpty()) {
          this._frameBounds.union(this._tmpBox.copy(local).applyMatrix4(object.matrixWorld));
        }
      }
      this._renderables.push({ object, visible: object.visible, isProviderMesh, isMesh, edgeParticipant });
    });
  }

  private _updateCameraUniforms(camera: Camera, w: number, h: number): void {
    const u = this._aoUniforms;
    const e = camera.projectionMatrix.elements;
    const p00 = e[0] ?? 1;
    const p11 = e[5] ?? 1;
    const isPerspective = (camera as PerspectiveCamera).isPerspectiveCamera === true;
    u.uResolution.value.set(w, h);
    u.uInvResolution.value.set(1 / w, 1 / h);
    u.uFocalLen.value.set(p00, p11);
    u.uInvFocalLen.value.set(1 / p00, 1 / p11);
    u.uOrthoOffset.value.set(e[12] ?? 0, e[13] ?? 0);
    u.uIsPerspective.value = isPerspective ? 1 : 0;
  }
}

export const SGL_PIPELINE_SHADERS = Object.freeze({
  normalDepthVertex: ND_VERTEX,
  normalDepthFragment: ND_FRAGMENT,
  ao: AO_FRAGMENT,
  blur: BLUR_FRAGMENT,
  hlr: HLR_FRAGMENT,
  composite: COMPOSITE_FRAGMENT,
});
