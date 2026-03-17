import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

import { AnnotationBase, type AnnotationOptions } from '../core/AnnotationBase';
import { worldPerPixelAt } from '../utils/solvespaceLike';

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
const MEASUREMENT_LINE_WIDTH_PX = 2.6;

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
  private readonly originGeometry = new LineGeometry();
  private readonly targetGeometry = new LineGeometry();
  private readonly originLine: Line2;
  private readonly targetLine: Line2;
  private readonly originMarker: THREE.Mesh;
  private readonly cornerMarker: THREE.Mesh;
  private readonly targetMarker: THREE.Mesh;
  private readonly angleLabelEl = createLabelElement();
  private readonly angleLabel: CSS2DObject;
  private readonly lineMaterialCache = new Map<string, LineMaterial>();
  private readonly worldScale = new THREE.Vector3();
  private readonly wppTmp = {
    ndc: new THREE.Vector3(),
    ndc2: new THREE.Vector3(),
    p0: new THREE.Vector3(),
    p1: new THREE.Vector3(),
    p2: new THREE.Vector3(),
  };
  private readonly tempWorld = new THREE.Vector3();
  private readonly tempLocalA = new THREE.Vector3();
  private readonly tempLocalB = new THREE.Vector3();
  private readonly tempLocalC = new THREE.Vector3();

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

    this.originLine = new Line2(this.originGeometry, this.getLineMaterial('normal', this.materialSet.fatLine));
    this.targetLine = new Line2(this.targetGeometry, this.getLineMaterial('normal', this.materialSet.fatLine));
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
    this.updateLabelLayout(camera);
    this.updateLineStyle();
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
    for (const material of this.lineMaterialCache.values()) {
      material.dispose();
    }
    this.lineMaterialCache.clear();
    this.angleLabelEl.remove();
    super.dispose();
  }

  private rebuild(): void {
    const { origin, corner, target } = this.params;
    const v1 = origin.clone().sub(corner);
    const v2 = target.clone().sub(corner);
    const angle = v1.lengthSq() > 1e-9 && v2.lengthSq() > 1e-9 ? THREE.MathUtils.radToDeg(v1.angleTo(v2)) : 0;
    this.setLineGeometry(this.originGeometry, corner, origin);
    this.setLineGeometry(this.targetGeometry, corner, target);
    this.originMarker.position.copy(origin);
    this.cornerMarker.position.copy(corner);
    this.targetMarker.position.copy(target);

    const prefix = this.params.labelPrefix ? `${this.params.labelPrefix} ` : '';
    this.angleLabelEl.textContent = `${prefix}${this.params.approximate ? '~ ' : ''}${formatAngle(angle)}`;
    this.angleLabel.position.copy(this.computeLabelAnchor(0.24));

    const showRoot = this.params.visible;

    this.visible = showRoot;
    this.originLine.visible = showRoot && this.params.originWireVisible;
    this.targetLine.visible = showRoot && this.params.targetWireVisible;
    this.originMarker.visible = showRoot && this.params.originVisible;
    this.cornerMarker.visible = showRoot && this.params.cornerVisible;
    this.targetMarker.visible = showRoot && this.params.targetVisible;
    this.angleLabel.visible = showRoot && this.params.angleVisible;
  }

  private setLineGeometry(geometry: LineGeometry, start: THREE.Vector3, end: THREE.Vector3): void {
    geometry.setPositions([
      start.x,
      start.y,
      start.z,
      end.x,
      end.y,
      end.z,
    ]);
  }

  private updateLabelLayout(camera: THREE.Camera): void {
    const viewport = (camera as any)?.userData?.annotationViewport as
      | { width?: number; height?: number }
      | undefined;
    const vw = Math.max(1, Math.floor(Number(viewport?.width) || Number(window?.innerWidth) || 1));
    const vh = Math.max(1, Math.floor(Number(viewport?.height) || Number(window?.innerHeight) || 1));
    const focusWorld = this.localToWorld(this.tempWorld.copy(this.params.corner));
    const wpp = worldPerPixelAt(camera, focusWorld, vw, vh, this.wppTmp);
    if (!Number.isFinite(wpp) || wpp <= 0) return;

    let localWpp = wpp;
    try {
      this.getWorldScale(this.worldScale);
      const scale =
        (Math.abs(this.worldScale.x) + Math.abs(this.worldScale.y) + Math.abs(this.worldScale.z)) / 3;
      if (Number.isFinite(scale) && scale > 1e-9) {
        localWpp = wpp / scale;
      }
    } catch {
      // ignore
    }

    const labelOffset = localWpp * 18;
    this.angleLabel.position.copy(this.computeLabelAnchor(labelOffset));
  }

  private updateLineStyle(): void {
    const { width, height } = this.materials.getResolution();
    for (const line of [this.originLine, this.targetLine]) {
      const material = line.material as LineMaterial;
      material.resolution.set(width, height);
      material.dashed = false;
      material.scale = 1;
      material.dashSize = 0;
      material.gapSize = 0;
      material.linewidth = MEASUREMENT_LINE_WIDTH_PX;
    }
  }

  private getLineMaterial(key: string, solid: LineMaterial): LineMaterial {
    const cached = this.lineMaterialCache.get(key);
    const src = (cached as any)?.__src as LineMaterial | undefined;
    if (cached && src === solid) {
      cached.linewidth = MEASUREMENT_LINE_WIDTH_PX;
      cached.dashed = false;
      return cached;
    }
    if (cached) {
      cached.dispose();
      this.lineMaterialCache.delete(key);
    }

    const material = solid.clone();
    (material as any).__src = solid;
    material.dashed = false;
    material.linewidth = MEASUREMENT_LINE_WIDTH_PX;
    material.scale = 1;
    material.dashSize = 0;
    material.gapSize = 0;
    material.resolution.copy(solid.resolution);
    this.lineMaterialCache.set(key, material);
    return material;
  }

  private computeLabelAnchor(offset: number): THREE.Vector3 {
    const { origin, corner, target } = this.params;
    const dirA = this.tempLocalA.copy(origin).sub(corner);
    const dirB = this.tempLocalB.copy(target).sub(corner);
    if (dirA.lengthSq() <= 1e-9 || dirB.lengthSq() <= 1e-9) {
      return this.tempLocalC.copy(corner);
    }

    dirA.normalize();
    dirB.normalize();
    const bisector = dirA.add(dirB);
    if (bisector.lengthSq() <= 1e-9) {
      bisector.copy(dirA).cross(new THREE.Vector3(0, 0, 1));
      if (bisector.lengthSq() <= 1e-9) {
        bisector.set(0, 1, 0);
      }
    }

    return this.tempLocalC.copy(corner).addScaledVector(bisector.normalize(), offset);
  }

  private applyVisualState(): void {
    const state = this.interactionState;
    const lineMat =
      state === 'selected'
        ? this.getLineMaterial('selected', this.materials.ssSelected.fatLine)
        : state === 'hovered'
          ? this.getLineMaterial('hovered', this.materials.ssHovered.fatLine)
          : this.getLineMaterial('normal', this.materialSet.fatLine);
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
