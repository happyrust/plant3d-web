/**
 * DTXPickingMaterial - GPU picking material for DTX.
 *
 * Encodes objectIndex into RGB for GPUPicker.
 */

import {
  ShaderMaterial,
  DataTexture,
  Matrix4,
  GLSL3
} from 'three';

// ========== Shader code ==========

const DTX_PICKING_VERTEX_SHADER = /* glsl */ `
precision highp float;
precision highp int;
precision highp usampler2D;
precision highp sampler2D;

// === Geometry data textures ===
uniform sampler2D positionsTexture;             // Positions (RGBA32F)
uniform highp usampler2D indicesTexture;         // Indices (R32UI)

// === Instance data textures ===
uniform sampler2D matricesTexture;               // Matrices (RGBA32F)
uniform highp usampler2D colorsAndFlagsTexture;  // Flags (RGBA8UI, 4 pixels/object)
uniform highp usampler2D primitiveToObjectTexture; // Primitive -> object

// === 全局模型变换（用于与旧版 applyAiosRotationTransform 口径对齐）===
uniform mat4 globalModelMatrix;

// === Texture sizes ===
uniform int positionsTextureWidth;
uniform int indicesTextureWidth;
uniform int objectsTextureWidth;
uniform int primitiveToObjectTextureWidth;

// === Varyings to fragment ===
flat out uint vObjectIndex;
flat out uint vVisibleFlag;
out vec3 vWorldPosition;

// === 对数深度缓冲 + per-object depth bias（与 DTXMaterial 保持一致）===
#ifdef USE_LOGDEPTHBUF
  uniform float logDepthBufFC;
  out float vFragDepth;
  flat out float vDepthBias;
#endif

// === Helpers ===
ivec2 getTexCoord(int index, int textureWidth) {
  return ivec2(index % textureWidth, index / textureWidth);
}

uint unpack32(uvec4 packed) {
  return (packed.r << 24u) | (packed.g << 16u) | (packed.b << 8u) | packed.a;
}

void main() {
  // 1. Primitive index from gl_VertexID
  int primitiveIndex = gl_VertexID / 3;
  int vertexInPrimitive = gl_VertexID % 3;

  // 2. Object index (1 pixel per primitive)
  ivec2 objTexCoord = getTexCoord(primitiveIndex, primitiveToObjectTextureWidth);
  uint objectIndex = texelFetch(primitiveToObjectTexture, objTexCoord, 0).r;

  // 3. Object attributes
  int objX = int(objectIndex) % objectsTextureWidth;
  int objY = int(objectIndex) / objectsTextureWidth;

  // 3.1 Flags and offsets (4 pixels per object)
  int flagsBaseX = objX * 4;
  uvec4 pixel0 = texelFetch(colorsAndFlagsTexture, ivec2(flagsBaseX + 0, objY), 0);
  uint visibleFlag = pixel0.b;

  uvec4 primitiveOffsetData = texelFetch(colorsAndFlagsTexture, ivec2(flagsBaseX + 1, objY), 0);
  uint primitiveOffset = unpack32(primitiveOffsetData);

  uvec4 vertexBaseData = texelFetch(colorsAndFlagsTexture, ivec2(flagsBaseX + 2, objY), 0);
  uint vertexBase = unpack32(vertexBaseData);

  uvec4 indexOffsetData = texelFetch(colorsAndFlagsTexture, ivec2(flagsBaseX + 3, objY), 0);
  uint indexOffset = unpack32(indexOffsetData);

  // 4. Local indices inside object
  int localPrimitiveIndex = primitiveIndex - int(primitiveOffset);
  int localIndexInBuffer = localPrimitiveIndex * 3 + vertexInPrimitive;

  int globalIndexPosition = int(indexOffset) + localIndexInBuffer;
  ivec2 indexTexCoord = getTexCoord(globalIndexPosition, indicesTextureWidth);
  uint vertexIndex = texelFetch(indicesTexture, indexTexCoord, 0).r;

  int globalVertexIndex = int(vertexBase) + int(vertexIndex);
  ivec2 posTexCoord = getTexCoord(globalVertexIndex, positionsTextureWidth);
  vec4 posData = texelFetch(positionsTexture, posTexCoord, 0);
  vec3 localPosition = posData.xyz;

  // 5. Transform matrix (4 rows per object)
  int matY = objY * 4;
  vec4 matCol0 = texelFetch(matricesTexture, ivec2(objX, matY + 0), 0);
  vec4 matCol1 = texelFetch(matricesTexture, ivec2(objX, matY + 1), 0);
  vec4 matCol2 = texelFetch(matricesTexture, ivec2(objX, matY + 2), 0);
  vec4 matCol3 = texelFetch(matricesTexture, ivec2(objX, matY + 3), 0);
  mat4 modelMatrix = mat4(matCol0, matCol1, matCol2, matCol3);

  vec4 worldPosition = (globalModelMatrix * modelMatrix) * vec4(localPosition, 1.0);
  vWorldPosition = worldPosition.xyz;

  if (visibleFlag == 0u) {
    gl_Position = vec4(0.0, 0.0, -999999.0, 1.0);
  } else {
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }

  #ifdef USE_LOGDEPTHBUF
    vFragDepth = 1.0 + gl_Position.w;
    vDepthBias = float(objectIndex & 7u) * 1.5e-7;
  #endif

  vObjectIndex = objectIndex;
  vVisibleFlag = visibleFlag;
}
`;

const DTX_PICKING_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
precision highp int;

flat in uint vObjectIndex;
flat in uint vVisibleFlag;
in vec3 vWorldPosition;

// === 房间凸壳裁剪（与 DTXMaterial 同步；语义见 DTXMaterial.ts）===
// 必须同步，否则被裁的片元仍可被点中，语义错乱。
uniform bool uClipEnabled;
uniform int  uClipRoomCount;

bool isInsideAnyRoom(vec3 p) {
  if (!uClipEnabled) return true;
  if (uClipRoomCount == 0) return true;
  return true;
}

// === 对数深度缓冲 + per-object depth bias ===
#ifdef USE_LOGDEPTHBUF
  uniform float logDepthBufFC;
  in float vFragDepth;
  flat in float vDepthBias;
#endif

out vec4 fragColor;

void main() {
  if (vVisibleFlag == 0u) {
    discard;
  }
  if (!isInsideAnyRoom(vWorldPosition)) {
    discard;
  }

  uint r = vObjectIndex & 255u;
  uint g = (vObjectIndex >> 8u) & 255u;
  uint b = (vObjectIndex >> 16u) & 255u;

  fragColor = vec4(float(r) / 255.0, float(g) / 255.0, float(b) / 255.0, 1.0);

  #ifdef USE_LOGDEPTHBUF
    gl_FragDepth = log2(vFragDepth) * logDepthBufFC * 0.5 + vDepthBias;
  #endif
}
`;

// ========== DTXPickingMaterial options ==========

export type DTXPickingMaterialOptions = {
  positionsTexture: DataTexture | null;
  indicesTexture: DataTexture | null;
  matricesTexture: DataTexture | null;
  colorsAndFlagsTexture: DataTexture | null;
  primitiveToObjectTexture: DataTexture | null;
  /** 全局模型变换（用于统一应用整体旋转/平移） */
  globalModelMatrix?: Matrix4;
  positionsTextureWidth?: number;
  indicesTextureWidth?: number;
  objectsTextureWidth?: number;
  primitiveToObjectTextureWidth?: number;
}

// ========== DTXPickingMaterial ==========

export class DTXPickingMaterial extends ShaderMaterial {
  constructor(options: DTXPickingMaterialOptions) {
    super({
      vertexShader: DTX_PICKING_VERTEX_SHADER,
      fragmentShader: DTX_PICKING_FRAGMENT_SHADER,
      uniforms: {
        positionsTexture: { value: options.positionsTexture },
        indicesTexture: { value: options.indicesTexture },
        matricesTexture: { value: options.matricesTexture },
        colorsAndFlagsTexture: { value: options.colorsAndFlagsTexture },
        primitiveToObjectTexture: { value: options.primitiveToObjectTexture },

        globalModelMatrix: { value: options.globalModelMatrix || new Matrix4() },

        positionsTextureWidth: { value: options.positionsTextureWidth || 1024 },
        indicesTextureWidth: { value: options.indicesTextureWidth || 4096 },
        objectsTextureWidth: { value: options.objectsTextureWidth || 512 },
        primitiveToObjectTextureWidth: { value: options.primitiveToObjectTextureWidth || 4096 },

        // 房间凸壳裁剪 uniform（与 DTXMaterial 同步语义；见 DTXMaterial.ts）
        uClipEnabled: { value: false },
        uClipRoomCount: { value: 0 }
      },
      glslVersion: GLSL3
    });

    this.side = 2; // DoubleSide to allow backface picking
  }

  customProgramCacheKey(): string {
    // v5: 加房间凸壳裁剪 uniform 占位（uClipEnabled/uClipRoomCount + isInsideAnyRoom），
    //     同时把 vWorldPosition 加到 picking varying 里供裁剪判定使用。
    //     必须与 DTXMaterial 同步升版，否则被裁的片元仍可被点中（语义错乱）。
    return 'DTXPickingMaterial_v5';
  }

  /** 与 DTXMaterial.setRoomClipUniforms 同步；裁剪必须双向应用，否则 picking 漏判。 */
  setRoomClipUniforms(options: { enabled: boolean; roomCount: number }): void {
    if (this.uniforms.uClipEnabled) {
      this.uniforms.uClipEnabled.value = options.enabled;
    }
    if (this.uniforms.uClipRoomCount) {
      this.uniforms.uClipRoomCount.value = options.roomCount;
    }
  }
}
