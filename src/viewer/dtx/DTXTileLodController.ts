import type { DTXLayer } from '@/utils/three/dtx';
import type { Camera } from 'three';

export type DtxTileLodUiConfig = {
  l1Px: number
  l2Px: number
  hysteresis: number
  settleMs: number
}

/**
 * Tile LOD 控制器（manifest.groups）
 *
 * 说明：当前提供 ViewerPanel 所需的最小接口（setConfig/setManifest/requestUpdate）。
 * - 真实 LOD/预热策略可在后续迭代中补齐。
 */
export class DTXTileLodController {
  private _dtxLayer: DTXLayer;
  private _debug: boolean;
  private _requestRender: (() => void) | null;

  private _config: DtxTileLodUiConfig | null = null;
  private _manifestByDbno = new Map<number, unknown>();
  private _viewport: { width: number; height: number } | null = null;

  constructor(options: { dtxLayer: DTXLayer; debug?: boolean; requestRender?: (() => void) | null }) {
    this._dtxLayer = options.dtxLayer;
    this._debug = !!options.debug;
    this._requestRender = options.requestRender ?? null;
  }

  setConfig(cfg: DtxTileLodUiConfig): void {
    this._config = cfg;
    if (this._debug) {
       
      console.log('[DTXTileLodController] setConfig', cfg);
    }
  }

  setManifest(dbno: number, manifest: unknown): void {
    this._manifestByDbno.set(dbno, manifest);
    if (this._debug) {
       
      console.log('[DTXTileLodController] setManifest', dbno);
    }
  }

  setViewportSize(width: number, height: number): void {
    this._viewport = { width, height };
    if (this._debug) {
       
      console.log('[DTXTileLodController] setViewportSize', width, height);
    }
  }

  onGlobalModelMatrixChanged(): void {
    // no-op：后续若 LOD 逻辑依赖 globalModelMatrix，可在此重算
  }

  requestUpdate(camera: Camera): void {
    void camera;
    void this._dtxLayer;
    void this._config;
    void this._viewport;
    // no-op：后续在此处根据 camera + manifest 决定 tile 可见集
    this._requestRender?.();
  }

  dispose(): void {
    this._manifestByDbno.clear();
  }
}

