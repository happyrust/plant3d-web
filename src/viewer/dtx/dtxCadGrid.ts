import { Box3, Color, GridHelper, Group, type Material, Vector3 } from 'three';

export type CadGridOptions = {
  enabled?: boolean;
  followTarget?: boolean;
  minorDivisions?: number;
  majorDivisions?: number;
  minorOpacity?: number;
  majorOpacity?: number;
  minorColor?: number | string;
  majorColor?: number | string;
  centerColor?: number | string;
  initialSize?: number;
  initialGroundZ?: number;
};

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.max(0, Math.min(1, v));
}

function niceRoundUp(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return n * exp;
}

function disposeMaterial(material: Material | Material[]): void {
  const list = Array.isArray(material) ? material : [material];
  for (const m of list) {
    try {
      m.dispose();
    } catch {
      // ignore
    }
  }
}

function applyGridMaterialStyle(material: Material | Material[], opacity: number): void {
  const list = Array.isArray(material) ? material : [material];
  const o = clamp01(opacity);
  for (const m of list) {
    const any = m as any;
    if (any.transparent !== undefined) any.transparent = o < 1;
    if (any.opacity !== undefined) any.opacity = o;
    if (any.depthWrite !== undefined) any.depthWrite = false;
  }
}

export class CadGrid {
  readonly group: Group;

  private _enabled: boolean;
  private _followTarget: boolean;
  private _minorDivisions: number;
  private _majorDivisions: number;
  private _minorOpacity: number;
  private _majorOpacity: number;
  private _minorColor: Color;
  private _majorColor: Color;
  private _centerColor: Color;

  private _gridSize: number;
  private _groundZ: number;
  private _snapStep: number;
  private _epsilonZ: number;

  private _minor: GridHelper | null = null;
  private _major: GridHelper | null = null;

  private _lastSnapX: number | null = null;
  private _lastSnapY: number | null = null;

  constructor(options: CadGridOptions = {}) {
    this._enabled = options.enabled !== false;
    this._followTarget = options.followTarget !== false;
    this._minorDivisions = clampInt(options.minorDivisions ?? 100, 10, 200);
    this._majorDivisions = clampInt(options.majorDivisions ?? 10, 2, 100);
    this._minorOpacity = clamp01(options.minorOpacity ?? 0.18);
    this._majorOpacity = clamp01(options.majorOpacity ?? 0.35);
    this._minorColor = new Color(options.minorColor ?? 0x9ca3af);
    this._majorColor = new Color(options.majorColor ?? 0x6b7280);
    this._centerColor = new Color(options.centerColor ?? 0x374151);

    this._gridSize = Math.max(1, Number(options.initialSize ?? 100000));
    this._groundZ = Number.isFinite(options.initialGroundZ) ? Number(options.initialGroundZ) : 0;
    this._snapStep = Math.max(1e-6, this._gridSize / Math.max(1, this._majorDivisions));
    this._epsilonZ = Math.max(1e-6, (this._gridSize / Math.max(1, this._minorDivisions)) * 1e-3);

    this.group = new Group();
    this.group.name = 'dtx-cad-grid';
    this.group.rotation.x = Math.PI / 2; // GridHelper 默认是 XZ 平面；Z-up 下需要转到 XY 平面
    this.group.visible = this._enabled;
    this.group.position.z = this._groundZ - this._epsilonZ;

    this._rebuild();
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled === true;
    this.group.visible = this._enabled;
  }

  fitToBoundingBox(bbox: Box3): void {
    if (!bbox || bbox.isEmpty()) return;

    const size = bbox.getSize(new Vector3());
    const center = bbox.getCenter(new Vector3());

    const maxXY = Math.max(size.x, size.y);
    const desired = Math.max(10, maxXY * 2);
    const nextSize = niceRoundUp(desired);
    const nextGroundZ = bbox.min.z;

    const sizeChanged = Math.abs(nextSize - this._gridSize) > 1e-6;
    this._gridSize = nextSize;
    this._snapStep = Math.max(1e-6, this._gridSize / Math.max(1, this._majorDivisions));
    this._epsilonZ = Math.max(1e-6, (this._gridSize / Math.max(1, this._minorDivisions)) * 1e-3);

    this._groundZ = nextGroundZ;
    this.group.position.z = this._groundZ - this._epsilonZ;

    // 初次对齐到模型中心；后续若 followTarget 开启，会在 update() 中做 snapping
    if (this._lastSnapX === null) this.group.position.x = center.x;
    if (this._lastSnapY === null) this.group.position.y = center.y;

    if (sizeChanged) {
      this._rebuild();
    }
  }

  update(target: Vector3): void {
    if (!this._enabled) return;
    if (!this._followTarget) return;
    if (!target) return;

    const step = this._snapStep;
    if (!Number.isFinite(step) || step <= 0) return;

    const snapX = Math.round(target.x / step) * step;
    const snapY = Math.round(target.y / step) * step;

    if (this._lastSnapX === snapX && this._lastSnapY === snapY) return;
    this._lastSnapX = snapX;
    this._lastSnapY = snapY;

    this.group.position.x = snapX;
    this.group.position.y = snapY;
  }

  private _rebuild(): void {
    this._clear();

    // major（稀疏、深色）
    this._major = new GridHelper(this._gridSize, this._majorDivisions, this._centerColor, this._majorColor);
    this._major.name = 'dtx-cad-grid-major';
    this._major.renderOrder = -1000;
    this._major.frustumCulled = false;
    applyGridMaterialStyle(this._major.material, this._majorOpacity);

    // minor（密集、浅色）
    this._minor = new GridHelper(this._gridSize, this._minorDivisions, this._centerColor, this._minorColor);
    this._minor.name = 'dtx-cad-grid-minor';
    this._minor.renderOrder = -1001;
    this._minor.frustumCulled = false;
    applyGridMaterialStyle(this._minor.material, this._minorOpacity);

    this.group.add(this._major);
    this.group.add(this._minor);
  }

  private _clear(): void {
    const nodes = [this._minor, this._major].filter(Boolean) as GridHelper[];
    for (const n of nodes) {
      try {
        this.group.remove(n);
      } catch {
        // ignore
      }
      try {
        n.geometry.dispose();
      } catch {
        // ignore
      }
      disposeMaterial(n.material);
    }
    this._minor = null;
    this._major = null;
  }

  dispose(): void {
    this._clear();
    try {
      this.group.parent?.remove(this.group);
    } catch {
      // ignore
    }
  }
}

