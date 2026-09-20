/**
 * SglLookPipeline —— 复刻 AVEVA E3D（SGL DX11 后端）的后处理链：
 *
 *   ① 场景一趟正常着色（SglLookMaterial）→ colorRT
 *   ② 场景一趟 overrideMaterial → ndRT：rgb = 眼空间「面」法线（位置导数叉乘，同 sglDx11 MRT1），a = 线性深度（背景 = 0）
 *   ③ HBAO（NVIDIA 同款参数：R / NumDirs / NumSteps / AngleBias / Attenuation / Contrast，法线模式）→ aoRT
 *   ④ 双边模糊 X/Y（BlurRadius / BlurFalloff / Sharpness）
 *   ⑤ HLR 边线：中心比邻居远 > 深度阈值（sglDx11 默认 50）或法线 |cos| < 0.6 → 边
 *   ⑥ 合成 final = colour × HLR × AO；背景处填纵向渐变（effect_bg_gradient）
 *
 * `legacyMode` 对应 SGL 的 `Sgl_View_Effects_Parameters::_legacy_mode`：一把关掉所有效果。
 * 参数默认值里带「E3D」注释的来自逆向；其余（AO 半径等）是逆向还没拿到的，先给合理值并暴露成可调。
 */

import {
  Camera,
  Color,
  FloatType,
  HalfFloatType,
  type IUniform,
  LinearFilter,
  type MagnificationTextureFilter,
  Material,
  type MinificationTextureFilter,
  NearestFilter,
  NoBlending,
  Object3D,
  PerspectiveCamera,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Texture,
  type TextureDataType,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

export interface SglHlrParams {
  /** SGL_ENHANCED_EDGES（E3D 默认 ON） */
  enabled: boolean;
  /** 深度差阈值，模型单位（sglDx11 HLR ps 里的常量 50，E3D 单位 mm） */
  depthThreshold: number;
  /** 法线夹角阈值：|cos| < 该值判边（sglDx11 常量 0.6） */
  normalThreshold: number;
  /** 采样半径（像素），对应 sglDx11 的 4 档质量 */
  radiusPx: number;
  /** 边线颜色（与颜色相乘；黑 = 纯黑线） */
  edgeColor: Color;
}

export interface SglAoParams {
  /** SGL_PSEUDO_SHADOWS（E3D 叫「伪阴影」，默认 ON） */
  enabled: boolean;
  /** g_R：采样半径，模型单位 */
  radius: number;
  /** g_NumDir */
  numDirs: number;
  /** g_NumSteps */
  numSteps: number;
  /** g_AngleBias（弧度） */
  angleBias: number;
  /** g_Attenuation */
  attenuation: number;
  /** g_Contrast */
  contrast: number;
  /** g_BlurRadius（像素） */
  blurRadius: number;
  /** g_Sharpness：深度权重 exp(-(dz·sharpness)²)，模型单位的倒数 */
  blurSharpness: number;
  /** 半分辨率算 AO（省时间；E3D 未知） */
  halfRes: boolean;
}

export interface SglBackgroundParams {
  /** SGL_BACKGROUND_GRADIENT（E3D 默认 ON） */
  gradient: boolean;
  /** 渐变顶部色 */
  top: Color;
  /** 渐变底部色 */
  bottom: Color;
  /** 关掉渐变时的纯色背景 */
  flat: Color;
}

export interface SglLookPipelineParams {
  hlr: SglHlrParams;
  ao: SglAoParams;
  background: SglBackgroundParams;
  /** Sgl_View_Effects_Parameters::_legacy_mode：全部效果关闭 */
  legacyMode: boolean;
}

/** 构造时可只给部分字段，其余用默认 */
export interface SglLookPipelineParamsInit {
  hlr?: Partial<SglHlrParams>;
  ao?: Partial<SglAoParams>;
  background?: Partial<SglBackgroundParams>;
  legacyMode?: boolean;
}

/**
 * 自己能输出「眼空间面法线 + 线性深度」的材质（如 DTXMaterial：顶点来自纹理，没法用 overrideMaterial）。
 * 管线在法线/深度通道前调 `setSglNormalDepthOutput(true)`，画完调 `false`。
 */
export interface SglNormalDepthProvider {
  setSglNormalDepthOutput(enabled: boolean): void;
}

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
}

export function createDefaultSglPipelineParams(): SglLookPipelineParams {
  return {
    hlr: {
      enabled: true,
      depthThreshold: 50,
      normalThreshold: 0.6,
      radiusPx: 1,
      edgeColor: new Color(0x000000),
    },
    ao: {
      enabled: true,
      radius: 400,
      numDirs: 8,
      numSteps: 6,
      angleBias: 0.1,
      attenuation: 1.0,
      contrast: 1.25,
      blurRadius: 4,
      blurSharpness: 0.01,
      halfRes: false,
    },
    background: {
      gradient: true,
      top: new Color(0x2b4a6e),
      bottom: new Color(0xa9bccf),
      flat: new Color(0x8c9cad),
    },
    legacyMode: false,
  };
}

// ---------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------

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
void main() {
  vec3 n = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
  gl_FragColor = vec4(n, -vViewPos.z);
}
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
  if (depth <= 0.0) { gl_FragColor = vec4(1.0); return; }
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
      if (ndS.a <= 0.0) continue;
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

void main() {
  float centerDepth = texture2D(tND, vUv).a;
  if (centerDepth <= 0.0) { gl_FragColor = vec4(1.0); return; }
  float total = 0.0;
  float wsum = 0.0;
  for (int i = -16; i <= 16; i++) {
    float fi = float(i);
    if (abs(fi) > uRadius) continue;
    vec2 uvS = vUv + uStep * fi;
    float d = texture2D(tND, uvS).a;
    if (d <= 0.0) continue;
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
 * HLR：按 sglDx11 dxbc_045 的三条判据 ——
 *   ① 轮廓：邻居是背景（深度 0）→ 几何一侧画线；
 *   ② 深度台阶：沿 x / y 两轴取左右邻居做二阶差分 (dR − d) − (d − dL)。
 *      sglDx11 用归一化后的 (Δ像素, Δ深度) 向量点积 < 0.9999 判「梯度方向变了」，并只在
 *      「中心比邻居远 > 50」的一侧画（lt 50 < center − neighbour）。这里等价地取 d2 < −阈值：
 *      中心落在远侧的台阶才画线；平坦表面无论多倾斜二阶差分都≈0，不会整片变黑；
 *   ③ 法线折痕：|N·N'| < 0.6（盒子这类 90° 折边由它负责）。
 */
const HLR_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tND;
uniform vec2 uInvResolution;
uniform float uRadiusPx;
uniform float uDepthThreshold;
uniform float uNormalThreshold;
uniform vec3 uEdgeColor;
varying vec2 vUv;

bool creaseAlong(vec4 c, vec2 offs) {
  vec4 a = texture2D(tND, vUv - offs);
  vec4 b = texture2D(tND, vUv + offs);
  // ① 任一侧是背景 → 轮廓
  if (a.a <= 0.0 || b.a <= 0.0) return true;
  // ② 二阶深度差分：d2 < 0 说明中心在台阶的远侧（sglDx11 只在远侧画）
  float d2 = (b.a - c.a) - (c.a - a.a);
  if (d2 < -uDepthThreshold) return true;
  // ③ 法线折痕
  vec3 n = normalize(c.rgb);
  if (abs(dot(n, normalize(a.rgb))) < uNormalThreshold) return true;
  if (abs(dot(n, normalize(b.rgb))) < uNormalThreshold) return true;
  return false;
}

void main() {
  vec4 c = texture2D(tND, vUv);
  if (c.a <= 0.0) { gl_FragColor = vec4(1.0); return; }
  vec2 r = uInvResolution * uRadiusPx;
  bool edge = creaseAlong(c, vec2(r.x, 0.0)) || creaseAlong(c, vec2(0.0, r.y));
  gl_FragColor = edge ? vec4(uEdgeColor, 1.0) : vec4(1.0);
}
`;

/** 合成：colour × HLR × AO，背景处填渐变 */
const COMPOSITE_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tND;
uniform sampler2D tHLR;
uniform sampler2D tAO;
uniform float uUseHlr;
uniform float uUseAo;
uniform float uUseGradient;
uniform vec3 uBgTop;
uniform vec3 uBgBottom;
uniform vec3 uBgFlat;
varying vec2 vUv;

void main() {
  vec4 c = texture2D(tColor, vUv);
  vec3 bg = (uUseGradient > 0.5) ? mix(uBgBottom, uBgTop, vUv.y) : uBgFlat;
  vec3 col = mix(bg, c.rgb, c.a);
  vec3 hlr = (uUseHlr > 0.5) ? texture2D(tHLR, vUv).rgb : vec3(1.0);
  float ao = (uUseAo > 0.5) ? texture2D(tAO, vUv).r : 1.0;
  gl_FragColor = vec4(col * hlr * ao, 1.0);
}
`;

// ---------------------------------------------------------------------------

type RtFilter = MinificationTextureFilter & MagnificationTextureFilter;

function makeRT(w: number, h: number, type: TextureDataType, filter: RtFilter, depthBuffer: boolean): WebGLRenderTarget {
  return new WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type,
    format: RGBAFormat,
    minFilter: filter,
    magFilter: filter,
    depthBuffer,
    stencilBuffer: false,
    generateMipmaps: false,
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
  uDepthThreshold: IUniform<number>;
  uNormalThreshold: IUniform<number>;
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
  uBgTop: IUniform<Vector3>;
  uBgBottom: IUniform<Vector3>;
  uBgFlat: IUniform<Vector3>;
}

interface RenderableRecord {
  object: Object3D;
  visible: boolean;
  isProviderMesh: boolean;
  isMesh: boolean;
}

export class SglLookPipeline {
  readonly params: SglLookPipelineParams;
  readonly options: Required<SglLookPipelineOptions>;

  private readonly _renderer: WebGLRenderer;
  private readonly _size = new Vector2(1, 1);
  private readonly _ndType: TextureDataType;
  private readonly _renderables: RenderableRecord[] = [];
  private readonly _providerMaterials = new Set<Material & SglNormalDepthProvider>();

  private _colorRT: WebGLRenderTarget;
  private _ndRT: WebGLRenderTarget;
  private _aoRT: WebGLRenderTarget;
  private _blurRTa: WebGLRenderTarget;
  private _blurRTb: WebGLRenderTarget;
  private _hlrRT: WebGLRenderTarget;

  private readonly _aoUniforms: AoUniforms = {
    tND: { value: null },
    uResolution: { value: new Vector2(1, 1) },
    uInvResolution: { value: new Vector2(1, 1) },
    uFocalLen: { value: new Vector2(1, 1) },
    uInvFocalLen: { value: new Vector2(1, 1) },
    uOrthoOffset: { value: new Vector2(0, 0) },
    uIsPerspective: { value: 1 },
    uR: { value: 1 },
    uInvSqrR: { value: 1 },
    uNumDirs: { value: 8 },
    uNumSteps: { value: 6 },
    uAngleBias: { value: 0.1 },
    uAttenuation: { value: 1 },
    uContrast: { value: 1.25 },
  };

  private readonly _blurUniforms: BlurUniforms = {
    tSource: { value: null },
    tND: { value: null },
    uStep: { value: new Vector2(0, 0) },
    uRadius: { value: 4 },
    uFalloff: { value: 0.1 },
    uSharpness: { value: 0.01 },
  };

  private readonly _hlrUniforms: HlrUniforms = {
    tND: { value: null },
    uInvResolution: { value: new Vector2(1, 1) },
    uRadiusPx: { value: 1 },
    uDepthThreshold: { value: 50 },
    uNormalThreshold: { value: 0.6 },
    uEdgeColor: { value: new Vector3(0, 0, 0) },
  };

  private readonly _compositeUniforms: CompositeUniforms = {
    tColor: { value: null },
    tND: { value: null },
    tHLR: { value: null },
    tAO: { value: null },
    uUseHlr: { value: 1 },
    uUseAo: { value: 1 },
    uUseGradient: { value: 1 },
    uBgTop: { value: new Vector3() },
    uBgBottom: { value: new Vector3() },
    uBgFlat: { value: new Vector3() },
  };

  private readonly _ndMaterial: ShaderMaterial;
  private readonly _aoMaterial: ShaderMaterial;
  private readonly _blurMaterial: ShaderMaterial;
  private readonly _hlrMaterial: ShaderMaterial;
  private readonly _compositeMaterial: ShaderMaterial;
  private readonly _fsq: FullScreenQuad;

  private readonly _tmpColor = new Color();

  constructor(renderer: WebGLRenderer, params?: SglLookPipelineParamsInit, options?: SglLookPipelineOptions) {
    this._renderer = renderer;
    const defaults = createDefaultSglPipelineParams();
    this.params = {
      hlr: { ...defaults.hlr, ...(params?.hlr ?? {}) },
      ao: { ...defaults.ao, ...(params?.ao ?? {}) },
      background: { ...defaults.background, ...(params?.background ?? {}) },
      legacyMode: params?.legacyMode ?? defaults.legacyMode,
    };
    this.options = {
      useSceneBackground: options?.useSceneBackground ?? false,
      normalDepthSource: options?.normalDepthSource ?? 'override',
    };

    // 线性深度按模型单位存，mm 级模型轻松过 65504 → 有浮点色附件就用 32 位
    const canFloat = renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
    this._ndType = canFloat ? FloatType : HalfFloatType;

    const dpr = renderer.getPixelRatio();
    const w = Math.round(this._size.x * dpr);
    const h = Math.round(this._size.y * dpr);
    this._colorRT = makeRT(w, h, UnsignedByteType, LinearFilter, true);
    this._ndRT = makeRT(w, h, this._ndType, NearestFilter, true);
    this._aoRT = makeRT(w, h, UnsignedByteType, LinearFilter, false);
    this._blurRTa = makeRT(w, h, UnsignedByteType, LinearFilter, false);
    this._blurRTb = makeRT(w, h, UnsignedByteType, LinearFilter, false);
    this._hlrRT = makeRT(w, h, UnsignedByteType, NearestFilter, false);

    this._ndMaterial = new ShaderMaterial({
      vertexShader: ND_VERTEX,
      fragmentShader: ND_FRAGMENT,
      blending: NoBlending,
      toneMapped: false,
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

    this._fsq = new FullScreenQuad(this._compositeMaterial);
  }

  /** 以 CSS 像素给尺寸；内部按 renderer 的 pixelRatio 放大 */
  setSize(width: number, height: number): void {
    this._size.set(Math.max(1, width), Math.max(1, height));
    const dpr = this._renderer.getPixelRatio();
    const w = Math.round(this._size.x * dpr);
    const h = Math.round(this._size.y * dpr);
    this._colorRT.setSize(w, h);
    this._ndRT.setSize(w, h);
    this._hlrRT.setSize(w, h);
    const aw = this.params.ao.halfRes ? Math.max(1, Math.round(w / 2)) : w;
    const ah = this.params.ao.halfRes ? Math.max(1, Math.round(h / 2)) : h;
    this._aoRT.setSize(aw, ah);
    this._blurRTa.setSize(aw, ah);
    this._blurRTb.setSize(aw, ah);
  }

  /** 画一帧到 target（null = 屏幕） */
  render(scene: Scene, camera: Camera, target: WebGLRenderTarget | null = null): void {
    const renderer = this._renderer;
    const p = this.params;
    const effectsOn = !p.legacyMode;
    const useAo = effectsOn && p.ao.enabled;
    const useHlr = effectsOn && p.hlr.enabled;
    const useGradient = effectsOn && p.background.gradient;

    // AO 目标尺寸随 halfRes 变
    const w = this._colorRT.width;
    const h = this._colorRT.height;
    const aw = p.ao.halfRes ? Math.max(1, Math.round(w / 2)) : w;
    const ah = p.ao.halfRes ? Math.max(1, Math.round(h / 2)) : h;
    if (this._aoRT.width !== aw || this._aoRT.height !== ah) {
      this._aoRT.setSize(aw, ah);
      this._blurRTa.setSize(aw, ah);
      this._blurRTb.setSize(aw, ah);
    }

    const prevTarget = renderer.getRenderTarget();
    const prevClearColor = renderer.getClearColor(this._tmpColor).clone();
    const prevClearAlpha = renderer.getClearAlpha();
    const prevAutoClear = renderer.autoClear;
    const prevOverride: Material | null = scene.overrideMaterial;
    const prevBackground = scene.background;

    renderer.autoClear = false;
    // 法线/深度通道绝不画背景（背景像素要留深度 0）
    scene.background = null;

    // ② 面法线 + 线性深度
    this._collectRenderables(scene);
    const source = this.options.normalDepthSource;
    renderer.setRenderTarget(this._ndRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    if (source !== 'providers') {
      // 普通 Mesh 走 overrideMaterial；provider 网格与线/点/精灵先藏起来
      for (const r of this._renderables) {
        if (r.visible && (r.isProviderMesh || !r.isMesh)) r.object.visible = false;
      }
      scene.overrideMaterial = this._ndMaterial;
      renderer.render(scene, camera);
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
        const sigma = (radius + 1) / 2;
        const bu = this._blurUniforms;
        bu.tND.value = this._ndRT.texture;
        bu.uRadius.value = radius;
        bu.uFalloff.value = 1 / (2 * sigma * sigma);
        bu.uSharpness.value = p.ao.blurSharpness;
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

    // ⑤ HLR
    if (useHlr) {
      const u = this._hlrUniforms;
      u.tND.value = this._ndRT.texture;
      u.uInvResolution.value.set(1 / w, 1 / h);
      u.uRadiusPx.value = Math.max(1, p.hlr.radiusPx);
      u.uDepthThreshold.value = p.hlr.depthThreshold;
      u.uNormalThreshold.value = p.hlr.normalThreshold;
      u.uEdgeColor.value.set(p.hlr.edgeColor.r, p.hlr.edgeColor.g, p.hlr.edgeColor.b);
      this._fsq.material = this._hlrMaterial;
      renderer.setRenderTarget(this._hlrRT);
      this._fsq.render(renderer);
    }

    // ⑥ 合成
    const cu = this._compositeUniforms;
    cu.tColor.value = this._colorRT.texture;
    cu.tND.value = this._ndRT.texture;
    cu.tHLR.value = useHlr ? this._hlrRT.texture : null;
    cu.tAO.value = aoTexture;
    cu.uUseHlr.value = useHlr ? 1 : 0;
    cu.uUseAo.value = useAo && aoTexture ? 1 : 0;
    cu.uUseGradient.value = useGradient ? 1 : 0;
    cu.uBgTop.value.set(p.background.top.r, p.background.top.g, p.background.top.b);
    cu.uBgBottom.value.set(p.background.bottom.r, p.background.bottom.g, p.background.bottom.b);
    cu.uBgFlat.value.set(p.background.flat.r, p.background.flat.g, p.background.flat.b);
    this._fsq.material = this._compositeMaterial;
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

  dispose(): void {
    for (const rt of [this._colorRT, this._ndRT, this._aoRT, this._blurRTa, this._blurRTb, this._hlrRT]) rt.dispose();
    for (const m of [this._ndMaterial, this._aoMaterial, this._blurMaterial, this._hlrMaterial, this._compositeMaterial]) m.dispose();
    this._fsq.dispose();
  }

  /** 一次遍历：记下所有可渲染对象的可见性，并找出实现了 SglNormalDepthProvider 的材质 */
  private _collectRenderables(scene: Scene): void {
    this._renderables.length = 0;
    this._providerMaterials.clear();
    scene.traverseVisible((object) => {
      const anyObj = object as Object3D & { isMesh?: boolean; isLine?: boolean; isPoints?: boolean; isSprite?: boolean; material?: Material | Material[] };
      const isMesh = anyObj.isMesh === true;
      if (!isMesh && !anyObj.isLine && !anyObj.isPoints && !anyObj.isSprite) return;
      let isProviderMesh = false;
      if (isMesh && anyObj.material) {
        const mats = Array.isArray(anyObj.material) ? anyObj.material : [anyObj.material];
        for (const m of mats) {
          if (isSglNormalDepthProvider(m)) {
            isProviderMesh = true;
            this._providerMaterials.add(m);
          }
        }
      }
      this._renderables.push({ object, visible: object.visible, isProviderMesh, isMesh });
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
