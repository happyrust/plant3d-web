import * as THREE from "three";

import type { AnnotationInteractionState } from "../core/AnnotationBase";
import {
  getSolveSpaceBuiltinVectorFont,
  SolveSpaceVectorFont,
} from "./SolveSpaceVectorFont";

export type SolveSpaceLabelRenderStyle = "solvespace" | "rebarviz";

type LabelStylePreset = {
  minCapHeightPx: number;
  pickPaddingPx: number;
  textRenderOrder: number;
  bgRenderOrder: number;
  haloRenderOrder: number;
  haloOpacity: number;
  haloScale: number;
  forceTextDepthOff: boolean;
  useCanvasText: boolean;
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
    haloOpacity: 0.68,
    haloScale: 1.06,
    forceTextDepthOff: false,
    useCanvasText: false,
  },
  rebarviz: {
    minCapHeightPx: 16,
    pickPaddingPx: 6,
    textRenderOrder: 922,
    bgRenderOrder: 909,
    haloRenderOrder: 921,
    haloOpacity: 0.72,
    haloScale: 1.08,
    forceTextDepthOff: true,
    useCanvasText: true,
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

  private _interactionState: AnnotationInteractionState = "normal";
  private _text = "";
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
  private spriteGeometry: THREE.PlaneGeometry | null = null;
  private spriteMaterial: THREE.MeshBasicMaterial | null = null;
  private spriteTexture: THREE.CanvasTexture | null = null;
  private spriteCanvas: HTMLCanvasElement | null = null;
  private spriteCtx: CanvasRenderingContext2D | null = null;
  private spriteLayout: {
    lines: string[];
    fontPx: number;
    lineHeight: number;
    pad: number;
    canvasWidth: number;
    canvasHeight: number;
  } | null = null;
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

  constructor(params: SolveSpaceBillboardVectorTextParams) {
    this.renderStyle = params.renderStyle ?? "solvespace";
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
    this._createRebarvizSprite();

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

  /** Set background occlusion color (should match scene background). */
  setBackgroundColor(color: THREE.ColorRepresentation): void {
    if (this.bgMaterial) {
      this.bgMaterial.color.set(color);
    }
  }

  /** SolveSpace style billboard */
  update(camera: THREE.Camera): void {
    this.object3d.quaternion.copy(camera.quaternion);
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
    try {
      this.spriteGeometry?.dispose();
    } catch {
      // ignore
    }
    try {
      this.spriteMaterial?.dispose();
    } catch {
      // ignore
    }
    try {
      this.spriteTexture?.dispose();
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
    if (this.spriteMesh) {
      this.spriteMesh.renderOrder = preset.textRenderOrder;
    }
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
      this.refreshRebarvizSpriteText();
      return;
    }

    if (this._interactionState === "selected") {
      this.line.material = this.materialSelected;
    } else if (this._interactionState === "hovered") {
      this.line.material = this.materialHovered;
    } else {
      this.line.material = this.materialNormal;
    }
  }

  private _applyRenderStyleVisibility(): void {
    const hasText = this.getStylePreset().useCanvasText
      ? !!this.spriteLayout
      : this.lineHasGeometry;
    this.applyRenderStylePreset();

    this.line.visible = hasText && this.renderStyle === "solvespace";

    if (this.haloLine) {
      this.haloLine.visible = hasText && this.renderStyle === "rebarviz";
    }

    if (this.bgMesh) {
      this.bgMesh.visible = hasText && this.renderStyle === "solvespace";
    }
    if (this.spriteMesh) {
      this.spriteMesh.visible = hasText && this.renderStyle === "rebarviz";
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

  private _createRebarvizSprite(): void {
    this.spriteGeometry = new THREE.PlaneGeometry(1, 1);
    this.spriteMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.spriteMesh = new THREE.Mesh(this.spriteGeometry, this.spriteMaterial);
    this.spriteMesh.userData.noPick = true;
    this.spriteMesh.visible = false;
    this.object3d.add(this.spriteMesh);
  }

  private ensureSpriteCanvas(): boolean {
    if (this.spriteCanvas && this.spriteCtx) return true;
    if (typeof document === "undefined") return false;
    this.spriteCanvas = document.createElement("canvas");
    this.spriteCtx = this.spriteCanvas.getContext("2d");
    return !!this.spriteCtx;
  }

  private getActiveTextColorCss(): string {
    const mat = this.resolveStateMaterial();
    const color = (mat as any)?.color as THREE.Color | undefined;
    if (!color) return "#6d28d9";
    return `#${color.getHexString()}`;
  }

  private resolveStateMaterial(): THREE.LineBasicMaterial {
    if (this._interactionState === "selected") return this.materialSelected;
    if (this._interactionState === "hovered") return this.materialHovered;
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

  private refreshRebarvizSpriteText(): void {
    if (!this.spriteLayout || !this.spriteMaterial || !this.spriteMesh) return;
    if (!this.ensureSpriteCanvas()) return;
    const canvas = this.spriteCanvas!;
    const ctx = this.spriteCtx!;
    const layout = this.spriteLayout;
    const dpr =
      typeof window !== "undefined"
        ? Math.max(1, window.devicePixelRatio || 1)
        : 1;

    canvas.width = Math.max(1, Math.floor(layout.canvasWidth * dpr));
    canvas.height = Math.max(1, Math.floor(layout.canvasHeight * dpr));
    canvas.style.width = `${layout.canvasWidth}px`;
    canvas.style.height = `${layout.canvasHeight}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, layout.canvasWidth, layout.canvasHeight);
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.font = `700 ${layout.fontPx}px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif`;
    ctx.fillStyle = this.getActiveTextColorCss();
    ctx.strokeStyle = "rgba(255,255,255,0.78)";
    ctx.lineWidth = Math.max(1.6, layout.fontPx * 0.12);

    for (let i = 0; i < layout.lines.length; i++) {
      const line = layout.lines[i] ?? "";
      const y = layout.pad + i * layout.lineHeight;
      ctx.strokeText(line, layout.pad, y);
      ctx.fillText(line, layout.pad, y);
    }

    this.spriteTexture?.dispose();
    this.spriteTexture = new THREE.CanvasTexture(canvas);
    this.spriteTexture.needsUpdate = true;
    this.spriteTexture.minFilter = THREE.LinearFilter;
    this.spriteTexture.magFilter = THREE.LinearFilter;

    this.spriteMaterial.map = this.spriteTexture;
    this.spriteMaterial.needsUpdate = true;
    this.spriteMesh.scale.set(layout.canvasWidth, layout.canvasHeight, 1);
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
    const text = this._text ?? "";
    if (!text) {
      this.widthPx = 0;
      this.heightPx = this.capHeightPx;
      this.lineHasGeometry = false;
      this.spriteLayout = null;
      this._applyRenderStyleVisibility();
      return;
    }

    let contentW = 0;
    let contentH = this.capHeightPx;
    if (this.getStylePreset().useCanvasText) {
      const lines = text.split("\n");
      const fontPx = this.capHeightPx;
      const lineHeight = Math.max(1, fontPx * 1.15);
      const pad = 4;
      let maxLineWidth = 0;
      if (this.ensureSpriteCanvas()) {
        const ctx = this.spriteCtx!;
        ctx.font = `700 ${fontPx}px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif`;
        for (const line of lines) {
          maxLineWidth = Math.max(maxLineWidth, ctx.measureText(line).width);
        }
      } else {
        maxLineWidth = Math.max(
          ...lines.map((x) => x.length * fontPx * 0.62),
          fontPx,
        );
      }

      const contentHeight = Math.max(fontPx, lines.length * lineHeight);
      const canvasWidth = Math.ceil(maxLineWidth + pad * 2);
      const canvasHeight = Math.ceil(contentHeight + pad * 2);

      contentW = maxLineWidth;
      contentH = contentHeight;
      this.spriteLayout = {
        lines,
        fontPx,
        lineHeight,
        pad,
        canvasWidth,
        canvasHeight,
      };

      this.refreshRebarvizSpriteText();
      this.lineHasGeometry = false;
    } else {
      if (!this.font) {
        this.ensureSolveSpaceFontLoaded();
        this.widthPx = 0;
        this.heightPx = this.capHeightPx;
        this.lineHasGeometry = false;
        this.spriteLayout = null;
        this._applyRenderStyleVisibility();
        return;
      }

      const w = this.font.getWidth(this.capHeightPx, text);
      const h = this.font.getCapHeight(this.capHeightPx);
      contentW = w;
      contentH = h;

      const originX = -w / 2;
      const originY = -h / 2;

      const positions: number[] = [];
      this.font.trace2D(
        this.capHeightPx,
        originX,
        originY,
        text,
        (ax, ay, bx, by) => {
          positions.push(ax, ay, 0, bx, by, 0);
        },
      );

      if (positions.length >= 6) {
        this.lineGeometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(positions, 3),
        );
        this.lineHasGeometry = true;
      } else {
        this.lineGeometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3),
        );
        this.lineHasGeometry = false;
      }
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
}
