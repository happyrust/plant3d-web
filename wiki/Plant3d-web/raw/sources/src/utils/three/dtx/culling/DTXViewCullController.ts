import type { DTXLayer } from '../DTXLayer';
import type { Camera } from 'three';

/**
 * View Frustum Culling（按对象 AABB）
 *
 * 说明：当前以“可用优先”给 ViewerPanel 提供最小接口（update）。
 * - 若后续要做性能优化，再在此处接入真实裁剪逻辑与对象可见性批量更新。
 */
export class DTXViewCullController {
  private _dtxLayer: DTXLayer;

  constructor(options: { dtxLayer: DTXLayer }) {
    this._dtxLayer = options.dtxLayer;
  }

  refreshSpatialIndex(): void {
    void this._dtxLayer;
    // no-op
  }

  update(camera: Camera): void {
    void camera;
    void this._dtxLayer;
    // no-op: 保持接口稳定，避免影响主流程
  }
}

