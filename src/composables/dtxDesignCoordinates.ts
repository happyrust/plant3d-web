import type { Ref } from 'vue';

import { Vector3 } from 'three';

import type { DTXLayer } from '@/utils/three/dtx';

/**
 * 场景坐标 ↔ 设计 World（米）换算，经 `dtxLayer.getGlobalModelMatrix()`。
 * 原在 `useXeokitMeasurementTools` 私有，#58 的 DTX 测量/净距迁移也要用——抽到这一层
 * 让 `useDtxTools` 与测量工具共用同一套矩阵数学，别各写一份。
 */
export function sceneWorldToDesignMeters(world: Vector3, dtxLayerRef: Ref<DTXLayer | null>): Vector3 {
  const globalModelMatrix = dtxLayerRef.value?.getGlobalModelMatrix?.();
  if (!globalModelMatrix) return world.clone();

  const inverse = globalModelMatrix.clone();
  if (Math.abs(inverse.determinant()) <= 1e-12) return world.clone();

  const raw = world.clone().applyMatrix4(inverse.invert());
  return raw.multiply(new Vector3().setFromMatrixScale(globalModelMatrix));
}

/** `sceneWorldToDesignMeters` 的逆：设计 World（米）→ 场景坐标。 */
export function designMetersToSceneWorld(design: Vector3, dtxLayerRef: Ref<DTXLayer | null>): Vector3 {
  const globalModelMatrix = dtxLayerRef.value?.getGlobalModelMatrix?.();
  if (!globalModelMatrix) return design.clone();
  if (Math.abs(globalModelMatrix.determinant()) <= 1e-12) return design.clone();
  const scale = new Vector3().setFromMatrixScale(globalModelMatrix);
  const raw = new Vector3(design.x / scale.x, design.y / scale.y, design.z / scale.z);
  return raw.applyMatrix4(globalModelMatrix);
}

/** 把场景坐标下的方向换到设计 World（米）：两点变换后相减，对任意仿射变换成立。 */
export function sceneDirectionToDesign(
  origin: Vector3,
  direction: Vector3,
  dtxLayerRef: Ref<DTXLayer | null>,
): Vector3 {
  const from = sceneWorldToDesignMeters(origin, dtxLayerRef);
  const to = sceneWorldToDesignMeters(origin.clone().add(direction), dtxLayerRef);
  return to.sub(from);
}

/**
 * 设计 World 的长度（米）→ 场景坐标下的同一段长度。属性给的是设计尺寸（`RADI` / 目录 `PARA`，mm），
 * 而弧的点都在场景系里算，两点变换后取距离对任意仿射变换成立（同 `sceneDirectionToDesign` 的做法）。
 */
export function designLengthToScene(meters: number, dtxLayerRef: Ref<DTXLayer | null>): number {
  const origin = designMetersToSceneWorld(new Vector3(0, 0, 0), dtxLayerRef);
  const along = designMetersToSceneWorld(new Vector3(meters, 0, 0), dtxLayerRef);
  return origin.distanceTo(along);
}
