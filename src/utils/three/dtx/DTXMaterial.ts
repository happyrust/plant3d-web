/**
 * DTXMaterial - DTX 专用着色器材质
 *
 * 核心职责：
 * 1. 从纹理中获取顶点位置、法线、索引
 * 2. 从材质调色板纹理获取共享材质参数
 * 3. 支持独立颜色覆盖（选中高亮等）
 * 4. 实现基于 gl_VertexID 的数据索引
 * 5. 实现 PBR 光照计算
 *
 * 材质调色板优化：
 * - 使用材质索引间接引用，减少重复数据
 * - 支持最多 256 种材质
 * - 支持独立颜色覆盖（不影响材质调色板）
 */

import {
  ShaderMaterial,
  DataTexture,
  Vector3,
  Matrix4,
  Color,
  GLSL3
} from 'three';

// ========== Shader 代码 ==========

const DTX_VERTEX_SHADER = /* glsl */ `
precision highp float;
precision highp int;
precision highp usampler2D;
precision highp sampler2D;

// === 几何数据纹理 ===
uniform sampler2D positionsTexture;             // 顶点位置 (RGBA32F)
uniform highp usampler2D indicesTexture;  // 索引 (R32UI)
uniform sampler2D normalsTexture;         // 法线 (RGBA32F)

// === 实例数据纹理 ===
uniform sampler2D matricesTexture;        // 变换矩阵 (RGBA32F)
uniform highp usampler2D colorsAndFlagsTexture; // 标志/材质索引 (RGBA8UI, 4 pixels/object)
uniform highp usampler2D primitiveToObjectTexture; // 图元→对象映射

// === 材质调色板纹理 ===
uniform sampler2D materialPaletteTexture; // 材质调色板 (RGBA32F, 256x2)
uniform sampler2D colorOverrideTexture;   // 颜色覆盖 (RGBA8)

// === 全局模型变换（用于与旧版 applyAiosRotationTransform 口径对齐）===
uniform mat4 globalModelMatrix;

// === 纹理尺寸 ===
uniform int positionsTextureWidth;
uniform int indicesTextureWidth;
uniform int objectsTextureWidth;
uniform int primitiveToObjectTextureWidth;

// === 输出到 Fragment Shader ===
flat out vec4 vColor;
flat out float vMetalness;
flat out float vRoughness;
flat out uint vFlags;
out vec3 vWorldPosition;
out vec3 vWorldNormal;

// === 对数深度缓冲 + per-object depth bias（解决 Z-fighting）===
#ifdef USE_LOGDEPTHBUF
  uniform float logDepthBufFC;
  out float vFragDepth;
  flat out float vDepthBias;
#endif

// === 辅助函数 ===
ivec2 getTexCoord(int index, int textureWidth) {
  return ivec2(index % textureWidth, index / textureWidth);
}

uint unpack32(uvec4 packed) {
  return (packed.r << 24u) | (packed.g << 16u) | (packed.b << 8u) | packed.a;
}

void main() {
  // 1. 通过 gl_VertexID 计算图元索引
  int primitiveIndex = gl_VertexID / 3;
  int vertexInPrimitive = gl_VertexID % 3;

  // 2. 获取对象 ID (每图元 1 像素)
  ivec2 objTexCoord = getTexCoord(primitiveIndex, primitiveToObjectTextureWidth);
  uint objectIndex = texelFetch(primitiveToObjectTexture, objTexCoord, 0).r;

  // 3. 获取对象属性
  int objX = int(objectIndex) % objectsTextureWidth;
  int objY = int(objectIndex) / objectsTextureWidth;

  // 3.1 读取标志和材质索引 (4 pixels per object)
  int flagsBaseX = objX * 4;

  // pixel 0: [materialIndex, hasColorOverride, visible, selected]
  uvec4 pixel0 = texelFetch(colorsAndFlagsTexture, ivec2(flagsBaseX + 0, objY), 0);
  uint materialIndex = pixel0.r;
  bool hasColorOverride = pixel0.g > 0u;
  uint visibleFlag = pixel0.b;

  // pixel 1: [primitiveOffset] (packed as 4 bytes)
  uvec4 primitiveOffsetData = texelFetch(colorsAndFlagsTexture, ivec2(flagsBaseX + 1, objY), 0);
  uint primitiveOffset = unpack32(primitiveOffsetData);

  // pixel 2: vertexBase (packed as 4 bytes)
  uvec4 vertexBaseData = texelFetch(colorsAndFlagsTexture, ivec2(flagsBaseX + 2, objY), 0);
  uint vertexBase = unpack32(vertexBaseData);

  // pixel 3: indexOffset (packed as 4 bytes)
  uvec4 indexOffsetData = texelFetch(colorsAndFlagsTexture, ivec2(flagsBaseX + 3, objY), 0);
  uint indexOffset = unpack32(indexOffsetData);

  // 3.2 从材质调色板获取颜色和 PBR 参数
  // row 0: [r, g, b, metalness]
  vec4 matRow0 = texelFetch(materialPaletteTexture, ivec2(int(materialIndex), 0), 0);
  // row 1: [roughness, opacity, 0, 0]
  vec4 matRow1 = texelFetch(materialPaletteTexture, ivec2(int(materialIndex), 1), 0);

  vec3 baseColor = matRow0.rgb;
  float metalness = matRow0.a;
  float roughness = matRow1.r;
  float opacity = matRow1.g;

  // 3.3 检查颜色覆盖
  if (hasColorOverride) {
    // 从颜色覆盖纹理读取
    vec4 overrideColor = texelFetch(colorOverrideTexture, ivec2(objX, objY), 0);
    baseColor = overrideColor.rgb;
  }

  vColor = vec4(baseColor, opacity);
  vMetalness = metalness;
  vRoughness = roughness;
  vFlags = visibleFlag;

  // 3.4 几何参数 (已在上方读取)

  // 3.5 变换矩阵 (4 rows per object)
  int matY = objY * 4;
  vec4 matCol0 = texelFetch(matricesTexture, ivec2(objX, matY + 0), 0);
  vec4 matCol1 = texelFetch(matricesTexture, ivec2(objX, matY + 1), 0);
  vec4 matCol2 = texelFetch(matricesTexture, ivec2(objX, matY + 2), 0);
  vec4 matCol3 = texelFetch(matricesTexture, ivec2(objX, matY + 3), 0);
  mat4 modelMatrix = mat4(matCol0, matCol1, matCol2, matCol3);

  // 4. 计算对象内的局部图元索引
  int localPrimitiveIndex = primitiveIndex - int(primitiveOffset);
  int localIndexInBuffer = localPrimitiveIndex * 3 + vertexInPrimitive;

  // 5. 获取顶点索引
  int globalIndexPosition = int(indexOffset) + localIndexInBuffer;
  ivec2 indexTexCoord = getTexCoord(globalIndexPosition, indicesTextureWidth);
  uint vertexIndex = texelFetch(indicesTexture, indexTexCoord, 0).r;

  // 6. 获取顶点位置
  int globalVertexIndex = int(vertexBase) + int(vertexIndex);
  ivec2 posTexCoord = getTexCoord(globalVertexIndex, positionsTextureWidth);
  vec4 posData = texelFetch(positionsTexture, posTexCoord, 0);
  vec3 localPosition = posData.xyz;

  // 7. 获取法线
  vec4 normalData = texelFetch(normalsTexture, posTexCoord, 0);
  vec3 localNormal = normalData.xyz;

  // 8. 应用变换
  mat4 worldModelMatrix = globalModelMatrix * modelMatrix;
  vec4 worldPosition = worldModelMatrix * vec4(localPosition, 1.0);
  vWorldPosition = worldPosition.xyz;

  // 9. 法线变换
  mat3 normalMatrix = mat3(worldModelMatrix);
  vWorldNormal = normalize(normalMatrix * localNormal);

  // 10. 可见性检查
  if (vFlags == 0u) {
    // 不可见对象，移到裁剪空间外
    gl_Position = vec4(0.0, 0.0, -999999.0, 1.0);
    return;
  }

  // 11. 投影
  gl_Position = projectionMatrix * viewMatrix * worldPosition;

  // 12. 对数深度缓冲 + per-object depth bias
  #ifdef USE_LOGDEPTHBUF
    vFragDepth = 1.0 + gl_Position.w;
    // 用 objectIndex 低 3 位生成 8 级微小深度偏移，
    // 打破共面几何体（如甲板板与设备底板）的深度平局
    vDepthBias = float(objectIndex & 7u) * 1.5e-7;
  #endif
}
`;

const DTX_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

// === 输入 ===
flat in vec4 vColor;
flat in float vMetalness;
flat in float vRoughness;
flat in uint vFlags;
in vec3 vWorldPosition;
in vec3 vWorldNormal;

// === 光照 ===
uniform vec3 ambientLight;
uniform vec3 lightDirection0;
uniform vec3 lightColor0;
uniform vec3 lightDirection1;
uniform vec3 lightColor1;
// 0=all, 1=opaque, 2=transparent
uniform int renderPass;
uniform float alphaCutoff;

// === 对数深度缓冲 + per-object depth bias ===
#ifdef USE_LOGDEPTHBUF
  uniform float logDepthBufFC;
  in float vFragDepth;
  flat in float vDepthBias;
#endif

// === 输出 ===
out vec4 fragColor;

// === PBR 光照计算（简化版）===
vec3 calculatePBR(vec3 N, vec3 V, vec3 L, vec3 albedo, float metalness, float roughness, vec3 lightColor) {
  vec3 H = normalize(V + L);
  float NdotL = max(dot(N, L), 0.0);
  float NdotV = max(dot(N, V), 0.001);
  float NdotH = max(dot(N, H), 0.0);
  float VdotH = max(dot(V, H), 0.0);

  // 简化的 PBR
  vec3 F0 = mix(vec3(0.04), albedo, metalness);
  float alpha = roughness * roughness;

  // Fresnel (Schlick)
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - VdotH, 5.0);

  // Distribution (GGX)
  float alphaSq = alpha * alpha;
  float denom = NdotH * NdotH * (alphaSq - 1.0) + 1.0;
  float D = alphaSq / (3.14159 * denom * denom);

  // Geometry (Smith)
  float k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
  float G1_V = NdotV / (NdotV * (1.0 - k) + k);
  float G1_L = NdotL / (NdotL * (1.0 - k) + k);
  float G = G1_V * G1_L;

  vec3 specular = (D * G * F) / (4.0 * NdotV * NdotL + 0.001);
  vec3 diffuse = (1.0 - F) * (1.0 - metalness) * albedo / 3.14159;

  return (diffuse + specular) * lightColor * NdotL;
}

void main() {
  if (vFlags == 0u) {
    discard;
  }
  bool isOpaque = vColor.a >= alphaCutoff;
  if (renderPass == 1 && !isOpaque) {
    discard;
  }
  if (renderPass == 2 && isOpaque) {
    discard;
  }
  // 透明对象：丢弃背面片元，避免内部三角边缘穿透可见
  if (renderPass == 2 && !gl_FrontFacing) {
    discard;
  }
  if (vColor.a <= 0.001) {
    discard;
  }

  vec3 N = normalize(vWorldNormal);
  // 背面法线翻转：确保双面渲染时法线始终朝向相机
  if (!gl_FrontFacing) {
    N = -N;
  }
  vec3 V = normalize(cameraPosition - vWorldPosition);

  vec3 albedo = vColor.rgb;

  vec3 ambient = ambientLight * albedo;
  vec3 directLight0 = calculatePBR(N, V, normalize(lightDirection0), albedo, vMetalness, vRoughness, lightColor0);
  vec3 directLight1 = calculatePBR(N, V, normalize(lightDirection1), albedo, vMetalness, vRoughness, lightColor1);

  // 输出保持线性空间，由 renderer 的 toneMapping/outputColorSpace 统一处理（与地形一致）
  vec3 finalColor = ambient + directLight0 + directLight1;

  fragColor = vec4(finalColor, vColor.a);

  #ifdef USE_LOGDEPTHBUF
    gl_FragDepth = log2(vFragDepth) * logDepthBufFC * 0.5 + vDepthBias;
  #endif
}
`;

// ========== DTXMaterial 配置接口 ==========

export type DTXMaterialOptions = {
  positionsTexture: DataTexture | null;
  indicesTexture: DataTexture | null;
  normalsTexture: DataTexture | null;
  matricesTexture: DataTexture | null;
  colorsAndFlagsTexture: DataTexture | null;
  primitiveToObjectTexture: DataTexture | null;
  /** 全局模型变换（用于统一应用整体旋转/平移） */
  globalModelMatrix?: Matrix4;
  /** 材质调色板纹理 (新增) */
  materialPaletteTexture?: DataTexture | null;
  /** 颜色覆盖纹理 (新增) */
  colorOverrideTexture?: DataTexture | null;
  positionsTextureWidth?: number;
  indicesTextureWidth?: number;
  objectsTextureWidth?: number;
  primitiveToObjectTextureWidth?: number;
  renderPass?: 0 | 1 | 2;
  alphaCutoff?: number;
  transparent?: boolean;
  depthWrite?: boolean;
  depthTest?: boolean;
}

// ========== DTXMaterial 类 ==========

export class DTXMaterial extends ShaderMaterial {
  constructor(options: DTXMaterialOptions) {
    super({
      vertexShader: DTX_VERTEX_SHADER,
      fragmentShader: DTX_FRAGMENT_SHADER,
      uniforms: {
        // 几何纹理
        positionsTexture: { value: options.positionsTexture },
        indicesTexture: { value: options.indicesTexture },
        normalsTexture: { value: options.normalsTexture },

        // 实例纹理
        matricesTexture: { value: options.matricesTexture },
        colorsAndFlagsTexture: { value: options.colorsAndFlagsTexture },
        primitiveToObjectTexture: { value: options.primitiveToObjectTexture },

        // 材质调色板纹理 (新增)
        materialPaletteTexture: { value: options.materialPaletteTexture || null },
        colorOverrideTexture: { value: options.colorOverrideTexture || null },

        // 全局模型变换
        globalModelMatrix: { value: options.globalModelMatrix || new Matrix4() },

        // 纹理尺寸
        positionsTextureWidth: { value: options.positionsTextureWidth || 1024 },
        indicesTextureWidth: { value: options.indicesTextureWidth || 4096 },
        objectsTextureWidth: { value: options.objectsTextureWidth || 512 },
        primitiveToObjectTextureWidth: { value: options.primitiveToObjectTextureWidth || 4096 },

        // 光照
        ambientLight: { value: new Vector3(0.3, 0.3, 0.3) },
        lightDirection0: { value: new Vector3(1, 1, 1).normalize() },
        lightColor0: { value: new Vector3(1, 1, 1) },
        lightDirection1: { value: new Vector3(-1, 0.4, -1).normalize() },
        lightColor1: { value: new Vector3(0, 0, 0) },
        renderPass: { value: options.renderPass ?? 0 },
        alphaCutoff: { value: options.alphaCutoff ?? 0.999 }
      },
      // 重要：启用 WebGL2 的 GLSL 3.0 语法
      glslVersion: GLSL3
    });

    // 禁用背面剔除以便调试
    this.side = 2; // DoubleSide
    this.transparent = options.transparent ?? false;
    this.depthWrite = options.depthWrite ?? true;
    this.depthTest = options.depthTest ?? true;
  }

  /**
   * 🔑 关键优化：自定义程序缓存键
   * 
   * Three.js 的 WebGLPrograms 使用材质的属性生成缓存键来决定是否复用已编译的 shader。
   * 对于自定义 ShaderMaterial，如果不提供此方法，Three.js 可能会因为 uniform 引用变化
   * 而错误地认为需要重新编译 shader，导致 getProgram 每帧都执行昂贵的编译操作。
   * 
   * 返回固定字符串确保所有 DTXMaterial 实例共享同一个编译好的 shader 程序。
   */
  customProgramCacheKey(): string {
    // 注意：当 shader 代码结构变化（如新增 uniform/global 变换）时必须升级该 key，
    // 否则 Three.js 可能复用旧 program 导致新逻辑不生效。
    return 'DTXMaterial_v10';
  }

  /**
   * 设置光照参数
   */
  setLighting(options: {
    ambient?: Color;
    directional0?: { direction: Vector3; color: Color };
    directional1?: { direction: Vector3; color: Color };
    // 兼容旧字段：等价 directional0
    lightDirection?: Vector3;
    lightColor?: Color;
  }): void {
    if (options.ambient) {
      this.uniforms.ambientLight!.value.set(
        options.ambient.r,
        options.ambient.g,
        options.ambient.b
      );
    }
    const dir0 = options.directional0?.direction || options.lightDirection;
    const col0 = options.directional0?.color || options.lightColor;
    if (dir0) {
      this.uniforms.lightDirection0!.value.copy(dir0).normalize();
    }
    if (col0) {
      this.uniforms.lightColor0!.value.set(col0.r, col0.g, col0.b);
    }

    if (options.directional1?.direction) {
      this.uniforms.lightDirection1!.value.copy(options.directional1.direction).normalize();
    }
    if (options.directional1?.color) {
      this.uniforms.lightColor1!.value.set(
        options.directional1.color.r,
        options.directional1.color.g,
        options.directional1.color.b
      );
    }
  }
}
