import {
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Scene,
  type BufferGeometry,
  type ColorRepresentation,
} from "three";

export type DTXOverlayHighlightStyle = {
  fillColor?: ColorRepresentation;
  fillOpacity?: number;
  edgeColor?: ColorRepresentation;
  edgeThresholdAngle?: number;
  /** 令边线恒在最上（不被深度遮挡）。默认 false，更近常规描边。 */
  edgeAlwaysOnTop?: boolean;
};

type GeometryData = { geometry: BufferGeometry; matrix: Matrix4 };

/**
 * 方案甲：覆层填充（半透明）+ Edges 描边。
 *
 * 注意：DTXLayer.getObjectGeometryData() 返回的 geometry 为“按 geoHash 缓存”的实例，
 * 属于 DTXLayer 的 Outline 缓存资源；此处不可 dispose 该 geometry。
 */
export class DTXOverlayHighlighter {
  private _scene: Scene;
  private _group: Group;
  private _getGeometryData: ((objectId: string) => GeometryData | null) | null = null;

  private _fillMat: MeshBasicMaterial;
  private _edgeMat: LineBasicMaterial;

  // LRU：key = `${geometry.uuid}:${thresholdAngle}`
  private _edgesCache = new Map<string, EdgesGeometry>();
  private _edgesCacheLimit = 128;

  private _style: Required<DTXOverlayHighlightStyle>;

  constructor(scene: Scene, style: DTXOverlayHighlightStyle = {}) {
    this._scene = scene;
    this._group = new Group();
    this._group.name = "DTXSelectionOverlay";
    this._group.renderOrder = 900;

    this._style = {
      fillColor: style.fillColor ?? 0x4b7cff,
      fillOpacity: style.fillOpacity ?? 0.85,
      edgeColor: style.edgeColor ?? 0x00ff00,
      edgeThresholdAngle: style.edgeThresholdAngle ?? 20,
      edgeAlwaysOnTop: style.edgeAlwaysOnTop ?? false,
    };

    this._fillMat = new MeshBasicMaterial({
      color: this._style.fillColor,
      transparent: true,
      opacity: this._style.fillOpacity,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    this._edgeMat = new LineBasicMaterial({
      color: this._style.edgeColor,
      depthTest: !this._style.edgeAlwaysOnTop,
      transparent: true,
      opacity: 1,
    });

    this._scene.add(this._group);
  }

  setGeometryGetter(getter: (objectId: string) => GeometryData | null): void {
    this._getGeometryData = getter;
  }

  setStyle(next: DTXOverlayHighlightStyle): void {
    this._style = {
      fillColor: next.fillColor ?? this._style.fillColor,
      fillOpacity: next.fillOpacity ?? this._style.fillOpacity,
      edgeColor: next.edgeColor ?? this._style.edgeColor,
      edgeThresholdAngle: next.edgeThresholdAngle ?? this._style.edgeThresholdAngle,
      edgeAlwaysOnTop: next.edgeAlwaysOnTop ?? this._style.edgeAlwaysOnTop,
    };

    this._fillMat.color.set(this._style.fillColor);
    this._fillMat.opacity = this._style.fillOpacity;

    this._edgeMat.color.set(this._style.edgeColor);
    this._edgeMat.depthTest = !this._style.edgeAlwaysOnTop;
    this._edgeMat.needsUpdate = true;
  }

  clear(): void {
    // 只清理本次创建的 Mesh/Line，别动 DTXLayer 提供的 geometry。
    this._group.clear();
  }

  setHighlightedObjects(objectIds: string[]): void {
    this.clear();
    if (!this._getGeometryData) return;
    if (!objectIds || objectIds.length === 0) return;

    for (const objectId of objectIds) {
      const data = this._getGeometryData(objectId);
      if (!data) continue;

      const fill = new Mesh(data.geometry, this._fillMat);
      fill.matrixAutoUpdate = false;
      fill.frustumCulled = false;
      fill.renderOrder = 901;
      fill.matrix.copy(data.matrix);
      fill.name = `sel_fill_${objectId}`;

      const edges = this._getEdgesGeometry(data.geometry, this._style.edgeThresholdAngle);
      const line = new LineSegments(edges, this._edgeMat);
      line.matrixAutoUpdate = false;
      line.frustumCulled = false;
      line.renderOrder = 902;
      line.matrix.copy(data.matrix);
      line.name = `sel_edge_${objectId}`;

      this._group.add(fill, line);
    }
  }

  dispose(): void {
    this.clear();
    this._scene.remove(this._group);

    // 仅释放我们创建的资源
    for (const geo of this._edgesCache.values()) {
      geo.dispose();
    }
    this._edgesCache.clear();
    this._fillMat.dispose();
    this._edgeMat.dispose();
  }

  private _getEdgesGeometry(geometry: BufferGeometry, thresholdAngle: number): EdgesGeometry {
    const key = `${geometry.uuid}:${thresholdAngle}`;
    const cached = this._edgesCache.get(key);
    if (cached) {
      // LRU touch
      this._edgesCache.delete(key);
      this._edgesCache.set(key, cached);
      return cached;
    }

    const created = new EdgesGeometry(geometry, thresholdAngle);
    this._edgesCache.set(key, created);

    if (this._edgesCache.size > this._edgesCacheLimit) {
      const oldest = this._edgesCache.entries().next().value as [string, EdgesGeometry] | undefined;
      if (oldest) {
        const [oldestKey, oldestGeo] = oldest;
        this._edgesCache.delete(oldestKey);
        oldestGeo.dispose();
      }
    }

    return created;
  }
}

