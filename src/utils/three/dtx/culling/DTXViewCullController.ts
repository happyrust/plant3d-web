import type { DTXLayer } from '../DTXLayer';
import type { Camera } from 'three';

export type DTXViewCullOptions = {
  /** 总开关；false 时每层一段画全部（`?dtx_cull=0`） */
  enabled: boolean;
  /** 拖动中跳过屏幕投影直径小于它的构件（px）；0 = 拖动时也不跳（`?dtx_cull_drag_px=`） */
  dragMinPx: number;
  /** 粗网格开关（`?dtx_lod=0` 关闭）：关掉时既不补拉粗网格也不画 */
  lod: boolean;
  /** 投影直径小于它（px）的构件改画粗网格，静止帧也生效；0 = 不用（`?dtx_lod_px=`） */
  lodPx: number;
};

export const DEFAULT_VIEW_CULL_OPTIONS: DTXViewCullOptions = { enabled: true, dragMinPx: 8, lod: true, lodPx: 48 };

/** URL 优先、其次 localStorage；`dtx_cull=0` / `dtx_lod=0` 关闭，`dtx_cull_drag_px` / `dtx_lod_px` 取非负数 */
export function readViewCullOptions(query: URLSearchParams, storage: Pick<Storage, 'getItem'> | null): DTXViewCullOptions {
  const read = (key: string): string | null => {
    const fromQuery = query.get(key);
    if (fromQuery !== null) return fromQuery;
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const readPx = (key: string, fallback: number): number => {
    const raw = read(key);
    const value = raw === null || raw.trim() === '' ? Number.NaN : Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  const enabledRaw = read('dtx_cull');
  const lodRaw = read('dtx_lod');
  return {
    enabled: enabledRaw === null || enabledRaw.trim() !== '0',
    dragMinPx: readPx('dtx_cull_drag_px', DEFAULT_VIEW_CULL_OPTIONS.dragMinPx),
    lod: lodRaw === null || lodRaw.trim() !== '0',
    lodPx: readPx('dtx_lod_px', DEFAULT_VIEW_CULL_OPTIONS.lodPx),
  };
}

/**
 * 按构件选段绘制的总控：把开关和「拖动中的像素阈值」下发到主层与 show_dbnum 额外层。
 *
 * 选段本身在 DTXLayer 里、按每一趟实际渲染用的相机懒算（输入没变就命中缓存），所以分屏 / 描边合成 /
 * E3D 管线 / 截图都不需要另外处理；这里的 `update` 每帧调一次，提前按主相机算好并汇总统计。
 */
export class DTXViewCullController {
  private _dtxLayer: DTXLayer;
  private _getExtraLayers: () => readonly DTXLayer[];
  private _options: DTXViewCullOptions;
  private _dragging = false;

  constructor(options: {
    dtxLayer: DTXLayer;
    getExtraLayers?: () => readonly DTXLayer[];
    options?: Partial<DTXViewCullOptions>;
  }) {
    this._dtxLayer = options.dtxLayer;
    this._getExtraLayers = options.getExtraLayers ?? (() => []);
    this._options = { ...DEFAULT_VIEW_CULL_OPTIONS, ...options.options };
  }

  setOptions(options: Partial<DTXViewCullOptions>): void {
    this._options = { ...this._options, ...options };
  }

  getOptions(): DTXViewCullOptions {
    return { ...this._options };
  }

  /** 拖动中（含松手后的宽限期）为 true；静止帧完整显示 */
  setDragging(dragging: boolean): void {
    this._dragging = dragging;
  }

  get dragging(): boolean {
    return this._dragging;
  }

  get currentMinPx(): number {
    return this._options.enabled && this._dragging ? this._options.dragMinPx : 0;
  }

  get currentLodPx(): number {
    return this._options.enabled && this._options.lod ? this._options.lodPx : 0;
  }

  /** 层的包围盒在 DTXLayer 内部随矩阵变化自动标脏，这里保留接口给旧调用方 */
  refreshSpatialIndex(): void {}

  update(camera: Camera, viewportHeightPx?: number): void {
    const minPx = this.currentMinPx;
    const lodPx = this.currentLodPx;
    for (const layer of this._layers()) {
      layer.setCullOptions({ enabled: this._options.enabled, minPx, lodPx });
      if (viewportHeightPx !== undefined && viewportHeightPx > 0) {
        layer.updateDrawRanges(camera, viewportHeightPx, minPx);
      }
    }
  }

  /** 临时一段画全部（给需要不受裁剪影响的整场景渲染），回调结束后恢复 */
  withFullDraw<T>(fn: () => T): T {
    const layers = this._layers();
    const prev = layers.map((layer) => layer.getCullOptions());
    for (const layer of layers) layer.setCullOptions({ enabled: false });
    try {
      return fn();
    } finally {
      layers.forEach((layer, i) => layer.setCullOptions(prev[i]!));
    }
  }

  getStats(): {
    layers: number;
    segments: number;
    triangles: number;
    totalTriangles: number;
    lastSelectMs: number;
    lodObjects: number;
    lodCapableObjects: number;
    } {
    const total = { layers: 0, segments: 0, triangles: 0, totalTriangles: 0, lastSelectMs: 0, lodObjects: 0, lodCapableObjects: 0 };
    for (const layer of this._layers()) {
      const s = layer.getCullStats();
      total.layers++;
      total.segments += s.segments;
      total.triangles += s.triangles;
      total.totalTriangles += s.totalTriangles;
      total.lastSelectMs += s.lastSelectMs;
      total.lodObjects += s.lodObjects;
      total.lodCapableObjects += s.lodCapableObjects;
    }
    return total;
  }

  private _layers(): DTXLayer[] {
    return [this._dtxLayer, ...this._getExtraLayers()];
  }
}
