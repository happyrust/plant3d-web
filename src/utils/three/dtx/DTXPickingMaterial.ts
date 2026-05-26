/**
 * DTXPickingMaterial - GPU picking material for DTX.
 *
 * Encodes objectIndex into RGB for GPUPicker.
 */

import {
  ShaderMaterial,
  DataTexture,
  Matrix4,
  Vector3,
  Vector4,
  GLSL3
} from 'three';

import {
  ROOM_CLIP_MAX_PLANES,
  ROOM_CLIP_MAX_SHAPES,
  type RoomClipUniformPayload,
} from './DTXClipController';

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
uniform int  uClipShapeCount;
uniform int  uClipPlaneCount;
uniform vec4 uClipPlanes[${ROOM_CLIP_MAX_PLANES}];
uniform int  uClipShapePlaneStart[${ROOM_CLIP_MAX_SHAPES}];
uniform int  uClipShapePlaneCount[${ROOM_CLIP_MAX_SHAPES}];
uniform vec3 uClipShapeAabbMin[${ROOM_CLIP_MAX_SHAPES}];
uniform vec3 uClipShapeAabbMax[${ROOM_CLIP_MAX_SHAPES}];

bool isInsideClipAabb(vec3 p, int shapeIndex) {
  vec3 mn = uClipShapeAabbMin[shapeIndex];
  vec3 mx = uClipShapeAabbMax[shapeIndex];
  return all(greaterThanEqual(p, mn)) && all(lessThanEqual(p, mx));
}

bool isInsideAnyRoom(vec3 p) {
  if (!uClipEnabled) return true;
  if (uClipRoomCount == 0) return true;
  if (uClipShapeCount == 0 || uClipPlaneCount == 0) return true;

  for (int shapeIndex = 0; shapeIndex < ${ROOM_CLIP_MAX_SHAPES}; shapeIndex++) {
    if (shapeIndex >= uClipShapeCount) break;
    if (!isInsideClipAabb(p, shapeIndex)) continue;

    int planeStart = uClipShapePlaneStart[shapeIndex];
    int planeCount = uClipShapePlaneCount[shapeIndex];
    bool insideShape = true;

    for (int localPlaneIndex = 0; localPlaneIndex < ${ROOM_CLIP_MAX_PLANES}; localPlaneIndex++) {
      if (localPlaneIndex >= planeCount) break;
      int planeIndex = planeStart + localPlaneIndex;
      if (planeIndex >= uClipPlaneCount) break;

      vec4 plane = uClipPlanes[planeIndex];
      float signedDistance = dot(plane.xyz, p) - plane.w;
      if (signedDistance > 0.0) {
        insideShape = false;
        break;
      }
    }

    if (insideShape) return true;
  }

  return false;
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

function createVector3Array(count: number): Vector3[] {
  return Array.from({ length: count }, () => new Vector3());
}

function createVector4Array(count: number): Vector4[] {
  return Array.from({ length: count }, () => new Vector4());
}

function copyVector3Array(target: Vector3[], source: RoomClipUniformPayload['shapeAabbMins']): void {
  for (let i = 0; i < target.length; i++) {
    const v = source[i] ?? [0, 0, 0];
    target[i]!.set(v[0], v[1], v[2]);
  }
}

function copyVector4Array(target: Vector4[], source: RoomClipUniformPayload['planes']): void {
  for (let i = 0; i < target.length; i++) {
    const v = source[i] ?? [0, 0, 0, 0];
    target[i]!.set(v[0], v[1], v[2], v[3]);
  }
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
        uClipRoomCount: { value: 0 },
        uClipShapeCount: { value: 0 },
        uClipPlaneCount: { value: 0 },
        uClipPlanes: { value: createVector4Array(ROOM_CLIP_MAX_PLANES) },
        uClipShapePlaneStart: { value: new Array(ROOM_CLIP_MAX_SHAPES).fill(0) },
        uClipShapePlaneCount: { value: new Array(ROOM_CLIP_MAX_SHAPES).fill(0) },
        uClipShapeAabbMin: { value: createVector3Array(ROOM_CLIP_MAX_SHAPES) },
        uClipShapeAabbMax: { value: createVector3Array(ROOM_CLIP_MAX_SHAPES) }
      },
      glslVersion: GLSL3
    });

    this.side = 2; // DoubleSide to allow backface picking
  }

  customProgramCacheKey(): string {
    // v6: 与 DTXMaterial_v13 同步 AABB + plane uniform 裁剪 MVP。
    return 'DTXPickingMaterial_v6';
  }

  /** 与 DTXMaterial.setRoomClipUniforms 同步；裁剪必须双向应用，否则 picking 漏判。 */
  setRoomClipUniforms(options: RoomClipUniformPayload): void {
    if (this.uniforms.uClipEnabled) {
      this.uniforms.uClipEnabled.value = options.enabled;
    }
    if (this.uniforms.uClipRoomCount) {
      this.uniforms.uClipRoomCount.value = options.roomCount;
    }
    if (this.uniforms.uClipShapeCount) {
      this.uniforms.uClipShapeCount.value = options.shapeCount;
    }
    if (this.uniforms.uClipPlaneCount) {
      this.uniforms.uClipPlaneCount.value = options.planeCount;
    }
    if (this.uniforms.uClipPlanes) {
      copyVector4Array(this.uniforms.uClipPlanes.value as Vector4[], options.planes);
    }
    if (this.uniforms.uClipShapePlaneStart) {
      this.uniforms.uClipShapePlaneStart.value = options.shapePlaneStarts.slice();
    }
    if (this.uniforms.uClipShapePlaneCount) {
      this.uniforms.uClipShapePlaneCount.value = options.shapePlaneCounts.slice();
    }
    if (this.uniforms.uClipShapeAabbMin) {
      copyVector3Array(this.uniforms.uClipShapeAabbMin.value as Vector3[], options.shapeAabbMins);
    }
    if (this.uniforms.uClipShapeAabbMax) {
      copyVector3Array(this.uniforms.uClipShapeAabbMax.value as Vector3[], options.shapeAabbMaxs);
    }
  }
}
