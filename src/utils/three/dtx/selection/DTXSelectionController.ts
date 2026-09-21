/**
 * DTXSelectionController - DTX 选中/拾取控制器（精简版）
 *
 * 职责：
 * - GPU picking：快速命中 objectId
 * - CPU picking：获取精确交点（用于测量/吸附）
 * - SelectionManager：选中/高亮的颜色覆盖
 * - ObjectsKdTree：射线候选集加速（1000 objects 场景足够）
 * - Outline：可选（通过替身 Mesh + OutlinePass）
 *
 * 说明：
 * - 不依赖 DTXPrepackLoader；如需 refno 级定位，由外部注入 resolver。
 */

import { Box3, Camera, Color, Frustum, Matrix4, Raycaster, Scene, Vector2, Vector3, WebGLRenderer } from 'three';

import { DTXLayer } from '../DTXLayer';
import { DTXOutlineHelper, type OutlineStyle } from '../outline/DTXOutlineHelper';

import { DTXOverlayHighlighter, type DTXOverlayHighlightStyle } from './DTXOverlayHighlighter';
import { EventEmitter } from './EventEmitter';
import { GPUPicker, type PickResult } from './GPUPicker';
import { ObjectsKdTree } from './ObjectsKdTree';
import { SelectionManager } from './SelectionManager';

export type DTXSelectionControllerOptions = {
  dtxLayer: DTXLayer
  scene: Scene
  camera: Camera
  renderer: WebGLRenderer
  container: HTMLElement
  selectionColor?: Color | number | string
  /** 「当前元素」颜色（最近一批选中），见 SelectionManagerOptions.primarySelectionColor */
  primarySelectionColor?: Color | number | string | null
  /** 悬停高亮颜色 */
  highlightColor?: Color | number | string
  enableOutline?: boolean
  /** 选中高亮模式：outline（后处理描边）| overlay（覆层填充+描边）| both */
  highlightMode?: 'outline' | 'overlay' | 'both'
  /** outline 模式样式（默认：橙色描边） */
  outlineStyle?: OutlineStyle
  /** overlay 模式样式（默认：蓝面+绿边） */
  overlayStyle?: DTXOverlayHighlightStyle
  resolveObjectIdsByRefno?: (refno: string) => string[]
}

export type LocateOptions = {
  select?: boolean
  flyTo?: boolean
  duration?: number
}

export type DTXPickPointHit = {
  objectId: string
  point: Vector3
  distance: number
  triangle: [Vector3, Vector3, Vector3]
}

export type PickPointsOptions = {
  /** 最多返回的命中数，按距离升序截断。默认 10。 */
  limit?: number
}

/** 密集管廊下同一射线可命中几十个对象，逐个做三角形级求交开销不可控，默认截断。 */
const DEFAULT_PICK_POINTS_LIMIT = 10;

export class DTXSelectionController extends EventEmitter {
  private _dtxLayer: DTXLayer;
  private _scene: Scene;
  private _camera: Camera;
  private _renderer: WebGLRenderer;
  private _container: HTMLElement;

  private _resolveObjectIdsByRefno: ((refno: string) => string[]) | null;

  private _kdTree: ObjectsKdTree;
  private _selectionManager: SelectionManager;
  private _outlineHelper: DTXOutlineHelper | null = null;
  private _overlayHighlighter: DTXOverlayHighlighter | null = null;
  private _gpuPicker: GPUPicker;
  private _highlightMode: 'outline' | 'overlay' | 'both';
  private _outlineStyle: OutlineStyle | undefined;

  constructor(options: DTXSelectionControllerOptions) {
    super();

    this._dtxLayer = options.dtxLayer;
    this._scene = options.scene;
    this._camera = options.camera;
    this._renderer = options.renderer;
    this._container = options.container;
    this._resolveObjectIdsByRefno = options.resolveObjectIdsByRefno ?? null;

    this._kdTree = new ObjectsKdTree();
    this.refreshSpatialIndex();

    this._selectionManager = new SelectionManager({
      selectionColor: options.selectionColor ?? 0xff8800,
      primarySelectionColor: options.primarySelectionColor ?? null,
      ...(options.highlightColor !== undefined ? { highlightColor: options.highlightColor } : {}),
      multiSelect: true,
    });
    this._selectionManager.setColorUpdateCallback((objectId, color) => {
      if (color) {
        this._dtxLayer.setObjectColor(objectId, color);
        return;
      }
      this._dtxLayer.resetObjectColor(objectId);
    });
    this._highlightMode = options.highlightMode ?? 'outline';
    this._outlineStyle = options.outlineStyle;
    this._setupSelectionManager();

    this._gpuPicker = new GPUPicker(this._renderer);
    this._gpuPicker.setObjectIndexMapper((index) => this._dtxLayer.getObjectIdByIndex(index));

    const enableOutline =
      (options.enableOutline ?? true) &&
      (this._highlightMode === 'outline' || this._highlightMode === 'both');
    if (enableOutline) {
      this._initOutlineHelper();
    }

    if (this._highlightMode === 'overlay' || this._highlightMode === 'both') {
      this._overlayHighlighter = new DTXOverlayHighlighter(this._scene, options.overlayStyle);
      this._overlayHighlighter.setGeometryGetter((objectId) =>
        this._dtxLayer.getObjectGeometryData(objectId),
      );
    }
  }

  select(objectIds: string | string[], additive = false): void {
    this._selectionManager.select(objectIds, additive);
  }

  deselect(objectIds?: string | string[]): void {
    this._selectionManager.deselect(objectIds);
  }

  clearSelection(): void {
    this._selectionManager.clearSelection();
  }

  getSelected(): string[] {
    return this._selectionManager.getSelected();
  }

  isSelected(objectId: string): boolean {
    return this._selectionManager.isSelected(objectId);
  }

  setSelectionColor(color: Color | number | string): void {
    this._selectionManager.setSelectionColor(color);
  }

  /** 「当前元素」颜色（E3D 的 CE）：最近一次选进来的那批用它，其余选中用 selectionColor；null = 不区分 */
  setPrimarySelectionColor(color: Color | number | string | null): void {
    this._selectionManager.setPrimarySelectionColor(color);
  }

  /** 悬停高亮颜色 */
  setHighlightColor(color: Color | number | string): void {
    this._selectionManager.setHighlightColor(color);
  }

  getPrimarySelected(): string[] {
    return this._selectionManager.getPrimarySelected();
  }

  setOutlineEnabled(enabled: boolean): void {
    this._outlineHelper?.setEnabled(enabled);
  }

  hasOutline(): boolean {
    return !!this._outlineHelper;
  }

  hasOutlinedObjects(): boolean {
    return (this._outlineHelper?.getOutlinedObjects()?.length ?? 0) > 0;
  }

  renderOutline(): void {
    this._outlineHelper?.render();
  }

  resize(width: number, height: number): void {
    this._outlineHelper?.resize(width, height);
  }

  pick(canvasPos: Vector2): PickResult | null {
    const pickingMesh = this._dtxLayer.getPickingMesh();
    if (!pickingMesh) return null;
    return this._gpuPicker.pick(canvasPos, this._camera, pickingMesh);
  }

  /**
   * 沿光标射线返回全部命中，按距离由近到远排序。
   *
   * kd-tree 本就返回射线穿过的全部对象，此处不再丢弃被遮挡的命中，
   * 以支撑「在重叠构件之间轮换候选」的拾取交互。
   */
  pickPoints(canvasPos: Vector2, options: PickPointsOptions = {}): DTXPickPointHit[] {
    const limit = Math.max(1, options.limit ?? DEFAULT_PICK_POINTS_LIMIT);

    this._camera.updateMatrixWorld(true);

    const rect = this._container.getBoundingClientRect();
    const ndc = new Vector2((canvasPos.x / rect.width) * 2 - 1, -(canvasPos.y / rect.height) * 2 + 1);

    const raycaster = new Raycaster();
    raycaster.setFromCamera(ndc, this._camera);

    const origin = raycaster.ray.origin;
    const direction = raycaster.ray.direction;

    const candidates = this._kdTree.queryRay(origin, direction);
    if (candidates.length === 0) return [];

    const hits: DTXPickPointHit[] = [];
    for (const objectId of candidates) {
      const hit = this._dtxLayer.raycastObject(objectId, origin, direction);
      if (!hit) continue;
      hits.push({ objectId, ...hit });
    }

    hits.sort((a, b) => a.distance - b.distance);
    return hits.length > limit ? hits.slice(0, limit) : hits;
  }

  pickPoint(canvasPos: Vector2): DTXPickPointHit | null {
    return this.pickPoints(canvasPos, { limit: 1 })[0] ?? null;
  }

  locateByRefno(refno: string, options: LocateOptions = {}): boolean {
    if (!this._resolveObjectIdsByRefno) {
      console.warn('DTXSelectionController: 未提供 resolveObjectIdsByRefno，无法 locateByRefno');
      return false;
    }
    const objectIds = this._resolveObjectIdsByRefno(refno);
    return this._locateObjects(objectIds, options);
  }

  locateByObjectId(objectId: string, options: LocateOptions = {}): boolean {
    if (!this._dtxLayer.hasObject(objectId)) {
      console.warn(`DTXSelectionController: 未找到 objectId=${objectId}`);
      return false;
    }
    return this._locateObjects([objectId], options);
  }

  locateByObjectIds(objectIds: string[], options: LocateOptions = {}): boolean {
    return this._locateObjects(objectIds, options);
  }

  refreshSpatialIndex(): void {
    this._kdTree.clear();
    this._kdTree.addObjects(this._dtxLayer.getAllObjectsWithBounds());
    this._kdTree.build();
  }

  private _setupSelectionManager(): void {
    // 注意：不再使用颜色覆盖来显示选中状态，而是只使用 OutlinePass
    // 这样可以保持原始的 PBR 材质渲染效果，避免选中时切换渲染路径
    // 参考 AiosPrepackViewer.vue 的做法

    this._selectionManager.on('selectionChanged', (event) => {
      if (this._highlightMode === 'outline' || this._highlightMode === 'both') {
        this._outlineHelper?.setOutlinedObjects(event.selected);
      }
      if (this._highlightMode === 'overlay' || this._highlightMode === 'both') {
        this._overlayHighlighter?.setHighlightedObjects(event.selected);
      }
      this.emit('selectionChanged', event);
    });
  }

  private _initOutlineHelper(): void {
    this._outlineHelper = new DTXOutlineHelper(this._scene, this._camera, this._renderer);
    this._outlineHelper.init();
    this._outlineHelper.setGeometryGetter((objectId) => this._dtxLayer.getObjectGeometryData(objectId));
    this._outlineHelper.setStyle({
      edgeColor: 0xff8800,
      edgeStrength: 2.5,
      edgeGlow: 0.5,
      edgeThickness: 1.0,
      ...this._outlineStyle,
    });
  }

  private _locateObjects(objectIds: string[], options: LocateOptions): boolean {
    if (!objectIds || objectIds.length === 0) return false;

    const { select = true, flyTo = true, duration = 1000 } = options;

    const bbox = new Box3();
    const tmpBox = new Box3();
    for (const objectId of objectIds) {
      const objBbox = this._dtxLayer.getObjectBoundingBoxInto(objectId, tmpBox);
      if (objBbox) bbox.union(objBbox);
    }
    if (bbox.isEmpty()) return false;

    if (select) {
      this._selectionManager.select(objectIds, false);
    }

    if (flyTo) {
      this._emitFlyToBoundingBox(bbox, duration);
    }

    this.emit('located', { objectIds, boundingBox: bbox });
    return true;
  }

  private _emitFlyToBoundingBox(bbox: Box3, duration: number): void {
    const center = bbox.getCenter(new Vector3());
    const size = bbox.getSize(new Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const distance = Math.max(maxDim * 2.5, 5);

    const targetPosition = new Vector3(center.x + distance * 0.8, center.y + distance * 0.6, center.z + distance * 0.8);

    this.emit('flyTo', {
      position: targetPosition,
      target: center,
      duration,
    });
  }

  boxSelect(rect: { startX: number; startY: number; endX: number; endY: number }): string[] {
    const selected: string[] = [];
    const frustum = this._createSelectionFrustum(rect);
    
    for (const objectId of this._dtxLayer.getAllObjectIds()) {
      const bbox = this._dtxLayer.getObjectBoundingBox(objectId);
      if (bbox && frustum.intersectsBox(bbox)) {
        selected.push(objectId);
      }
    }
    
    return selected;
  }

  private _createSelectionFrustum(rect: { startX: number; startY: number; endX: number; endY: number }): Frustum {
    const frustum = new Frustum();
    
    const canvas = this._container;
    const canvasRect = canvas.getBoundingClientRect();
    
    const x1 = ((Math.min(rect.startX, rect.endX) - canvasRect.left) / canvasRect.width) * 2 - 1;
    const y1 = -((Math.min(rect.startY, rect.endY) - canvasRect.top) / canvasRect.height) * 2 + 1;
    const x2 = ((Math.max(rect.startX, rect.endX) - canvasRect.left) / canvasRect.width) * 2 - 1;
    const y2 = -((Math.max(rect.startY, rect.endY) - canvasRect.top) / canvasRect.height) * 2 + 1;
    
    const projMatrix = new Matrix4().multiplyMatrices(
      this._camera.projectionMatrix,
      this._camera.matrixWorldInverse
    );
    frustum.setFromProjectionMatrix(projMatrix);
    
    return frustum;
  }

  dispose(): void {
    this._outlineHelper?.dispose();
    this._overlayHighlighter?.dispose();
    this._selectionManager.dispose();
    this._gpuPicker.dispose();
    this.removeAllListeners();
  }
}
