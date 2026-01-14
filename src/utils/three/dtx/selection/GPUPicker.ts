/**
 * GPUPicker - GPU 拾取器
 *
 * 使用 GPU Color Picking 技术实现高效的对象拾取。
 * 通过渲染一帧到离屏 buffer，每个对象用唯一颜色编码 objectIndex，
 * 读取点击位置像素值解码得到 objectId。
 */

import {
  Camera,
  Color,
  DataTexture,
  UnsignedByteType,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PerspectiveCamera,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget
} from 'three';

// ========== 类型定义 ==========

/**
 * 拾取结果
 */
export interface PickResult {
  /** 对象 ID */
  objectId: string;
  /** 对象索引 */
  objectIndex: number;
  /** 拾取点的世界坐标 (如果可用) */
  point?: Vector3;
  /** 到相机的距离 */
  distance?: number;
}

/**
 * 对象索引到 ID 的映射函数
 */
export type ObjectIndexToIdMapper = (index: number) => string | null;

// ========== GPUPicker 类 ==========

/**
 * GPU 拾取器
 */
export class GPUPicker {
  private _renderer: WebGLRenderer;
  private _pickingTarget: WebGLRenderTarget;
  private _pickingScene: Scene;
  private _pixelBuffer: Uint8Array;
  private _objectIndexToId: ObjectIndexToIdMapper | null = null;

  /** 拾取区域大小 (像素) */
  private _pickRadius = 1;

  constructor(renderer: WebGLRenderer) {
    this._renderer = renderer;

    // 创建离屏渲染目标（默认 3x3，pickRadius=1）
    // 注意：必须与 _pickRadius 匹配，否则 _decodeObjectIndex 会读到越界像素导致永远拾取失败
    const size = this._pickRadius * 2 + 1;
    this._pickingTarget = new WebGLRenderTarget(size, size, {
      format: RGBAFormat,
      type: UnsignedByteType,
      minFilter: NearestFilter,
      magFilter: NearestFilter
    });

    this._pickingScene = new Scene();
    this._pixelBuffer = new Uint8Array(size * size * 4);
  }

  /**
   * 设置对象索引到 ID 的映射函数
   */
  setObjectIndexMapper(mapper: ObjectIndexToIdMapper): void {
    this._objectIndexToId = mapper;
  }

  /**
   * 设置拾取半径
   */
  setPickRadius(radius: number): void {
    this._pickRadius = Math.max(1, radius);
    this._resizePickingTarget();
  }

  /**
   * 调整拾取目标大小
   */
  private _resizePickingTarget(): void {
    const size = this._pickRadius * 2 + 1;
    this._pickingTarget.setSize(size, size);
    this._pixelBuffer = new Uint8Array(size * size * 4);
  }

  /**
   * 通过 Canvas 坐标拾取
   */
  pick(
    canvasPos: Vector2,
    camera: Camera,
    pickingMesh: Mesh | null
  ): PickResult | null {
    if (!pickingMesh || !this._objectIndexToId) {
      return null;
    }

    // 保存当前渲染状态
    const currentRenderTarget = this._renderer.getRenderTarget();
    const currentClearColor = this._renderer.getClearColor(new Color());
    const currentClearAlpha = this._renderer.getClearAlpha();

    try {
      // 设置拾取场景
      this._pickingScene.children = [];
      this._pickingScene.add(pickingMesh);

      // 创建拾取相机 (裁剪到点击位置)
      const pickCamera = this._createPickCamera(canvasPos, camera);

      // 渲染到离屏目标
      this._renderer.setRenderTarget(this._pickingTarget);
      this._renderer.setClearColor(0x000000, 0);
      this._renderer.clear();
      this._renderer.render(this._pickingScene, pickCamera);

      // 读取像素
      this._renderer.readRenderTargetPixels(
        this._pickingTarget,
        0, 0,
        this._pickingTarget.width,
        this._pickingTarget.height,
        this._pixelBuffer
      );

      const debugPick = typeof window !== 'undefined' && window.localStorage?.getItem('AIOS_PICK_DEBUG') === '1';
      if (debugPick) {
        const size = this._pickRadius * 2 + 1;
        const centerIdx = Math.floor(size * size / 2) * 4;
        const rgba = Array.from(this._pixelBuffer.slice(centerIdx, centerIdx + 4));
        // eslint-disable-next-line no-console
        console.debug('[AIOS][GPUPicker] center RGBA:', rgba, { canvasPos, size });
      }

      // 解码对象索引
      const objectIndex = this._decodeObjectIndex();
      if (objectIndex < 0) {
        return null;
      }

      // 映射到对象 ID
      const objectId = this._objectIndexToId(objectIndex);
      if (!objectId) {
        return null;
      }

      return {
        objectId,
        objectIndex
      };
    } finally {
      // 恢复渲染状态
      this._renderer.setRenderTarget(currentRenderTarget);
      this._renderer.setClearColor(currentClearColor, currentClearAlpha);
      this._pickingScene.children = [];
    }
  }

  /**
   * 创建拾取相机
   */
  private _createPickCamera(canvasPos: Vector2, camera: Camera): Camera {
    const pickCamera = camera.clone() as PerspectiveCamera | OrthographicCamera;
    const pixelRatio = this._renderer.getPixelRatio ? this._renderer.getPixelRatio() : 1;
    const rendererSize = this._renderer.getSize(new Vector2());
    const fullWidth = Math.max(1, Math.floor(rendererSize.x * pixelRatio));
    const fullHeight = Math.max(1, Math.floor(rendererSize.y * pixelRatio));

    const viewSize = this._pickRadius * 2 + 1;
    const cx = Math.floor(canvasPos.x * pixelRatio);
    const cy = Math.floor(canvasPos.y * pixelRatio);

    let offsetX = cx - this._pickRadius;
    let offsetY = cy - this._pickRadius;
    offsetX = Math.max(0, Math.min(fullWidth - viewSize, offsetX));
    offsetY = Math.max(0, Math.min(fullHeight - viewSize, offsetY));

    // 使用 Three.js 标准的 viewOffset 裁剪投影视锥，避免手改 projectionMatrix 导致拾取失效
    if (pickCamera instanceof PerspectiveCamera || pickCamera instanceof OrthographicCamera) {
      pickCamera.setViewOffset(fullWidth, fullHeight, offsetX, offsetY, viewSize, viewSize);
      pickCamera.updateProjectionMatrix();
    }

    return pickCamera;
  }

  /**
   * 解码对象索引
   */
  private _decodeObjectIndex(): number {
    // 查找中心像素或最常见的非零值
    const size = this._pickRadius * 2 + 1;
    const centerIdx = Math.floor(size * size / 2) * 4;

    if (centerIdx + 3 >= this._pixelBuffer.length) {
      return -1;
    }

    const r = this._pixelBuffer[centerIdx];
    const g = this._pixelBuffer[centerIdx + 1];
    const b = this._pixelBuffer[centerIdx + 2];
    const a = this._pixelBuffer[centerIdx + 3];

    // 检查是否为空 (背景)
    if (a === 0) {
      return -1;
    }

    // 从 RGBA 解码对象索引
    // 使用 24 位编码 (RGB)，支持最多 16M 个对象
    return r! + (g! << 8) + (b! << 16);
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this._pickingTarget.dispose();
    this._objectIndexToId = null;
  }
}
