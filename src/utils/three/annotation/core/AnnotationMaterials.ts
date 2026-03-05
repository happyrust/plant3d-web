/**
 * 三维标注材质管理
 *
 * SolveSpace 风格：使用原生 GL 线（LineBasicMaterial）+ Mesh 材质。
 * 原生 GL 线宽度固定 1px，与 SolveSpace 行为一致。
 */

import * as THREE from 'three'

export interface AnnotationMaterialSet {
  line: THREE.LineBasicMaterial
  lineHover: THREE.LineBasicMaterial
  mesh: THREE.MeshBasicMaterial
  meshHover: THREE.MeshBasicMaterial
}

export class AnnotationMaterials {
  private resolutionWidth = 1
  private resolutionHeight = 1

  // 预定义颜色集
  readonly green: AnnotationMaterialSet;   // 尺寸标注
  readonly orange: AnnotationMaterialSet;  // 焊缝标注
  readonly blue: AnnotationMaterialSet;    // 坡度/引线标注
  readonly white: AnnotationMaterialSet;   // 通用
  readonly yellow: AnnotationMaterialSet;  // 高亮/默认
  readonly black: AnnotationMaterialSet;   // 黑色（工程图纸风格）

  // ── SolveSpace 约束默认色（洋红）────────────────────────────
  /** SolveSpace constraint default (magenta) */
  readonly ssConstraintMagenta: AnnotationMaterialSet

  // ── SolveSpace 交互色（与 style.cpp Defaults 对齐）──────────
  /** Hovered 状态材质（SolveSpace: 黄色 RGBf(1,1,0)） */
  readonly ssHovered: AnnotationMaterialSet
  /** Selected 状态材质（SolveSpace: 红色 RGBf(1,0,0)） */
  readonly ssSelected: AnnotationMaterialSet

  constructor() {
    this.green = this.createMaterialSet(0x22c55e, 0x4ade80);
    this.orange = this.createMaterialSet(0xf97316, 0xfb923c);
    this.blue = this.createMaterialSet(0x3b82f6, 0x60a5fa);
    this.white = this.createMaterialSet(0xffffff, 0xffffff);
    this.yellow = this.createMaterialSet(0xfacc15, 0xfde047);
    this.black = this.createMaterialSet(0x000000, 0x333333);

    // SolveSpace 约束洋红（默认）
    this.ssConstraintMagenta = this.createMaterialSet(0xff00ff, 0xff44ff)

    // SolveSpace 交互色
    this.ssHovered = this.createMaterialSet(0xffff00, 0xffff44)
    this.ssSelected = this.createMaterialSet(0xff0000, 0xff4444)
  }

  private createMaterialSet(normalColor: number, hoverColor: number): AnnotationMaterialSet {
    const depthParams = {
      depthTest: true,
      depthWrite: true,
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    }

    return {
      line: new THREE.LineBasicMaterial({
        color: normalColor,
        ...depthParams,
      }),
      lineHover: new THREE.LineBasicMaterial({
        color: hoverColor,
        ...depthParams,
      }),
      mesh: new THREE.MeshBasicMaterial({
        color: normalColor,
        opacity: 0.9,
        ...depthParams,
      }),
      meshHover: new THREE.MeshBasicMaterial({
        color: hoverColor,
        opacity: 1,
        ...depthParams,
      }),
    }
  }

  get all(): AnnotationMaterialSet[] {
    return [
      this.green, this.orange, this.blue, this.white, this.yellow, this.black,
      this.ssConstraintMagenta, this.ssDimensionDefault, this.ssHovered, this.ssSelected,
    ];
  }

  getResolution(): { width: number, height: number } {
    return { width: this.resolutionWidth, height: this.resolutionHeight }
  }

  get all(): AnnotationMaterialSet[] {
    return [this.green, this.orange, this.blue, this.white, this.yellow, this.ssConstraintMagenta, this.ssHovered, this.ssSelected]
  }

  dispose(): void {
    for (const set of this.all) {
      set.line.dispose()
      set.lineHover.dispose()
      set.mesh.dispose()
      set.meshHover.dispose()
    }
  }
}
