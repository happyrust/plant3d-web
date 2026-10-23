/**
 * 房间视图专用三维叠加图层（对齐 `plant-ui/crates/plant-ui-view3d/src/room_clip.rs`）：
 * 1. `roomVolumeGroup`：在册面板（`PANE`）画成半透明蓝青色 X-Ray 壳体 + 轮廓边线，不可拾取（不挡鼠标点选房内构件）；
 * 2. `capGroup`：直段截点处的 2 mm 洋红色（`#D946EF`）断口薄饼；
 * 3. `pieceGroup`：凹房间 / L 形房间直管二次进房时生成的附加兄弟管段（`pieces[1..]`）。
 *
 * 整个 `rootGroup` 的 `matrix` 与 `DTXLayer.getGlobalModelMatrix()` 保持同步（ミリメートル -> 场景世界系），
 * 因此子节点的 `matrix` 直接使用 PDMS 世界毫米系矩阵，零坐标换算误差、零 `DTXLayer.recompile()` 开销。
 */
import {
  type BufferGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Scene,
} from 'three';

import { SECTION_CAP_COLOR_HEX } from './prism';

export type RoomPanelMeshInput = {
  panelRefno: string;
  geometry: BufferGeometry;
  matrixMm: Matrix4;
}

export class RoomClipOverlay {
  readonly rootGroup: Group;
  readonly roomVolumeGroup: Group;
  readonly capGroup: Group;
  readonly pieceGroup: Group;

  private readonly _panelFillMaterial: MeshBasicMaterial;
  private readonly _panelEdgeMaterial: LineBasicMaterial;
  private readonly _capMaterial: MeshBasicMaterial;
  private readonly _pieceMaterials = new Map<number, MeshLambertMaterial>();
  private readonly _edgeGeometries: EdgesGeometry[] = [];

  constructor() {
    this.rootGroup = new Group();
    this.rootGroup.name = 'RoomClipOverlayRoot';
    this.rootGroup.matrixAutoUpdate = false;

    this.roomVolumeGroup = new Group();
    this.roomVolumeGroup.name = 'RoomVolumeLayer';
    this.capGroup = new Group();
    this.capGroup.name = 'RoomClipCapLayer';
    this.pieceGroup = new Group();
    this.pieceGroup.name = 'RoomClipPieceLayer';

    this.rootGroup.add(this.roomVolumeGroup, this.capGroup, this.pieceGroup);

    this._panelFillMaterial = new MeshBasicMaterial({
      color: new Color(0x38bdf8),
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });

    this._panelEdgeMaterial = new LineBasicMaterial({
      color: new Color(0x0284c7),
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });

    // 断口薄饼：固定洋红色 #D946EF，不随分支选中改色（对齐 plant-ui R6）
    this._capMaterial = new MeshBasicMaterial({
      color: new Color(SECTION_CAP_COLOR_HEX),
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
  }

  /** 将叠加层挂到 Three.js 场景并同步 `DTXLayer` 的全局变换矩阵。 */
  attach(scene: Scene, globalModelMatrix: Matrix4): void {
    if (this.rootGroup.parent !== scene) {
      scene.add(this.rootGroup);
    }
    this.syncGlobalMatrix(globalModelMatrix);
  }

  syncGlobalMatrix(globalModelMatrix: Matrix4): void {
    this.rootGroup.matrix.copy(globalModelMatrix);
    this.rootGroup.matrixWorldNeedsUpdate = true;
  }

  /** 替换半透明房间体面板网格（不可拾取 `raycast = noop`）。 */
  setRoomVolumePanels(panels: RoomPanelMeshInput[]): void {
    this.clearRoomVolume();
    for (const item of panels) {
      const fillMesh = new Mesh(item.geometry, this._panelFillMaterial);
      fillMesh.matrixAutoUpdate = false;
      fillMesh.matrix.copy(item.matrixMm);
      fillMesh.matrixWorldNeedsUpdate = true;
      fillMesh.renderOrder = 10;
      fillMesh.raycast = () => { /* non-pickable room volume */ };
      fillMesh.userData = { isRoomVolumePanel: true, panelRefno: item.panelRefno };
      this.roomVolumeGroup.add(fillMesh);

      const edgesGeo = new EdgesGeometry(item.geometry, 25);
      this._edgeGeometries.push(edgesGeo);
      const edgeLines = new LineSegments(edgesGeo, this._panelEdgeMaterial);
      edgeLines.matrixAutoUpdate = false;
      edgeLines.matrix.copy(item.matrixMm);
      edgeLines.matrixWorldNeedsUpdate = true;
      edgeLines.renderOrder = 11;
      edgeLines.raycast = () => { /* non-pickable room volume edges */ };
      this.roomVolumeGroup.add(edgeLines);
    }
  }

  /** 在截点添加一枚 2 mm 洋红断口薄饼。 */
  addSectionCap(geometry: BufferGeometry, matrixMm: Matrix4, carrierRefno: string): void {
    const capMesh = new Mesh(geometry, this._capMaterial);
    capMesh.matrixAutoUpdate = false;
    capMesh.matrix.copy(matrixMm);
    capMesh.matrixWorldNeedsUpdate = true;
    capMesh.renderOrder = 5;
    capMesh.userData = {
      isRoomClipCap: true,
      refno: carrierRefno,
    };
    this.capGroup.add(capMesh);
  }

  /** 为二次进房直段（`pieces[1..]`）添加同几何、同颜色的补片。 */
  addExtraPiece(
    geometry: BufferGeometry,
    matrixMm: Matrix4,
    colorHex: number,
    carrierRefno: string,
  ): void {
    let mat = this._pieceMaterials.get(colorHex);
    if (!mat) {
      mat = new MeshLambertMaterial({
        color: new Color(colorHex),
        side: DoubleSide,
      });
      this._pieceMaterials.set(colorHex, mat);
    }
    const mesh = new Mesh(geometry, mat);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(matrixMm);
    mesh.matrixWorldNeedsUpdate = true;
    mesh.userData = {
      isRoomClipPiece: true,
      refno: carrierRefno,
    };
    this.pieceGroup.add(mesh);
  }

  /** 清空断口与补片（保留半透明房间体）。 */
  clearCapsAndPieces(): void {
    this.capGroup.clear();
    this.pieceGroup.clear();
  }

  /** 清空半透明房间体。 */
  clearRoomVolume(): void {
    this.roomVolumeGroup.clear();
    for (const geo of this._edgeGeometries) {
      geo.dispose();
    }
    this._edgeGeometries.length = 0;
  }

  /** 全部撤除（退出房间视图或切换房间时调用）。 */
  clearAll(): void {
    this.clearCapsAndPieces();
    this.clearRoomVolume();
  }
}