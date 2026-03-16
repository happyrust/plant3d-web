import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

import { AnnotationBase, type AnnotationOptions } from '../core/AnnotationBase';

import type { AnnotationMaterials, AnnotationMaterialSet } from '../core/AnnotationMaterials';

export type XeokitAngleMeasurementParams = {
  origin: THREE.Vector3;
  corner: THREE.Vector3;
  target: THREE.Vector3;
  approximate?: boolean;
  visible?: boolean;
  originVisible?: boolean;
  cornerVisible?: boolean;
  targetVisible?: boolean;
  originWireVisible?: boolean;
  targetWireVisible?: boolean;
  angleVisible?: boolean;
  labelPrefix?: string;
};

const markerGeometry = new THREE.SphereGeometry(0.08, 16, 16);

function createLabelElement(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.pointerEvents = 'none';
  el.style.whiteSpace = 'nowrap';
  el.style.fontSize = '12px';
  el.style.fontWeight = '700';
  el.style.padding = '2px 8px';
  el.style.borderRadius = '6px';
  el.style.border = '1px solid #b45309';
  el.style.background = '#f59e0b';
  el.style.boxShadow = '0 4px 12px rgba(15, 23, 42, 0.18)';
  el.style.color = '#ffffff';
  return el;
}

function formatAngle(deg: number): string {
  return `${deg.toFixed(2)}°`;
}

export class XeokitAngleMeasurement extends AnnotationBase {
  private params: Required<XeokitAngleMeasurementParams>;
  private materialSet: AnnotationMaterialSet;
  private readonly originGeometry = new THREE.BufferGeometry();
  private readonly targetGeometry = new THREE.BufferGeometry();
  private readonly originLine: THREE.Line;
  private readonly targetLine: THREE.Line;
  private readonly originMarker: THREE.Mesh;
  private readonly cornerMarker: THREE.Mesh;
  private readonly targetMarker: THREE.Mesh;
  private readonly angleLabelEl = createLabelElement();
  private readonly angleLabel: CSS2DObject;

  constructor(materials: AnnotationMaterials, params: XeokitAngleMeasurementParams, options?: AnnotationOptions) {
    super(materials, {
      depthTest: false,
      ...options,
    });
    this.params = {
      approximate: false,
      visible: true,
      originVisible: true,
      cornerVisible: true,
      targetVisible: true,
      originWireVisible: true,
      targetWireVisible: true,
      angleVisible: true,
      labelPrefix: '',
      ...params,
    };
    this.params.visible = this.params.visible ?? true;
    this.params.originVisible = this.params.originVisible ?? true;
    this.params.cornerVisible = this.params.cornerVisible ?? true;
    this.params.targetVisible = this.params.targetVisible ?? true;
    this.params.originWireVisible = this.params.originWireVisible ?? true;
    this.params.targetWireVisible = this.params.targetWireVisible ?? true;
    this.params.angleVisible = this.params.angleVisible ?? true;
    this.params.labelPrefix = this.params.labelPrefix ?? '';
    this.materialSet = this.resolveMaterialSet(materials.orange);

    this.originLine = new THREE.Line(this.originGeometry, this.materialSet.line);
    this.targetLine = new THREE.Line(this.targetGeometry, this.materialSet.line);
    this.originMarker = new THREE.Mesh(markerGeometry, this.materialSet.mesh);
    this.cornerMarker = new THREE.Mesh(markerGeometry, this.materialSet.mesh);
    this.targetMarker = new THREE.Mesh(markerGeometry, this.materialSet.mesh);
    this.angleLabel = new CSS2DObject(this.angleLabelEl);

    for (const obj of [this.originLine, this.targetLine, this.originMarker, this.cornerMarker, this.targetMarker]) {
      obj.userData.pickable = true;
    }
    this.angleLabel.userData.noPick = true;

    this.add(this.originLine, this.targetLine, this.originMarker, this.cornerMarker, this.targetMarker, this.angleLabel);

    this.rebuild();
    this.applyVisualState();
  }

  setParams(params: Partial<XeokitAngleMeasurementParams>): void {
    this.params = { ...this.params, ...params };
    this.rebuild();
    this.applyVisualState();
  }

  override update(camera: THREE.Camera): void {
    super.update(camera);
    this.angleLabel.quaternion.copy(camera.quaternion);
  }

  protected override onScaleFactorChanged(factor: number): void {
    const markerScale = Math.max(0.06, factor * 0.3);
    this.originMarker.scale.setScalar(markerScale);
    this.cornerMarker.scale.setScalar(markerScale);
    this.targetMarker.scale.setScalar(markerScale);
  }

  protected override onHighlightChanged(_highlighted: boolean): void {
    this.applyVisualState();
  }

  override dispose(): void {
    this.originGeometry.dispose();
    this.targetGeometry.dispose();
    this.angleLabelEl.remove();
    super.dispose();
  }

  private rebuild(): void {
    const { origin, corner, target } = this.params;
    const v1 = origin.clone().sub(corner);
    const v2 = target.clone().sub(corner);
    const angle = v1.lengthSq() > 1e-9 && v2.lengthSq() > 1e-9 ? THREE.MathUtils.radToDeg(v1.angleTo(v2)) : 0;
    const bisector = v1.clone().normalize().add(v2.clone().normalize());
    if (bisector.lengthSq() <= 1e-9) {
      bisector.set(0, 1, 0);
    } else {
      bisector.normalize();
    }
    const labelOffset = Math.max(0.2, Math.min(1.2, Math.min(v1.length(), v2.length()) * 0.35));

    this.originGeometry.setFromPoints([corner, origin]);
    this.targetGeometry.setFromPoints([corner, target]);
    this.originMarker.position.copy(origin);
    this.cornerMarker.position.copy(corner);
    this.targetMarker.position.copy(target);

    const prefix = this.params.labelPrefix ? `${this.params.labelPrefix} ` : '';
    this.angleLabelEl.textContent = `${prefix}${this.params.approximate ? '~ ' : ''}${formatAngle(angle)}`;
    this.angleLabel.position.copy(corner.clone().add(bisector.multiplyScalar(labelOffset)));

    const showRoot = this.params.visible;

    this.visible = showRoot;
    this.originLine.visible = showRoot && this.params.originWireVisible;
    this.targetLine.visible = showRoot && this.params.targetWireVisible;
    this.originMarker.visible = showRoot && this.params.originVisible;
    this.cornerMarker.visible = showRoot && this.params.cornerVisible;
    this.targetMarker.visible = showRoot && this.params.targetVisible;
    this.angleLabel.visible = showRoot && this.params.angleVisible;
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

    this.originLine.material = lineMat;
    this.targetLine.material = lineMat;
    this.originMarker.material = meshMat;
    this.cornerMarker.material = meshMat;
    this.targetMarker.material = meshMat;

    this.angleLabelEl.style.color = '#ffffff';
    this.angleLabelEl.style.borderColor = state === 'selected' ? '#dc2626' : state === 'hovered' ? '#eab308' : '#b45309';
  }
}
