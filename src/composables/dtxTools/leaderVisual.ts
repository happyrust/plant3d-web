/**
 * 引线（MeshLine）构造与更新。
 * 从 useDtxTools.ts 拆出（docs/plans/2026-10-26-usedtxtools-split-plan.md 第 1 步），实现未改。
 */
import { MeshLine, MeshLineGeometry, MeshLineMaterial } from '@lume/three-meshline';
import { Color, Group, Vector2, Vector3 } from 'three';

import type { AnnotationLeaderKind, AnnotationLeaderStyle, AnnotationLeaderVisual } from './types';

import { useAnnotationStyleStore } from '@/composables/useAnnotationStyleStore';

/**
 * `@lume/three-meshline` 的 d.ts 把构造参数声明成 `ShaderMaterialParameters & MeshLineMaterial`
 * （本应是 `Partial<...>`），导致调用方被要求提供 85 个实例成员。运行时构造函数只做
 * `super({uniforms, vertexShader, fragmentShader})` 再 `this.setValues(parameters)`，
 * 所以真实参数形状就是下面这个结构。这里只把「参数对象」标注成真实形状，
 * 构造时补一层到库声明类型的断言（不是 any，也不改变运行时）。
 */
type MeshLineMaterialInit = {
  color?: Color
  lineWidth?: number
  transparent?: boolean
  opacity?: number
  depthTest?: boolean
  depthWrite?: boolean
  sizeAttenuation?: boolean
  resolution?: Vector2
}

type MeshLineMaterialCtorArg = ConstructorParameters<typeof MeshLineMaterial>[0]

export function createMeshLineMaterial(init: MeshLineMaterialInit): MeshLineMaterial {
  return new MeshLineMaterial(init as MeshLineMaterialCtorArg);
}

export function buildAnnotationLeaderStyle(kind: AnnotationLeaderKind): AnnotationLeaderStyle {
  const { style } = useAnnotationStyleStore();
  const leaderStyle = style[kind];
  return {
    color: leaderStyle.color,
    haloColor: leaderStyle.haloColor,
    linewidth: leaderStyle.lineWidth,
    haloLinewidth: leaderStyle.haloLineWidth,
    opacity: leaderStyle.opacity,
    haloOpacity: leaderStyle.haloOpacity,
  };
}

function buildAnnotationLeaderPositions(anchorWorldPos: Vector3, labelWorldPos: Vector3): number[] {
  return [
    anchorWorldPos.x, anchorWorldPos.y, anchorWorldPos.z,
    labelWorldPos.x, labelWorldPos.y, labelWorldPos.z,
  ];
}

export function setAnnotationLeaderResolution(
  leader: AnnotationLeaderVisual,
  width: number,
  height: number,
): void {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 1;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 1;
  leader.coreMaterial.resolution.set(safeWidth, safeHeight);
  leader.haloMaterial.resolution.set(safeWidth, safeHeight);
}

export function createAnnotationLeader(
  kind: AnnotationLeaderKind,
  anchorWorldPos: Vector3,
  labelWorldPos: Vector3,
  resolution?: { width: number; height: number },
): AnnotationLeaderVisual {
  const style = buildAnnotationLeaderStyle(kind);
  const positions = buildAnnotationLeaderPositions(anchorWorldPos, labelWorldPos);
  const haloGeometry = new MeshLineGeometry();
  haloGeometry.setPoints(positions);
  const coreGeometry = new MeshLineGeometry();
  coreGeometry.setPoints(positions);
  // 库的 d.ts 把构造参数写成 `ShaderMaterialParameters & MeshLineMaterial`（应为 Partial），
  // 于是调用方被要求提供 85 个实例成员。运行时构造只读下面这几个字段，先按真实参数形状建对象，
  // 再单层断言到库声明类型（不是 any，也不改运行时）。
  // 另外 `color` 显式构造成 `Color`：原来传数字时 three 的 `Material.setValues`
  // 会走 `currentValue.set(number)`，结果等价，颜色不变。
  const haloMaterial = createMeshLineMaterial({
    color: new Color(style.haloColor),
    lineWidth: style.haloLinewidth,
    transparent: true,
    opacity: style.haloOpacity,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false,
    resolution: new Vector2(1, 1),
  });
  const coreMaterial = createMeshLineMaterial({
    color: new Color(style.color),
    lineWidth: style.linewidth,
    transparent: true,
    opacity: style.opacity,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false,
    resolution: new Vector2(1, 1),
  });
  const halo = new MeshLine(haloGeometry, haloMaterial);
  const core = new MeshLine(coreGeometry, coreMaterial);
  halo.renderOrder = 900;
  core.renderOrder = 901;
  halo.frustumCulled = false;
  core.frustumCulled = false;
  halo.raycast = () => {};
  core.raycast = () => {};
  const root = new Group();
  root.renderOrder = 901;
  root.add(halo, core);
  const leader = {
    root,
    core,
    halo,
    coreGeometry,
    haloGeometry,
    coreMaterial,
    haloMaterial,
  };
  setAnnotationLeaderResolution(leader, resolution?.width ?? 1, resolution?.height ?? 1);
  return leader;
}

export function createTextAnnotationLeader(
  anchorWorldPos: Vector3,
  labelWorldPos: Vector3,
  resolution?: { width: number; height: number },
): AnnotationLeaderVisual {
  return createAnnotationLeader('text', anchorWorldPos, labelWorldPos, resolution);
}

export function updateLeaderGeometry(
  leader: AnnotationLeaderVisual,
  anchorWorldPos: Vector3,
  labelWorldPos: Vector3,
): void {
  const positions = buildAnnotationLeaderPositions(anchorWorldPos, labelWorldPos);
  leader.haloGeometry.setPoints(positions);
  leader.coreGeometry.setPoints(positions);
}
