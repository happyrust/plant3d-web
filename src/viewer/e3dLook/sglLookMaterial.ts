/**
 * SglLookMaterial —— 复刻 AVEVA E3D（SGL DX11 后端）实体着色的 three.js ShaderMaterial。
 *
 * 公式与默认值来自对 `sglDx11.dll` 的逆向（2026-09-20，DXBC 反汇编 + ida-bridge 反编译，
 * 见 docs/rendering/e3d-sgl-look-prototype.md）：
 *
 *   L = normalize(LampDir)  V = normalize(眼 - p)  N = normalize(n)  H = normalize(V + L)
 *   rgb = colour * (Ka + Kd * max(N·L, 0))
 *       + Ks * pow(max(N·H, 0), Kse) * max(N·L, 0)      // 白色高光，不乘物体色
 *       + Kr * lum(env(reflect(-V, N)))                 // 环境贴图只取灰度
 *   a   = colour.a                                      // 半透明 = 顶点 alpha
 *
 * 单盏「头灯」（LightEyePos 默认 (0,0,1)，眼空间 +Z），无衰减、无阴影、无 gamma/tonemap。
 * 屏幕面法线 + 线性深度那两张 MRT 由 SglLookPipeline 单独一趟画出来。
 */

import {
  Color,
  CubeTexture,
  FrontSide,
  type IUniform,
  SRGBColorSpace,
  ShaderMaterial,
  Vector3,
  Vector4
} from 'three';

/** 对应 sglDx11 `CSglSceneLightParams`（32 字节：Ka Kd slot3 slot4 Kse eye.xyz）。 */
export interface SglSceneLightParams {
  /** Ka：环境项系数 */
  ambient: number;
  /** Kd：漫反射系数 */
  diffuse: number;
  /**
   * HLSL `Ks`（cbuffer 偏移 712）：Blinn-Phong 高光系数，默认 0.3。
   * 上传函数 `sub_1000B970` 把 C++ `Specular`（+12）写到这一槽——C++ 名与 HLSL 名一致，不是 memcpy 交叉。
   */
  specular: number;
  /**
   * HLSL `Kr`（cbuffer 偏移 716）：环境立方体贴图反射系数，默认 0.35。
   * 来自 C++ `Reflection`（+8）；E3D 视图设置「Reflection」滑块（PML 默认 0.8）改的就是它。
   */
  reflection: number;
  /** Kse：高光指数 */
  specularExponent: number;
  /** 灯在眼空间的位置/方向（单位化后即 L） */
  lightEyePos: readonly [number, number, number];
}

/**
 * `CSglSceneLightParams::CSglSceneLightParams()`（sglDx11 3.1 @0x1005a1b0）的常量：
 * {Ambient 0.5, Diffuse 0.8, Reflection 0.35, Specular 0.3, Exponent 64, eye (0,0,1)}，
 * 经 `sub_1000B970` 装进 cbuffer 后 Ks=Specular=0.3、Kr=Reflection=0.35（2026-09-20 第二轮坐实）。
 * 这是 SGL 的 C++ 兜底值；E3D 3.1 的 PML 视图默认（gphviewopt）会再覆盖成
 * brightness 0.7 / colourDepth 0 / reflection 0.8 / mirrorEffect 0 / spotSize 0，见 SGL_E3D31_VIEW_DEFAULT_LIGHT。
 */
export const SGL_DEFAULT_LIGHT: Readonly<SglSceneLightParams> = Object.freeze({
  ambient: 0.5,
  diffuse: 0.8,
  specular: 0.3,
  reflection: 0.35,
  specularExponent: 64,
  lightEyePos: [0, 0, 1] as const,
});

/**
 * `CSglMaterialLightingStrategyList::SetDefaultSceneLightParams(false)` 建出来的 4 套策略，
 * 顶点 ATTRIBFLAGS bits16-23 选用：0/1 = 默认打光，2 = 纯环境 0.7（不打光），3 = 原色（辅助线/文字/手柄）。
 */
export const SGL_LIGHT_STRATEGIES: Readonly<Record<'default' | 'flat70' | 'unlit', Readonly<SglSceneLightParams>>> = Object.freeze({
  default: SGL_DEFAULT_LIGHT,
  flat70: Object.freeze({ ambient: 0.7, diffuse: 0, specular: 0, reflection: 0, specularExponent: 0, lightEyePos: [0, 0, 1] as const }),
  unlit: Object.freeze({ ambient: 1.0, diffuse: 0, specular: 0, reflection: 0, specularExponent: 0, lightEyePos: [0, 0, 1] as const }),
});

/**
 * E3D 3.1 出厂视图设置（`PMLLIB\common\objects\gphviewopt.pmlobj` `.default()`）经
 * VIEW 属性 79..84 → `SGL_set_view_attribute_real(61..68)` 写进策略 1 的值：
 * brightness=Ka 0.7、colourDepth=Kd 0、reflection=Kr 0.8、mirrorEffect=Ks 0、spotSize=Kse 0、torch (0,0,1)。
 * 也就是说未改过设置的 E3D 3.1 视图没有漫反射/高光，全靠 0.7·颜色 + 0.8·环境立方体反射出体积感。
 * （本机那台经修补启动的 E3D 没走这条 PML 路径，实测吻合的是 SGL_DEFAULT_LIGHT。）
 */
export const SGL_E3D31_VIEW_DEFAULT_LIGHT: Readonly<SglSceneLightParams> = Object.freeze({
  ambient: 0.7,
  diffuse: 0,
  specular: 0,
  reflection: 0.8,
  specularExponent: 0,
  lightEyePos: [0, 0, 1] as const,
});

export interface SglLookMaterialOptions {
  /** 元素颜色（PDMS 颜色表查出来的 RGB）；有顶点色/实例色时被覆盖 */
  color?: Color | number | string;
  /** 半透明：E3D 的 0..100 翻成 alpha = 1 - t/100；这里直接给 alpha */
  opacity?: number;
  /** 光照参数，缺省 SGL_DEFAULT_LIGHT */
  light?: Partial<SglSceneLightParams>;
  /** 环境立方体贴图；不给就用解析天空/地面两段灰度 */
  envMap?: CubeTexture | null;
  /** 解析环境：天顶亮度 / 地面亮度（0..1） */
  envSkyLum?: number;
  envGroundLum?: number;
  /** 世界「上」方向，E3D 是 Z-up */
  up?: Vector3;
  /** 是否读顶点色 attribute（`color`，vec3 或 vec4） */
  vertexColors?: boolean;
  /** 是否 alpha 混合（半透明体） */
  transparent?: boolean;
}

const VERTEX_SHADER = /* glsl */ `
uniform vec4 uColor;

varying vec3 vViewPos;
varying vec3 vNormalView;
varying vec4 vColor;

void main() {
  vec3 transformed = position;
  vec3 objectNormal = normal;
  #ifdef USE_INSTANCING
    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(transformed, 1.0);
    vec3 nView = normalMatrix * (mat3(instanceMatrix) * objectNormal);
  #else
    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    vec3 nView = normalMatrix * objectNormal;
  #endif
  vViewPos = mvPosition.xyz;
  vNormalView = nView;

  vec4 c = uColor;
  #if defined(USE_COLOR_ALPHA)
    c = color;
  #elif defined(USE_COLOR)
    c = vec4(color, uColor.a);
  #endif
  #ifdef USE_INSTANCING_COLOR
    c = vec4(instanceColor, c.a);
  #endif
  vColor = c;

  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform float uKa;
uniform float uKd;
uniform float uKs;
uniform float uKr;
uniform float uKse;
uniform vec3 uLampDirEye;
uniform float uOpacity;
uniform samplerCube uEnvMap;
uniform float uUseEnvMap;
uniform float uEnvSkyLum;
uniform float uEnvGroundLum;
uniform vec3 uUp;

varying vec3 vViewPos;
varying vec3 vNormalView;
varying vec4 vColor;

// viewMatrix 的旋转部分转置 = 眼空间 → 世界空间
mat3 viewToWorldRot() {
  mat3 vm = mat3(viewMatrix);
  return mat3(
    vec3(vm[0][0], vm[1][0], vm[2][0]),
    vec3(vm[0][1], vm[1][1], vm[2][1]),
    vec3(vm[0][2], vm[1][2], vm[2][2])
  );
}

void main() {
  vec3 N = normalize(vNormalView);
  #ifdef DOUBLE_SIDED
    if (!gl_FrontFacing) N = -N;
  #endif
  vec3 V = normalize(-vViewPos);
  vec3 L = normalize(uLampDirEye);
  vec3 H = normalize(V + L);

  float ndl = dot(N, L);
  float ndh = dot(N, H);
  // sglDx11 ps: (NdotL>=0 && NdotH>=0) ? pow(NdotH, Kse) * NdotL : 0
  float spec = (ndl >= 0.0 && ndh >= 0.0) ? pow(max(ndh, 1e-6), uKse) * ndl : 0.0;
  ndl = max(ndl, 0.0);

  // 环境反射：只取亮度（sglDx11 对 cube 采样结果 (r+g+b)/3）
  vec3 Rw = viewToWorldRot() * reflect(-V, N);
  float envLum;
  if (uUseEnvMap > 0.5) {
    vec3 e = textureCube(uEnvMap, Rw).rgb;
    envLum = (e.r + e.g + e.b) * (1.0 / 3.0);
  } else {
    float t = clamp(dot(Rw, uUp) * 0.5 + 0.5, 0.0, 1.0);
    envLum = mix(uEnvGroundLum, uEnvSkyLum, t);
  }

  vec3 c = vColor.rgb;
  vec3 rgb = c * (uKa + uKd * ndl) + uKs * spec + uKr * envLum;
  gl_FragColor = vec4(rgb, vColor.a * uOpacity);
}
`;

/** 把 E3D 的半透明百分比（0 = 不透明，100 = 全透）翻成 alpha。 */
export function translucencyToAlpha(translucencyPercent: number): number {
  const t = Math.min(100, Math.max(0, translucencyPercent));
  return 1 - t / 100;
}

/** 与片元/顶点着色器一一对应的 uniform 表（type 别名才能赋给 ShaderMaterial 的索引签名） */
export type SglLookUniforms = {
  uColor: IUniform<Vector4>;
  uKa: IUniform<number>;
  uKd: IUniform<number>;
  uKs: IUniform<number>;
  uKr: IUniform<number>;
  uKse: IUniform<number>;
  uLampDirEye: IUniform<Vector3>;
  uOpacity: IUniform<number>;
  uEnvMap: IUniform<CubeTexture | null>;
  uUseEnvMap: IUniform<number>;
  uEnvSkyLum: IUniform<number>;
  uEnvGroundLum: IUniform<number>;
  uUp: IUniform<Vector3>;
};

const _rgbTmp = { r: 0, g: 0, b: 0 };

/** E3D 颜色表是 sRGB 字节直写；three 的 Color 内部是线性值，取回 sRGB 分量再上传 */
function colorToSrgb(c: Color): { r: number; g: number; b: number } {
  return c.getRGB(_rgbTmp, SRGBColorSpace);
}

function createUniforms(options: SglLookMaterialOptions): SglLookUniforms {
  const light: SglSceneLightParams = { ...SGL_DEFAULT_LIGHT, ...(options.light ?? {}) };
  const color = colorToSrgb(new Color(options.color ?? 0xffffff));
  const up = options.up ?? new Vector3(0, 0, 1);
  return {
    uColor: { value: new Vector4(color.r, color.g, color.b, 1) },
    uKa: { value: light.ambient },
    uKd: { value: light.diffuse },
    uKs: { value: light.specular },
    uKr: { value: light.reflection },
    uKse: { value: light.specularExponent },
    uLampDirEye: { value: new Vector3(...light.lightEyePos) },
    uOpacity: { value: options.opacity ?? 1 },
    uEnvMap: { value: options.envMap ?? null },
    uUseEnvMap: { value: options.envMap ? 1 : 0 },
    uEnvSkyLum: { value: options.envSkyLum ?? 0.75 },
    uEnvGroundLum: { value: options.envGroundLum ?? 0.25 },
    uUp: { value: up.clone() },
  };
}

/** 复刻 SGL 前向实体着色的 ShaderMaterial；uniform 名与 sglDx11 常量一一对应。 */
export class SglLookMaterial extends ShaderMaterial {
  /** 带类型的 uniform 视图（与 `this.uniforms` 是同一个对象） */
  readonly sglUniforms: SglLookUniforms;

  constructor(options: SglLookMaterialOptions = {}) {
    const uniforms = createUniforms(options);
    const translucent = options.transparent ?? (options.opacity ?? 1) < 1;
    super({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms,
      vertexColors: options.vertexColors ?? false,
      transparent: translucent,
      side: FrontSide,
      // E3D 在 8-bit 目标上直接写线性结果，不做 gamma / tonemap
      toneMapped: false,
      depthWrite: !translucent,
    });
    this.sglUniforms = uniforms;
    this.name = 'SglLookMaterial';
  }

  /** 元素颜色（无顶点色 / 实例色时生效）；uniform 里存的是 sRGB 分量 */
  get color(): Color {
    const v = this.sglUniforms.uColor.value;
    return new Color().setRGB(v.x, v.y, v.z, SRGBColorSpace);
  }

  set color(c: Color | number | string) {
    const cc = colorToSrgb(new Color(c));
    const v = this.sglUniforms.uColor.value;
    v.set(cc.r, cc.g, cc.b, v.w);
  }

  /** 半透明 alpha（1 = 不透明） */
  get sglOpacity(): number {
    return this.sglUniforms.uOpacity.value;
  }

  set sglOpacity(a: number) {
    this.sglUniforms.uOpacity.value = a;
    const translucent = a < 1;
    if (translucent !== this.transparent) {
      this.transparent = translucent;
      this.depthWrite = !translucent;
      this.needsUpdate = true;
    }
  }

  /** 一次性写入一套光照策略（Ka/Kd/Ks/Kr/Kse/LampDir） */
  setLight(light: Partial<SglSceneLightParams>): this {
    const u = this.sglUniforms;
    if (light.ambient !== undefined) u.uKa.value = light.ambient;
    if (light.diffuse !== undefined) u.uKd.value = light.diffuse;
    if (light.specular !== undefined) u.uKs.value = light.specular;
    if (light.reflection !== undefined) u.uKr.value = light.reflection;
    if (light.specularExponent !== undefined) u.uKse.value = light.specularExponent;
    if (light.lightEyePos) u.uLampDirEye.value.set(...light.lightEyePos);
    return this;
  }

  getLight(): SglSceneLightParams {
    const u = this.sglUniforms;
    const d = u.uLampDirEye.value;
    return {
      ambient: u.uKa.value,
      diffuse: u.uKd.value,
      specular: u.uKs.value,
      reflection: u.uKr.value,
      specularExponent: u.uKse.value,
      lightEyePos: [d.x, d.y, d.z],
    };
  }

  setEnvMap(envMap: CubeTexture | null): this {
    this.sglUniforms.uEnvMap.value = envMap;
    this.sglUniforms.uUseEnvMap.value = envMap ? 1 : 0;
    return this;
  }

  /** 解析环境（无 cube 贴图时）的天 / 地亮度 */
  setAnalyticEnv(skyLum: number, groundLum: number): this {
    this.sglUniforms.uEnvSkyLum.value = skyLum;
    this.sglUniforms.uEnvGroundLum.value = groundLum;
    return this;
  }
}

export const SGL_LOOK_SHADERS = Object.freeze({ vertex: VERTEX_SHADER, fragment: FRAGMENT_SHADER });
