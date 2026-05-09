/**
 * 角度标注
 *
 * 结构：
 *              / line1
 *             /
 *     vertex ●──────── line2
 *            \  arc
 *             \ [角度值]
 */

import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

import { AnnotationBase, type AnnotationOptions } from '../core/AnnotationBase';

import type { AnnotationMaterials, AnnotationMaterialSet } from '../core/AnnotationMaterials';

export type AngleDimensionParams = {
  /** 角度顶点 */
  vertex: THREE.Vector3
  /** 第一条边上的点 */
  point1: THREE.Vector3
  /** 第二条边上的点 */
  point2: THREE.Vector3
  /** 圆弧半径（世界单位） */
  arcRadius?: number
  /** 自定义文本（默认自动计算角度） */
  text?: string
  /** 单位（默认 °） */
  unit?: string
  /** 小数位数 */
  decimals?: number
  /** 圆弧分段数 */
  arcSegments?: number
}

export class AngleDimension extends AnnotationBase {
  private params: Required<Omit<AngleDimensionParams, 'text'>> & { text?: string };
  private materialSet: AnnotationMaterialSet;

  // 子组件
  private arcLine: Line2;
  private arcGeometry: LineGeometry;
  private textLabel: CSS2DObject;

  // 缓存
  private readonly tempVec1 = new THREE.Vector3();
  private readonly tempVec2 = new THREE.Vector3();

  constructor(
    materials: AnnotationMaterials,
    params: AngleDimensionParams,
    options?: AnnotationOptions
  ) {
    super(materials, options);

    this.params = {
      vertex: params.vertex.clone(),
      point1: params.point1.clone(),
      point2: params.point2.clone(),
      arcRadius: params.arcRadius ?? 1,
      text: params.text,
      unit: params.unit ?? '°',
      decimals: params.decimals ?? 1,
      arcSegments: params.arcSegments ?? 32,
    };
    this.materialSet = materials.yellow;

    // 创建圆弧线
    this.arcGeometry = new LineGeometry();
    this.arcLine = new Line2(this.arcGeometry, this.materialSet.line);
    this.add(this.arcLine);

    // 创建文本标签
    const labelDiv = document.createElement('div');
    labelDiv.className = 'annotation-label annotation-label--angle';
    this.textLabel = new CSS2DObject(labelDiv);
    this.add(this.textLabel);

    this.rebuild();
  }

  /** 获取当前参数 */
  getParams(): AngleDimensionParams {
    return {
      vertex: this.params.vertex.clone(),
      point1: this.params.point1.clone(),
      point2: this.params.point2.clone(),
      arcRadius: this.params.arcRadius,
      text: this.params.text,
      unit: this.params.unit,
      decimals: this.params.decimals,
      arcSegments: this.params.arcSegments,
    };
  }

  /** 更新参数并重建 */
  setParams(params: Partial<AngleDimensionParams>): void {
    if (params.vertex) this.params.vertex.copy(params.vertex);
    if (params.point1) this.params.point1.copy(params.point1);
    if (params.point2) this.params.point2.copy(params.point2);
    if (params.arcRadius !== undefined) this.params.arcRadius = params.arcRadius;
    if (params.text !== undefined) this.params.text = params.text;
    if (params.unit !== undefined) this.params.unit = params.unit;
    if (params.decimals !== undefined) this.params.decimals = params.decimals;
    if (params.arcSegments !== undefined) this.params.arcSegments = params.arcSegments;
    this.rebuild();
  }

  /** 设置材质颜色集 */
  setMaterialSet(materialSet: AnnotationMaterialSet): void {
    this.materialSet = materialSet;
    this.applyMaterials();
  }

  /** 计算角度（弧度） */
  getAngleRadians(): number {
    const { vertex, point1, point2 } = this.params;
    this.tempVec1.copy(point1).sub(vertex).normalize();
    this.tempVec2.copy(point2).sub(vertex).normalize();
    return Math.acos(Math.min(1, Math.max(-1, this.tempVec1.dot(this.tempVec2))));
  }

  /** 计算角度（角度） */
  getAngleDegrees(): number {
    return (this.getAngleRadians() * 180) / Math.PI;
  }

  private rebuild(): void {
    const { vertex, point1, point2, arcRadius, arcSegments } = this.params;

    // 计算两条边的方向
    const dir1 = this.tempVec1.copy(point1).sub(vertex).normalize();
    const dir2 = this.tempVec2.copy(point2).sub(vertex).normalize();

    // 计算角度
    const angleRadians = this.getAngleRadians();

    // 计算法向量（用于确定圆弧平面）
    const normal = new THREE.Vector3().crossVectors(dir1, dir2).normalize();
    if (normal.lengthSq() < 0.0001) {
      // 两向量平行，使用默认法向量
      normal.set(0, 0, 1);
    }

    // 生成圆弧点
    const arcPoints: number[] = [];
    for (let i = 0; i <= arcSegments; i++) {
      const t = i / arcSegments;
      const angle = t * angleRadians;

      // 使用四元数旋转 dir1
      const quaternion = new THREE.Quaternion().setFromAxisAngle(normal, angle);
      const point = dir1.clone().applyQuaternion(quaternion).multiplyScalar(arcRadius).add(vertex);

      arcPoints.push(point.x, point.y, point.z);
    }

    this.arcGeometry.setPositions(arcPoints);

    // 更新文本
    const angleDegrees = this.getAngleDegrees();
    const displayText = this.params.text ?? `${angleDegrees.toFixed(this.params.decimals)}${this.params.unit}`;
    const labelEl = this.textLabel.element as HTMLDivElement;
    labelEl.textContent = displayText;

    // 文本位置（圆弧中点）
    const midAngle = angleRadians / 2;
    const quaternion = new THREE.Quaternion().setFromAxisAngle(normal, midAngle);
    const labelPos = dir1.clone().applyQuaternion(quaternion).multiplyScalar(arcRadius * 1.2).add(vertex);
    this.textLabel.position.copy(labelPos);
  }

  private applyMaterials(): void {
    const mat = this._highlighted ? this.materialSet.lineHover : this.materialSet.line;
    this.arcLine.material = mat;
  }

  protected onHighlightChanged(highlighted: boolean): void {
    this.applyMaterials();

    const labelEl = this.textLabel.element as HTMLElement;
    labelEl.classList.toggle('annotation-label--active', highlighted);
  }

  override dispose(): void {
    this.arcGeometry.dispose();
    this.textLabel.element.remove();
    super.dispose();
  }
}
