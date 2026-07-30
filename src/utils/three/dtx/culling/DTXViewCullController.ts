import type { DTXLayer } from '../DTXLayer';
import { Box3, Frustum, Matrix4, Vector3, type Camera } from 'three';

type CullRegion = {
  aabb: Box3;
  objectIds: string[];
  visible: boolean | null;
};

const GRID_AXIS_CELLS = 16;
const REBUILD_SETTLE_MS = 100;

/**
 * View Frustum Culling（按对象 AABB）
 *
 * 将对象按世界空间网格聚合成区域，按区域更新 DataTexture 可见掩码。
 * 业务隐藏/隔离保存在 DTXLayer.visible，优先于这里的视锥掩码。
 */
export class DTXViewCullController {
  private _dtxLayer: DTXLayer;
  private _regions: CullRegion[] = [];
  private _dirty = true;
  private _lastCamera: Camera | null = null;
  private _rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private _frustum = new Frustum();
  private _projectionView = new Matrix4();

  constructor(options: { dtxLayer: DTXLayer }) {
    this._dtxLayer = options.dtxLayer;
  }

  refreshSpatialIndex(): void {
    this._dirty = true;
    if (this._rebuildTimer !== null) {
      clearTimeout(this._rebuildTimer);
      this._rebuildTimer = null;
    }
    this._scheduleRebuild();
  }

  update(camera: Camera): void {
    this._lastCamera = camera;
    if (this._dirty) {
      this._scheduleRebuild();
      return;
    }
    this._apply(camera);
  }

  dispose(): void {
    if (this._rebuildTimer !== null) {
      clearTimeout(this._rebuildTimer);
      this._rebuildTimer = null;
    }
    this._regions = [];
    this._lastCamera = null;
  }

  private _scheduleRebuild(): void {
    if (!this._lastCamera || this._rebuildTimer !== null) return;
    this._rebuildTimer = setTimeout(() => {
      this._rebuildTimer = null;
      if (!this._lastCamera || !this._dirty) return;
      this._rebuild();
      this._apply(this._lastCamera);
    }, REBUILD_SETTLE_MS);
  }

  private _rebuild(): void {
    const ids = this._dtxLayer.getAllObjectIds();
    const sceneBox = this._dtxLayer.getBoundingBox();
    if (ids.length === 0 || sceneBox.isEmpty()) {
      this._regions = [];
      this._dirty = false;
      return;
    }

    const size = sceneBox.getSize(new Vector3());
    const scratchBox = new Box3();
    const center = new Vector3();
    const cells = new Map<number, CullRegion>();
    const cellIndex = (value: number, min: number, span: number) =>
      Math.min(GRID_AXIS_CELLS - 1, Math.max(0, Math.floor(
        ((value - min) / Math.max(span, Number.EPSILON)) * GRID_AXIS_CELLS,
      )));

    for (const objectId of ids) {
      const box = this._dtxLayer.getObjectBoundingBoxInto(objectId, scratchBox);
      if (!box || box.isEmpty()) continue;
      box.getCenter(center);
      const x = cellIndex(center.x, sceneBox.min.x, size.x);
      const y = cellIndex(center.y, sceneBox.min.y, size.y);
      const z = cellIndex(center.z, sceneBox.min.z, size.z);
      const key = x + y * GRID_AXIS_CELLS + z * GRID_AXIS_CELLS * GRID_AXIS_CELLS;
      let region = cells.get(key);
      if (!region) {
        region = { aabb: new Box3(), objectIds: [], visible: null };
        cells.set(key, region);
      }
      region.aabb.union(box);
      region.objectIds.push(objectId);
    }

    this._regions = Array.from(cells.values());
    this._dirty = false;
  }

  private _apply(camera: Camera): void {
    camera.updateMatrixWorld();
    this._projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._projectionView);

    for (const region of this._regions) {
      const visible = this._frustum.intersectsBox(region.aabb);
      if (region.visible === visible) continue;
      region.visible = visible;
      this._dtxLayer.setObjectsFrustumVisible(region.objectIds, visible);
    }
  }
}

