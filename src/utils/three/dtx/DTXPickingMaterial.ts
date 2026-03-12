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

  if (visibleFlag == 0u) {
    gl_Position = vec4(0.0, 0.0, -999999.0, 1.0);
  } else {
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }

  vObjectIndex = objectIndex;
  vVisibleFlag = visibleFlag;
}
`;

const DTX_PICKING_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
precision highp int;

flat in uint vObjectIndex;
flat in uint vVisibleFlag;

out vec4 fragColor;

void main() {
  if (vVisibleFlag == 0u) {
    discard;
  }

  uint r = vObjectIndex & 255u;
  uint g = (vObjectIndex >> 8u) & 255u;
  uint b = (vObjectIndex >> 16u) & 255u;

  fragColor = vec4(float(r) / 255.0, float(g) / 255.0, float(b) / 255.0, 1.0);
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
      },
      glslVersion: GLSL3
    });

    this.side = 2; // DoubleSide to allow backface picking
  }

  customProgramCacheKey(): string {
    return 'DTXPickingMaterial_v2';
  }
}
