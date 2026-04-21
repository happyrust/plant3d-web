/**
 * 焊缝标注
 *
 * 结构：
 *          │
 *     ─────┼─────  十字标记
 *          │
 *        [文本]
 */

import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

import { AnnotationBase, type AnnotationOptions } from '../core/AnnotationBase';

import type { AnnotationMaterials, AnnotationMaterialSet } from '../core/AnnotationMaterials';

export type WeldAnnotationParams = {
  /** 焊缝位置 */
  position: THREE.Vector3
  /** 焊缝标签 */
  label: string
  /** 是否为车间焊 */
  isShop?: boolean
  /** 十字大小（世界单位） */
  crossSize?: number
}

export class WeldAnnotation extends AnnotationBase {
  private params: WeldAnnotationParams;
  private materialSet: AnnotationMaterialSet;

  // 子组件
  private crossLineH: Line2;
  private crossLineV: Line2;
  private lineGeometryH: LineGeometry;
  private lineGeometryV: LineGeometry;
  private textLabel: CSS2DObject;
  private labelTitleEl: HTMLDivElement;
  private labelSubEl: HTMLDivElement;

  constructor(
    materials: AnnotationMaterials,
    params: WeldAnnotationParams,
    options?: AnnotationOptions
  ) {
    super(materials, options);

    this.params = {
      position: params.position.clone(),
      label: params.label,
      isShop: params.isShop ?? false,
      crossSize: params.crossSize ?? 50,
    };
    this.materialSet = this.resolveMaterialSet(materials.orange);

    // 创建十字线（两条独立线段；避免 Line2 折线连线导致出现斜线）
    this.lineGeometryH = new LineGeometry();
    this.lineGeometryV = new LineGeometry();
    this.crossLineH = new Line2(this.lineGeometryH, this.materialSet.line);
    this.crossLineV = new Line2(this.lineGeometryV, this.materialSet.line);
    this.add(this.crossLineH, this.crossLineV);

    // 创建文本
    const labelDiv = document.createElement('div');
    labelDiv.className = 'annotation-label annotation-label--weld';
    this.labelTitleEl = document.createElement('div');
    this.labelTitleEl.className = 'annotation-label-title';
    this.labelSubEl = document.createElement('div');
    this.labelSubEl.className = 'annotation-label-sub';
    labelDiv.append(this.labelTitleEl, this.labelSubEl);
    this.textLabel = new CSS2DObject(labelDiv);
    this.add(this.textLabel);

    this.rebuild();
  }

  /** 获取当前参数 */
  getParams(): WeldAnnotationParams {
    return {
      position: this.params.position.clone(),
      label: this.params.label,
      isShop: this.params.isShop,
      crossSize: this.params.crossSize,
    };
  }

  /** 更新参数并重建 */
  setParams(params: Partial<WeldAnnotationParams>): void {
    if (params.position) this.params.position.copy(params.position);
    if (params.label !== undefined) this.params.label = params.label;
    if (params.isShop !== undefined) this.params.isShop = params.isShop;
    if (params.crossSize !== undefined) this.params.crossSize = params.crossSize;
    this.rebuild();
  }

  /** 设置材质颜色集 */
  setMaterialSet(materialSet: AnnotationMaterialSet): void {
    this.materialSet = materialSet;
    this.applyMaterials();
  }

  private rebuild(): void {
    const { position, label, isShop, crossSize } = this.params;
    const p = position;
    const s = crossSize!;

    // 十字形：水平线 + 垂直线（两条独立线段）
    this.lineGeometryH.setPositions([
      p.x - s, p.y, p.z,
      p.x + s, p.y, p.z,
    ]);
    this.lineGeometryV.setPositions([
      p.x, p.y - s, p.z,
      p.x, p.y + s, p.z,
    ]);

    // 更新文本
    const subtitle = isShop ? '车间焊' : '现场焊';
    // 使用 textContent 以避免后端文本携带 HTML 造成注入
    this.labelTitleEl.textContent = label;
    this.labelSubEl.textContent = subtitle;
    this.textLabel.position.copy(position);
  }

  /**
   * SolveSpace 状态机分流材质：selected > hovered > normal。
   */
  private applyMaterials(): void {
    const state = this.interactionState;
    let mat: THREE.Material;
    if (state === 'selected') {
      mat = this.materials.ssSelected.line;
    } else if (state === 'hovered') {
      mat = this.materials.ssHovered.line;
    } else {
      mat = this.materialSet.line;
    }
    this.crossLineH.material = mat;
    this.crossLineV.material = mat;
  }

  protected onHighlightChanged(highlighted: boolean): void {
    this.applyMaterials();

    const labelEl = this.textLabel.element as HTMLElement;
    labelEl.classList.toggle('annotation-label--active', highlighted);
    labelEl.classList.toggle('annotation-label--hovered', this.interactionState === 'hovered');
    labelEl.classList.toggle('annotation-label--selected', this.interactionState === 'selected');
  }

  override dispose(): void {
    this.lineGeometryH.dispose();
    this.lineGeometryV.dispose();
    this.textLabel.element.remove();
    super.dispose();
  }
}
