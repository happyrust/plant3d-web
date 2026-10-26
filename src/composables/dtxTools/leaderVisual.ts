/**
 * 引线（MeshLine）构造与更新。
 * 从 useDtxTools.ts 拆出（docs/plans/2026-10-26-usedtxtools-split-plan.md 第 1 步），实现未改。
 */
import { MeshLine, MeshLineGeometry, MeshLineMaterial } from '@lume/three-meshline';
import { Group, Vector2, Vector3 } from 'three';

import type { AnnotationLeaderKind, AnnotationLeaderStyle, AnnotationLeaderVisual } from './types';

import { useAnnotationStyleStore } from '@/composables/useAnnotationStyleStore';

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
  const haloMaterial = new MeshLineMaterial({
    color: style.haloColor,
    lineWidth: style.haloLinewidth,
    transparent: true,
    opacity: style.haloOpacity,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false,
    resolution: new Vector2(1, 1),
  });
  const coreMaterial = new MeshLineMaterial({
    color: style.color,
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
