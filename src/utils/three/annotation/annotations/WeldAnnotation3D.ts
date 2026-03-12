import * as THREE from 'three';

import { AnnotationBase, type AnnotationOptions } from '../core/AnnotationBase';
import {
  SolveSpaceBillboardVectorText,
  type SolveSpaceLabelRenderStyle,
} from '../text/SolveSpaceBillboardVectorText';
import { worldPerPixelAt } from '../utils/solvespaceLike';

import type {
  AnnotationMaterials,
  AnnotationMaterialSet,
} from '../core/AnnotationMaterials';

export type WeldAnnotation3DParams = {
  /** 焊缝位置 */
  position: THREE.Vector3;
  /** 焊缝标签 */
  label: string;
  /** 可选副标题；为空时仅显示单行标签 */
  subtitle?: string | null;
  /** 是否为车间焊 */
  isShop?: boolean;
  /** 十字大小（世界单位；在全局缩放下会自动换算为本地） */
  crossSize?: number;
  /** 文字世界偏移（拖拽后保存） */
  labelOffsetWorld?: THREE.Vector3 | null;
  /** 文字渲染风格（solvespace/rebarviz） */
  labelRenderStyle?: SolveSpaceLabelRenderStyle;
}

// 十字标记：两条独立线段（避免 Line2 折线连线导致出现斜线）
export class WeldAnnotation3D extends AnnotationBase {
  private params: Required<
    Omit<WeldAnnotation3DParams, 'labelOffsetWorld' | 'labelRenderStyle'>
  > & {
    labelOffsetWorld: THREE.Vector3 | null;
    labelRenderStyle?: SolveSpaceLabelRenderStyle;
  };
  private materialSet: AnnotationMaterialSet;

  private crossLineH: THREE.Line;
  private crossLineV: THREE.Line;
  private lineGeometryH: THREE.BufferGeometry;
  private lineGeometryV: THREE.BufferGeometry;
  private textLabel: SolveSpaceBillboardVectorText;
  private readonly labelWorld = new THREE.Vector3();
  private readonly wppTmp = {
    ndc: new THREE.Vector3(),
    ndc2: new THREE.Vector3(),
    p0: new THREE.Vector3(),
    p1: new THREE.Vector3(),
    p2: new THREE.Vector3(),
  };

  constructor(
    materials: AnnotationMaterials,
    params: WeldAnnotation3DParams,
    options?: AnnotationOptions,
  ) {
    super(materials, options);

    this.params = {
      position: params.position.clone(),
      label: params.label,
      subtitle: params.subtitle ?? null,
      isShop: params.isShop ?? false,
      crossSize: params.crossSize ?? 50,
      labelOffsetWorld: params.labelOffsetWorld?.clone() ?? null,
      labelRenderStyle: params.labelRenderStyle,
    };
    this.materialSet = this.resolveMaterialSet(materials.orange);

    this.lineGeometryH = new THREE.BufferGeometry();
    this.lineGeometryV = new THREE.BufferGeometry();
    this.crossLineH = new THREE.Line(this.lineGeometryH, this.materialSet.line);
    this.crossLineV = new THREE.Line(this.lineGeometryV, this.materialSet.line);
    this.crossLineH.userData.dragRole = 'offset';
    this.crossLineV.userData.dragRole = 'offset';
    this.add(this.crossLineH, this.crossLineV);

    this.textLabel = new SolveSpaceBillboardVectorText({
      text: '',
      materialNormal: this.materialSet.line,
      materialHovered: materials.ssHovered.line,
      materialSelected: materials.ssSelected.line,
      renderStyle: this.params.labelRenderStyle,
    });
    this.textLabel.object3d.userData.dragRole = 'label';
    this.add(this.textLabel.object3d);

    this.rebuild();
  }

  override update(camera: THREE.Camera): void {
    super.update(camera);
    const viewport = (camera as any)?.userData?.annotationViewport as
      | { width?: number; height?: number }
      | undefined;
    const vw = Math.max(
      1,
      Math.floor(Number(viewport?.width) || Number(window?.innerWidth) || 1),
    );
    const vh = Math.max(
      1,
      Math.floor(Number(viewport?.height) || Number(window?.innerHeight) || 1),
    );
    this.textLabel.object3d.getWorldPosition(this.labelWorld);
    const wpp = worldPerPixelAt(camera, this.labelWorld, vw, vh, this.wppTmp);
    if (Number.isFinite(wpp) && wpp > 0) {
      this.textLabel.setWorldPerPixel(wpp);
    }
    this.textLabel.setFrame(
      this.labelWorld,
      new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion),
      new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion),
    );
    this.textLabel.update(camera);
  }

  /** 仅控制文字显隐（不影响十字/线） */
  setLabelVisible(visible: boolean): void {
    this.textLabel.setVisible(visible);
  }

  /** 设置文字渲染风格（solvespace/rebarviz） */
  setLabelRenderStyle(style: SolveSpaceLabelRenderStyle): void {
    this.params.labelRenderStyle = style;
    this.textLabel.setRenderStyle(style);
  }

  getParams(): WeldAnnotation3DParams {
    return {
      position: this.params.position.clone(),
      label: this.params.label,
      subtitle: this.params.subtitle,
      isShop: this.params.isShop,
      crossSize: this.params.crossSize,
      labelOffsetWorld: this.params.labelOffsetWorld?.clone() ?? null,
      labelRenderStyle: this.params.labelRenderStyle,
    };
  }

  setParams(params: Partial<WeldAnnotation3DParams>): void {
    if (params.position) this.params.position.copy(params.position);
    if (params.label !== undefined) this.params.label = params.label;
    if ('subtitle' in params) this.params.subtitle = params.subtitle ?? null;
    if (params.isShop !== undefined) this.params.isShop = params.isShop;
    if (params.crossSize !== undefined)
      this.params.crossSize = params.crossSize;
    if ('labelOffsetWorld' in params) {
      this.params.labelOffsetWorld = params.labelOffsetWorld?.clone() ?? null;
    }
    if (params.labelRenderStyle !== undefined) {
      this.params.labelRenderStyle = params.labelRenderStyle;
      this.textLabel.setRenderStyle(params.labelRenderStyle);
    }
    this.rebuild();
  }

  setMaterialSet(materialSet: AnnotationMaterialSet): void {
    this.materialSet = materialSet;
    this.applyMaterials();
  }

  /** 获取默认文字位置（本地坐标，用于拖拽偏移计算） */
  getDefaultLabelLocalPos(): THREE.Vector3 {
    const s = this.params.crossSize;
    return new THREE.Vector3(0, s * 0.9, 0);
  }

  /** 获取默认文字世界位置（用于拖拽偏移计算） */
  getDefaultLabelWorldPos(): THREE.Vector3 {
    const local = this.getDefaultLabelLocalPos();
    return this.localToWorld(local);
  }

  /** 获取当前文字世界位置（用于外部 CSS2D 标签跟随） */
  getLabelWorldPos(): THREE.Vector3 {
    return this.textLabel.object3d.getWorldPosition(new THREE.Vector3());
  }

  private rebuild(): void {
    const { position, label, subtitle, isShop, crossSize } = this.params;
    const s = crossSize;

    // 以 position 作为根节点位置，几何体用“相对坐标”，避免全局缩放/缩放独立时漂移
    this.position.copy(position);

    this.lineGeometryH.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-s, 0, 0, s, 0, 0], 3),
    );
    this.lineGeometryV.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, -s, 0, 0, s, 0], 3),
    );

    const subtitleText =
      subtitle !== null && subtitle !== undefined
        ? String(subtitle)
        : isShop
          ? '车间焊'
          : '现场焊';
    this.textLabel.setText(
      subtitleText.trim().length > 0 ? `${label}\n${subtitleText}` : label,
    );
    const labelPos = new THREE.Vector3(0, s * 0.9, 0);
    if (this.params.labelOffsetWorld) {
      labelPos.add(this.params.labelOffsetWorld);
    }
    this.textLabel.object3d.position.copy(labelPos);
  }

  private applyMaterials(): void {
    // SolveSpace 风格：selected > hovered > normal
    const state = this.interactionState;
    let lineMat: any;
    if (state === 'selected') {
      lineMat = this.materials.ssSelected.line;
    } else if (state === 'hovered') {
      lineMat = this.materials.ssHovered.line;
    } else {
      lineMat = this._highlighted
        ? this.materialSet.lineHover
        : this.materialSet.line;
    }
    this.crossLineH.material = lineMat;
    this.crossLineV.material = lineMat;
  }

  protected override onScaleFactorChanged(factor: number): void {
    // 使用 worldPerPixelAt + annotationViewport 控制文字缩放，避免窗口布局变化时尺寸漂移。
    void factor;
  }

  override setBackgroundColor(color: THREE.ColorRepresentation): void {
    this.textLabel.setBackgroundColor(color);
  }

  protected onHighlightChanged(highlighted: boolean): void {
    this.applyMaterials();
    this.textLabel.setInteractionState(this.interactionState);
  }

  override dispose(): void {
    this.lineGeometryH.dispose();
    this.lineGeometryV.dispose();
    this.textLabel.dispose();
    super.dispose();
  }
}
