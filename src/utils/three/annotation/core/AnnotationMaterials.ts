/**
 * 三维标注材质管理
 *
 * 说明：
 * - 当前标注系统主要使用原生 GL 线和基础 Mesh 材质。
 * - `setResolution()` 对这套材质是 no-op，但保留统一接口，方便调用方无差别更新。
 */

import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

export type AnnotationMaterialSet = {
  line: THREE.LineBasicMaterial;
  lineHover: THREE.LineBasicMaterial;
  mesh: THREE.MeshBasicMaterial;
  meshHover: THREE.MeshBasicMaterial;
  fatLine: LineMaterial;
  fatLineHover: LineMaterial;
  textFatLine: LineMaterial;
  textFatLineHover: LineMaterial;
}

export class AnnotationMaterials {
  private resolutionWidth = 1;
  private resolutionHeight = 1;

  readonly green: AnnotationMaterialSet;
  readonly orange: AnnotationMaterialSet;
  readonly blue: AnnotationMaterialSet;
  readonly white: AnnotationMaterialSet;
  readonly yellow: AnnotationMaterialSet;
  readonly black: AnnotationMaterialSet;

  readonly ssConstraintMagenta: AnnotationMaterialSet;
  readonly ssDimensionDefault: AnnotationMaterialSet;
  readonly ssHovered: AnnotationMaterialSet;
  readonly ssSelected: AnnotationMaterialSet;

  constructor() {
    this.green = this.createMaterialSet(0x22c55e, 0x4ade80);
    this.orange = this.createMaterialSet(0xf97316, 0xfb923c);
    this.blue = this.createMaterialSet(0x3b82f6, 0x60a5fa);
    this.white = this.createMaterialSet(0xffffff, 0xffffff);
    this.yellow = this.createMaterialSet(0xfacc15, 0xfde047);
    this.black = this.createMaterialSet(0x000000, 0x333333);

    this.ssConstraintMagenta = this.createMaterialSet(0xff00ff, 0xff44ff);
    this.ssDimensionDefault = this.createMaterialSet(0x8b5cf6, 0xa78bfa);
    this.ssHovered = this.createMaterialSet(0xffff00, 0xffff44);
    this.ssSelected = this.createMaterialSet(0xff0000, 0xff4444);
  }

  private createMaterialSet(
    normalColor: number,
    hoverColor: number,
  ): AnnotationMaterialSet {
    const sharedParams = {
      depthTest: true,
      depthWrite: true,
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    } satisfies Partial<THREE.Material>;

    return {
      line: new THREE.LineBasicMaterial({
        color: normalColor,
        ...sharedParams,
      }),
      lineHover: new THREE.LineBasicMaterial({
        color: hoverColor,
        ...sharedParams,
      }),
      mesh: new THREE.MeshBasicMaterial({
        color: normalColor,
        opacity: 0.9,
        ...sharedParams,
      }),
      meshHover: new THREE.MeshBasicMaterial({
        color: hoverColor,
        opacity: 1,
        ...sharedParams,
      }),
      fatLine: new LineMaterial({
        color: normalColor,
        transparent: true,
        linewidth: 5,
        depthTest: true,
        depthWrite: true,
      }),
      fatLineHover: new LineMaterial({
        color: hoverColor,
        transparent: true,
        linewidth: 5,
        depthTest: true,
        depthWrite: true,
      }),
      textFatLine: new LineMaterial({
        color: normalColor,
        transparent: true,
        linewidth: 4,
        depthTest: true,
        depthWrite: true,
      }),
      textFatLineHover: new LineMaterial({
        color: hoverColor,
        transparent: true,
        linewidth: 4,
        depthTest: true,
        depthWrite: true,
      }),
    };
  }

  get all(): AnnotationMaterialSet[] {
    return [
      this.green,
      this.orange,
      this.blue,
      this.white,
      this.yellow,
      this.black,
      this.ssConstraintMagenta,
      this.ssDimensionDefault,
      this.ssHovered,
      this.ssSelected,
    ];
  }

  setResolution(width: number, height: number): void {
    this.resolutionWidth = Number.isFinite(width) && width > 0 ? width : 1;
    this.resolutionHeight = Number.isFinite(height) && height > 0 ? height : 1;
    for (const set of this.all) {
      set.fatLine.resolution.set(this.resolutionWidth, this.resolutionHeight);
      set.fatLineHover.resolution.set(this.resolutionWidth, this.resolutionHeight);
      set.textFatLine.resolution.set(this.resolutionWidth, this.resolutionHeight);
      set.textFatLineHover.resolution.set(this.resolutionWidth, this.resolutionHeight);
    }
  }

  getResolution(): { width: number; height: number } {
    return {
      width: this.resolutionWidth,
      height: this.resolutionHeight,
    };
  }

  dispose(): void {
    for (const set of this.all) {
      set.line.dispose();
      set.lineHover.dispose();
      set.mesh.dispose();
      set.meshHover.dispose();
      set.fatLine.dispose();
      set.fatLineHover.dispose();
      set.textFatLine.dispose();
      set.textFatLineHover.dispose();
    }
  }
}
