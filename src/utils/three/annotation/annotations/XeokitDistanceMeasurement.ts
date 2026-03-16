import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

import { AnnotationBase, type AnnotationOptions } from '../core/AnnotationBase';

import type { AnnotationMaterials, AnnotationMaterialSet } from '../core/AnnotationMaterials';

export type XeokitDistanceMeasurementParams = {
  origin: THREE.Vector3;
  target: THREE.Vector3;
  approximate?: boolean;
  showAxes?: boolean;
  visible?: boolean;
  originVisible?: boolean;
  targetVisible?: boolean;
  wireVisible?: boolean;
  axisVisible?: boolean;
  xAxisVisible?: boolean;
  yAxisVisible?: boolean;
  zAxisVisible?: boolean;
  labelVisible?: boolean;
  labelPrefix?: string;
};

const markerGeometry = new THREE.SphereGeometry(0.08, 16, 16);

function createLabelElement(kind: 'main' | 'axis'): HTMLDivElement {
  const el = document.createElement('div');
  el.style.pointerEvents = 'none';
  el.style.whiteSpace = 'nowrap';
  el.style.fontSize = kind === 'main' ? '12px' : '11px';
  el.style.fontWeight = kind === 'main' ? '700' : '600';
  el.style.padding = kind === 'main' ? '2px 8px' : '2px 6px';
  el.style.borderRadius = '999px';
  el.style.border = '1px solid rgba(30, 41, 59, 0.18)';
  el.style.background = 'rgba(255, 255, 255, 0.92)';
  el.style.boxShadow = '0 2px 8px rgba(15, 23, 42, 0.12)';
  el.style.color = '#0f172a';
  return el;
}

function formatLength(value: number): string {
  return `${value.toFixed(3)} m`;
}

export class XeokitDistanceMeasurement extends AnnotationBase {
  private params: Required<XeokitDistanceMeasurementParams>;
  private materialSet: AnnotationMaterialSet;
  private readonly mainGeometry = new THREE.BufferGeometry();
  private readonly xGeometry = new THREE.BufferGeometry();
  private readonly yGeometry = new THREE.BufferGeometry();
  private readonly zGeometry = new THREE.BufferGeometry();
  private readonly mainLine: THREE.Line;
  private readonly xLine: THREE.Line;
  private readonly yLine: THREE.Line;
  private readonly zLine: THREE.Line;
  private readonly originMarker: THREE.Mesh;
  private readonly targetMarker: THREE.Mesh;
  private readonly mainLabelEl = createLabelElement('main');
  private readonly xLabelEl = createLabelElement('axis');
  private readonly yLabelEl = createLabelElement('axis');
  private readonly zLabelEl = createLabelElement('axis');
  private readonly mainLabel: CSS2DObject;
  private readonly xLabel: CSS2DObject;
  private readonly yLabel: CSS2DObject;
  private readonly zLabel: CSS2DObject;

  constructor(materials: AnnotationMaterials, params: XeokitDistanceMeasurementParams, options?: AnnotationOptions) {
    super(materials, options);
    this.params = {
      approximate: false,
      showAxes: true,
      visible: true,
      originVisible: true,
      targetVisible: true,
      wireVisible: true,
      axisVisible: true,
      xAxisVisible: true,
      yAxisVisible: true,
      zAxisVisible: true,
      labelVisible: true,
      labelPrefix: '',
      ...params,
    };
    this.params.visible = this.params.visible ?? true;
    this.params.originVisible = this.params.originVisible ?? true;
    this.params.targetVisible = this.params.targetVisible ?? true;
    this.params.wireVisible = this.params.wireVisible ?? true;
    this.params.axisVisible = this.params.axisVisible ?? true;
    this.params.xAxisVisible = this.params.xAxisVisible ?? true;
    this.params.yAxisVisible = this.params.yAxisVisible ?? true;
    this.params.zAxisVisible = this.params.zAxisVisible ?? true;
    this.params.labelVisible = this.params.labelVisible ?? true;
    this.params.labelPrefix = this.params.labelPrefix ?? '';
    this.materialSet = this.resolveMaterialSet(materials.blue);

    this.mainLine = new THREE.Line(this.mainGeometry, this.materialSet.line);
    this.xLine = new THREE.Line(this.xGeometry, this.materialSet.line);
    this.yLine = new THREE.Line(this.yGeometry, this.materialSet.line);
    this.zLine = new THREE.Line(this.zGeometry, this.materialSet.line);

    this.originMarker = new THREE.Mesh(markerGeometry, this.materialSet.mesh);
    this.targetMarker = new THREE.Mesh(markerGeometry, this.materialSet.mesh);

    this.mainLabel = new CSS2DObject(this.mainLabelEl);
    this.xLabel = new CSS2DObject(this.xLabelEl);
    this.yLabel = new CSS2DObject(this.yLabelEl);
    this.zLabel = new CSS2DObject(this.zLabelEl);

    for (const obj of [this.mainLine, this.xLine, this.yLine, this.zLine, this.originMarker, this.targetMarker]) {
      obj.userData.pickable = true;
    }
    for (const label of [this.mainLabel, this.xLabel, this.yLabel, this.zLabel]) {
      label.userData.noPick = true;
    }

    this.add(
      this.mainLine,
      this.xLine,
      this.yLine,
      this.zLine,
      this.originMarker,
      this.targetMarker,
      this.mainLabel,
      this.xLabel,
      this.yLabel,
      this.zLabel,
    );

    this.rebuild();
    this.applyVisualState();
  }

  setParams(params: Partial<XeokitDistanceMeasurementParams>): void {
    this.params = { ...this.params, ...params };
    this.rebuild();
    this.applyVisualState();
  }

  override update(camera: THREE.Camera): void {
    super.update(camera);
    this.mainLabel.quaternion.copy(camera.quaternion);
    this.xLabel.quaternion.copy(camera.quaternion);
    this.yLabel.quaternion.copy(camera.quaternion);
    this.zLabel.quaternion.copy(camera.quaternion);
  }

  protected override onScaleFactorChanged(factor: number): void {
    const markerScale = Math.max(0.06, factor * 0.3);
    this.originMarker.scale.setScalar(markerScale);
    this.targetMarker.scale.setScalar(markerScale);
  }

  protected override onHighlightChanged(_highlighted: boolean): void {
    this.applyVisualState();
  }

  override dispose(): void {
    this.mainGeometry.dispose();
    this.xGeometry.dispose();
    this.yGeometry.dispose();
    this.zGeometry.dispose();
    this.mainLabelEl.remove();
    this.xLabelEl.remove();
    this.yLabelEl.remove();
    this.zLabelEl.remove();
    super.dispose();
  }

  private rebuild(): void {
    const origin = this.params.origin;
    const target = this.params.target;
    const cornerX = new THREE.Vector3(target.x, origin.y, origin.z);
    const cornerXY = new THREE.Vector3(target.x, target.y, origin.z);
    const delta = target.clone().sub(origin);
    const distance = origin.distanceTo(target);

    this.mainGeometry.setFromPoints([origin, target]);
    this.xGeometry.setFromPoints([origin, cornerX]);
    this.yGeometry.setFromPoints([cornerX, cornerXY]);
    this.zGeometry.setFromPoints([cornerXY, target]);

    this.originMarker.position.copy(origin);
    this.targetMarker.position.copy(target);

    const prefix = this.params.labelPrefix ? `${this.params.labelPrefix} ` : '';
    this.mainLabelEl.textContent = `${prefix}${this.params.approximate ? '≈ ' : ''}${formatLength(distance)}`;
    this.xLabelEl.textContent = `ΔX ${formatLength(Math.abs(delta.x))}`;
    this.yLabelEl.textContent = `ΔY ${formatLength(Math.abs(delta.y))}`;
    this.zLabelEl.textContent = `ΔZ ${formatLength(Math.abs(delta.z))}`;

    this.mainLabel.position.copy(origin.clone().lerp(target, 0.5).add(new THREE.Vector3(0, 0.14, 0)));
    this.xLabel.position.copy(origin.clone().lerp(cornerX, 0.5).add(new THREE.Vector3(0, 0.08, 0)));
    this.yLabel.position.copy(cornerX.clone().lerp(cornerXY, 0.5).add(new THREE.Vector3(0, 0.08, 0)));
    this.zLabel.position.copy(cornerXY.clone().lerp(target, 0.5).add(new THREE.Vector3(0, 0.08, 0)));

    const hasX = Math.abs(delta.x) > 1e-6;
    const hasY = Math.abs(delta.y) > 1e-6;
    const hasZ = Math.abs(delta.z) > 1e-6;
    const showRoot = this.params.visible;
    const showWire = showRoot && this.params.wireVisible;
    const showAxes = showRoot && this.params.showAxes && this.params.axisVisible;
    const showLabels = showRoot && this.params.labelVisible;

    this.visible = showRoot;
    this.mainLine.visible = showWire;
    this.originMarker.visible = showRoot && this.params.originVisible;
    this.targetMarker.visible = showRoot && this.params.targetVisible;
    this.mainLabel.visible = showWire && showLabels;
    this.xLine.visible = showAxes && this.params.xAxisVisible && hasX;
    this.yLine.visible = showAxes && this.params.yAxisVisible && hasY;
    this.zLine.visible = showAxes && this.params.zAxisVisible && hasZ;
    this.xLabel.visible = this.xLine.visible && showLabels;
    this.yLabel.visible = this.yLine.visible && showLabels;
    this.zLabel.visible = this.zLine.visible && showLabels;
  }

  private applyVisualState(): void {
    const state = this.interactionState;
    const lineMat =
      state === 'selected'
        ? this.materials.ssSelected.line
        : state === 'hovered'
          ? this.materials.ssHovered.line
          : this.materialSet.line;
    const meshMat =
      state === 'selected'
        ? this.materials.ssSelected.mesh
        : state === 'hovered'
          ? this.materials.ssHovered.mesh
          : this.materialSet.mesh;

    this.mainLine.material = lineMat;
    this.xLine.material = lineMat;
    this.yLine.material = lineMat;
    this.zLine.material = lineMat;
    this.originMarker.material = meshMat;
    this.targetMarker.material = meshMat;

    const textColor = state === 'selected' ? '#b91c1c' : state === 'hovered' ? '#a16207' : '#0f172a';
    for (const el of [this.mainLabelEl, this.xLabelEl, this.yLabelEl, this.zLabelEl]) {
      el.style.color = textColor;
      el.style.borderColor = state === 'selected' ? 'rgba(239, 68, 68, 0.4)' : state === 'hovered' ? 'rgba(234, 179, 8, 0.5)' : 'rgba(30, 41, 59, 0.18)';
    }
  }
}
