import * as THREE from 'three'
import type { AnnotationInteractionState } from '../core/AnnotationBase'
import { getSolveSpaceBuiltinVectorFont, SolveSpaceVectorFont } from './SolveSpaceVectorFont'

export type SolveSpaceBillboardVectorTextParams = {
  text: string
  /**
   * Desired cap-height in "SolveSpace pixel units".
   * SolveSpace defaults to 11.5px text height; we keep that as default.
   */
  capHeightPx?: number
  /** Provide a loaded font or leave empty to auto-load builtin `/fonts/unicode.lff.gz`. */
  font?: SolveSpaceVectorFont | Promise<SolveSpaceVectorFont>

  materialNormal: THREE.LineBasicMaterial
  materialHovered: THREE.LineBasicMaterial
  materialSelected: THREE.LineBasicMaterial
}

/**
 * SolveSpace-like vector text:
 * - Uses SolveSpace LFF vector font (line strokes).
 * - Renders with native `THREE.LineSegments` (GL_LINES, 1px).
 * - Uses a transparent `PlaneGeometry` as pick-proxy (bounding-rect hit test).
 */
export class SolveSpaceBillboardVectorText {
  readonly object3d: THREE.Group

  private readonly capHeightPx: number
  private materialNormal: THREE.LineBasicMaterial
  private materialHovered: THREE.LineBasicMaterial
  private materialSelected: THREE.LineBasicMaterial

  private _interactionState: AnnotationInteractionState = 'normal'
  private _text = ''
  private _worldPerPixel = 1

  private font: SolveSpaceVectorFont | null = null

  private readonly lineGeometry: THREE.BufferGeometry
  private readonly line: THREE.LineSegments

  private pickProxy: THREE.Mesh | null = null
  private pickProxyGeometry: THREE.PlaneGeometry | null = null

  /** SolveSpace-style background occlusion plane (visible, scene bg color) */
  private bgMesh: THREE.Mesh | null = null
  private bgGeometry: THREE.PlaneGeometry | null = null
  private bgMaterial: THREE.MeshBasicMaterial | null = null

  private widthPx = 0
  private heightPx = 0

  constructor(params: SolveSpaceBillboardVectorTextParams) {
    this.capHeightPx = params.capHeightPx ?? 11.5
    this.materialNormal = params.materialNormal
    this.materialHovered = params.materialHovered
    this.materialSelected = params.materialSelected

    this.object3d = new THREE.Group()

    this.lineGeometry = new THREE.BufferGeometry()
    this.line = new THREE.LineSegments(this.lineGeometry, this.materialNormal)
    this.line.frustumCulled = false
    this.line.renderOrder = 910
    this.line.userData.noPick = true
    this.object3d.add(this.line)

    this._createBackgroundMesh()
    this._createPickProxy()

    this.setText(params.text)

    const fp =
      params.font instanceof SolveSpaceVectorFont
        ? Promise.resolve(params.font)
        : (params.font ?? getSolveSpaceBuiltinVectorFont())

    fp.then((f) => {
      this.font = f
      this._rebuild()
    }).catch(() => {
      // ignore (text will stay empty)
    })
  }

  setText(text: string): void {
    if (this._text === text) return
    this._text = text
    this._rebuild()
  }

  getText(): string {
    return this._text
  }

  /** Text bounds in SolveSpace "pixel units". */
  getExtentsPx(): { width: number; height: number } {
    return { width: this.widthPx, height: this.heightPx }
  }

  /** Convert pixel units to world units by setting a scalar scale. */
  setWorldPerPixel(worldPerPixel: number): void {
    if (!Number.isFinite(worldPerPixel) || worldPerPixel <= 0) return
    if (this._worldPerPixel === worldPerPixel) return
    this._worldPerPixel = worldPerPixel
    this.object3d.scale.setScalar(worldPerPixel)
  }

  /** Back-compat naming (matches TroikaBillboardText API). */
  setScale(scale: number): void {
    this.setWorldPerPixel(scale)
  }

  setVisible(visible: boolean): void {
    this.object3d.visible = visible
  }

  /** Set background occlusion color (should match scene background). */
  setBackgroundColor(color: THREE.ColorRepresentation): void {
    if (this.bgMaterial) {
      this.bgMaterial.color.set(color)
    }
  }

  /** SolveSpace style billboard */
  update(camera: THREE.Camera): void {
    this.object3d.quaternion.copy(camera.quaternion)
  }

  setInteractionState(state: AnnotationInteractionState): void {
    if (this._interactionState === state) return
    this._interactionState = state
    this._applyMaterial()
  }

  /**
   * Update materials after construction (e.g. when annotation color set changes).
   * Note: we keep SolveSpace behavior by only switching which shared LineMaterial is used.
   */
  setMaterials(materials: { normal?: THREE.LineBasicMaterial; hovered?: THREE.LineBasicMaterial; selected?: THREE.LineBasicMaterial }): void {
    if (materials.normal) this.materialNormal = materials.normal
    if (materials.hovered) this.materialHovered = materials.hovered
    if (materials.selected) this.materialSelected = materials.selected
    this._applyMaterial()
  }

  syncPickProxyUserData(): void {
    if (!this.pickProxy) return
    const role = this.object3d.userData?.dragRole
    if (role !== undefined) this.pickProxy.userData.dragRole = role
  }

  dispose(): void {
    try { this.lineGeometry.dispose() } catch { /* ignore */ }
    try { this.pickProxyGeometry?.dispose() } catch { /* ignore */ }
    try { (this.pickProxy?.material as THREE.Material | undefined)?.dispose?.() } catch { /* ignore */ }
    try { this.bgGeometry?.dispose() } catch { /* ignore */ }
    try { this.bgMaterial?.dispose() } catch { /* ignore */ }
    this.object3d.removeFromParent()
  }

  private _applyMaterial(): void {
    if (this._interactionState === 'selected') {
      this.line.material = this.materialSelected
    } else if (this._interactionState === 'hovered') {
      this.line.material = this.materialHovered
    } else {
      this.line.material = this.materialNormal
    }
  }

  private _createBackgroundMesh(): void {
    this.bgMaterial = new THREE.MeshBasicMaterial({
      color: 0xe5e7eb, // default scene bg; caller should update via setBackgroundColor()
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: true,
      transparent: false,
    })
    this.bgGeometry = new THREE.PlaneGeometry(1, 1)
    this.bgMesh = new THREE.Mesh(this.bgGeometry, this.bgMaterial)
    this.bgMesh.renderOrder = 909 // below text lines (910), above annotation lines
    this.bgMesh.userData.noPick = true
    this.bgMesh.visible = false // shown after first _rebuild with valid extents
    this.object3d.add(this.bgMesh)
  }

  private _createPickProxy(): void {
    this.pickProxyGeometry = new THREE.PlaneGeometry(1, 1)
    const mat = new THREE.MeshBasicMaterial({
      visible: false,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    })
    this.pickProxy = new THREE.Mesh(this.pickProxyGeometry, mat)
    this.pickProxy.renderOrder = 911
    this.object3d.add(this.pickProxy)
  }

  private _rebuild(): void {
    if (!this.font) {
      // allow calling setText() before font ready
      return
    }

    const text = this._text ?? ''
    if (!text) {
      this.widthPx = 0
      this.heightPx = this.capHeightPx
      this.line.visible = false
      return
    }

    const w = this.font.getWidth(this.capHeightPx, text)
    const h = this.font.getCapHeight(this.capHeightPx)
    this.widthPx = w
    this.heightPx = h

    const originX = -w / 2
    const originY = -h / 2

    const positions: number[] = []
    this.font.trace2D(this.capHeightPx, originX, originY, text, (ax, ay, bx, by) => {
      positions.push(ax, ay, 0, bx, by, 0)
    })

    if (positions.length >= 6) {
      this.lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      this.line.visible = true
    } else {
      this.lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3))
      this.line.visible = false
    }

    // pickProxy + bgMesh: match SolveSpace DoLineTrimmedAgainstBox padding (+8px on both axes)
    const pad = 8
    const pw = Math.max(1e-6, w + pad)
    const ph = Math.max(1e-6, h + pad)
    if (this.pickProxy && this.pickProxyGeometry) {
      this.pickProxyGeometry.dispose()
      this.pickProxyGeometry = new THREE.PlaneGeometry(pw, ph)
      this.pickProxy.geometry = this.pickProxyGeometry
      this.pickProxy.position.set(0, 0, 0)
    }

    // Background occlusion plane (same size as pickProxy)
    if (this.bgMesh && this.bgGeometry) {
      this.bgGeometry.dispose()
      this.bgGeometry = new THREE.PlaneGeometry(pw, ph)
      this.bgMesh.geometry = this.bgGeometry
      this.bgMesh.position.set(0, 0, -0.01) // slightly behind text to avoid z-fight
      this.bgMesh.visible = true
    }

    this._applyMaterial()
  }
}

