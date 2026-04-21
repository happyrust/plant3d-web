/**
 * 坡度标注
 *
 * 结构：
 *     start ─────────────── end
 *              [坡度文本]
 */

import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

import { AnnotationBase, type AnnotationOptions } from '../core/AnnotationBase';

import type { AnnotationMaterials, AnnotationMaterialSet } from '../core/AnnotationMaterials';

export type SlopeAnnotationParams = {
  /** 起点 */
  start: THREE.Vector3
  /** 终点 */
  end: THREE.Vector3
  /** 坡度文本 */
  text: string
  /** 坡度值 */
  slope?: number
}

export class SlopeAnnotation extends AnnotationBase {
  private params: SlopeAnnotationParams;
  private materialSet: AnnotationMaterialSet;

  // 子组件
  private slopeLine: Line2;
  private lineGeometry: LineGeometry;
  private textLabel: CSS2DObject;
  private labelTitleEl: HTMLDivElement;
  private labelSubEl: HTMLDivElement;

  constructor(
    materials: AnnotationMaterials,
    params: SlopeAnnotationParams,
    options?: AnnotationOptions
  ) {
    super(materials, options);

    this.params = {
      start: params.start.clone(),
      end: params.end.clone(),
      text: params.text,
      slope: params.slope,
    };
    this.materialSet = this.resolveMaterialSet(materials.blue);

    // 创建坡度线
    this.lineGeometry = new LineGeometry();
    this.slopeLine = new Line2(this.lineGeometry, this.materialSet.line);
    this.add(this.slopeLine);

    // 创建文本
    const labelDiv = document.createElement('div');
    labelDiv.className = 'annotation-label annotation-label--slope';
    this.labelTitleEl = document.createElement('div');
    this.labelTitleEl.className = 'annotation-label-title';
    this.labelSubEl = document.createElement('div');
    this.labelSubEl.className = 'annotation-label-sub';
    this.labelSubEl.textContent = '坡度';
    labelDiv.append(this.labelTitleEl, this.labelSubEl);
    this.textLabel = new CSS2DObject(labelDiv);
    this.add(this.textLabel);

    this.rebuild();
  }

  /** 获取当前参数 */
  getParams(): SlopeAnnotationParams {
    return {
      start: this.params.start.clone(),
      end: this.params.end.clone(),
      text: this.params.text,
      slope: this.params.slope,
    };
  }

  /** 更新参数并重建 */
  setParams(params: Partial<SlopeAnnotationParams>): void {
    if (params.start) this.params.start.copy(params.start);
    if (params.end) this.params.end.copy(params.end);
    if (params.text !== undefined) this.params.text = params.text;
    if (params.slope !== undefined) this.params.slope = params.slope;
    this.rebuild();
  }

  /** 设置材质颜色集 */
  setMaterialSet(materialSet: AnnotationMaterialSet): void {
    this.materialSet = materialSet;
    this.applyMaterials();
  }

  private rebuild(): void {
    const { start, end, text } = this.params;

    // 更新线段
    this.lineGeometry.setPositions([
      start.x, start.y, start.z,
      end.x, end.y, end.z,
    ]);

    // 更新文本
    // 使用 textContent 以避免后端文本携带 HTML 造成注入
    this.labelTitleEl.textContent = text;

    // 文本位置（中点）
    this.textLabel.position.set(
      (start.x + end.x) / 2,
      (start.y + end.y) / 2,
      (start.z + end.z) / 2
    );
  }

  /**
   * 按 SolveSpace 状态机分流材质：selected > hovered > normal。
   * 与 LinearDimension3D/SlopeAnnotation3D 等 3D 系列保持一致。
   */
  private applyMaterials(): void {
    const state = this.interactionState;
    if (state === 'selected') {
      this.slopeLine.material = this.materials.ssSelected.line;
      return;
    }
    if (state === 'hovered') {
      this.slopeLine.material = this.materials.ssHovered.line;
      return;
    }
    this.slopeLine.material = this.materialSet.line;
  }

  protected onHighlightChanged(highlighted: boolean): void {
    this.applyMaterials();

    const labelEl = this.textLabel.element as HTMLElement;
    labelEl.classList.toggle('annotation-label--active', highlighted);
    labelEl.classList.toggle('annotation-label--hovered', this.interactionState === 'hovered');
    labelEl.classList.toggle('annotation-label--selected', this.interactionState === 'selected');
  }

  override dispose(): void {
    this.lineGeometry.dispose();
    this.textLabel.element.remove();
    super.dispose();
  }
}
