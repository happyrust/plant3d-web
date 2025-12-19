/**
 * ptset (点集/连接点) 可视化 composable
 *
 * 用于在 xeokit 3D 场景中渲染元件的点集数据：
 * - 十字星标记每个点
 * - 文字标签显示点编号和坐标
 * - 方向箭头显示方向向量
 */

import { ref, type Ref, watch } from 'vue';
import {
  LineSet,
  type Viewer,
} from '@xeokit/xeokit-sdk';

import type { LazyEntityManager } from '@/aios-prepack-bundle-loader';
import type { PtsetPoint, PtsetResponse } from '@/api/genModelPdmsAttrApi';

type Vec3 = [number, number, number];

/**
 * 渲染的点集可视化对象
 */
interface PtsetVisualObject {
  id: string;
  refno: string;
  point: PtsetPoint;
  worldPos: Vec3;
  crossLineSet?: LineSet;
  arrowLineSet?: LineSet;
  labelDiv?: HTMLDivElement;
}

/**
 * 生成十字星的线段（三条互相垂直的线段）
 * @param origin 中心点
 * @param size 十字星臂长（从中心到端点的距离）
 */
function generateCrossLines(origin: Vec3, size: number) {
  const [x, y, z] = origin;
  return {
    positions: [
      // X 轴线段
      x - size, y, z,
      x + size, y, z,
      // Y 轴线段
      x, y - size, z,
      x, y + size, z,
      // Z 轴线段
      x, y, z - size,
      x, y, z + size,
    ],
    indices: [0, 1, 2, 3, 4, 5],
  };
}

/**
 * 生成箭头的线段（从点位置沿方向延伸）
 * @param origin 起点
 * @param direction 方向向量
 * @param length 箭头长度
 */
function generateArrowLines(origin: Vec3, direction: Vec3, length: number) {
  // 归一化方向
  const len = Math.sqrt(direction[0] ** 2 + direction[1] ** 2 + direction[2] ** 2);
  if (len < 0.0001) return null;

  const dir: Vec3 = [direction[0] / len, direction[1] / len, direction[2] / len];

  // 箭头末端
  const end: Vec3 = [
    origin[0] + dir[0] * length,
    origin[1] + dir[1] * length,
    origin[2] + dir[2] * length,
  ];

  // 箭头头部（小三角形）
  const headLength = length * 0.2;
  const headWidth = length * 0.1;

  // 计算垂直向量
  let perpX: Vec3, perpY: Vec3;
  if (Math.abs(dir[1]) < 0.9) {
    perpX = [
      dir[2],
      0,
      -dir[0],
    ];
  } else {
    perpX = [
      0,
      dir[2],
      -dir[1],
    ];
  }
  const perpLen = Math.sqrt(perpX[0] ** 2 + perpX[1] ** 2 + perpX[2] ** 2);
  perpX = [perpX[0] / perpLen, perpX[1] / perpLen, perpX[2] / perpLen];

  perpY = [
    dir[1] * perpX[2] - dir[2] * perpX[1],
    dir[2] * perpX[0] - dir[0] * perpX[2],
    dir[0] * perpX[1] - dir[1] * perpX[0],
  ];

  // 箭头头部点
  const headBase: Vec3 = [
    end[0] - dir[0] * headLength,
    end[1] - dir[1] * headLength,
    end[2] - dir[2] * headLength,
  ];

  const head1: Vec3 = [
    headBase[0] + perpX[0] * headWidth,
    headBase[1] + perpX[1] * headWidth,
    headBase[2] + perpX[2] * headWidth,
  ];
  const head2: Vec3 = [
    headBase[0] - perpX[0] * headWidth,
    headBase[1] - perpX[1] * headWidth,
    headBase[2] - perpX[2] * headWidth,
  ];
  const head3: Vec3 = [
    headBase[0] + perpY[0] * headWidth,
    headBase[1] + perpY[1] * headWidth,
    headBase[2] + perpY[2] * headWidth,
  ];
  const head4: Vec3 = [
    headBase[0] - perpY[0] * headWidth,
    headBase[1] - perpY[1] * headWidth,
    headBase[2] - perpY[2] * headWidth,
  ];

  return {
    positions: [
      // 主线：origin -> end
      ...origin, ...end,
      // 箭头头部线
      ...end, ...head1,
      ...end, ...head2,
      ...end, ...head3,
      ...end, ...head4,
    ],
    indices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  };
}

/**
 * 格式化坐标为字符串
 */
function formatCoord(pt: [number, number, number]): string {
  return `(${pt[0].toFixed(1)}, ${pt[1].toFixed(1)}, ${pt[2].toFixed(1)})`;
}

export function usePtsetVisualization(
  viewerRef: Ref<Viewer | null>,
  labelContainerRef: Ref<HTMLElement | null>
) {
  const visualObjects = ref<Map<string, PtsetVisualObject>>(new Map());
  const isVisible = ref(false);
  const currentRefno = ref<string | null>(null);
  const currentResponse = ref<PtsetResponse | null>(null);

  // 显示选项
  const showCrosses = ref(true);
  const showLabels = ref(true);
  const showArrows = ref(true);

  /**
   * 清除所有可视化对象
   */
  function clearAll() {
    for (const obj of visualObjects.value.values()) {
      try {
        obj.crossLineSet?.destroy();
        obj.arrowLineSet?.destroy();
        obj.labelDiv?.remove();
      } catch {
        // ignore
      }
    }
    visualObjects.value.clear();
    currentRefno.value = null;
    currentResponse.value = null;
    isVisible.value = false;
  }

  /**
   * 渲染 ptset 数据
   * @param refno 元件参考号
   * @param response ptset 响应数据
   */
  function renderPtset(refno: string, response: PtsetResponse) {
    const viewer = viewerRef.value;
    const container = labelContainerRef.value;
    if (!viewer || !container) return;

    // 清除之前的渲染
    clearAll();
    currentRefno.value = refno;
    currentResponse.value = response;

    if (!response.success || response.ptset.length === 0) {
      console.warn(`[ptset] No ptset data for refno: ${refno}`);
      return;
    }

    // 获取单位转换因子，默认为 1（不转换）
    const unitFactor = response.unit_info?.conversion_factor || 1;
    const sourceUnit = response.unit_info?.source_unit || 'unknown';
    const targetUnit = response.unit_info?.target_unit || 'unknown';

    if (unitFactor !== 1) {
      console.log(`[ptset] Converting units from ${sourceUnit} to ${targetUnit} with factor ${unitFactor}`);
    }

    // 从 LazyEntityManager 获取 refnoTransform
    let refnoTransform: number[] | undefined;
    try {
      const sceneAny = viewer.scene as unknown as {
        __aiosLazyEntityManagers?: Record<string, LazyEntityManager>;
        __aiosActiveLazyModelId?: string;
      };
      const managers = sceneAny.__aiosLazyEntityManagers;
      const activeId = sceneAny.__aiosActiveLazyModelId;
      if (managers && activeId) {
        const mgr = managers[activeId];
        if (mgr?.getRefnoTransform) {
          refnoTransform = mgr.getRefnoTransform(refno);
          if (refnoTransform) {
            console.log(`[ptset] Using refnoTransform from LazyEntityManager for ${refno}`);
          }
        }
      }
    } catch {
      // ignore
    }

    // 如果没有从 LazyEntityManager 获取到，使用 API 返回的 world_transform
    const worldTransform = refnoTransform || response.world_transform;

    for (const point of response.ptset) {
      const objId = `ptset_${refno}_${point.number}`;

      // 首先应用单位转换（从 mm 到 dm）
      const localPt = [
        point.pt[0] * unitFactor,
        point.pt[1] * unitFactor,
        point.pt[2] * unitFactor,
      ];
      const localDir = point.dir ? [
        point.dir[0] * unitFactor,
        point.dir[1] * unitFactor,
        point.dir[2] * unitFactor,
      ] : null;

      // 应用世界变换（如果有）
      let worldPt: Vec3 = [...localPt];
      let worldDir: Vec3 | null = localDir ? [...localDir] : null;

      if (worldTransform && worldTransform.length > 0) {
        const px = localPt[0];
        const py = localPt[1];
        const pz = localPt[2];

        if (worldTransform.length === 16) {
          // 列主序 4x4 矩阵（来自 refnoTransform）
          // 矩阵布局：[m00, m10, m20, m30, m01, m11, m21, m31, m02, m12, m22, m32, m03, m13, m23, m33]
          const m = worldTransform as number[];
          worldPt = [
            (m[0] ?? 1) * px + (m[4] ?? 0) * py + (m[8] ?? 0) * pz + (m[12] ?? 0),
            (m[1] ?? 0) * px + (m[5] ?? 1) * py + (m[9] ?? 0) * pz + (m[13] ?? 0),
            (m[2] ?? 0) * px + (m[6] ?? 0) * py + (m[10] ?? 1) * pz + (m[14] ?? 0),
          ];

          // 应用变换矩阵到方向（只旋转，不平移）
          if (localDir) {
            const dx = localDir[0];
            const dy = localDir[1];
            const dz = localDir[2];
            worldDir = [
              (m[0] ?? 1) * dx + (m[4] ?? 0) * dy + (m[8] ?? 0) * dz,
              (m[1] ?? 0) * dx + (m[5] ?? 1) * dy + (m[9] ?? 0) * dz,
              (m[2] ?? 0) * dx + (m[6] ?? 0) * dy + (m[10] ?? 1) * dz,
            ];
          }
        } else if (worldTransform.length >= 3) {
          // 行主序 3x4 或 4x4 矩阵（来自 API world_transform）
          const m = worldTransform as unknown as number[][];
          const m0 = m[0] ?? [1, 0, 0, 0];
          const m1 = m[1] ?? [0, 1, 0, 0];
          const m2 = m[2] ?? [0, 0, 1, 0];
          worldPt = [
            (m0[0] ?? 1) * px + (m0[1] ?? 0) * py + (m0[2] ?? 0) * pz + (m0[3] ?? 0),
            (m1[0] ?? 0) * px + (m1[1] ?? 1) * py + (m1[2] ?? 0) * pz + (m1[3] ?? 0),
            (m2[0] ?? 0) * px + (m2[1] ?? 0) * py + (m2[2] ?? 1) * pz + (m2[3] ?? 0),
          ];

          // 应用变换矩阵到方向（只旋转，不平移）
          if (localDir) {
            const dx = localDir[0];
            const dy = localDir[1];
            const dz = localDir[2];
            worldDir = [
              (m0[0] ?? 1) * dx + (m0[1] ?? 0) * dy + (m0[2] ?? 0) * dz,
              (m1[0] ?? 0) * dx + (m1[1] ?? 1) * dy + (m1[2] ?? 0) * dz,
              (m2[0] ?? 0) * dx + (m2[1] ?? 0) * dy + (m2[2] ?? 1) * dz,
            ];
          }
        }
      }

      // 十字星大小：固定 0.2 dm (20mm)
      const crossSize = 0.2;

      // 创建十字星
      let crossLineSet: LineSet | undefined;
      const crossData = generateCrossLines(worldPt, crossSize);

      try {
        crossLineSet = new LineSet(viewer.scene, {
          id: `${objId}_cross`,
          positions: crossData.positions,
          indices: crossData.indices,
          color: [0.2, 0.8, 0.3], // 绿色
          opacity: 1.0,
          visible: true,
        });
      } catch (e) {
        console.warn(`[ptset] Failed to create cross for point ${point.number}:`, e);
      }

      // 创建方向箭头
      let arrowLineSet: LineSet | undefined;
      if (worldDir) {
        // 箭头长度：固定 0.5 dm (50mm)
        const arrowLength = 0.5;
        const arrowData = generateArrowLines(worldPt, worldDir, arrowLength);
        if (arrowData) {
          try {
            arrowLineSet = new LineSet(viewer.scene, {
              id: `${objId}_arrow`,
              positions: arrowData.positions,
              indices: arrowData.indices,
              color: [1, 0.5, 0], // 橙色箭头
              opacity: 1.0,
              visible: true,
            });
          } catch (e) {
            console.warn(`[ptset] Failed to create arrow for point ${point.number}:`, e);
          }
        }
      }

      // 创建文字标签
      const labelDiv = document.createElement('div');
      labelDiv.className = 'ptset-label';
      labelDiv.setAttribute('data-ptset-point', String(point.number));
      const pboreInTargetUnit = point.pbore * unitFactor;
      labelDiv.innerHTML = `
        <div class="ptset-label-content">
          <div class="ptset-label-number">#${point.number}</div>
          <div class="ptset-label-coord">${formatCoord(worldPt)}</div>
          ${point.pbore > 0 ? `<div class="ptset-label-bore">Ø${pboreInTargetUnit.toFixed(1)}${targetUnit}</div>` : ''}
        </div>
      `;
      labelDiv.style.cssText = `
        position: absolute;
        pointer-events: none;
        transform: translate(-50%, -100%);
        z-index: 1000;
        opacity: 0;
        transition: opacity 0.2s;
      `;
      container.appendChild(labelDiv);

      // 保存对象引用
      visualObjects.value.set(objId, {
        id: objId,
        refno,
        point,
        worldPos: worldPt,
        crossLineSet,
        arrowLineSet,
        labelDiv,
      });
    }

    isVisible.value = true;

    // 更新标签位置
    updateLabelPositions();
  }

  /**
   * 更新所有标签的屏幕位置
   */
  function updateLabelPositions() {
    const viewer = viewerRef.value;
    if (!viewer) return;

    const camera = viewer.scene.camera;

    for (const obj of visualObjects.value.values()) {
      if (!obj.labelDiv) continue;

      const worldPos = obj.worldPos;
      if (!worldPos || worldPos.length < 3) continue;

      try {
        // 投影世界坐标到屏幕
        const screenPos = (camera as unknown as { projectWorldPos: (p: number[]) => number[] })
          .projectWorldPos([worldPos[0] ?? 0, worldPos[1] ?? 0, worldPos[2] ?? 0]);

        obj.labelDiv.style.left = `${screenPos[0] ?? 0}px`;
        obj.labelDiv.style.top = `${(screenPos[1] ?? 0) - 10}px`; // 稍微向上偏移
        obj.labelDiv.style.opacity = '1';
      } catch {
        obj.labelDiv.style.opacity = '0';
      }
    }
  }

  /**
   * 设置整体可见性
   */
  function setVisible(visible: boolean) {
    isVisible.value = visible;
    applyVisibility();
  }

  /**
   * 设置十字星显示
   */
  function setCrossesVisible(visible: boolean) {
    showCrosses.value = visible;
    applyVisibility();
  }

  /**
   * 设置标签显示
   */
  function setLabelsVisible(visible: boolean) {
    showLabels.value = visible;
    applyVisibility();
  }

  /**
   * 设置箭头显示
   */
  function setArrowsVisible(visible: boolean) {
    showArrows.value = visible;
    applyVisibility();
  }

  /**
   * 应用可见性设置
   */
  function applyVisibility() {
    for (const obj of visualObjects.value.values()) {
      try {
        if (obj.crossLineSet) {
          obj.crossLineSet.visible = isVisible.value && showCrosses.value;
        }
        if (obj.arrowLineSet) {
          obj.arrowLineSet.visible = isVisible.value && showArrows.value;
        }
        if (obj.labelDiv) {
          obj.labelDiv.style.display = (isVisible.value && showLabels.value) ? 'block' : 'none';
        }
      } catch {
        // ignore
      }
    }
  }

  /**
   * 飞行到 ptset 视图
   */
  function flyToPtset() {
    const viewer = viewerRef.value;
    if (!viewer || visualObjects.value.size === 0) return;

    const positions: Vec3[] = [];
    for (const obj of visualObjects.value.values()) {
      const pos = obj.worldPos;
      if (pos && pos.length >= 3) {
        positions.push([pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0]);
      }
    }

    if (positions.length === 0) return;

    // 计算包围盒
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const p of positions) {
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      minZ = Math.min(minZ, p[2]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
      maxZ = Math.max(maxZ, p[2]);
    }

    // 添加 padding（适应 dm 单位，padding 为包围盒尺寸的 20%，最小 2 dm）
    const boxSize = (maxX - minX) + (maxY - minY) + (maxZ - minZ);
    const pad = Math.max(2, boxSize * 0.2);
    const aabb = [minX - pad, minY - pad, minZ - pad, maxX + pad, maxY + pad, maxZ + pad];

    viewer.cameraFlight.flyTo({
      aabb,
      fit: true,
      duration: 0.8,
    } as unknown as Record<string, unknown>);
  }

  // 监听 viewer 变化，清理资源
  watch(viewerRef, (viewer, prevViewer) => {
    if (prevViewer && !viewer) {
      clearAll();
    }
  });

  // 监听相机变化，更新标签位置
  watch(viewerRef, (viewer) => {
    if (!viewer) return;

    // 监听相机矩阵变化
    let rafId: number | null = null;
    const scheduleUpdate = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (isVisible.value) {
          updateLabelPositions();
        }
      });
    };

    viewer.scene.camera.on('matrix', scheduleUpdate);
  }, { immediate: true });

  return {
    visualObjects,
    isVisible,
    currentRefno,
    currentResponse,
    showCrosses,
    showLabels,
    showArrows,
    renderPtset,
    clearAll,
    setVisible,
    setCrossesVisible,
    setLabelsVisible,
    setArrowsVisible,
    flyToPtset,
    updateLabelPositions,
  };
}
