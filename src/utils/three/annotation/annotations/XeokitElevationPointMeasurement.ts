import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

import { AnnotationBase, type AnnotationOptions } from '../core/AnnotationBase';
import { worldPerPixelAt } from '../utils/solvespaceLike';

import type { AnnotationMaterials, AnnotationMaterialSet } from '../core/AnnotationMaterials';

export type XeokitElevationPointMeasurementParams = {
  point: THREE.Vector3;
  labelLines: string[];
  visible?: boolean;
  markerVisible?: boolean;
  leaderVisible?: boolean;
  labelVisible?: boolean;
};

const markerGeometry = new THREE.SphereGeometry(0.08, 16, 16);
const LEADER_LINE_WIDTH_PX = 2.4;

function createLabelElement(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.pointerEvents = 'none';
  el.style.display = 'flex';
  el.style.flexDirection = 'column';
  el.style.gap = '2px';
  el.style.minWidth = '108px';
  el.style.padding = '6px 8px';
  el.style.borderRadius = '10px';
  el.style.border = '1px solid #0284c7';
  el.style.background = 'rgba(2, 132, 199, 0.94)';
  el.style.boxShadow = '0 8px 22px rgba(15, 23, 42, 0.22)';
  el.style.color = '#ffffff';
  return el;
}

function setLabelLines(el: HTMLDivElement, lines: string[]): void {
  el.replaceChildren();
  for (const line of lines) {
    const row = document.createElement('div');
    row.style.whiteSpace = 'nowrap';
    row.style.fontSize = '11px';
    row.style.fontWeight = line.startsWith('标高') ? '700' : '600';
    row.textContent = line;
    el.appendChild(row);
  }
}

export class XeokitElevationPointMeasurement extends AnnotationBase {
  private params: Required<XeokitElevationPointMeasurementParams>;
  private materialSet: AnnotationMaterialSet;
  private readonly leaderGeometry = new LineGeometry();
  private readonly leaderLine: Line2;
  private readonly marker: THREE.Mesh;
  private readonly labelEl = createLabelElement();
  private readonly label: CSS2DObject;
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
  private readonly tempLeaderEnd = new THREE.Vector3();
  private readonly upAxis = new THREE.Vector3(0, 0, 1);

  constructor(materials: AnnotationMaterials, params: XeokitElevationPointMeasurementParams, options?: AnnotationOptions) {
    super(materials, {
      depthTest: false,
      ...options,
    });
    this.params = {
      visible: true,
      markerVisible: true,
      leaderVisible: true,
      labelVisible: true,
      ...params,
    };
    this.materialSet = this.resolveMaterialSet(materials.blue);
    this.leaderLine = new Line2(this.leaderGeometry, this.getLineMaterial('normal', this.materialSet.fatLine));
    this.marker = new THREE.Mesh(markerGeometry, this.materialSet.mesh);
    this.label = new CSS2DObject(this.labelEl);

    this.leaderLine.userData.pickable = true;
    this.marker.userData.pickable = true;
    this.label.userData.noPick = true;

    this.add(this.leaderLine, this.marker, this.label);
    this.rebuild();
    this.applyVisualState();
  }

  setParams(params: Partial<XeokitElevationPointMeasurementParams>): void {
    this.params = { ...this.params, ...params };
    this.rebuild();
    this.applyVisualState();
  }

  override update(camera: THREE.Camera): void {
    super.update(camera);
    this.updateLayout(camera);
    this.updateLineStyle();
    this.label.quaternion.copy(camera.quaternion);
  }

  protected override onScaleFactorChanged(factor: number): void {
    const markerScale = Math.max(0.06, factor * 0.28);
    this.marker.scale.setScalar(markerScale);
  }

  protected override onHighlightChanged(_highlighted: boolean): void {
    this.applyVisualState();
  }

  override dispose(): void {
    this.leaderGeometry.dispose();
    for (const material of this.lineMaterialCache.values()) {
      material.dispose();
    }
    this.lineMaterialCache.clear();
    this.labelEl.remove();
    super.dispose();
  }

  private rebuild(): void {
    this.marker.position.copy(this.params.point);
    setLabelLines(this.labelEl, this.params.labelLines);
    this.visible = this.params.visible;
    this.marker.visible = this.params.visible && this.params.markerVisible;
    this.leaderLine.visible = this.params.visible && this.params.leaderVisible;
    this.label.visible = this.params.visible && this.params.labelVisible && this.params.labelLines.length > 0;
    this.setLineGeometry(this.params.point, this.params.point.clone().addScaledVector(this.upAxis, 0.2));
    this.label.position.copy(this.params.point).addScaledVector(this.upAxis, 0.28);
  }

  private updateLayout(camera: THREE.Camera): void {
    const viewport = (camera as any)?.userData?.annotationViewport as
      | { width?: number; height?: number }
      | undefined;
    const vw = Math.max(1, Math.floor(Number(viewport?.width) || Number(window?.innerWidth) || 1));
    const vh = Math.max(1, Math.floor(Number(viewport?.height) || Number(window?.innerHeight) || 1));
    const focusWorld = this.localToWorld(this.tempWorld.copy(this.params.point));
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

    const leaderLength = localWpp * 20;
    const labelOffset = localWpp * 30;
    this.tempLeaderEnd.copy(this.params.point).addScaledVector(this.upAxis, leaderLength);
    this.setLineGeometry(this.params.point, this.tempLeaderEnd);
    this.label.position.copy(this.params.point).addScaledVector(this.upAxis, labelOffset);
  }

  private updateLineStyle(): void {
    const { width, height } = this.materials.getResolution();
    const material = this.leaderLine.material as LineMaterial;
    material.resolution.set(width, height);
    material.dashed = false;
    material.scale = 1;
    material.dashSize = 0;
    material.gapSize = 0;
    material.linewidth = LEADER_LINE_WIDTH_PX;
  }

  private setLineGeometry(start: THREE.Vector3, end: THREE.Vector3): void {
    this.leaderGeometry.setPositions([
      start.x,
      start.y,
      start.z,
      end.x,
      end.y,
      end.z,
    ]);
  }

  private getLineMaterial(key: string, solid: LineMaterial): LineMaterial {
    const cached = this.lineMaterialCache.get(key);
    const src = (cached as any)?.__src as LineMaterial | undefined;
    if (cached && src === solid) {
      cached.linewidth = LEADER_LINE_WIDTH_PX;
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
    material.linewidth = LEADER_LINE_WIDTH_PX;
    material.scale = 1;
    material.dashSize = 0;
    material.gapSize = 0;
    material.resolution.copy(solid.resolution);
    this.lineMaterialCache.set(key, material);
    return material;
  }

  private applyVisualState(): void {
    const state = this.interactionState;
    this.leaderLine.material =
      state === 'selected'
        ? this.getLineMaterial('selected', this.materials.ssSelected.fatLine)
        : state === 'hovered'
          ? this.getLineMaterial('hovered', this.materials.ssHovered.fatLine)
          : this.getLineMaterial('normal', this.materialSet.fatLine);
    this.marker.material =
      state === 'selected'
        ? this.materials.ssSelected.mesh
        : state === 'hovered'
          ? this.materials.ssHovered.mesh
          : this.materialSet.mesh;

    this.labelEl.style.borderColor =
      state === 'selected'
        ? '#dc2626'
        : state === 'hovered'
          ? '#eab308'
          : '#0284c7';
  }
}
