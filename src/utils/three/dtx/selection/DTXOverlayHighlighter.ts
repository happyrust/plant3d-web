import {
  EdgesGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Scene,
  Vector2,
  type BufferGeometry,
  type ColorRepresentation,
} from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

export type DTXOverlayHighlightStyle = {
  /** 是否绘制填充面，默认 true。 */
  showFill?: boolean;
  /** 是否绘制 edge 线段，默认 true。 */
  showEdges?: boolean;
  fillColor?: ColorRepresentation;
  fillOpacity?: number;
  edgeColor?: ColorRepresentation;
  edgeOpacity?: number;
  edgeLineWidth?: number;
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
  private _edgeMat: LineMaterial;
  private _highlightedObjectCount = 0;

  // LRU：key = `${geometry.uuid}:${thresholdAngle}`
  private _edgesCache = new Map<string, LineSegmentsGeometry>();
  private _edgesCacheLimit = 128;
  private _resolution = new Vector2(1, 1);

  private _style: Required<DTXOverlayHighlightStyle>;

  constructor(scene: Scene, style: DTXOverlayHighlightStyle = {}) {
    this._scene = scene;
    this._group = new Group();
    this._group.name = 'DTXSelectionOverlay';
    this._group.renderOrder = 900;

    this._style = {
      showFill: style.showFill ?? true,
      showEdges: style.showEdges ?? true,
      fillColor: style.fillColor ?? 0x4b7cff,
      fillOpacity: style.fillOpacity ?? 0.85,
      edgeColor: style.edgeColor ?? 0x00ff00,
      edgeOpacity: style.edgeOpacity ?? 1,
      edgeLineWidth: style.edgeLineWidth ?? 1,
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

    this._resolution.set(
      typeof window !== 'undefined' ? window.innerWidth : 1,
      typeof window !== 'undefined' ? window.innerHeight : 1,
    );

    this._edgeMat = new LineMaterial({
      color: this._style.edgeColor,
      depthTest: !this._style.edgeAlwaysOnTop,
      transparent: true,
      opacity: this._style.edgeOpacity,
      linewidth: this._style.edgeLineWidth,
      resolution: this._resolution.clone(),
    });

    this._scene.add(this._group);
  }

  setResolution(width: number, height: number): void {
    this._resolution.set(
      Math.max(1, Number(width) || 1),
      Math.max(1, Number(height) || 1),
    );
    if (this._edgeMat) {
      this._edgeMat.resolution.copy(this._resolution);
    }
  }

  setGeometryGetter(getter: (objectId: string) => GeometryData | null): void {
    this._getGeometryData = getter;
  }

  setStyle(next: DTXOverlayHighlightStyle): void {
    this._style = {
      showFill: next.showFill ?? this._style.showFill,
      showEdges: next.showEdges ?? this._style.showEdges,
      fillColor: next.fillColor ?? this._style.fillColor,
      fillOpacity: next.fillOpacity ?? this._style.fillOpacity,
      edgeColor: next.edgeColor ?? this._style.edgeColor,
      edgeOpacity: next.edgeOpacity ?? this._style.edgeOpacity,
      edgeLineWidth: next.edgeLineWidth ?? this._style.edgeLineWidth,
      edgeThresholdAngle: next.edgeThresholdAngle ?? this._style.edgeThresholdAngle,
      edgeAlwaysOnTop: next.edgeAlwaysOnTop ?? this._style.edgeAlwaysOnTop,
    };

    this._fillMat.color.set(this._style.fillColor);
    this._fillMat.opacity = this._style.fillOpacity;

    this._edgeMat.color.set(this._style.edgeColor);
    this._edgeMat.opacity = this._style.edgeOpacity;
    this._edgeMat.linewidth = this._style.edgeLineWidth;
    this._edgeMat.depthTest = !this._style.edgeAlwaysOnTop;
    this._edgeMat.needsUpdate = true;
  }

  clear(): void {
    // 只清理本次创建的 Mesh/Line，别动 DTXLayer 提供的 geometry。
    this._group.clear();
    this._highlightedObjectCount = 0;
  }

  setHighlightedObjects(objectIds: string[]): void {
    this.clear();
    if (!this._getGeometryData) return;
    if (!objectIds || objectIds.length === 0) return;

    for (const objectId of objectIds) {
      const data = this._getGeometryData(objectId);
      if (!data) continue;

      let fill: Mesh | null = null;
      if (this._style.showFill) {
        fill = new Mesh(data.geometry, this._fillMat);
        fill.matrixAutoUpdate = false;
        fill.frustumCulled = false;
        fill.renderOrder = 901;
        fill.matrix.copy(data.matrix);
        fill.name = `sel_fill_${objectId}`;
      }

      let line: LineSegments2 | null = null;
      if (this._style.showEdges) {
        const edges = this._getEdgeSegmentsGeometry(
          data.geometry,
          this._style.edgeThresholdAngle,
        );
        line = new LineSegments2(edges, this._edgeMat);
        line.matrixAutoUpdate = false;
        line.frustumCulled = false;
        line.renderOrder = 902;
        line.matrix.copy(data.matrix);
        line.name = `sel_edge_${objectId}`;
      }

      if (fill && line) {
        this._group.add(fill, line);
        this._highlightedObjectCount += 1;
      } else if (fill) {
        this._group.add(fill);
        this._highlightedObjectCount += 1;
      } else if (line) {
        this._group.add(line);
        this._highlightedObjectCount += 1;
      }
    }
  }

  getSnapshot(): {
    objectCount: number;
    style: Required<DTXOverlayHighlightStyle>;
    } {
    return {
      objectCount: this._highlightedObjectCount,
      style: { ...this._style },
    };
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

  private _getEdgeSegmentsGeometry(
    geometry: BufferGeometry,
    thresholdAngle: number,
  ): LineSegmentsGeometry {
    const key = `${geometry.uuid}:${thresholdAngle}`;
    const cached = this._edgesCache.get(key);
    if (cached) {
      // LRU touch
      this._edgesCache.delete(key);
      this._edgesCache.set(key, cached);
      return cached;
    }

    const thinEdges = new EdgesGeometry(geometry, thresholdAngle);
    const created = new LineSegmentsGeometry().fromEdgesGeometry(thinEdges);
    thinEdges.dispose();
    this._edgesCache.set(key, created);

    if (this._edgesCache.size > this._edgesCacheLimit) {
      const oldest = this._edgesCache.entries().next().value as
        [string, LineSegmentsGeometry] | undefined;
      if (oldest) {
        const [oldestKey, oldestGeo] = oldest;
        this._edgesCache.delete(oldestKey);
        oldestGeo.dispose();
      }
    }

    return created;
  }
}
