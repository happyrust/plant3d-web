/**
 * 三维标注材质管理
 *
 * 支持两种线条渲染模式：
 * - lineWidth === 1：使用原生 GL 线（LineBasicMaterial），固定 1px
 * - lineWidth > 1：使用 LineMaterial（Line2），支持任意线宽
 */

import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

import type { DimensionStyleConfig } from '@/composables/useDimensionStyleStore';

export type AnnotationMaterialSet = {
  line: THREE.LineBasicMaterial;
  lineHover: THREE.LineBasicMaterial;
  mesh: THREE.MeshBasicMaterial;
  meshHover: THREE.MeshBasicMaterial;
  fatLine: LineMaterial;
  fatLineHover: LineMaterial;
};

export class AnnotationMaterials {

  // 预定义颜色集
  readonly green: AnnotationMaterialSet;   // 尺寸标注
  readonly orange: AnnotationMaterialSet;  // 焊缝标注
  readonly blue: AnnotationMaterialSet;    // 坡度/引线标注
  readonly white: AnnotationMaterialSet;   // 通用
  readonly yellow: AnnotationMaterialSet;  // 高亮/默认

  // ── SolveSpace 约束默认色（洋红）────────────────────────────
  /** SolveSpace constraint default (magenta) */
  readonly ssConstraintMagenta: AnnotationMaterialSet;

  // ── 尺寸标注默认色（深紫，由 DimensionStyleStore 驱动）──────
  /** Dimension default (purple, configurable) */
  ssDimensionDefault: AnnotationMaterialSet;

  // ── SolveSpace 交互色（与 style.cpp Defaults 对齐）──────────
  /** Hovered 状态材质（SolveSpace: 黄色 RGBf(1,1,0)） */
  ssHovered: AnnotationMaterialSet;
  /** Selected 状态材质（SolveSpace: 红色 RGBf(1,0,0)） */
  ssSelected: AnnotationMaterialSet;

  private _resolution = new THREE.Vector2(1, 1);

  constructor() {
    this.green = this.createMaterialSet(0x22c55e, 0x4ade80);
    this.orange = this.createMaterialSet(0xf97316, 0xfb923c);
    this.blue = this.createMaterialSet(0x3b82f6, 0x60a5fa);
    this.white = this.createMaterialSet(0xffffff, 0xffffff);
    this.yellow = this.createMaterialSet(0xfacc15, 0xfde047);

    // SolveSpace 约束洋红（默认）
    this.ssConstraintMagenta = this.createMaterialSet(0xff00ff, 0xff44ff);

    // 尺寸标注默认色（深紫）
    this.ssDimensionDefault = this.createMaterialSet(0x7B2FBE, 0xA855F7, 2);

    // SolveSpace 交互色
    this.ssHovered = this.createMaterialSet(0xffff00, 0xffff44);
    this.ssSelected = this.createMaterialSet(0xff0000, 0xff4444);
  }

  /** 根据 DimensionStyleConfig 更新尺寸标注相关材质 */
  updateFromStyleConfig(config: DimensionStyleConfig): void {
    const normal = new THREE.Color(config.lineColor).getHex();
    const hover = new THREE.Color(config.lineColorHover).getHex();
    const selected = new THREE.Color(config.lineColorSelected).getHex();
    const lw = Math.max(1, config.lineWidth);

    // 更新 ssDimensionDefault
    this.disposeMaterialSet(this.ssDimensionDefault);
    this.ssDimensionDefault = this.createMaterialSet(normal, hover, lw);

    // 更新交互色
    this.disposeMaterialSet(this.ssHovered);
    this.ssHovered = this.createMaterialSet(hover, hover, lw);

    this.disposeMaterialSet(this.ssSelected);
    this.ssSelected = this.createMaterialSet(selected, selected, lw);
  }

  private createMaterialSet(normalColor: number, hoverColor: number, lineWidth = 1): AnnotationMaterialSet {
    const depthParams = {
      depthTest: true,
      depthWrite: true,
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    };

    const fatLineParams = {
      depthTest: true,
      depthWrite: true,
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      worldUnits: false,
      linewidth: lineWidth,
      resolution: this._resolution,
    };

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
        side: THREE.DoubleSide,
        ...depthParams,
      }),
      meshHover: new THREE.MeshBasicMaterial({
        color: hoverColor,
        opacity: 1,
        side: THREE.DoubleSide,
        ...depthParams,
      }),
      fatLine: new LineMaterial({
        color: normalColor,
        ...fatLineParams,
      }),
      fatLineHover: new LineMaterial({
        color: hoverColor,
        ...fatLineParams,
      }),
    };
  }

  /** 更新 LineMaterial resolution（需每帧或 resize 时调用） */
  setResolution(width: number, height: number): void {
    this._resolution.set(width, height);
    for (const set of this.all) {
      set.fatLine.resolution.set(width, height);
      set.fatLineHover.resolution.set(width, height);
    }
  }

  get all(): AnnotationMaterialSet[] {
    return [
      this.green, this.orange, this.blue, this.white, this.yellow,
      this.ssConstraintMagenta, this.ssDimensionDefault, this.ssHovered, this.ssSelected,
    ];
  }

  private disposeMaterialSet(set: AnnotationMaterialSet): void {
    set.line.dispose();
    set.lineHover.dispose();
    set.mesh.dispose();
    set.meshHover.dispose();
    set.fatLine.dispose();
    set.fatLineHover.dispose();
  }

  dispose(): void {
    for (const set of this.all) {
      this.disposeMaterialSet(set);
    }
  }
}
