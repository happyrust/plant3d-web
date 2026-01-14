/**
 * DTXLayer - Data Texture Layer
 *
 * 借鉴 xeokit 的 DTX 架构，将所有几何体和实例数据打包到 GPU 纹理中，
 * 通过 gl_VertexID + texelFetch 实现单次 draw call 渲染全场景。
 *
 * 核心优化目标：
 *   - 269 个 InstancedMesh2 → 1 个 DTXLayer
 *   - 269 次 draw call → 1-3 次 draw call
 *   - setProgram 开销从 90-165ms 降至 < 5ms
 *
 * @see docs/渲染引擎/DTX数据纹理层技术方案.md
 */

import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DirectionalLight,
  FloatType,
  Matrix4,
  Mesh,
  NearestFilter,
  RGBAFormat,
  RGBAIntegerFormat,
  RedIntegerFormat,
  Ray,
  Scene,
  UnsignedByteType,
  UnsignedIntType,
  Vector3,
  WebGLRenderer,
  Box3,
  Sphere,
  Camera,
  Triangle
} from 'three';

import { DTXMaterial } from './DTXMaterial';
import { DTXPickingMaterial } from './DTXPickingMaterial';
import { DTXGeometry } from './DTXGeometry';

// ========== 类型定义 ==========

/**
 * 几何体句柄 - 添加几何体后返回
 */
export interface GeometryHandle {
  geoHash: string;
  vertexBase: number;
  vertexCount: number;
  indexBase: number;
  indexCount: number;
}

/**
 * 对象句柄 - 添加对象后返回
 */
export interface ObjectHandle {
  objectId: string;
  objectIndex: number;
  geoHash: string;
}

/**
 * DTX 对象内部数据
 */
interface DTXObject {
  objectId: string;
  geoHash: string;
  objectIndex: number;
  vertexBase: number;
  indexOffset: number;
  indexCount: number;
  /** 材质调色板索引 */
  materialIndex: number;
  /** 是否使用独立颜色覆盖 */
  hasColorOverride: boolean;
  /** 独立颜色覆盖值 */
  colorOverride: Color;
  opacity: number;
  visible: boolean;
  selected: boolean;
  highlighted: boolean;
  /** 包围盒 (局部) */
  boundingBox: Box3;
  /** 图元偏移 (用于 shader 定位对象属性) */
  primitiveOffset: number;
}

/**
 * PBR 材质参数
 */
export interface PBRParams {
  metalness?: number;
  roughness?: number;
}

export interface MaterialParams extends PBRParams {
  color?: Color;
}

/**
 * 材质调色板条目
 */
export interface MaterialPaletteEntry {
  color: Color;
  metalness: number;
  roughness: number;
}

/**
 * 材质调色板配置
 */
export interface MaterialPaletteConfig {
  /** 最大材质数量 (默认 256) */
  maxMaterials?: number;
}

/**
 * DTXLayer 配置选项
 */
export interface DTXLayerOptions {
  /** 预估的最大顶点数 */
  maxVertices?: number;
  /** 预估的最大索引数 */
  maxIndices?: number;
  /** 预估的最大对象数 */
  maxObjects?: number;
  /** 是否启用调试模式 */
  debug?: boolean;
  /** 可选：renderer 引用（用于后续扩展，如曝光等） */
  renderer?: WebGLRenderer;
}

// ========== 常量 ==========

/** 位置纹理宽度 */
const POSITIONS_TEXTURE_WIDTH = 1024;
/** 索引纹理宽度 */
const INDICES_TEXTURE_WIDTH = 4096;
/** 对象纹理宽度 */
const OBJECTS_TEXTURE_WIDTH = 512;
/** 每个对象在颜色/标志纹理中占用的像素数 (从8减少到4) */
const PIXELS_PER_OBJECT = 4;
/** 材质调色板最大容量 */
const MAX_MATERIAL_PALETTE_SIZE = 256;

// ========== DTXLayer 类 ==========

/**
 * DTXLayer - 数据纹理层
 *
 * 核心职责：
 * 1. 收集所有几何体数据（positions, indices, normals）
 * 2. 收集所有对象数据（matrices, colors, flags, pbr）
 * 3. 将数据打包到 GPU 纹理
 * 4. 提供单次 draw call 渲染
 */
export class DTXLayer {
  // ========== 几何数据纹理 ==========

  /** 顶点位置纹理 (RGBA32F - Float32 位置) */
  private _positionsTexture: DataTexture | null = null;
  /** 索引纹理 (R32UI) */
  private _indicesTexture: DataTexture | null = null;
  /** 法线纹理 (RGB8) */
  private _normalsTexture: DataTexture | null = null;

  // ========== 实例数据纹理 ==========

  /** 变换矩阵纹理 (RGBA32F, 4行/对象) */
  private _matricesTexture: DataTexture | null = null;
  /** 颜色和标志纹理 (RGBA8UI, 4像素/对象) */
  private _colorsAndFlagsTexture: DataTexture | null = null;
  /** 图元到对象映射纹理 (R32UI, 8个三角形共享) */
  private _primitiveToObjectTexture: DataTexture | null = null;
  /** 材质调色板纹理 (RGBA32F, 每材质2行: row0=color+metalness, row1=roughness+padding) */
  private _materialPaletteTexture: DataTexture | null = null;
  /** 颜色覆盖纹理 (RGBA8, 用于独立颜色覆盖) */
  private _colorOverrideTexture: DataTexture | null = null;

  // ========== 几何数据缓冲区 ==========

  /** 顶点位置数据 (Float32, 原始未量化) */
  private _positionsBuffer: Float32Array;
  /** 索引数据 */
  private _indicesBuffer: Uint32Array;
  /** 法线数据 */
  private _normalsBuffer: Float32Array;

  // ========== 实例数据缓冲区 ==========

  /** 矩阵数据 (每对象 16 floats) */
  private _matricesBuffer: Float32Array;
  /** 颜色和标志数据 (每对象 16 bytes = 4 pixels * 4 channels) */
  private _colorsAndFlagsBuffer: Uint8Array;
  /** 颜色覆盖缓冲区 (每对象 4 bytes = RGBA) */
  private _colorOverrideBuffer: Uint8Array;

  // ========== 材质调色板 ==========

  /** 材质调色板: key -> index */
  private _materialPalette: Map<string, number> = new Map();
  /** 材质调色板数据 (每材质 8 floats: r,g,b,metalness,roughness,0,0,0) */
  private _materialPaletteBuffer: Float32Array;
  /** 当前材质数量 */
  private _materialCount = 0;

  // ========== 几何注册表 ==========

  /** 几何体映射: geoHash -> GeometryHandle */
  private _geometries: Map<string, GeometryHandle> = new Map();
  /** Outline 几何体缓存（LRU），避免反复从缓冲区拷贝 */
  private _outlineGeometryCache: Map<string, BufferGeometry> = new Map();
  private _outlineGeometryCacheLimit = 128;
  /** 当前顶点偏移 */
  private _currentVertexOffset = 0;
  /** 当前索引偏移 (对应几何体池) */
  private _currentIndexOffset = 0;
  /** 绘制索引计数 (用于计算全局 primitiveOffset) */
  private _drawIndexCount = 0;
  /** 绘制图元计数 (triangle 数，用于计算 primitiveOffset) */
  private _drawTriangleCount = 0;

  // ========== 对象注册表 ==========

  /** 对象映射: objectId -> DTXObject */
  private _objects: Map<string, DTXObject> = new Map();
  /** 对象索引数组 (用于快速按索引查找) */
  private _objectsArray: DTXObject[] = [];
  /** 当前对象数量 */
  private _objectCount = 0;

  // ========== 渲染相关 ==========

  /** Three.js 材质 */
  private _material: DTXMaterial | null = null;
  /** Three.js 几何体 */
  private _geometry: DTXGeometry | null = null;
  /** Three.js 网格 */
  private _mesh: Mesh | null = null;
  /** GPU Picking 材质 */
  private _pickingMaterial: DTXPickingMaterial | null = null;
  /** GPU Picking 网格 */
  private _pickingMesh: Mesh | null = null;
  /** WebGL 渲染器引用 */
  private _renderer: WebGLRenderer | null = null;
  /** 场景引用 */
  private _scene: Scene | null = null;

  // ========== 灯光缓存（避免每帧 traverse 大场景树） ==========

  private _cachedAmbientLights: AmbientLight[] = [];
  private _cachedDirectionalLights: DirectionalLight[] = [];
  private _lightingCacheDirty = true;

  private _tmpLightPos0 = new Vector3();
  private _tmpTargetPos0 = new Vector3();
  private _tmpLightPos1 = new Vector3();
  private _tmpTargetPos1 = new Vector3();
  private _tmpDir0 = new Vector3(1, 1, 1).normalize();
  private _tmpDir1 = new Vector3(-1, 0.4, -1).normalize();
  private _tmpColor0 = new Color(1, 1, 1);
  private _tmpColor1 = new Color(0, 0, 0);

  // ========== 元数据 ==========

  /** 总顶点数 */
  private _totalVertices = 0;
  /** 总索引数 */
  private _totalIndices = 0;
  /** 总对象数 */
  private _totalObjects = 0;
  /** 是否已编译 */
  private _compiled = false;
  /** 调试模式 */
  private _debug = false;

  /** 全局模型变换（用于整体旋转/平移，默认 identity） */
  private _globalModelMatrix: Matrix4 = new Matrix4();

  // ========== 包围盒 ==========

  private _boundingBox: Box3 = new Box3();
  /** 场景世界包围盒 (用于对外暴露) */
  private _sceneBoundingBox: Box3 = new Box3();
  /** 几何体局部包围盒缓存 */
  private _geometryLocalBBoxes: Map<string, Box3> = new Map();

  // ========== 构造函数 ==========

  constructor(options: DTXLayerOptions = {}) {
    const maxVertices = options.maxVertices || 1000000;
    const maxIndices = options.maxIndices || 3000000;
    const maxObjects = options.maxObjects || 100000;
    this._debug = options.debug || false;
    this._renderer = options.renderer ?? null;

    // 预分配几何数据缓冲区
    this._positionsBuffer = new Float32Array(maxVertices * 3);
    this._indicesBuffer = new Uint32Array(maxIndices);
    this._normalsBuffer = new Float32Array(maxVertices * 3);

    // 预分配实例数据缓冲区
    this._matricesBuffer = new Float32Array(maxObjects * 16);
    this._colorsAndFlagsBuffer = new Uint8Array(maxObjects * 16); // 4 pixels * 4 channels
    this._colorOverrideBuffer = new Uint8Array(maxObjects * 4); // RGBA per object

    // 预分配材质调色板 (每材质 8 floats = 2 pixels of RGBA32F)
    this._materialPaletteBuffer = new Float32Array(MAX_MATERIAL_PALETTE_SIZE * 8);

    if (this._debug) {
      console.log(`🏗️ DTXLayer 初始化:`, {
        maxVertices,
        maxIndices,
        maxObjects,
        estimatedMemory: `${((maxVertices * 3 * 4 + maxIndices * 4 + maxObjects * (16 * 4 + 32)) / 1024 / 1024).toFixed(2)} MB`
      });
    }
  }

  // ========== 几何体管理 ==========

  /**
   * 添加几何体定义
   * @param geoHash 几何体唯一标识
   * @param geometry Three.js BufferGeometry
   * @returns 几何体句柄
   */
  addGeometry(geoHash: string, geometry: BufferGeometry): GeometryHandle {
    // 检查是否已存在
    if (this._geometries.has(geoHash)) {
      return this._geometries.get(geoHash)!;
    }

    // 获取顶点数据
    const positionAttr = geometry.getAttribute('position');
    let normalAttr = geometry.getAttribute('normal');
    const indexAttr = geometry.getIndex();

    if (!positionAttr) {
      throw new Error(`几何体 ${geoHash} 缺少 position 属性`);
    }

    const vertexCount = positionAttr.count;
    const vertexBase = this._currentVertexOffset;

    // 复制顶点位置
    for (let i = 0; i < vertexCount; i++) {
      const dstOffset = (vertexBase + i) * 3;
      this._positionsBuffer[dstOffset] = positionAttr.getX(i);
      this._positionsBuffer[dstOffset + 1] = positionAttr.getY(i);
      this._positionsBuffer[dstOffset + 2] = positionAttr.getZ(i);
    }

    // 复制法线（若缺失则尝试生成，避免“只有底色/无光照”的观感）
    if (!normalAttr) {
      if (this._debug) {
        console.warn(`⚠️ 几何体 ${geoHash} 缺少 normal 属性，尝试 computeVertexNormals() 生成`);
      }
      geometry.computeVertexNormals();
      normalAttr = geometry.getAttribute('normal');
    }

    if (normalAttr) {
      for (let i = 0; i < vertexCount; i++) {
        const dstOffset = (vertexBase + i) * 3;
        this._normalsBuffer[dstOffset] = normalAttr.getX(i);
        this._normalsBuffer[dstOffset + 1] = normalAttr.getY(i);
        this._normalsBuffer[dstOffset + 2] = normalAttr.getZ(i);
      }
    } else if (this._debug) {
      console.warn(`⚠️ 几何体 ${geoHash} 仍无法获取 normal（将导致光照缺失）`);
    }

    // 复制索引
    let indexCount = 0;
    const indexBase = this._currentIndexOffset;

    if (indexAttr) {
      indexCount = indexAttr.count;
      let maxIndex = 0;
      let minIndex = Number.POSITIVE_INFINITY;
      for (let i = 0; i < indexCount; i++) {
        // 注意：indicesTexture 存储的是“局部索引”（相对于本几何体的 position），
        // shader 里会使用 vertexBase 做二次偏移得到全局顶点索引。
        const idx = indexAttr.getX(i);
        this._indicesBuffer[indexBase + i] = idx;
        if (this._debug) {
          if (idx > maxIndex) maxIndex = idx;
          if (idx < minIndex) minIndex = idx;
        }
      }

      if (this._debug) {
        // 正常情况下：0 <= index <= vertexCount-1
        if (minIndex < 0 || maxIndex >= vertexCount) {
          console.warn(`⚠️ 几何体 ${geoHash} 的索引疑似不是局部索引（可能已包含顶点偏移）`, {
            vertexCount,
            minIndex,
            maxIndex
          });
        }
      }
    } else {
      // 非索引几何体，生成顺序索引
      indexCount = vertexCount;
      for (let i = 0; i < indexCount; i++) {
        this._indicesBuffer[indexBase + i] = i;
      }
    }

    // 更新偏移
    this._currentVertexOffset += vertexCount;
    this._currentIndexOffset += indexCount;

    // 创建句柄
    const handle: GeometryHandle = {
      geoHash,
      vertexBase,
      vertexCount,
      indexBase,
      indexCount
    };

    // 计算并缓存几何体局部包围盒（用于对象 world bbox、诊断等）
    const localBBox = new Box3();
    for (let i = 0; i < vertexCount; i++) {
      localBBox.expandByPoint(new Vector3(
        this._positionsBuffer[(vertexBase + i) * 3],
        this._positionsBuffer[(vertexBase + i) * 3 + 1],
        this._positionsBuffer[(vertexBase + i) * 3 + 2]
      ));
    }
    this._geometryLocalBBoxes.set(geoHash, localBBox);

    this._geometries.set(geoHash, handle);

    if (this._debug) {
      console.log(`📐 添加几何体 ${geoHash}:`, {
        vertexBase,
        vertexCount,
        indexBase,
        indexCount
      });
    }

    return handle;
  }

  // ========== 对象管理 ==========

  /**
   * 获取或创建材质调色板条目
   * @param color 颜色
   * @param metalness 金属度
   * @param roughness 粗糙度
   * @returns 材质索引
   */
  private _getOrCreateMaterialIndex(color: Color, metalness: number, roughness: number): number {
    // 生成材质键 (颜色精度降低到 0-255，PBR 精度降低到 0-100)
    const r = Math.floor(color.r * 255);
    const g = Math.floor(color.g * 255);
    const b = Math.floor(color.b * 255);
    const m = Math.floor(metalness * 100);
    const rg = Math.floor(roughness * 100);
    const key = `${r}_${g}_${b}_${m}_${rg}`;

    if (this._materialPalette.has(key)) {
      return this._materialPalette.get(key)!;
    }

    if (this._materialCount >= MAX_MATERIAL_PALETTE_SIZE) {
      console.warn(`⚠️ 材质调色板已满 (${MAX_MATERIAL_PALETTE_SIZE})，复用最后一个材质`);
      return MAX_MATERIAL_PALETTE_SIZE - 1;
    }

    const index = this._materialCount;

    // 存储到调色板缓冲区 (每材质 8 floats)
    const offset = index * 8;
    this._materialPaletteBuffer[offset + 0] = color.r;
    this._materialPaletteBuffer[offset + 1] = color.g;
    this._materialPaletteBuffer[offset + 2] = color.b;
    this._materialPaletteBuffer[offset + 3] = metalness;
    this._materialPaletteBuffer[offset + 4] = roughness;
    this._materialPaletteBuffer[offset + 5] = 0;
    this._materialPaletteBuffer[offset + 6] = 0;
    this._materialPaletteBuffer[offset + 7] = 0;

    this._materialPalette.set(key, index);
    this._materialCount++;

    if (this._debug && this._materialCount % 10 === 0) {
      console.log(`🎨 材质调色板: ${this._materialCount} 种材质`);
    }

    return index;
  }

  /**
   * 添加对象实例
   * @param objectId 对象唯一标识
   * @param geoHash 引用的几何体哈希
   * @param matrix 变换矩阵
   * @param color 颜色
   * @param pbr PBR 参数
   * @returns 对象句柄
   */
  addObject(
    objectId: string,
    geoHash: string,
    matrix: Matrix4,
    color: Color = new Color(0xffffff),
    pbr: PBRParams = {}
  ): ObjectHandle {
    const geoHandle = this._geometries.get(geoHash);
    if (!geoHandle) {
      throw new Error(`未找到几何体 ${geoHash}，请先调用 addGeometry`);
    }

    const objectIndex = this._objectCount;
    const metalness = pbr.metalness ?? 0.5;
    const roughness = pbr.roughness ?? 0.5;

    // 获取或创建材质调色板索引
    const materialIndex = this._getOrCreateMaterialIndex(color, metalness, roughness);

    const triangleCount = Math.floor(geoHandle.indexCount / 3);
    const primitiveOffset = this._drawTriangleCount;
    const drawIndexCount = triangleCount * 3;

    // 创建对象数据
    const obj: DTXObject = {
      objectId,
      geoHash,
      objectIndex,
      vertexBase: geoHandle.vertexBase,
      indexOffset: geoHandle.indexBase,
      indexCount: drawIndexCount,
      materialIndex,
      hasColorOverride: false,
      colorOverride: new Color(0xffffff),
      opacity: 1.0,
      visible: true,
      selected: false,
      highlighted: false,
      boundingBox: new Box3(), // 后面计算
      primitiveOffset
    };

    // 存储矩阵数据
    matrix.toArray(this._matricesBuffer, objectIndex * 16);

    // 计算对象的世界包围盒 (供 _sceneBoundingBox 使用)
    const geoBBox = this._computeGeometryLocalBBox(geoHandle);
    obj.boundingBox.copy(geoBBox).applyMatrix4(matrix);
    this._sceneBoundingBox.union(obj.boundingBox);

    // 存储颜色/标志数据 (4 pixels * 4 channels = 16 bytes)
    const flagsOffset = objectIndex * 16;

    // pixel 0: [materialIndex, hasColorOverride, visible, selected]
    this._colorsAndFlagsBuffer[flagsOffset + 0] = materialIndex;
    this._colorsAndFlagsBuffer[flagsOffset + 1] = 0; // hasColorOverride = false
    this._colorsAndFlagsBuffer[flagsOffset + 2] = 1; // visible = true
    this._colorsAndFlagsBuffer[flagsOffset + 3] = 0; // selected = false

    // pixel 1: primitiveOffset (packed as 4 bytes, triangle index)
    this._packUint32(this._colorsAndFlagsBuffer, flagsOffset + 4, primitiveOffset);

    // pixel 2: vertexBase (packed as 4 bytes)
    this._packUint32(this._colorsAndFlagsBuffer, flagsOffset + 8, geoHandle.vertexBase);

    // pixel 3: indexOffset (packed as 4 bytes)
    this._packUint32(this._colorsAndFlagsBuffer, flagsOffset + 12, geoHandle.indexBase);

    // 初始化颜色覆盖为默认值
    const overrideOffset = objectIndex * 4;
    this._colorOverrideBuffer[overrideOffset + 0] = 255;
    this._colorOverrideBuffer[overrideOffset + 1] = 255;
    this._colorOverrideBuffer[overrideOffset + 2] = 255;
    this._colorOverrideBuffer[overrideOffset + 3] = 255;

    // 注册对象
    this._objects.set(objectId, obj);
    this._objectsArray.push(obj);
    this._objectCount++;

    // 累计 drawIndexCount / drawTriangleCount
    this._drawTriangleCount += triangleCount;
    this._drawIndexCount += drawIndexCount;

    return {
      objectId,
      objectIndex,
      geoHash
    };
  }

  /**
   * 将 Uint32 打包到 Uint8Array (big-endian)
   */
  private _packUint32(buffer: Uint8Array, offset: number, value: number): void {
    buffer[offset + 0] = (value >> 24) & 0xFF;
    buffer[offset + 1] = (value >> 16) & 0xFF;
    buffer[offset + 2] = (value >> 8) & 0xFF;
    buffer[offset + 3] = value & 0xFF;
  }

  // ========== 编译 ==========

  /**
   * 计算几何体局部包围盒
   */
  private _computeGeometryLocalBBox(handle: GeometryHandle): Box3 {
    const cached = this._geometryLocalBBoxes.get(handle.geoHash);
    if (cached) return cached;

    const bbox = new Box3();
    for (let i = 0; i < handle.vertexCount; i++) {
      const idx = (handle.vertexBase + i) * 3;
      bbox.expandByPoint(new Vector3(
        this._positionsBuffer[idx],
        this._positionsBuffer[idx + 1],
        this._positionsBuffer[idx + 2]
      ));
    }
    this._geometryLocalBBoxes.set(handle.geoHash, bbox);
    return bbox;
  }

  /**
   * 编译所有数据到 GPU 纹理
   * 在所有几何体和对象添加完成后调用一次
   */
  compile(): void {
    if (this._compiled) {
      console.warn('⚠️ DTXLayer 已编译，跳过');
      return;
    }

    this._totalVertices = this._currentVertexOffset;
    this._totalIndices = this._currentIndexOffset;
    this._totalObjects = this._objectCount;

    if (this._debug) {
      console.log(`🔧 DTXLayer 编译:`, {
        totalVertices: this._totalVertices,
        totalIndices: this._totalIndices,
        drawIndexCount: this._drawIndexCount,
        totalObjects: this._totalObjects,
        uniqueGeometries: this._geometries.size,
        uniqueMaterials: this._materialCount,
        sceneBBox: this._sceneBoundingBox
      });
    }

    // 2. 创建几何数据纹理
    this._createPositionsTexture();
    this._createIndicesTexture();
    this._createNormalsTexture();

    // 3. 创建实例数据纹理
    this._createMatricesTexture();
    this._createColorsAndFlagsTexture();
    this._createColorOverrideTexture();
    this._createMaterialPaletteTexture();
    this._createPrimitiveToObjectTexture();

    // 4. 创建渲染对象
    this._createRenderObjects();

    this._compiled = true;

    if (this._debug) {
      console.log(`✅ DTXLayer 编译完成`);
    }
  }

  /**
   * 重新编译（用于增量追加对象后的 GPU 资源重建）
   * - 保留 CPU 侧注册表与缓冲区（geometries/objects/颜色覆盖等）
   * - 释放并重建 GPU DataTexture/材质/网格
   * - 若已 addToScene，则会自动替换场景中的 mesh 引用
   */
  recompile(): void {
    const scene = this._scene;

    if (scene && this._mesh) {
      scene.remove(this._mesh);
    }

    // 释放旧 GPU 资源
    this._positionsTexture?.dispose();
    this._indicesTexture?.dispose();
    this._normalsTexture?.dispose();
    this._matricesTexture?.dispose();
    this._colorsAndFlagsTexture?.dispose();
    this._primitiveToObjectTexture?.dispose();
    this._materialPaletteTexture?.dispose();
    this._colorOverrideTexture?.dispose();

    this._positionsTexture = null;
    this._indicesTexture = null;
    this._normalsTexture = null;
    this._matricesTexture = null;
    this._colorsAndFlagsTexture = null;
    this._primitiveToObjectTexture = null;
    this._materialPaletteTexture = null;
    this._colorOverrideTexture = null;

    this._geometry?.dispose();
    this._material?.dispose();
    this._pickingMaterial?.dispose();

    this._geometry = null;
    this._material = null;
    this._mesh = null;
    this._pickingMaterial = null;
    this._pickingMesh = null;

    this._compiled = false;

    // 重新创建纹理与 mesh
    this.compile();

    if (scene) {
      this._scene = scene;
      this._lightingCacheDirty = true;
      if (this._mesh) {
        scene.add(this._mesh);
      }
    }
  }

  /**
   * 获取场景包围盒（用于外部诊断/视口适配）
   */
  getBoundingBox(): Box3 {
    return this._sceneBoundingBox.clone().applyMatrix4(this._globalModelMatrix);
  }

  /**
   * 设置全局模型变换（影响渲染、包围盒查询与 CPU 射线求交）
   * - 在 compile() 前调用：缓存矩阵，编译时注入材质 uniform
   * - 在 compile() 后调用：同步更新材质 uniform
   */
  setGlobalModelMatrix(matrix: Matrix4): void {
    this._globalModelMatrix.copy(matrix);

    if (this._material) {
      (this._material.uniforms as any).globalModelMatrix.value = this._globalModelMatrix;
    }
    if (this._pickingMaterial) {
      (this._pickingMaterial.uniforms as any).globalModelMatrix.value = this._globalModelMatrix;
    }
  }

  getGlobalModelMatrix(): Matrix4 {
    return this._globalModelMatrix.clone();
  }

  /**
   * 创建顶点位置纹理
   * 使用 Float32 (RGBA32F) 存储，避免全局 16bit 量化在大场景下导致小几何体退化。
   */
  private _createPositionsTexture(): void {
    const width = POSITIONS_TEXTURE_WIDTH;
    const height = Math.ceil(this._totalVertices / width);

    // 使用 RGBA32F 存储 (xyz + padding)
    const data = new Float32Array(width * height * 4);

    for (let i = 0; i < this._totalVertices; i++) {
      const base = i * 3;
      data[i * 4] = this._positionsBuffer[base]!;
      data[i * 4 + 1] = this._positionsBuffer[base + 1]!;
      data[i * 4 + 2] = this._positionsBuffer[base + 2]!;
      data[i * 4 + 3] = 0.0; // padding
    }

    this._positionsTexture = new DataTexture(data, width, height, RGBAFormat, FloatType);
    this._positionsTexture.internalFormat = 'RGBA32F';
    this._positionsTexture.minFilter = NearestFilter;
    this._positionsTexture.magFilter = NearestFilter;
    this._positionsTexture.generateMipmaps = false;
    this._positionsTexture.needsUpdate = true;

    if (this._debug) {
      console.log(`📦 位置纹理: ${width}x${height} (${(data.byteLength / 1024 / 1024).toFixed(2)} MB)`);
    }
  }

  /**
   * 创建索引纹理
   */
  private _createIndicesTexture(): void {
    const width = INDICES_TEXTURE_WIDTH;
    const height = Math.ceil(this._totalIndices / width);

    // 使用 R32UI 存储
    const data = new Uint32Array(width * height);
    data.set(this._indicesBuffer.subarray(0, this._totalIndices));

    this._indicesTexture = new DataTexture(data, width, height, RedIntegerFormat, UnsignedIntType);
    this._indicesTexture.internalFormat = 'R32UI';
    this._indicesTexture.minFilter = NearestFilter;
    this._indicesTexture.magFilter = NearestFilter;
    this._indicesTexture.generateMipmaps = false;
    this._indicesTexture.needsUpdate = true;

    if (this._debug) {
      console.log(`📦 索引纹理: ${width}x${height} (${(data.byteLength / 1024 / 1024).toFixed(2)} MB)`);
    }
  }

  /**
   * 创建法线纹理
   */
  private _createNormalsTexture(): void {
    const width = POSITIONS_TEXTURE_WIDTH;
    const height = Math.ceil(this._totalVertices / width);

    // 使用 RGBA32F 存储 (xyz + padding)
    const data = new Float32Array(width * height * 4);

    for (let i = 0; i < this._totalVertices; i++) {
      data[i * 4] = this._normalsBuffer[i * 3]!;
      data[i * 4 + 1] = this._normalsBuffer[i * 3 + 1]!;
      data[i * 4 + 2] = this._normalsBuffer[i * 3 + 2]!;
      data[i * 4 + 3] = 0.0; // padding
    }

    this._normalsTexture = new DataTexture(data, width, height, RGBAFormat, FloatType);
    this._normalsTexture.internalFormat = 'RGBA32F';
    this._normalsTexture.minFilter = NearestFilter;
    this._normalsTexture.magFilter = NearestFilter;
    this._normalsTexture.generateMipmaps = false;
    this._normalsTexture.needsUpdate = true;

    if (this._debug) {
      console.log(`📦 法线纹理: ${width}x${height}`);
    }
  }

  /**
   * 创建矩阵纹理
   * 每个对象占用 4 行（4x4 矩阵）
   */
  private _createMatricesTexture(): void {
    const width = OBJECTS_TEXTURE_WIDTH;
    const height = Math.ceil(this._totalObjects / width) * 4;

    // 使用 RGBA32F 存储
    const data = new Float32Array(width * height * 4);

    for (let i = 0; i < this._totalObjects; i++) {
      const srcOffset = i * 16;
      const objX = i % width;
      const objY = Math.floor(i / width) * 4;

      // 4 行，每行 4 个 float
      for (let row = 0; row < 4; row++) {
        const dstOffset = ((objY + row) * width + objX) * 4;
        data[dstOffset] = this._matricesBuffer[srcOffset + row * 4]!;
        data[dstOffset + 1] = this._matricesBuffer[srcOffset + row * 4 + 1]!;
        data[dstOffset + 2] = this._matricesBuffer[srcOffset + row * 4 + 2]!;
        data[dstOffset + 3] = this._matricesBuffer[srcOffset + row * 4 + 3]!;
      }
    }

    this._matricesTexture = new DataTexture(data, width, height, RGBAFormat, FloatType);
    this._matricesTexture.internalFormat = 'RGBA32F';
    this._matricesTexture.minFilter = NearestFilter;
    this._matricesTexture.magFilter = NearestFilter;
    this._matricesTexture.generateMipmaps = false;
    this._matricesTexture.needsUpdate = true;

    if (this._debug) {
      console.log(`📦 矩阵纹理: ${width}x${height} (${(data.byteLength / 1024 / 1024).toFixed(2)} MB)`);
    }
  }

  /**
   * 创建颜色和标志纹理
   * 每个对象占用 4 个像素 (材质调色板优化后)
   */
  private _createColorsAndFlagsTexture(): void {
    const pixelsPerRow = OBJECTS_TEXTURE_WIDTH * PIXELS_PER_OBJECT;
    const height = Math.ceil(this._totalObjects / OBJECTS_TEXTURE_WIDTH);

    // 使用 RGBA8UI
    const data = new Uint8Array(pixelsPerRow * height * 4);

    for (let i = 0; i < this._totalObjects; i++) {
      const srcOffset = i * 16; // 4 pixels * 4 channels
      const objX = (i % OBJECTS_TEXTURE_WIDTH) * PIXELS_PER_OBJECT;
      const objY = Math.floor(i / OBJECTS_TEXTURE_WIDTH);

      // 4 个像素
      for (let p = 0; p < PIXELS_PER_OBJECT; p++) {
        const dstOffset = (objY * pixelsPerRow + objX + p) * 4;
        data[dstOffset] = this._colorsAndFlagsBuffer[srcOffset + p * 4]!;
        data[dstOffset + 1] = this._colorsAndFlagsBuffer[srcOffset + p * 4 + 1]!;
        data[dstOffset + 2] = this._colorsAndFlagsBuffer[srcOffset + p * 4 + 2]!;
        data[dstOffset + 3] = this._colorsAndFlagsBuffer[srcOffset + p * 4 + 3]!;
      }
    }

    this._colorsAndFlagsTexture = new DataTexture(
      data,
      pixelsPerRow,
      height,
      RGBAIntegerFormat,
      UnsignedByteType
    );
    this._colorsAndFlagsTexture.internalFormat = 'RGBA8UI';
    this._colorsAndFlagsTexture.minFilter = NearestFilter;
    this._colorsAndFlagsTexture.magFilter = NearestFilter;
    this._colorsAndFlagsTexture.generateMipmaps = false;
    this._colorsAndFlagsTexture.needsUpdate = true;

    if (this._debug) {
      console.log(`📦 颜色/标志纹理: ${pixelsPerRow}x${height} (优化后，每对象 ${PIXELS_PER_OBJECT} 像素)`);
    }
  }

  /**
   * 创建颜色覆盖纹理
   * 用于独立颜色覆盖（选中高亮等场景）
   */
  private _createColorOverrideTexture(): void {
    const width = OBJECTS_TEXTURE_WIDTH;
    const height = Math.ceil(this._totalObjects / width);

    // 使用 RGBA8
    const data = new Uint8Array(width * height * 4);

    for (let i = 0; i < this._totalObjects; i++) {
      const srcOffset = i * 4;
      const dstOffset = i * 4;
      data[dstOffset] = this._colorOverrideBuffer[srcOffset]!;
      data[dstOffset + 1] = this._colorOverrideBuffer[srcOffset + 1]!;
      data[dstOffset + 2] = this._colorOverrideBuffer[srcOffset + 2]!;
      data[dstOffset + 3] = this._colorOverrideBuffer[srcOffset + 3]!;
    }

    this._colorOverrideTexture = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType);
    this._colorOverrideTexture.internalFormat = 'RGBA8';
    this._colorOverrideTexture.minFilter = NearestFilter;
    this._colorOverrideTexture.magFilter = NearestFilter;
    this._colorOverrideTexture.generateMipmaps = false;
    this._colorOverrideTexture.needsUpdate = true;

    if (this._debug) {
      console.log(`📦 颜色覆盖纹理: ${width}x${height}`);
    }
  }

  /**
   * 创建材质调色板纹理
   * 每材质占 2 行: row0=[r,g,b,metalness], row1=[roughness,0,0,0]
   */
  private _createMaterialPaletteTexture(): void {
    // 256 材质，每材质 2 行，每行 4 floats
    const width = MAX_MATERIAL_PALETTE_SIZE;
    const height = 2;

    const data = new Float32Array(width * height * 4);

    for (let i = 0; i < this._materialCount; i++) {
      const srcOffset = i * 8;
      // row 0: r, g, b, metalness
      data[i * 4] = this._materialPaletteBuffer[srcOffset + 0]!;
      data[i * 4 + 1] = this._materialPaletteBuffer[srcOffset + 1]!;
      data[i * 4 + 2] = this._materialPaletteBuffer[srcOffset + 2]!;
      data[i * 4 + 3] = this._materialPaletteBuffer[srcOffset + 3]!;
      // row 1: roughness, 0, 0, 0
      data[width * 4 + i * 4] = this._materialPaletteBuffer[srcOffset + 4]!;
      data[width * 4 + i * 4 + 1] = 0;
      data[width * 4 + i * 4 + 2] = 0;
      data[width * 4 + i * 4 + 3] = 0;
    }

    this._materialPaletteTexture = new DataTexture(data, width, height, RGBAFormat, FloatType);
    this._materialPaletteTexture.internalFormat = 'RGBA32F';
    this._materialPaletteTexture.minFilter = NearestFilter;
    this._materialPaletteTexture.magFilter = NearestFilter;
    this._materialPaletteTexture.generateMipmaps = false;
    this._materialPaletteTexture.needsUpdate = true;

    if (this._debug) {
      console.log(`📦 材质调色板纹理: ${width}x${height} (${this._materialCount} 种材质)`);
    }
  }

  /**
   * 创建图元到对象映射纹理
   */
  private _createPrimitiveToObjectTexture(): void {
    // 按照 drawTriangleCount 生成，每图元 1 像素，不进行压缩以简化 shader 并支持复用
    const totalTriangles = this._drawTriangleCount;
    const width = INDICES_TEXTURE_WIDTH;
    const height = Math.ceil(totalTriangles / width);

    const data = new Uint32Array(width * height);

    // 为每个对象的图元段设置对应的 objectIndex
    for (const obj of this._objectsArray) {
      const triangleCount = Math.floor(obj.indexCount / 3);
      const start = obj.primitiveOffset;
      const end = start + triangleCount;

      for (let p = start; p < end && p < data.length; p++) {
        data[p] = obj.objectIndex;
      }
    }

    this._primitiveToObjectTexture = new DataTexture(
      data,
      width,
      height,
      RedIntegerFormat,
      UnsignedIntType
    );
    this._primitiveToObjectTexture.internalFormat = 'R32UI';
    this._primitiveToObjectTexture.minFilter = NearestFilter;
    this._primitiveToObjectTexture.magFilter = NearestFilter;
    this._primitiveToObjectTexture.generateMipmaps = false;
    this._primitiveToObjectTexture.needsUpdate = true;

    if (this._debug) {
      console.log(`📦 图元映射纹理: ${width}x${height}`);
    }
  }

  /**
   * 创建渲染对象 (Material, Geometry, Mesh)
   */
  private _createRenderObjects(): void {
    // 创建材质
    this._material = new DTXMaterial({
      positionsTexture: this._positionsTexture,
      indicesTexture: this._indicesTexture,
      normalsTexture: this._normalsTexture,
      matricesTexture: this._matricesTexture,
      colorsAndFlagsTexture: this._colorsAndFlagsTexture,
      primitiveToObjectTexture: this._primitiveToObjectTexture,
      materialPaletteTexture: this._materialPaletteTexture,
      colorOverrideTexture: this._colorOverrideTexture,
      globalModelMatrix: this._globalModelMatrix,
      positionsTextureWidth: POSITIONS_TEXTURE_WIDTH,
      indicesTextureWidth: INDICES_TEXTURE_WIDTH,
      objectsTextureWidth: OBJECTS_TEXTURE_WIDTH,
      primitiveToObjectTextureWidth: INDICES_TEXTURE_WIDTH
    });

    // 创建几何体 (不再是 totalIndices，而是 drawIndexCount)
    this._geometry = new DTXGeometry(this._drawIndexCount);

    // 创建网格
    this._mesh = new Mesh(this._geometry, this._material);
    this._mesh.frustumCulled = false; // DTX 自己管理裁剪
    this._mesh.name = 'DTXLayer';

    // 创建 GPU Picking 材质与网格
    this._pickingMaterial = new DTXPickingMaterial({
      positionsTexture: this._positionsTexture,
      indicesTexture: this._indicesTexture,
      matricesTexture: this._matricesTexture,
      colorsAndFlagsTexture: this._colorsAndFlagsTexture,
      primitiveToObjectTexture: this._primitiveToObjectTexture,
      globalModelMatrix: this._globalModelMatrix,
      positionsTextureWidth: POSITIONS_TEXTURE_WIDTH,
      indicesTextureWidth: INDICES_TEXTURE_WIDTH,
      objectsTextureWidth: OBJECTS_TEXTURE_WIDTH,
      primitiveToObjectTextureWidth: INDICES_TEXTURE_WIDTH
    });

    this._pickingMesh = new Mesh(this._geometry, this._pickingMaterial);
    this._pickingMesh.frustumCulled = false;
    this._pickingMesh.name = 'DTXLayerPicking';
  }

  // ========== 渲染 ==========

  /**
   * 添加到场景
   */
  addToScene(scene: Scene): void {
    if (!this._compiled) {
      throw new Error('请先调用 compile() 编译 DTXLayer');
    }

    this._scene = scene;
    this._lightingCacheDirty = true;
    if (this._mesh) {
      scene.add(this._mesh);
    }
  }

  /**
   * 获取 GPU Picking Mesh
   */
  getPickingMesh(): Mesh | null {
    return this._pickingMesh;
  }

  /**
   * 从场景移除
   */
  removeFromScene(): void {
    if (this._scene && this._mesh) {
      this._scene.remove(this._mesh);
    }
    this._scene = null;
    this._lightingCacheDirty = true;
  }

  setRenderer(renderer: WebGLRenderer | null): void {
    this._renderer = renderer;
  }

  /**
   * 更新（每帧调用）
   */
  update(camera: Camera): void {
    // 三大矩阵与 cameraPosition 由 Three.js 自动注入 GLSL 内建 uniform。
    // DTX 的自定义 ShaderMaterial 不接入 three.js lights 系统，需要显式同步场景灯光。
    void camera;
    this._syncLighting();
  }

  private _syncLighting(): void {
    if (!this._material) return;
    const scene = this._scene;
    if (!scene) return;

    if (this._lightingCacheDirty) {
      this._refreshLightingCache(scene);
      this._lightingCacheDirty = false;
    } else {
      // 低成本兜底：只扫描 scene.children（避免 traverse），适配灯光动态增删
      this._refreshLightingCacheShallow(scene);
    }

    // 1) AmbientLight：累加（color * intensity）
    let ambientR = 0;
    let ambientG = 0;
    let ambientB = 0;
    for (const a of this._cachedAmbientLights) {
      if (!a.visible) continue;
      const i = a.intensity ?? 0;
      ambientR += a.color.r * i;
      ambientG += a.color.g * i;
      ambientB += a.color.b * i;
    }

    // 2) DirectionalLight：取强度最高的两盏（与 Viewer 当前“主光 + 补光”对齐）
    let best0: DirectionalLight | null = null;
    let best1: DirectionalLight | null = null;
    let best0I = -Infinity;
    let best1I = -Infinity;
    for (const l of this._cachedDirectionalLights) {
      if (!l || !l.visible) continue;
      const i = l.intensity ?? 0;
      if (i >= best0I) {
        best1 = best0;
        best1I = best0I;
        best0 = l;
        best0I = i;
      } else if (i > best1I) {
        best1 = l;
        best1I = i;
      }
    }

    // 默认值：无方向光时保持第二盏为黑
    this._tmpDir0.set(1, 1, 1).normalize();
    this._tmpColor0.setRGB(1, 1, 1);
    this._tmpDir1.set(-1, 0.4, -1).normalize();
    this._tmpColor1.setRGB(0, 0, 0);

    if (best0) {
      // direction 取“从点到光”的方向（用于 dot(N, L)）
      best0.getWorldPosition(this._tmpLightPos0);
      best0.target.getWorldPosition(this._tmpTargetPos0);
      this._tmpDir0.copy(this._tmpLightPos0).sub(this._tmpTargetPos0).normalize();
      this._tmpColor0.copy(best0.color).multiplyScalar(best0.intensity ?? 1);
    }
    if (best1) {
      best1.getWorldPosition(this._tmpLightPos1);
      best1.target.getWorldPosition(this._tmpTargetPos1);
      this._tmpDir1.copy(this._tmpLightPos1).sub(this._tmpTargetPos1).normalize();
      this._tmpColor1.copy(best1.color).multiplyScalar(best1.intensity ?? 1);
    }

    const u: any = this._material.uniforms;
    u.ambientLight.value.set(ambientR, ambientG, ambientB);
    u.lightDirection0.value.copy(this._tmpDir0);
    u.lightColor0.value.set(this._tmpColor0.r, this._tmpColor0.g, this._tmpColor0.b);
    u.lightDirection1.value.copy(this._tmpDir1);
    u.lightColor1.value.set(this._tmpColor1.r, this._tmpColor1.g, this._tmpColor1.b);
  }

  private _refreshLightingCache(scene: Scene): void {
    this._cachedAmbientLights = [];
    this._cachedDirectionalLights = [];

    this._refreshLightingCacheShallow(scene);

    if (this._cachedAmbientLights.length === 0 && this._cachedDirectionalLights.length === 0) {
      scene.traverse((obj: any) => {
        if (obj?.isAmbientLight) this._cachedAmbientLights.push(obj as AmbientLight);
        if (obj?.isDirectionalLight) this._cachedDirectionalLights.push(obj as DirectionalLight);
      });
    }
  }

  private _refreshLightingCacheShallow(scene: Scene): void {
    const amb: AmbientLight[] = [];
    const dir: DirectionalLight[] = [];
    for (const child of scene.children as any[]) {
      if (child?.isAmbientLight) amb.push(child as AmbientLight);
      if (child?.isDirectionalLight) dir.push(child as DirectionalLight);
    }
    this._cachedAmbientLights = amb;
    this._cachedDirectionalLights = dir;
  }

  // ========== 对象属性更新 ==========

  private _getMaterialPaletteEntry(materialIndex: number): MaterialPaletteEntry | null {
    if (materialIndex < 0 || materialIndex >= MAX_MATERIAL_PALETTE_SIZE) return null;
    const offset = materialIndex * 8;
    const r = this._materialPaletteBuffer[offset + 0]!;
    const g = this._materialPaletteBuffer[offset + 1]!;
    const b = this._materialPaletteBuffer[offset + 2]!;
    const metalness = this._materialPaletteBuffer[offset + 3]!;
    const roughness = this._materialPaletteBuffer[offset + 4]!;
    return {
      color: new Color(r, g, b),
      metalness,
      roughness
    };
  }

  private _syncMaterialPaletteTexture(materialIndex: number): void {
    if (!this._materialPaletteTexture) return;
    if (materialIndex < 0 || materialIndex >= MAX_MATERIAL_PALETTE_SIZE) return;

    const entry = this._getMaterialPaletteEntry(materialIndex);
    if (!entry) return;

    const texData = this._materialPaletteTexture.image.data as Float32Array;
    const width = MAX_MATERIAL_PALETTE_SIZE;

    // row 0: [r, g, b, metalness]
    const row0 = (0 * width + materialIndex) * 4;
    texData[row0 + 0] = entry.color.r;
    texData[row0 + 1] = entry.color.g;
    texData[row0 + 2] = entry.color.b;
    texData[row0 + 3] = entry.metalness;

    // row 1: [roughness, 0, 0, 0]
    const row1 = (1 * width + materialIndex) * 4;
    texData[row1 + 0] = entry.roughness;
    texData[row1 + 1] = 0;
    texData[row1 + 2] = 0;
    texData[row1 + 3] = 0;

    this._materialPaletteTexture.needsUpdate = true;
  }

  /**
   * 设置对象的基础材质（颜色 + PBR 参数），使用材质调色板生效。
   * 默认会清除颜色覆盖标志，使其回到“使用调色板”的渲染路径。
   */
  setObjectMaterial(objectId: string, params: MaterialParams, options: { keepColorOverride?: boolean } = {}): void {
    const obj = this._objects.get(objectId);
    if (!obj) return;

    const current = this._getMaterialPaletteEntry(obj.materialIndex) ?? {
      color: new Color(1, 1, 1),
      metalness: 0.5,
      roughness: 0.5
    };

    const nextColor = params.color ?? current.color;
    const nextMetalness = params.metalness ?? current.metalness;
    const nextRoughness = params.roughness ?? current.roughness;

    const nextMaterialIndex = this._getOrCreateMaterialIndex(nextColor, nextMetalness, nextRoughness);

    if (nextMaterialIndex !== obj.materialIndex) {
      obj.materialIndex = nextMaterialIndex;

      const flagsOffset = obj.objectIndex * 16;
      this._colorsAndFlagsBuffer[flagsOffset + 0] = nextMaterialIndex;

      if (this._colorsAndFlagsTexture) {
        const pixelsPerRow = OBJECTS_TEXTURE_WIDTH * PIXELS_PER_OBJECT;
        const objX = (obj.objectIndex % OBJECTS_TEXTURE_WIDTH) * PIXELS_PER_OBJECT;
        const objY = Math.floor(obj.objectIndex / OBJECTS_TEXTURE_WIDTH);
        const dstOffset = (objY * pixelsPerRow + objX) * 4 + 0; // pixel 0, byte 0 (materialIndex)
        const texData = this._colorsAndFlagsTexture.image.data as Uint8Array;
        texData[dstOffset] = nextMaterialIndex;
        this._colorsAndFlagsTexture.needsUpdate = true;
      }
    }

    if (!options.keepColorOverride) {
      obj.hasColorOverride = false;
      const flagsOffset = obj.objectIndex * 16;
      this._colorsAndFlagsBuffer[flagsOffset + 1] = 0; // hasColorOverride = false

      if (this._colorsAndFlagsTexture) {
        const pixelsPerRow = OBJECTS_TEXTURE_WIDTH * PIXELS_PER_OBJECT;
        const objX = (obj.objectIndex % OBJECTS_TEXTURE_WIDTH) * PIXELS_PER_OBJECT;
        const objY = Math.floor(obj.objectIndex / OBJECTS_TEXTURE_WIDTH);
        const dstOffset = (objY * pixelsPerRow + objX) * 4 + 1; // pixel 0, byte 1 (hasColorOverride)
        const texData = this._colorsAndFlagsTexture.image.data as Uint8Array;
        texData[dstOffset] = 0;
        this._colorsAndFlagsTexture.needsUpdate = true;
      }
    }

    this._syncMaterialPaletteTexture(nextMaterialIndex);
  }

  /**
   * 设置对象颜色（使用颜色覆盖，支持独立颜色）
   */
  setObjectColor(objectId: string, color: Color): void {
    const obj = this._objects.get(objectId);
    if (!obj) return;

    obj.hasColorOverride = true;
    obj.colorOverride.copy(color);

    // 设置 hasColorOverride 标志到缓冲区
    const flagsOffset = obj.objectIndex * 16;
    this._colorsAndFlagsBuffer[flagsOffset + 1] = 1; // hasColorOverride = true

    // 更新颜色覆盖缓冲区
    const overrideOffset = obj.objectIndex * 4;
    const r = Math.floor(color.r * 255);
    const g = Math.floor(color.g * 255);
    const b = Math.floor(color.b * 255);
    this._colorOverrideBuffer[overrideOffset + 0] = r;
    this._colorOverrideBuffer[overrideOffset + 1] = g;
    this._colorOverrideBuffer[overrideOffset + 2] = b;
    this._colorOverrideBuffer[overrideOffset + 3] = 255;

    // 同步 hasColorOverride 标志到纹理 image.data
    if (this._colorsAndFlagsTexture) {
      const pixelsPerRow = OBJECTS_TEXTURE_WIDTH * PIXELS_PER_OBJECT;
      const objX = (obj.objectIndex % OBJECTS_TEXTURE_WIDTH) * PIXELS_PER_OBJECT;
      const objY = Math.floor(obj.objectIndex / OBJECTS_TEXTURE_WIDTH);
      const dstOffset = (objY * pixelsPerRow + objX) * 4 + 1; // pixel 0, byte 1 (hasColorOverride)
      const texData = this._colorsAndFlagsTexture.image.data as Uint8Array;
      texData[dstOffset] = 1;
      this._colorsAndFlagsTexture.needsUpdate = true;
    }

    // 同步颜色覆盖数据到纹理 image.data
    if (this._colorOverrideTexture) {
      const width = OBJECTS_TEXTURE_WIDTH;
      const objX = obj.objectIndex % width;
      const objY = Math.floor(obj.objectIndex / width);
      const texData = this._colorOverrideTexture.image.data as Uint8Array;
      const texOffset = (objY * width + objX) * 4;
      texData[texOffset + 0] = r;
      texData[texOffset + 1] = g;
      texData[texOffset + 2] = b;
      texData[texOffset + 3] = 255;
      this._colorOverrideTexture.needsUpdate = true;
    }
  }

  /**
   * 重置对象颜色（恢复使用材质调色板）
   */
  resetObjectColor(objectId: string): void {
    const obj = this._objects.get(objectId);
    if (!obj) return;

    obj.hasColorOverride = false;

    // 清除 hasColorOverride 标志到缓冲区
    const flagsOffset = obj.objectIndex * 16;
    this._colorsAndFlagsBuffer[flagsOffset + 1] = 0; // hasColorOverride = false

    // 同步 hasColorOverride 标志到纹理 image.data
    if (this._colorsAndFlagsTexture) {
      const pixelsPerRow = OBJECTS_TEXTURE_WIDTH * PIXELS_PER_OBJECT;
      const objX = (obj.objectIndex % OBJECTS_TEXTURE_WIDTH) * PIXELS_PER_OBJECT;
      const objY = Math.floor(obj.objectIndex / OBJECTS_TEXTURE_WIDTH);
      const dstOffset = (objY * pixelsPerRow + objX) * 4 + 1; // pixel 0, byte 1 (hasColorOverride)
      const texData = this._colorsAndFlagsTexture.image.data as Uint8Array;
      texData[dstOffset] = 0;
      this._colorsAndFlagsTexture.needsUpdate = true;
    }
  }

  /**
   * 设置对象可见性
   */
  setObjectVisible(objectId: string, visible: boolean): void {
    const obj = this._objects.get(objectId);
    if (!obj) return;

    obj.visible = visible;

    const flagsOffset = obj.objectIndex * 16 + 2; // pixel 0, byte 2
    this._colorsAndFlagsBuffer[flagsOffset] = visible ? 1 : 0;

    // 同步更新纹理数据
    if (this._colorsAndFlagsTexture) {
      const pixelsPerRow = OBJECTS_TEXTURE_WIDTH * PIXELS_PER_OBJECT;
      const objX = (obj.objectIndex % OBJECTS_TEXTURE_WIDTH) * PIXELS_PER_OBJECT;
      const objY = Math.floor(obj.objectIndex / OBJECTS_TEXTURE_WIDTH);
      const dstOffset = (objY * pixelsPerRow + objX) * 4 + 2; // pixel 0, byte 2
      const texData = this._colorsAndFlagsTexture.image.data as Uint8Array;
      texData[dstOffset] = visible ? 1 : 0;
      this._colorsAndFlagsTexture.needsUpdate = true;
    }
  }

  /**
   * 批量设置所有对象的可见性
   */
  setAllVisible(visible: boolean): void {
    const flag = visible ? 1 : 0;

    // 更新内部缓冲区
    for (const obj of this._objects.values()) {
      obj.visible = visible;
      const flagsOffset = obj.objectIndex * 16 + 2;
      this._colorsAndFlagsBuffer[flagsOffset] = flag;
    }

    // 同步更新纹理数据
    if (this._colorsAndFlagsTexture) {
      const pixelsPerRow = OBJECTS_TEXTURE_WIDTH * PIXELS_PER_OBJECT;
      const texData = this._colorsAndFlagsTexture.image.data as Uint8Array;

      for (const obj of this._objects.values()) {
        const objX = (obj.objectIndex % OBJECTS_TEXTURE_WIDTH) * PIXELS_PER_OBJECT;
        const objY = Math.floor(obj.objectIndex / OBJECTS_TEXTURE_WIDTH);
        const dstOffset = (objY * pixelsPerRow + objX) * 4 + 2; // pixel 0, byte 2
        texData[dstOffset] = flag;
      }

      this._colorsAndFlagsTexture.needsUpdate = true;
    }
  }

  /**
   * 设置对象矩阵
   */
  setObjectMatrix(objectId: string, matrix: Matrix4): void {
    const obj = this._objects.get(objectId);
    if (!obj) return;

    matrix.toArray(this._matricesBuffer, obj.objectIndex * 16);

    // 需要重建矩阵纹理的对应区域
    // 简化实现：标记整个纹理需要更新
    if (this._matricesTexture) {
      // TODO: 实现局部更新
      this._matricesTexture.needsUpdate = true;
    }
  }

  // ========== 对象查询 ==========

  /**
   * 通过 objectId 获取对象
   */
  getObject(objectId: string): DTXObject | undefined {
    return this._objects.get(objectId);
  }

  /**
   * 获取所有对象 ID
   */
  getAllObjectIds(): string[] {
    return Array.from(this._objects.keys());
  }

  /**
   * 获取对象包围盒
   */
  getObjectBoundingBox(objectId: string): Box3 | null {
    return this.getObjectBoundingBoxInto(objectId, new Box3());
  }

  /**
   * 获取对象包围盒（写入到 target，避免大量 Box3 分配）
   */
  getObjectBoundingBoxInto(objectId: string, target: Box3): Box3 | null {
    const obj = this._objects.get(objectId);
    if (!obj) return null;
    return target.copy(obj.boundingBox).applyMatrix4(this._globalModelMatrix);
  }

  /**
   * 通过索引获取对象 ID
   */
  getObjectIdByIndex(index: number): string | null {
    const obj = this._objectsArray[index];
    return obj ? obj.objectId : null;
  }

  /**
   * 获取对象的几何体和变换矩阵 (用于 Outline)
   */
  getObjectGeometryData(objectId: string): {
    geometry: BufferGeometry;
    matrix: Matrix4;
  } | null {
    const obj = this._objects.get(objectId);
    if (!obj) return null;

    // 获取几何体句柄
    const geoHandle = this._geometries.get(obj.geoHash);
    if (!geoHandle) return null;

    // 为 Outline 构造“真实几何体”（DTXGeometry 为虚拟属性，无法用于 OutlinePass）
    let geometry = this._outlineGeometryCache.get(obj.geoHash) || null;
    if (geometry) {
      // LRU touch
      this._outlineGeometryCache.delete(obj.geoHash);
      this._outlineGeometryCache.set(obj.geoHash, geometry);
    } else {
      const vStart = geoHandle.vertexBase * 3;
      const vEnd = (geoHandle.vertexBase + geoHandle.vertexCount) * 3;
      const iStart = geoHandle.indexBase;
      const iEnd = geoHandle.indexBase + geoHandle.indexCount;

      const positions = this._positionsBuffer.slice(vStart, vEnd);
      const normals = this._normalsBuffer.slice(vStart, vEnd);
      const indices = this._indicesBuffer.slice(iStart, iEnd);

      geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new BufferAttribute(normals, 3));
      geometry.setIndex(new BufferAttribute(indices, 1));
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();

      this._outlineGeometryCache.set(obj.geoHash, geometry);
      if (this._outlineGeometryCache.size > this._outlineGeometryCacheLimit) {
        const oldest = this._outlineGeometryCache.entries().next().value as [string, BufferGeometry] | undefined;
        if (oldest) {
          const [oldestKey, oldestGeometry] = oldest;
          this._outlineGeometryCache.delete(oldestKey);
          oldestGeometry.dispose();
        }
      }
    }

    // 从矩阵缓冲区读取变换矩阵
    const matrix = new Matrix4();
    matrix.fromArray(this._matricesBuffer, obj.objectIndex * 16);
    matrix.premultiply(this._globalModelMatrix);

    return {
      geometry,
      matrix
    };
  }

  /**
   * 🔧 调试：从 GPU DataTexture 反解对象参数，并校验 primitive->object 映射区间
   *
   * 典型用途：debugRefno 下发现“只显示一个部件/像所有图元都映射到同一 object”时，
   * 用本方法确认 primitiveToObjectTexture、colorsAndFlagsTexture 的打包与 shader 解包是否一致。
   */
  debugValidateGpuMappings(
    objectIds: string[],
    options: {
      /** 每个对象区间内采样上限（区间过大时会抽样） */
      maxPrimitiveSamplesPerObject?: number;
      /** primitiveToObjectTexture 区间统计最多输出的 unique 值数量 */
      maxUniqueObjectIndexReport?: number;
      /** 是否打印每个对象的详细对比（否则仅输出异常项） */
      verbose?: boolean;
    } = {}
  ): void {
    // 仅在 DTXLayer debug 模式下启用，避免线上产生额外开销/日志
    if (!this._debug) return;

    const {
      maxPrimitiveSamplesPerObject = 2000,
      maxUniqueObjectIndexReport = 10,
      verbose = true
    } = options;

    if (!this._compiled) {
      console.warn('[DTX][DEBUG] 尚未 compile()，无法进行 GPU 反解诊断');
      return;
    }
    if (!this._colorsAndFlagsTexture || !this._primitiveToObjectTexture) {
      console.warn('[DTX][DEBUG] 缺少 colorsAndFlagsTexture 或 primitiveToObjectTexture');
      return;
    }

    const colorsTexData = this._colorsAndFlagsTexture.image.data as Uint8Array | undefined;
    const primTexData = this._primitiveToObjectTexture.image.data as Uint32Array | undefined;
    if (!colorsTexData || !primTexData) {
      console.warn('[DTX][DEBUG] DataTexture.image.data 为空，无法进行 GPU 反解诊断');
      return;
    }

    const colorsTexWidth = OBJECTS_TEXTURE_WIDTH * PIXELS_PER_OBJECT;
    const unpack32 = (offset: number): number => {
      // 与 shader 保持一致：uint unpack32(uvec4 packed) { (r<<24)|(g<<16)|(b<<8)|a }
      const r = colorsTexData[offset] ?? 0;
      const g = colorsTexData[offset + 1] ?? 0;
      const b = colorsTexData[offset + 2] ?? 0;
      const a = colorsTexData[offset + 3] ?? 0;
      return (((r << 24) | (g << 16) | (b << 8) | a) >>> 0);
    };

    const decodeGpuFlagsForObjectIndex = (objectIndex: number) => {
      const objX = (objectIndex % OBJECTS_TEXTURE_WIDTH) * PIXELS_PER_OBJECT;
      const objY = Math.floor(objectIndex / OBJECTS_TEXTURE_WIDTH);
      const base0 = (objY * colorsTexWidth + (objX + 0)) * 4;
      const base1 = (objY * colorsTexWidth + (objX + 1)) * 4;
      const base2 = (objY * colorsTexWidth + (objX + 2)) * 4;
      const base3 = (objY * colorsTexWidth + (objX + 3)) * 4;

      return {
        materialIndex: colorsTexData[base0 + 0] ?? 0,
        hasColorOverride: (colorsTexData[base0 + 1] ?? 0) > 0,
        visibleFlag: colorsTexData[base0 + 2] ?? 0,
        selectedFlag: colorsTexData[base0 + 3] ?? 0,
        primitiveOffset: unpack32(base1),
        vertexBase: unpack32(base2),
        indexOffset: unpack32(base3)
      };
    };

    const problems: Array<Record<string, any>> = [];
    const summaries: Array<Record<string, any>> = [];

    for (const objectId of objectIds) {
      const obj = this._objects.get(objectId);
      if (!obj) {
        problems.push({ objectId, error: 'objectId 未注册到 DTXLayer' });
        continue;
      }

      const gpu = decodeGpuFlagsForObjectIndex(obj.objectIndex);
      const cpu = {
        objectIndex: obj.objectIndex,
        geoHash: obj.geoHash,
        primitiveOffset: obj.primitiveOffset,
        vertexBase: obj.vertexBase,
        indexOffset: obj.indexOffset,
        indexCount: obj.indexCount,
        visible: obj.visible,
        materialIndex: obj.materialIndex,
        hasColorOverride: obj.hasColorOverride
      };

      const triangleCount = Math.floor(obj.indexCount / 3);
      const start = obj.primitiveOffset;
      const end = start + triangleCount;
      const segLen = Math.max(0, end - start);

      // 统计 primitiveToObjectTexture 在该对象区间内的 unique objectIndex 分布
      const counts = new Map<number, number>();
      if (segLen > 0) {
        const step = segLen > maxPrimitiveSamplesPerObject
          ? Math.ceil(segLen / maxPrimitiveSamplesPerObject)
          : 1;
        for (let p = start; p < end && p < primTexData.length; p += step) {
          const v = primTexData[p] ?? 0;
          counts.set(v, (counts.get(v) || 0) + 1);
        }
      }

      const topUniques = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxUniqueObjectIndexReport)
        .map(([k, v]) => ({ objectIndex: k, samples: v }));

      const mappingLooksWrong = counts.size > 0 && (counts.size > 1 || !counts.has(obj.objectIndex));

      const mismatch: Record<string, any> = {};
      const checkEq = (key: string, a: any, b: any) => {
        if (a !== b) mismatch[key] = { cpu: a, gpu: b };
      };

      checkEq('materialIndex', cpu.materialIndex, gpu.materialIndex);
      checkEq('hasColorOverride', cpu.hasColorOverride, gpu.hasColorOverride);
      checkEq('visibleFlag', cpu.visible ? 1 : 0, gpu.visibleFlag);
      checkEq('primitiveOffset', cpu.primitiveOffset, gpu.primitiveOffset);
      checkEq('vertexBase', cpu.vertexBase, gpu.vertexBase);
      checkEq('indexOffset', cpu.indexOffset, gpu.indexOffset);

      const summary = {
        objectId,
        geoHash: cpu.geoHash,
        objectIndex: cpu.objectIndex,
        triangleCount,
        primitiveRange: `[${start}, ${end})`,
        primitiveSamples: segLen > 0 ? Math.min(segLen, maxPrimitiveSamplesPerObject) : 0,
        primitiveToObjectTop: topUniques
      };
      summaries.push(summary);

      if (Object.keys(mismatch).length > 0 || mappingLooksWrong) {
        problems.push({
          ...summary,
          flagsMismatch: Object.keys(mismatch).length > 0 ? mismatch : null,
          mappingLooksWrong
        });
      } else if (verbose) {
        // verbose 时也保留正常项，便于对照
        // （不放进 problems，避免误导）
      }
    }

    console.groupCollapsed?.(`[DTX][DEBUG] GPU 映射诊断: objects=${objectIds.length}, problems=${problems.length}`);
    if (verbose) {
      console.log('[DTX][DEBUG] 汇总（每对象 primitiveToObjectTop 为采样统计）:');
      try {
        console.table(summaries);
      } catch {
        console.log(summaries);
      }
    }
    if (problems.length > 0) {
      console.warn('[DTX][DEBUG] 异常项（flagsMismatch / mappingLooksWrong）:');
      try {
        console.table(problems);
      } catch {
        console.warn(problems);
      }
    }
    console.groupEnd?.();
  }

  /**
   * 射线与指定对象求交，返回最近交点与三角形
   */
  raycastObject(
    objectId: string,
    origin: Vector3,
    direction: Vector3
  ): { point: Vector3; distance: number; triangle: [Vector3, Vector3, Vector3] } | null {
    const obj = this._objects.get(objectId);
    if (!obj) return null;

    const geoHandle = this._geometries.get(obj.geoHash);
    if (!geoHandle) return null;

    const ray = new Ray(origin, direction);
    const boxHit = new Vector3();
    // 注意：obj.boundingBox 为“对象矩阵”下的 world bbox；全局变换需在求交前应用
    const worldBox = obj.boundingBox.clone().applyMatrix4(this._globalModelMatrix);
    if (!ray.intersectBox(worldBox, boxHit)) {
      return null;
    }

    const matrix = new Matrix4();
    matrix.fromArray(this._matricesBuffer, obj.objectIndex * 16);

    const tempA = new Vector3();
    const tempB = new Vector3();
    const tempC = new Vector3();
    const tempHit = new Vector3();
    let closestDistance = Infinity;
    let closestPoint: Vector3 | null = null;
    let closestTriangle: [Vector3, Vector3, Vector3] | null = null;

    const indexStart = obj.indexOffset;
    const indexEnd = obj.indexOffset + obj.indexCount;
    const vertexBase = geoHandle.vertexBase;

    for (let i = indexStart; i < indexEnd; i += 3) {
      const ia = this._indicesBuffer[i]!;
      const ib = this._indicesBuffer[i + 1]!;
      const ic = this._indicesBuffer[i + 2]!;

      const aIdx = (vertexBase + ia) * 3;
      const bIdx = (vertexBase + ib) * 3;
      const cIdx = (vertexBase + ic) * 3;

      tempA.set(
        this._positionsBuffer[aIdx]!,
        this._positionsBuffer[aIdx + 1]!,
        this._positionsBuffer[aIdx + 2]!
      ).applyMatrix4(matrix);
      tempB.set(
        this._positionsBuffer[bIdx]!,
        this._positionsBuffer[bIdx + 1]!,
        this._positionsBuffer[bIdx + 2]!
      ).applyMatrix4(matrix);
      tempC.set(
        this._positionsBuffer[cIdx]!,
        this._positionsBuffer[cIdx + 1]!,
        this._positionsBuffer[cIdx + 2]!
      ).applyMatrix4(matrix);

      const hit = ray.intersectTriangle(tempA, tempB, tempC, false, tempHit);
      if (!hit) continue;

      const distance = origin.distanceTo(tempHit);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestPoint = tempHit.clone();
        closestTriangle = [tempA.clone(), tempB.clone(), tempC.clone()];
      }
    }

    if (!closestPoint || !closestTriangle) {
      return null;
    }

    return {
      point: closestPoint,
      distance: closestDistance,
      triangle: closestTriangle
    };
  }

  /**
   * 计算点到指定对象的最近点（用于点到面测量）
   * - 基于 getObjectGeometryData() 的缓存几何体数据
   * - 返回最近点、距离与对应三角形
   */
  closestPointToObject(
    objectId: string,
    point: Vector3
  ): { point: Vector3; distance: number; triangle: [Vector3, Vector3, Vector3] } | null {
    const data = this.getObjectGeometryData(objectId)
    if (!data) return null

    const { geometry, matrix } = data
    const posAttr = geometry.getAttribute('position') as BufferAttribute | undefined
    const idxAttr = geometry.getIndex() as BufferAttribute | null
    if (!posAttr) return null

    const tri = new Triangle()
    const a = new Vector3()
    const b = new Vector3()
    const c = new Vector3()
    const tmp = new Vector3()

    let bestDistSq = Infinity
    const bestPoint = new Vector3()
    const bestA = new Vector3()
    const bestB = new Vector3()
    const bestC = new Vector3()

    const indexCount = idxAttr ? idxAttr.count : posAttr.count
    for (let i = 0; i + 2 < indexCount; i += 3) {
      const ia = idxAttr ? idxAttr.getX(i) : i
      const ib = idxAttr ? idxAttr.getX(i + 1) : i + 1
      const ic = idxAttr ? idxAttr.getX(i + 2) : i + 2

      a.fromBufferAttribute(posAttr, ia).applyMatrix4(matrix)
      b.fromBufferAttribute(posAttr, ib).applyMatrix4(matrix)
      c.fromBufferAttribute(posAttr, ic).applyMatrix4(matrix)

      tri.set(a, b, c)
      tri.closestPointToPoint(point, tmp)

      const d2 = tmp.distanceToSquared(point)
      if (d2 < bestDistSq) {
        bestDistSq = d2
        bestPoint.copy(tmp)
        bestA.copy(a)
        bestB.copy(b)
        bestC.copy(c)
      }
    }

    if (!Number.isFinite(bestDistSq)) return null

    return {
      point: bestPoint.clone(),
      distance: Math.sqrt(bestDistSq),
      triangle: [bestA.clone(), bestB.clone(), bestC.clone()],
    }
  }

  /**
   * 获取所有对象及其包围盒 (用于构建 K-D 树)
   */
  getAllObjectsWithBounds(): Array<{ objectId: string; boundingBox: Box3 }> {
    const result: Array<{ objectId: string; boundingBox: Box3 }> = [];
    for (const [objectId, obj] of this._objects) {
      result.push({
        objectId,
        boundingBox: obj.boundingBox.clone().applyMatrix4(this._globalModelMatrix)
      });
    }
    return result;
  }

  /**
   * 检查对象是否存在
   */
  hasObject(objectId: string): boolean {
    return this._objects.has(objectId);
  }

  /**
   * 获取对象数量
   */
  get objectCount(): number {
    return this._objects.size;
  }

  // ========== 统计信息 ==========

  /**
   * 获取统计信息
   */
  getStats(): {
    totalVertices: number;
    totalIndices: number;
    totalObjects: number;
    uniqueGeometries: number;
    uniqueMaterials: number;
    compiled: boolean;
  } {
    return {
      totalVertices: this._totalVertices,
      totalIndices: this._totalIndices,
      totalObjects: this._totalObjects,
      uniqueGeometries: this._geometries.size,
      uniqueMaterials: this._materialCount,
      compiled: this._compiled
    };
  }

  // getBoundingBox 已移动到上面

  // ========== 资源释放 ==========

  /**
   * 释放资源
   */
  dispose(): void {
    this.removeFromScene();

    for (const [, geometry] of this._outlineGeometryCache) {
      geometry.dispose();
    }
    this._outlineGeometryCache.clear();

    // 释放纹理
    this._positionsTexture?.dispose();
    this._indicesTexture?.dispose();
    this._normalsTexture?.dispose();
    this._matricesTexture?.dispose();
    this._colorsAndFlagsTexture?.dispose();
    this._primitiveToObjectTexture?.dispose();
    this._materialPaletteTexture?.dispose();
    this._colorOverrideTexture?.dispose();

    // 释放渲染对象
    this._geometry?.dispose();
    this._material?.dispose();
    this._pickingMaterial?.dispose();

    // 清理引用
    this._geometries.clear();
    this._objects.clear();
    this._objectsArray = [];
    this._materialPalette.clear();

    if (this._debug) {
      console.log('🗑️ DTXLayer 已释放');
    }
  }
}
