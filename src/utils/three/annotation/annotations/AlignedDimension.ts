/**
 * 对齐标注（沿两点之间的真实距离标注）
 *
 * 与 LinearDimension 的区别：
 * - LinearDimension：标注线偏移后与原线段平行
 * - AlignedDimension：标注线沿两点连线方向，无偏移
 *
 * 结构：
 *     start ●─────────────────● end
 *             [真实距离值]
 */

import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

import { AnnotationBase, type AnnotationOptions } from '../core/AnnotationBase';

import type { AnnotationMaterials, AnnotationMaterialSet } from '../core/AnnotationMaterials';

export type AlignedDimensionParams = {
  /** 起点 */
  start: THREE.Vector3
  /** 终点 */
  end: THREE.Vector3
  /** 自定义文本（默认自动计算距离） */
  text?: string
  /** 单位后缀 */
  unit?: string
  /** 小数位数 */
  decimals?: number
  /** 文本偏移（相对于线段中点，沿垂直方向偏移的距离） */
  textOffset?: number
}

// 共享几何体
const arrowGeometry = new THREE.ConeGeometry(0.06, 0.18, 8);
arrowGeometry.rotateZ(-Math.PI / 2); // 指向 +X

export class AlignedDimension extends AnnotationBase {
  private params: Required<Omit<AlignedDimensionParams, 'text'>> & { text?: string };
  private materialSet: AnnotationMaterialSet;

  // 子组件
  private dimensionLine: Line2;
  private lineGeometry: LineGeometry;
  private arrow1: THREE.Mesh;
  private arrow2: THREE.Mesh;
  private textLabel: CSS2DObject;

  constructor(
    materials: AnnotationMaterials,
    params: AlignedDimensionParams,
    options?: AnnotationOptions
  ) {
    super(materials, options);

    this.params = {
      start: params.start.clone(),
      end: params.end.clone(),
      text: params.text,
      unit: params.unit ?? '',
      decimals: params.decimals ?? 1,
      textOffset: params.textOffset ?? 0,
    };
    this.materialSet = materials.green;

    // 创建尺寸线
    this.lineGeometry = new LineGeometry();
    this.dimensionLine = new Line2(this.lineGeometry, this.materialSet.line);
    this.add(this.dimensionLine);

    // 创建箭头
    this.arrow1 = new THREE.Mesh(arrowGeometry, this.materialSet.mesh);
    this.arrow2 = new THREE.Mesh(arrowGeometry, this.materialSet.mesh);
    this.add(this.arrow1, this.arrow2);

    // 创建文本标签
    const labelDiv = document.createElement('div');
    labelDiv.className = 'annotation-label annotation-label--aligned';
    this.textLabel = new CSS2DObject(labelDiv);
    this.add(this.textLabel);

    this.rebuild();
  }

  /** 获取当前参数 */
  getParams(): AlignedDimensionParams {
    return {
      start: this.params.start.clone(),
      end: this.params.end.clone(),
      text: this.params.text,
      unit: this.params.unit,
      decimals: this.params.decimals,
      textOffset: this.params.textOffset,
    };
  }

  /** 更新参数并重建 */
  setParams(params: Partial<AlignedDimensionParams>): void {
    if (params.start) this.params.start.copy(params.start);
    if (params.end) this.params.end.copy(params.end);
    if (params.text !== undefined) this.params.text = params.text;
    if (params.unit !== undefined) this.params.unit = params.unit;
    if (params.decimals !== undefined) this.params.decimals = params.decimals;
    if (params.textOffset !== undefined) this.params.textOffset = params.textOffset;
    this.rebuild();
  }

  /** 设置材质颜色集 */
  setMaterialSet(materialSet: AnnotationMaterialSet): void {
    this.materialSet = materialSet;
    this.applyMaterials();
  }

  /** 获取两点间距离 */
  getDistance(): number {
    return this.params.start.distanceTo(this.params.end);
  }

  private rebuild(): void {
    const { start, end, textOffset } = this.params;

    // 更新尺寸线
    this.lineGeometry.setPositions([
      start.x, start.y, start.z,
      end.x, end.y, end.z,
    ]);

    // 计算方向
    const dir = new THREE.Vector3().copy(end).sub(start).normalize();
    const xAxis = new THREE.Vector3(1, 0, 0);

    // 更新箭头1（指向 end 方向）
    this.arrow1.position.copy(start);
    this.arrow1.quaternion.setFromUnitVectors(xAxis, dir);

    // 更新箭头2（指向 start 方向）
    this.arrow2.position.copy(end);
    this.arrow2.quaternion.setFromUnitVectors(xAxis, dir.clone().negate());

    // 更新文本
    const distance = this.getDistance();
    const displayText = this.params.text ?? `${distance.toFixed(this.params.decimals)}${this.params.unit}`;
    const labelEl = this.textLabel.element as HTMLDivElement;
    labelEl.textContent = displayText;

    // 文本位置（中点 + 偏移）
    const midPoint = new THREE.Vector3().copy(start).add(end).multiplyScalar(0.5);

    if (textOffset !== 0) {
      // 计算垂直方向
      const perpDir = new THREE.Vector3(-dir.y, dir.x, 0);
      if (perpDir.lengthSq() < 0.0001) {
        perpDir.set(0, 0, 1);
      }
      perpDir.normalize();
      midPoint.addScaledVector(perpDir, textOffset);
    }

    this.textLabel.position.copy(midPoint);
  }

  private applyMaterials(): void {
    const mat = this._highlighted ? this.materialSet.lineHover : this.materialSet.line;
    const meshMat = this._highlighted ? this.materialSet.meshHover : this.materialSet.mesh;

    this.dimensionLine.material = mat;
    this.arrow1.material = meshMat;
    this.arrow2.material = meshMat;
  }

  protected onHighlightChanged(highlighted: boolean): void {
    this.applyMaterials();

    const labelEl = this.textLabel.element as HTMLElement;
    labelEl.classList.toggle('annotation-label--active', highlighted);
  }

  override dispose(): void {
    this.lineGeometry.dispose();
    this.textLabel.element.remove();
    super.dispose();
  }
}
