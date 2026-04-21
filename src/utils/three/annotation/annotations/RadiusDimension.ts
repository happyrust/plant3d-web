/**
 * 半径标注
 *
 * 结构：
 *          ┌─────── [R 500]
 *         ╱
 *     ●──╱  (从圆心到圆周的引线)
 *   center
 */

import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

import { AnnotationBase, type AnnotationOptions } from '../core/AnnotationBase';

import type { AnnotationMaterials, AnnotationMaterialSet } from '../core/AnnotationMaterials';

export type RadiusDimensionParams = {
  /** 圆心 */
  center: THREE.Vector3
  /** 半径 */
  radius: number
  /** 引线方向（从圆心指向圆周的方向，默认 +X） */
  direction?: THREE.Vector3
  /** 自定义文本（默认自动计算 R + 半径值） */
  text?: string
  /** 单位后缀 */
  unit?: string
  /** 小数位数 */
  decimals?: number
  /** 是否显示直径（D 而不是 R） */
  showDiameter?: boolean
}

// 共享几何体
const arrowGeometry = new THREE.ConeGeometry(0.05, 0.15, 6);
arrowGeometry.rotateZ(-Math.PI / 2); // 指向 +X

export class RadiusDimension extends AnnotationBase {
  private params: Required<Omit<RadiusDimensionParams, 'text'>> & { text?: string };
  private materialSet: AnnotationMaterialSet;

  // 子组件
  private leaderLine: Line2;
  private lineGeometry: LineGeometry;
  private arrow: THREE.Mesh;
  private textLabel: CSS2DObject;

  constructor(
    materials: AnnotationMaterials,
    params: RadiusDimensionParams,
    options?: AnnotationOptions
  ) {
    super(materials, options);

    this.params = {
      center: params.center.clone(),
      radius: params.radius,
      direction: params.direction?.clone() ?? new THREE.Vector3(1, 0, 0),
      text: params.text,
      unit: params.unit ?? '',
      decimals: params.decimals ?? 1,
      showDiameter: params.showDiameter ?? false,
    };
    this.materialSet = materials.green;

    // 创建引线
    this.lineGeometry = new LineGeometry();
    this.leaderLine = new Line2(this.lineGeometry, this.materialSet.line);
    this.add(this.leaderLine);

    // 创建箭头
    this.arrow = new THREE.Mesh(arrowGeometry, this.materialSet.mesh);
    this.add(this.arrow);

    // 创建文本标签
    const labelDiv = document.createElement('div');
    labelDiv.className = 'annotation-label annotation-label--radius';
    this.textLabel = new CSS2DObject(labelDiv);
    this.add(this.textLabel);

    this.rebuild();
  }

  /** 获取当前参数 */
  getParams(): RadiusDimensionParams {
    return {
      center: this.params.center.clone(),
      radius: this.params.radius,
      direction: this.params.direction.clone(),
      text: this.params.text,
      unit: this.params.unit,
      decimals: this.params.decimals,
      showDiameter: this.params.showDiameter,
    };
  }

  /** 更新参数并重建 */
  setParams(params: Partial<RadiusDimensionParams>): void {
    if (params.center) this.params.center.copy(params.center);
    if (params.radius !== undefined) this.params.radius = params.radius;
    if (params.direction) this.params.direction.copy(params.direction);
    if (params.text !== undefined) this.params.text = params.text;
    if (params.unit !== undefined) this.params.unit = params.unit;
    if (params.decimals !== undefined) this.params.decimals = params.decimals;
    if (params.showDiameter !== undefined) this.params.showDiameter = params.showDiameter;
    this.rebuild();
  }

  /** 设置材质颜色集 */
  setMaterialSet(materialSet: AnnotationMaterialSet): void {
    this.materialSet = materialSet;
    this.applyMaterials();
  }

  private rebuild(): void {
    const { center, radius, direction, showDiameter } = this.params;

    // 标准化方向
    const dir = direction.clone().normalize();

    // 计算圆周点
    const edgePoint = center.clone().addScaledVector(dir, radius);

    // 计算文本位置（略微超出圆周）
    const textOffset = radius * 0.3;
    const textPos = edgePoint.clone().addScaledVector(dir, textOffset);

    // 更新引线
    this.lineGeometry.setPositions([
      center.x, center.y, center.z,
      textPos.x, textPos.y, textPos.z,
    ]);

    // 更新箭头（指向圆周点）
    this.arrow.position.copy(edgePoint);
    const xAxis = new THREE.Vector3(1, 0, 0);
    this.arrow.quaternion.setFromUnitVectors(xAxis, dir);

    // 更新文本
    const prefix = showDiameter ? 'Ø' : 'R';
    const value = showDiameter ? radius * 2 : radius;
    const displayText = this.params.text ?? `${prefix}${value.toFixed(this.params.decimals)}${this.params.unit}`;
    const labelEl = this.textLabel.element as HTMLDivElement;
    labelEl.textContent = displayText;

    this.textLabel.position.copy(textPos);
  }

  /**
   * SolveSpace 状态机分流材质：selected > hovered > normal。
   */
  private applyMaterials(): void {
    const state = this.interactionState;
    if (state === 'selected') {
      this.leaderLine.material = this.materials.ssSelected.line;
      this.arrow.material = this.materials.ssSelected.mesh;
      return;
    }
    if (state === 'hovered') {
      this.leaderLine.material = this.materials.ssHovered.line;
      this.arrow.material = this.materials.ssHovered.mesh;
      return;
    }
    this.leaderLine.material = this.materialSet.line;
    this.arrow.material = this.materialSet.mesh;
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
