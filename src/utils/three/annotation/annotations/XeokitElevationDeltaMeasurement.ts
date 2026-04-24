import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

import { AnnotationBase, type AnnotationOptions } from '../core/AnnotationBase';
import { worldPerPixelAt } from '../utils/solvespaceLike';

import type { AnnotationMaterials, AnnotationMaterialSet } from '../core/AnnotationMaterials';

export type XeokitElevationDeltaMeasurementParams = {
  origin: THREE.Vector3;
  target: THREE.Vector3;
  originLabelText: string;
  targetLabelText: string;
  deltaLabelText: string;
  visible?: boolean;
  markerVisible?: boolean;
  endpointLabelsVisible?: boolean;
  deltaLabelVisible?: boolean;
  verticalGuideVisible?: boolean;
};

const markerGeometry = new THREE.SphereGeometry(0.08, 16, 16);
const GUIDE_LINE_WIDTH_PX = 2.4;

function createLabelElement(kind: 'endpoint' | 'delta'): HTMLDivElement {
  const el = document.createElement('div');
  el.style.pointerEvents = 'none';
  el.style.whiteSpace = 'nowrap';
  el.style.padding = kind === 'delta' ? '4px 8px' : '3px 7px';
  el.style.borderRadius = kind === 'delta' ? '999px' : '8px';
  el.style.border = '1px solid #0f766e';
  el.style.background = kind === 'delta' ? 'rgba(15, 118, 110, 0.94)' : 'rgba(15, 118, 110, 0.88)';
  el.style.boxShadow = '0 8px 22px rgba(15, 23, 42, 0.18)';
  el.style.color = '#ffffff';
  el.style.fontSize = kind === 'delta' ? '11px' : '10px';
  el.style.fontWeight = kind === 'delta' ? '700' : '600';
  return el;
}

export class XeokitElevationDeltaMeasurement extends AnnotationBase {
  private params: Required<XeokitElevationDeltaMeasurementParams>;
  private materialSet: AnnotationMaterialSet;
  private readonly guideGeometry = new LineGeometry();
  private readonly guideLine: Line2;
  private readonly originMarker: THREE.Mesh;
  private readonly targetMarker: THREE.Mesh;
  private readonly originLabelEl = createLabelElement('endpoint');
  private readonly targetLabelEl = createLabelElement('endpoint');
  private readonly deltaLabelEl = createLabelElement('delta');
  private readonly originLabel: CSS2DObject;
  private readonly targetLabel: CSS2DObject;
  private readonly deltaLabel: CSS2DObject;
  private readonly lineMaterialCache = new Map<string, LineMaterial>();
  private readonly worldScale = new THREE.Vector3();
  private readonly wppTmp = {
    ndc: new THREE.Vector3(),
    ndc2: new THREE.Vector3(),
    p0: new THREE.Vector3(),
    p1: new THREE.Vector3(),
    p2: new THREE.Vector3(),
  };
  private readonly tempMidpoint = new THREE.Vector3();
  private readonly tempProjectedOrigin = new THREE.Vector3();
  private readonly tempFocusWorld = new THREE.Vector3();
  private readonly upAxis = new THREE.Vector3(0, 0, 1);
  private readonly sideAxis = new THREE.Vector3(1, 0, 0);

  constructor(materials: AnnotationMaterials, params: XeokitElevationDeltaMeasurementParams, options?: AnnotationOptions) {
    super(materials, {
      depthTest: false,
      ...options,
    });
    this.params = {
      visible: true,
      markerVisible: true,
      endpointLabelsVisible: true,
      deltaLabelVisible: true,
      verticalGuideVisible: true,
      ...params,
    };
    this.materialSet = this.resolveMaterialSet(materials.green);
    this.guideLine = new Line2(this.guideGeometry, this.getLineMaterial('normal', this.materialSet.fatLine));
    this.originMarker = new THREE.Mesh(markerGeometry, this.materialSet.mesh);
    this.targetMarker = new THREE.Mesh(markerGeometry, this.materialSet.mesh);
    this.originLabel = new CSS2DObject(this.originLabelEl);
    this.targetLabel = new CSS2DObject(this.targetLabelEl);
    this.deltaLabel = new CSS2DObject(this.deltaLabelEl);

    for (const obj of [this.guideLine, this.originMarker, this.targetMarker]) {
      obj.userData.pickable = true;
    }
    for (const label of [this.originLabel, this.targetLabel, this.deltaLabel]) {
      label.userData.noPick = true;
    }

    this.add(
      this.guideLine,
      this.originMarker,
      this.targetMarker,
      this.originLabel,
      this.targetLabel,
      this.deltaLabel,
    );

    this.rebuild();
    this.applyVisualState();
  }

  setParams(params: Partial<XeokitElevationDeltaMeasurementParams>): void {
    this.params = { ...this.params, ...params };
    this.rebuild();
    this.applyVisualState();
  }

  override update(camera: THREE.Camera): void {
    super.update(camera);
    this.updateLayout(camera);
    this.updateLineStyle();
    this.originLabel.quaternion.copy(camera.quaternion);
    this.targetLabel.quaternion.copy(camera.quaternion);
    this.deltaLabel.quaternion.copy(camera.quaternion);
  }

  protected override onScaleFactorChanged(factor: number): void {
    const markerScale = Math.max(0.06, factor * 0.28);
    this.originMarker.scale.setScalar(markerScale);
    this.targetMarker.scale.setScalar(markerScale);
  }

  protected override onHighlightChanged(_highlighted: boolean): void {
    this.applyVisualState();
  }

  override dispose(): void {
    this.guideGeometry.dispose();
    for (const material of this.lineMaterialCache.values()) {
      material.dispose();
    }
    this.lineMaterialCache.clear();
    this.originLabelEl.remove();
    this.targetLabelEl.remove();
    this.deltaLabelEl.remove();
    super.dispose();
  }

  private rebuild(): void {
    this.originMarker.position.copy(this.params.origin);
    this.targetMarker.position.copy(this.params.target);
    this.originLabelEl.textContent = this.params.originLabelText;
    this.targetLabelEl.textContent = this.params.targetLabelText;
    this.deltaLabelEl.textContent = this.params.deltaLabelText;
    this.visible = this.params.visible;
    this.originMarker.visible = this.params.visible && this.params.markerVisible;
    this.targetMarker.visible = this.params.visible && this.params.markerVisible;
    this.originLabel.visible = this.params.visible && this.params.endpointLabelsVisible;
    this.targetLabel.visible = this.params.visible && this.params.endpointLabelsVisible;
    this.deltaLabel.visible = this.params.visible && this.params.deltaLabelVisible;
    this.guideLine.visible = this.params.visible && this.params.verticalGuideVisible;
    this.setGuideGeometry();
    this.originLabel.position.copy(this.params.origin).addScaledVector(this.upAxis, 0.18);
    this.targetLabel.position.copy(this.params.target).addScaledVector(this.upAxis, 0.18);
    this.tempMidpoint.copy(this.params.origin).lerp(this.params.target, 0.5);
    this.deltaLabel.position.copy(this.tempMidpoint).addScaledVector(this.sideAxis, 0.14);
  }

  private updateLayout(camera: THREE.Camera): void {
    const viewport = (camera as any)?.userData?.annotationViewport as
      | { width?: number; height?: number }
      | undefined;
    const vw = Math.max(1, Math.floor(Number(viewport?.width) || Number(window?.innerWidth) || 1));
    const vh = Math.max(1, Math.floor(Number(viewport?.height) || Number(window?.innerHeight) || 1));
    this.tempFocusWorld.copy(this.params.origin).lerp(this.params.target, 0.5);
    this.localToWorld(this.tempFocusWorld);
    const wpp = worldPerPixelAt(camera, this.tempFocusWorld, vw, vh, this.wppTmp);
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

    const endpointOffset = localWpp * 16;
    const deltaOffset = localWpp * 18;
    this.originLabel.position.copy(this.params.origin).addScaledVector(this.upAxis, endpointOffset);
    this.targetLabel.position.copy(this.params.target).addScaledVector(this.upAxis, endpointOffset);
    this.tempProjectedOrigin.set(this.params.target.x, this.params.target.y, this.params.origin.z);
    this.tempMidpoint.copy(this.tempProjectedOrigin).lerp(this.params.target, 0.5);
    this.deltaLabel.position.copy(this.tempMidpoint).addScaledVector(this.sideAxis, deltaOffset);
  }

  private setGuideGeometry(): void {
    this.tempProjectedOrigin.set(this.params.target.x, this.params.target.y, this.params.origin.z);
    this.guideGeometry.setPositions([
      this.tempProjectedOrigin.x,
      this.tempProjectedOrigin.y,
      this.tempProjectedOrigin.z,
      this.params.target.x,
      this.params.target.y,
      this.params.target.z,
    ]);
  }

  private updateLineStyle(): void {
    const { width, height } = this.materials.getResolution();
    const material = this.guideLine.material as LineMaterial;
    material.resolution.set(width, height);
    material.dashed = false;
    material.scale = 1;
    material.dashSize = 0;
    material.gapSize = 0;
    material.linewidth = GUIDE_LINE_WIDTH_PX;
  }

  private getLineMaterial(key: string, solid: LineMaterial): LineMaterial {
    const cached = this.lineMaterialCache.get(key);
    const src = (cached as any)?.__src as LineMaterial | undefined;
    if (cached && src === solid) {
      cached.linewidth = GUIDE_LINE_WIDTH_PX;
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
    material.linewidth = GUIDE_LINE_WIDTH_PX;
    material.scale = 1;
    material.dashSize = 0;
    material.gapSize = 0;
    material.resolution.copy(solid.resolution);
    this.lineMaterialCache.set(key, material);
    return material;
  }

  private applyVisualState(): void {
    const state = this.interactionState;
    this.guideLine.material =
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
    this.originMarker.material = meshMat;
    this.targetMarker.material = meshMat;

    const borderColor =
      state === 'selected'
        ? '#dc2626'
        : state === 'hovered'
          ? '#eab308'
          : '#0f766e';
    this.originLabelEl.style.borderColor = borderColor;
    this.targetLabelEl.style.borderColor = borderColor;
    this.deltaLabelEl.style.borderColor = borderColor;
  }
}
