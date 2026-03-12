import * as THREE from 'three';

import {
  getSolveSpaceBuiltinVectorFont,
  SolveSpaceVectorFont,
} from './SolveSpaceVectorFont';

import type { AnnotationInteractionState } from '../core/AnnotationBase';

export type SolveSpaceLabelRenderStyle = 'solvespace' | 'rebarviz';

type LabelStylePreset = {
  minCapHeightPx: number;
  pickPaddingPx: number;
  textRenderOrder: number;
  bgRenderOrder: number;
  haloRenderOrder: number;
  haloOpacity: number;
  haloScale: number;
  forceTextDepthOff: boolean;
};

export type SolveSpaceBillboardVectorTextParams = {
  text: string;
  /**
   * Desired cap-height in "SolveSpace pixel units".
   * SolveSpace defaults to 11.5px text height; we keep that as default.
   */
  capHeightPx?: number;
  /** Provide a loaded font or leave empty to auto-load builtin `/fonts/unicode.lff.gz`. */
  font?: SolveSpaceVectorFont | Promise<SolveSpaceVectorFont>;

  materialNormal: THREE.LineBasicMaterial;
  materialHovered: THREE.LineBasicMaterial;
  materialSelected: THREE.LineBasicMaterial;
  /** 文本风格：solvespace(默认) | rebarviz */
  renderStyle?: SolveSpaceLabelRenderStyle;
};

const LABEL_STYLE_PRESETS: Record<
  SolveSpaceLabelRenderStyle,
  LabelStylePreset
> = {
  solvespace: {
    minCapHeightPx: 11.5,
    pickPaddingPx: 8,
    textRenderOrder: 910,
    bgRenderOrder: 909,
    haloRenderOrder: 909,
    haloOpacity: 0.85,
    haloScale: 1.12,
    forceTextDepthOff: false,
  },
  rebarviz: {
    minCapHeightPx: 16,
    pickPaddingPx: 6,
    textRenderOrder: 922,
    bgRenderOrder: 909,
    haloRenderOrder: 921,
    haloOpacity: 0.28,
    haloScale: 1.15,
    forceTextDepthOff: true,
  },
};

/**
 * SolveSpace-like vector text:
 * - Uses SolveSpace LFF vector font (line strokes).
 * - Renders with native `THREE.LineSegments` (GL_LINES, 1px).
 * - Uses a transparent `PlaneGeometry` as pick-proxy (bounding-rect hit test).
 */
export class SolveSpaceBillboardVectorText {
  readonly object3d: THREE.Group;

  private readonly baseCapHeightPx: number;
  private capHeightPx: number;
  private renderStyle: SolveSpaceLabelRenderStyle;
  private materialNormal: THREE.LineBasicMaterial;
  private materialHovered: THREE.LineBasicMaterial;
  private materialSelected: THREE.LineBasicMaterial;

  private _interactionState: AnnotationInteractionState = 'normal';
  private _text = '';
  private _worldPerPixel = 1;

  private font: SolveSpaceVectorFont | null = null;
  private fontPromise: Promise<SolveSpaceVectorFont> | null = null;
  private fontSource:
    | SolveSpaceVectorFont
    | Promise<SolveSpaceVectorFont>
    | null = null;

  private readonly lineGeometry: THREE.BufferGeometry;
  private readonly line: THREE.LineSegments;
  private haloLine: THREE.LineSegments | null = null;
  private haloMaterial: THREE.LineBasicMaterial | null = null;
  private spriteMesh: THREE.Mesh | null = null;
  private readonly rebarvizMaterialCache = new Map<
    string,
    THREE.LineBasicMaterial
  >();

  private pickProxy: THREE.Mesh | null = null;
  private pickProxyGeometry: THREE.PlaneGeometry | null = null;

  /** SolveSpace-style background occlusion plane (visible, scene bg color) */
  private bgMesh: THREE.Mesh | null = null;
  private bgGeometry: THREE.PlaneGeometry | null = null;
  private bgMaterial: THREE.MeshBasicMaterial | null = null;

  private widthPx = 0;
  private heightPx = 0;
  private lineHasGeometry = false;
  private hasExplicitFrame = false;
  private readonly frameOriginWorld = new THREE.Vector3();
  private readonly frameAxisUWorld = new THREE.Vector3(1, 0, 0);
  private readonly frameAxisVWorld = new THREE.Vector3(0, 1, 0);
  private readonly frameAxisNLocal = new THREE.Vector3();
  private readonly frameAxisULocal = new THREE.Vector3();
  private readonly frameAxisVLocal = new THREE.Vector3();
  private readonly frameOriginLocal = new THREE.Vector3();
  private readonly tmpWorldOrigin = new THREE.Vector3();
  private readonly tmpParentQuat = new THREE.Quaternion();
  private readonly tmpMatrix = new THREE.Matrix4();

  constructor(params: SolveSpaceBillboardVectorTextParams) {
    this.renderStyle = params.renderStyle ?? 'solvespace';
    this.baseCapHeightPx = params.capHeightPx ?? 11.5;
    this.capHeightPx = this.resolveCapHeightPx(this.renderStyle);
    this.materialNormal = params.materialNormal;
    this.materialHovered = params.materialHovered;
    this.materialSelected = params.materialSelected;
    this.fontSource = params.font ?? null;
    if (this.fontSource instanceof SolveSpaceVectorFont) {
      this.font = this.fontSource;
    }

    this.object3d = new THREE.Group();

    this.lineGeometry = new THREE.BufferGeometry();
    this.line = new THREE.LineSegments(this.lineGeometry, this.materialNormal);
    this.line.frustumCulled = false;
    this.line.userData.noPick = true;

    this._createHaloLine();
    this.object3d.add(this.line);

    this._createBackgroundMesh();
    this._createPickProxy();
    this.applyRenderStylePreset();

    this.setText(params.text);
  }

  setText(text: string): void {
    if (this._text === text) return;
    this._text = text;
    this._rebuild();
  }

  getText(): string {
    return this._text;
  }

  getRenderStyle(): SolveSpaceLabelRenderStyle {
    return this.renderStyle;
  }

  /** 切换文字渲染风格（SolveSpace/RebarViz） */
  setRenderStyle(style: SolveSpaceLabelRenderStyle): void {
    if (this.renderStyle === style) return;
    this.renderStyle = style;
    this.capHeightPx = this.resolveCapHeightPx(style);
    this._rebuild();
  }

  /** Text bounds in SolveSpace "pixel units". */
  getExtentsPx(): { width: number; height: number } {
    return { width: this.widthPx, height: this.heightPx };
  }

  /** Convert pixel units to world units by setting a scalar scale. */
  setWorldPerPixel(worldPerPixel: number): void {
    if (!Number.isFinite(worldPerPixel) || worldPerPixel <= 0) return;
    if (this._worldPerPixel === worldPerPixel) return;
    this._worldPerPixel = worldPerPixel;
    this.object3d.scale.setScalar(worldPerPixel);
  }

  /** Back-compat naming (matches TroikaBillboardText API). */
  setScale(scale: number): void {
    this.setWorldPerPixel(scale);
  }

  setVisible(visible: boolean): void {
    this.object3d.visible = visible;
  }

  setFrame(
    originWorld: THREE.Vector3,
    axisUWorld: THREE.Vector3,
    axisVWorld: THREE.Vector3,
  ): void {
    this.hasExplicitFrame = true;
    this.frameOriginWorld.copy(originWorld);
    this.frameAxisUWorld.copy(axisUWorld);
    this.frameAxisVWorld.copy(axisVWorld);
    this.applyFrameFromWorld();
  }

  /** Set background occlusion color (should match scene background). */
  setBackgroundColor(color: THREE.ColorRepresentation): void {
    if (this.bgMaterial) {
      this.bgMaterial.color.set(color);
    }
  }

  update(camera: THREE.Camera): void {
    if (!this.hasExplicitFrame) {
      this.object3d.updateWorldMatrix(true, false);
      this.object3d.getWorldPosition(this.tmpWorldOrigin);
      this.frameOriginWorld.copy(this.tmpWorldOrigin);
      this.frameAxisUWorld.set(1, 0, 0).applyQuaternion(camera.quaternion);
      this.frameAxisVWorld.set(0, 1, 0).applyQuaternion(camera.quaternion);
    }
    this.applyFrameFromWorld();
  }

  setInteractionState(state: AnnotationInteractionState): void {
    if (this._interactionState === state) return;
    this._interactionState = state;
    this._applyMaterial();
  }

  /**
   * Update materials after construction (e.g. when annotation color set changes).
   * Note: we keep SolveSpace behavior by only switching which shared LineMaterial is used.
   */
  setMaterials(materials: {
    normal?: THREE.LineBasicMaterial;
    hovered?: THREE.LineBasicMaterial;
    selected?: THREE.LineBasicMaterial;
  }): void {
    if (materials.normal) this.materialNormal = materials.normal;
    if (materials.hovered) this.materialHovered = materials.hovered;
    if (materials.selected) this.materialSelected = materials.selected;
    this.clearRebarvizMaterialCache();
    this._applyMaterial();
  }

  syncPickProxyUserData(): void {
    if (!this.pickProxy) return;
    const role = this.object3d.userData?.dragRole;
    if (role !== undefined) this.pickProxy.userData.dragRole = role;
  }

  dispose(): void {
    try {
      this.lineGeometry.dispose();
    } catch {
      // ignore
    }
    try {
      this.pickProxyGeometry?.dispose();
    } catch {
      // ignore
    }
    try {
      (this.pickProxy?.material as THREE.Material | undefined)?.dispose?.();
    } catch {
      // ignore
    }
    try {
      this.bgGeometry?.dispose();
    } catch {
      // ignore
    }
    try {
      this.bgMaterial?.dispose();
    } catch {
      // ignore
    }
    try {
      this.haloMaterial?.dispose();
    } catch {
      // ignore
    }
    this.clearRebarvizMaterialCache();
    this.object3d.removeFromParent();
  }

  private resolveCapHeightPx(style: SolveSpaceLabelRenderStyle): number {
    const preset = LABEL_STYLE_PRESETS[style] ?? LABEL_STYLE_PRESETS.solvespace;
    return Math.max(this.baseCapHeightPx, preset.minCapHeightPx);
  }

  private getStylePreset(): LabelStylePreset {
    return (
      LABEL_STYLE_PRESETS[this.renderStyle] ?? LABEL_STYLE_PRESETS.solvespace
    );
  }

  private applyRenderStylePreset(): void {
    const preset = this.getStylePreset();
    this.line.renderOrder = preset.textRenderOrder;
    if (this.haloLine) {
      this.haloLine.renderOrder = preset.haloRenderOrder;
      this.haloLine.scale.setScalar(preset.haloScale);
    }
    if (this.haloMaterial) {
      this.haloMaterial.opacity = preset.haloOpacity;
    }
    if (this.bgMesh) {
      this.bgMesh.renderOrder = preset.bgRenderOrder;
    }
  }

  private _applyMaterial(): void {
    const stateMat = this.resolveStateMaterial();
    if (this.getStylePreset().forceTextDepthOff) {
      this.line.material = this.getRebarvizTextMaterial(stateMat);
      return;
    }

    if (this._interactionState === 'selected') {
      this.line.material = this.materialSelected;
    } else if (this._interactionState === 'hovered') {
      this.line.material = this.materialHovered;
    } else {
      this.line.material = this.materialNormal;
    }
  }

  private _applyRenderStyleVisibility(): void {
    const hasText = this.lineHasGeometry;
    this.applyRenderStylePreset();

    this.line.visible = hasText;

    if (this.haloLine) {
      this.haloLine.visible = false; // Disable halo for all styles
    }

    if (this.bgMesh) {
      this.bgMesh.visible = hasText && this.renderStyle === 'solvespace';
    }
  }

  private _createHaloLine(): void {
    this.haloMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.68,
      depthTest: false,
      depthWrite: false,
    });
    this.haloLine = new THREE.LineSegments(
      this.lineGeometry,
      this.haloMaterial,
    );
    this.haloLine.frustumCulled = false;
    this.haloLine.userData.noPick = true;
    this.haloLine.visible = false;
    this.object3d.add(this.haloLine);
  }

  private resolveStateMaterial(): THREE.LineBasicMaterial {
    if (this._interactionState === 'selected') return this.materialSelected;
    if (this._interactionState === 'hovered') return this.materialHovered;
    return this.materialNormal;
  }

  private ensureSolveSpaceFontLoaded(): void {
    if (this.font || this.fontPromise) return;
    const source = this.fontSource ?? getSolveSpaceBuiltinVectorFont();
    this.fontSource = source;
    this.fontPromise = Promise.resolve(source)
      .then((f) => {
        this.font = f;
        this.fontPromise = null;
        this._rebuild();
        return f;
      })
      .catch(() => {
        this.fontPromise = null;
      });
  }

  private clearRebarvizMaterialCache(): void {
    for (const m of this.rebarvizMaterialCache.values()) {
      try {
        m.dispose();
      } catch {
        // ignore
      }
    }
    this.rebarvizMaterialCache.clear();
  }

  private getRebarvizTextMaterial(
    base: THREE.LineBasicMaterial,
  ): THREE.LineBasicMaterial {
    const key = base.uuid;
    const cached = this.rebarvizMaterialCache.get(key);
    if (cached) return cached;

    const m = base.clone();
    m.depthTest = false;
    m.depthWrite = false;
    m.transparent = true;
    this.rebarvizMaterialCache.set(key, m);
    return m;
  }

  private _createBackgroundMesh(): void {
    this.bgMaterial = new THREE.MeshBasicMaterial({
      color: 0xe5e7eb, // default scene bg; caller should update via setBackgroundColor()
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: true,
      transparent: false,
    });
    this.bgGeometry = new THREE.PlaneGeometry(1, 1);
    this.bgMesh = new THREE.Mesh(this.bgGeometry, this.bgMaterial);
    this.bgMesh.renderOrder = 909; // below text lines (910), above annotation lines
    this.bgMesh.userData.noPick = true;
    this.bgMesh.visible = false; // shown after first _rebuild with valid extents
    this.object3d.add(this.bgMesh);
  }

  private _createPickProxy(): void {
    this.pickProxyGeometry = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      visible: false,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    this.pickProxy = new THREE.Mesh(this.pickProxyGeometry, mat);
    this.pickProxy.renderOrder = 911;
    this.object3d.add(this.pickProxy);
  }

  private _rebuild(): void {
    const text = this._text ?? '';
    if (!text) {
      this.widthPx = 0;
      this.heightPx = this.capHeightPx;
      this.lineHasGeometry = false;
      this._applyRenderStyleVisibility();
      return;
    }

    if (!this.font) {
      this.ensureSolveSpaceFontLoaded();
      this.widthPx = 0;
      this.heightPx = this.capHeightPx;
      this.lineHasGeometry = false;
      this._applyRenderStyleVisibility();
      return;
    }

    const lines = text.split('\n');
    const capHeight = this.font.getCapHeight(this.capHeightPx);
    const fontHeight =
      typeof (this.font as any).getHeight === 'function'
        ? (this.font as any).getHeight(this.capHeightPx)
        : capHeight;
    const lineHeight = Math.max(capHeight, fontHeight * 1.15);
    const lineWidths = lines.map((line) =>
      line.length > 0 ? this.font!.getWidth(this.capHeightPx, line) : 0,
    );
    const contentW = Math.max(1, ...lineWidths);
    const contentH =
      lines.length <= 1 ? capHeight : capHeight + lineHeight * (lines.length - 1);

    const positions: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (!line) continue;
      const lineWidth = lineWidths[i] ?? 0;
      const originX = -lineWidth / 2;
      const originY = contentH / 2 - capHeight - i * lineHeight;
      this.font.trace2D(
        this.capHeightPx,
        originX,
        originY,
        line,
        (ax, ay, bx, by) => {
          positions.push(ax, ay, 0, bx, by, 0);
        },
      );
    }

    if (positions.length >= 6) {
      this.lineGeometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(positions, 3),
      );
      this.lineHasGeometry = true;
    } else {
      this.lineGeometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3),
      );
      this.lineHasGeometry = false;
    }

    this.widthPx = contentW;
    this.heightPx = contentH;

    // pickProxy + bgMesh: match SolveSpace DoLineTrimmedAgainstBox padding (+8px on both axes)
    const pickPad = this.getStylePreset().pickPaddingPx;
    const pw = Math.max(1e-6, contentW + pickPad);
    const ph = Math.max(1e-6, contentH + pickPad);
    if (this.pickProxy && this.pickProxyGeometry) {
      this.pickProxyGeometry.dispose();
      this.pickProxyGeometry = new THREE.PlaneGeometry(pw, ph);
      this.pickProxy.geometry = this.pickProxyGeometry;
      this.pickProxy.position.set(0, 0, 0);
    }

    // Background occlusion plane (same size as pickProxy)
    if (this.bgMesh && this.bgGeometry) {
      this.bgGeometry.dispose();
      this.bgGeometry = new THREE.PlaneGeometry(pw, ph);
      this.bgMesh.geometry = this.bgGeometry;
      this.bgMesh.position.set(0, 0, -0.01); // slightly behind text to avoid z-fight
    }

    this._applyMaterial();
    this._applyRenderStyleVisibility();
  }

  private applyFrameFromWorld(): void {
    const axisU = this.frameAxisULocal.copy(this.frameAxisUWorld);
    const axisV = this.frameAxisVLocal.copy(this.frameAxisVWorld);
    if (axisU.lengthSq() < 1e-12 || axisV.lengthSq() < 1e-12) return;

    const parent = this.object3d.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      parent.getWorldQuaternion(this.tmpParentQuat);
      this.tmpParentQuat.invert();
      axisU.applyQuaternion(this.tmpParentQuat);
      axisV.applyQuaternion(this.tmpParentQuat);
      this.frameOriginLocal.copy(this.frameOriginWorld);
      parent.worldToLocal(this.frameOriginLocal);
    } else {
      this.frameOriginLocal.copy(this.frameOriginWorld);
    }

    axisU.normalize();
    axisV.normalize();
    this.frameAxisNLocal.copy(axisU).cross(axisV);
    if (this.frameAxisNLocal.lengthSq() < 1e-12) return;
    this.frameAxisNLocal.normalize();
    axisV.copy(this.frameAxisNLocal).cross(axisU).normalize();

    this.tmpMatrix.makeBasis(axisU, axisV, this.frameAxisNLocal);
    this.object3d.position.copy(this.frameOriginLocal);
    this.object3d.quaternion.setFromRotationMatrix(this.tmpMatrix);
  }
}
