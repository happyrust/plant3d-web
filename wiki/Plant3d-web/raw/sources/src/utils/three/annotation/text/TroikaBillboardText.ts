import * as THREE from 'three';
import { Text } from 'troika-three-text';

import type { AnnotationInteractionState } from '../core/AnnotationBase';

export type TroikaBillboardTextParams = {
  text: string
  fontUrl: string
  fontSize: number
  color: number
  outlineColor: number
  outlineWidth: number
}

/**
 * SolveSpace 风格交互色（与 style.cpp Defaults 对齐）
 *
 * - Hovered:  黄色 RGBf(1,1,0) = 0xffff00
 * - Selected: 红色 RGBf(1,0,0) = 0xff0000
 */
const SS_HOVERED_COLOR = new THREE.Color(0xffff00);
const SS_SELECTED_COLOR = new THREE.Color(0xff0000);

export class TroikaBillboardText {
  readonly object3d: THREE.Object3D;

  private readonly baseOutlineWidth: number;
  private readonly baseColor: THREE.Color;
  private readonly baseOutlineColor: THREE.Color;
  private readonly snapOutlineColor: THREE.Color;

  private highlighted = false;
  private snapActive = false;
  private _interactionState: AnnotationInteractionState = 'normal';

  // NOTE: test 中会通过 (as any).textMesh 读取；保持该字段名稳定
  private readonly textMesh: Text;

  /**
   * SolveSpace 风格外接矩形拾取代理（PlaneGeometry）。
   *
   * 与 SolveSpace ObjectPicker::DrawVectorText() 行为一致：
   * 用文字的外接框（而非字形三角形）做命中检测，使得命中"容易且稳定"。
   */
  private pickProxy: THREE.Mesh | null = null;
  private pickProxyGeometry: THREE.PlaneGeometry | null = null;

  constructor(params: TroikaBillboardTextParams) {
    this.baseOutlineWidth = params.outlineWidth;
    this.baseColor = new THREE.Color(params.color);
    this.baseOutlineColor = new THREE.Color(params.outlineColor);
    this.snapOutlineColor = new THREE.Color(0xffffff);

    const t = new Text();
    t.text = params.text;
    t.font = params.fontUrl;
    t.fontSize = params.fontSize;
    t.color = this.baseColor;
    t.anchorX = 'center';
    t.anchorY = 'middle';
    t.frustumCulled = false;
    t.renderOrder = 910

    // ── SDF 质量优化 ──────────────────────────────────────────────
    // sdfGlyphSize 提高到 128：SDF 纹理精度翻倍，远距离/大缩放仍清晰
    ;(t as any).sdfGlyphSize = 128;

    // ── SolveSpace 风格：去掉黑色模糊光晕，只保留极细描边 ──────────
    t.outlineColor = this.baseOutlineColor;
    t.outlineWidth = this.baseOutlineWidth
    // outlineBlur = 0：SolveSpace 文字没有模糊阴影/光晕
    ;(t as any).outlineBlur = 0;

    // 监听 sync 完成，更新 pickProxy 的尺寸
    t.addEventListener('synccomplete', () => {
      this._updatePickProxy();
    });

    t.sync();

    // 作为"标注文字"，默认不参与深度测试，避免被模型遮挡（SolveSpace FRONT layer）。
    // 注意：troika Text 的 material 可能为数组；这里做兼容处理。
    try {
      const m = (t as any).material as THREE.Material | THREE.Material[] | undefined;
      const apply = (mm: THREE.Material) => {
        ;(mm as any).depthTest = false
        ;(mm as any).depthWrite = false
        ;(mm as any).transparent = true;
      };
      if (Array.isArray(m)) m.forEach((mm) => mm && apply(mm));
      else if (m) apply(m);
    } catch {
      // ignore
    }

    // 将真实字形 mesh 标记为不可拾取，交互走 pickProxy
    t.userData.noPick = true;

    this.textMesh = t;

    // 创建容器 Group，放 textMesh + pickProxy
    const container = new THREE.Group();
    container.add(t);
    this._createPickProxy(container);
    this.object3d = container;
  }

  /** 创建拾取代理（透明平面），与 SolveSpace ObjectPicker::DrawVectorText 行为一致 */
  private _createPickProxy(parent: THREE.Group): void {
    // 初始尺寸 1x1，后续 _updatePickProxy 会根据文本 bounds 调整
    this.pickProxyGeometry = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      visible: false,   // 不渲染，仅用于 raycast 命中
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    this.pickProxy = new THREE.Mesh(this.pickProxyGeometry, mat);
    this.pickProxy.renderOrder = 911; // 略高于文字
    // pickProxy 继承 dragRole（如果 textMesh.userData.dragRole 设置了的话）
    parent.add(this.pickProxy);
  }

  /** 根据 troika textRenderInfo 更新 pickProxy 尺寸（sync 完成后调用） */
  private _updatePickProxy(): void {
    if (!this.pickProxy || !this.pickProxyGeometry) return;
    try {
      const info = (this.textMesh as any).textRenderInfo;
      if (!info) return;
      const bounds = info.blockBounds as [number, number, number, number] | undefined;
      if (!bounds || bounds.length < 4) return;
      const [x0, y0, x1, y1] = bounds;
      const w = Math.abs(x1 - x0);
      const h = Math.abs(y1 - y0);
      if (w < 1e-6 || h < 1e-6) return;

      // 增加少量 padding（与 SolveSpace DoLineTrimmedAgainstBox 的 8*pixels 类似）
      const padX = w * 0.15;
      const padY = h * 0.3;

      // 更新 geometry scale
      this.pickProxyGeometry.dispose();
      this.pickProxyGeometry = new THREE.PlaneGeometry(w + padX, h + padY);
      this.pickProxy.geometry = this.pickProxyGeometry;

      // 居中偏移（troika anchor=center/middle 时 blockBounds 的中心通常接近 0,0）
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      this.pickProxy.position.set(cx, cy, 0);
    } catch {
      // ignore
    }
  }

  private applyStyle(): void {
    // ── SolveSpace 风格交互色：selected > hovered > snapActive > normal ──
    let textColor: THREE.Color;
    let outlineColor: THREE.Color;

    if (this._interactionState === 'selected') {
      textColor = SS_SELECTED_COLOR;
      outlineColor = SS_SELECTED_COLOR;
    } else if (this._interactionState === 'hovered') {
      textColor = SS_HOVERED_COLOR;
      outlineColor = SS_HOVERED_COLOR;
    } else if (this.snapActive) {
      textColor = this.snapOutlineColor;
      outlineColor = this.snapOutlineColor;
    } else {
      textColor = this.baseColor;
      outlineColor = this.baseOutlineColor;
    }

    this.textMesh.color = textColor;

    // 描边：SolveSpace 风格不使用模糊光晕
    this.textMesh.outlineColor = outlineColor;
    const w = this.highlighted ? Math.max(this.baseOutlineWidth, 0.08) : this.baseOutlineWidth;
    this.textMesh.outlineWidth = this.snapActive ? Math.max(w, 0.12) : w
    ;(this.textMesh as any).outlineBlur = 0;

    this.textMesh.sync();
  }

  setText(text: string): void {
    if (this.textMesh.text === text) return;
    this.textMesh.text = text;
    this.textMesh.sync();
  }

  /** @deprecated 使用 setInteractionState 替代 */
  setHighlighted(highlighted: boolean): void {
    if (this.highlighted === highlighted) return;
    this.highlighted = highlighted;
    this.applyStyle();
  }

  /** SolveSpace 风格交互状态切换 */
  setInteractionState(state: AnnotationInteractionState): void {
    if (this._interactionState === state) return;
    this._interactionState = state;
    this.applyStyle();
  }

  /** 拖拽吸附提示：短暂增强描边 */
  setSnapActive(active: boolean): void {
    if (this.snapActive === active) return;
    this.snapActive = active;
    this.applyStyle();
  }

  setScale(scale: number): void {
    this.object3d.scale.setScalar(scale);
  }

  setVisible(visible: boolean): void {
    this.object3d.visible = visible;
  }

  /** 使文字面向相机（billboard） */
  update(camera: THREE.Camera): void {
    this.object3d.quaternion.copy(camera.quaternion);
  }

  /** 同步 pickProxy 的 dragRole userData（由标注子类在构建后调用） */
  syncPickProxyUserData(): void {
    if (!this.pickProxy) return;
    const role = this.textMesh?.userData?.dragRole;
    if (role !== undefined) {
      this.pickProxy.userData.dragRole = role;
    }
  }

  dispose(): void {
    try {
      ;(this.textMesh as any).dispose?.();
    } catch {
      // ignore
    }
    try {
      const m = (this.textMesh as any).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach((x) => x?.dispose?.());
      else m?.dispose?.();
    } catch {
      // ignore
    }
    try {
      ;(this.textMesh as any).geometry?.dispose?.();
    } catch {
      // ignore
    }
    try {
      this.pickProxyGeometry?.dispose()
      ;(this.pickProxy?.material as THREE.Material)?.dispose?.();
    } catch {
      // ignore
    }
    this.object3d.removeFromParent();
  }
}
