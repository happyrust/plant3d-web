import { Matrix4, Vector3 } from 'three';

import { useConsoleStore } from './useConsoleStore';
import { useViewerContext } from './useViewerContext';

import { e3dSearch } from '@/api/genModelE3dApi';
import { e3dParquetResolveDbnumForRefno } from '@/api/genModelE3dParquetApi';
import { pdmsGetUiAttr, pdmsGetTransform } from '@/api/genModelPdmsAttrApi';
import { getModelTreeInstance } from '@/composables/useModelTreeStore';
import { useModelProjects } from '@/composables/useModelProjects';
import { setGlobalSelectedRefno } from '@/composables/useSelectionStore';
import { useUnitSettingsStore } from '@/composables/useUnitSettingsStore';
import {
  extractPosition,
  extractEulerAnglesDegrees,
  computeRelativeTransform,
  type TransformMatrix,
} from '@/utils/matrixUtils';
import { formatVec3Meters } from '@/utils/unitFormat';

const unitSettings = useUnitSettingsStore();

function formatPosSceneMeters(p: [number, number, number]): string {
  return formatVec3Meters(p, unitSettings.displayUnit.value as any, unitSettings.precision.value);
}

function formatPosFromRawMaybe(viewer: any, p: [number, number, number]): string {
  const v = new Vector3(p[0], p[1], p[2]);

  // 尽量与 Viewer 的 globalModelMatrix 对齐（mm->m + recenter 等）
  try {
    const layer = viewer?.__dtxLayer as any;
    const gm = layer?.getGlobalModelMatrix?.() as Matrix4 | null;
    if (gm) {
      v.applyMatrix4(gm);
    } else {
      const scale = unitSettings.modelUnit.value === 'mm' ? 0.001 : 1;
      v.multiplyScalar(scale);
    }
  } catch {
    const scale = unitSettings.modelUnit.value === 'mm' ? 0.001 : 1;
    v.multiplyScalar(scale);
  }

  return formatPosSceneMeters([v.x, v.y, v.z]);
}

// 用于角度/非长度的三元组输出（保持原有控制台输出风格）
function formatTriple(p: number[] | Float32Array | Float64Array | { [key: number]: number, length: number }): string {
  if (!p) return 'N/A';
  if (Array.isArray(p) || ArrayBuffer.isView(p)) {
    return `${Number(p[0] ?? 0).toFixed(2)} ${Number(p[1] ?? 0).toFixed(2)} ${Number(p[2] ?? 0).toFixed(2)}`;
  }
  return 'Invalid Vec3';
}

export function usePdmsConsoleCommands() {
  const store = useConsoleStore();
  const ctx = useViewerContext();

  function parsePdmsRefnoFromArgs(args: string[]): string | null {
    const raw = args.join(' ').trim();
    if (!raw) return null;

    // 若用户粘贴了 JSON 片段，优先尝试提取 "refno": "..."
    const jsonRef = raw.match(/"refno"\s*:\s*"([^"]+)"/i)?.[1];
    if (jsonRef) {
      const normalized = String(jsonRef).trim().replace(/\//g, '_').replace(/,/g, '_');
      if (/^\d+_\d+$/.test(normalized)) return normalized;
    }

    // 常见输入：=17496/171640、17496_171640、pe:⟨17496_171640⟩、<17496_171640>
    const noEq = raw.replace(/^=/, '').trim();
    const unwrapped = noEq.match(/[⟨<]([^⟩>]+)[⟩>]/)?.[1] ?? noEq;
    const core = unwrapped.replace(/^pe:/i, '').trim();
    const normalized = core.replace(/\//g, '_').replace(/,/g, '_');
    if (/^\d+_\d+$/.test(normalized)) return normalized;

    // 兜底：从更长文本中提取第一个 refno-like（避免把 geo_hash/aabb_hash 等长数字误识别）
    const m = raw.match(/\b(\d+)[_\/,](\d+)\b/);
    if (m) return `${m[1]}_${m[2]}`;
    return null;
  }

  function getViewer() {
    return ctx.viewerRef.value;
  }

  function getSelectedId(): string | null {
    // 优先从模型树获取选中节点
    const tree = getModelTreeInstance();
    if (tree && tree.selectedIds.value.size > 0) {
      // 返回第一个选中的节点
      const firstId = tree.selectedIds.value.values().next().value;
      if (firstId) return firstId;
    }

    // 回退：从场景选中对象获取
    const viewer = getViewer();
    if (!viewer) return null;
    const ids = viewer.scene.selectedObjectIds;
    if (!ids || ids.length === 0) return null;
    return ids[0] ?? null; // Return first selected
  }

  // --- Command Handlers ---

  // Q (Query)
  store.registerCommand('q', async (args: string[]) => {
    const viewer = getViewer();
    if (!viewer) {
      store.addLog('error', 'Viewer not ready');
      return;
    }

    const id = getSelectedId();
    const cmdUpper = args[0]?.toUpperCase();
    if (!id && cmdUpper !== 'REF' && cmdUpper !== 'DBNUM') {
      store.addLog('error', 'No element selected (CE is unset)');
      return;
    }

    const cmd = args.join(' ').toUpperCase();

    // Handle Q REF (Refno) - 查询参考号
    if (cmd === 'REF' || cmd === 'REFNO') {
      if (id) {
        store.addLog('output', `Refno: ${id}`);
      }
      return;
    }

    // Handle Q DBNUM - 查询数据库编号（通过 db_meta_info.json 的 ref0_to_dbnum 映射）
    if (cmd === 'DBNUM') {
      if (id) {
        try {
          const dbnum = await e3dParquetResolveDbnumForRefno(id);
          if (dbnum != null) {
            store.addLog('output', `DBNUM: ${dbnum}`);
          } else {
            store.addLog('info', `Cannot resolve DBNUM for refno: ${id}`);
          }
        } catch (e) {
          store.addLog('error', `Failed to query DBNUM: ${e}`);
        }
      } else {
        // 没有选中元素时，从当前项目获取 dbnum
        const { currentProject } = useModelProjects();
        const dbnum = currentProject.value?.showDbnum;
        if (dbnum != null) {
          store.addLog('output', `DBNUM: ${dbnum}`);
        } else {
          store.addLog('info', 'No element selected and no project DBNUM configured');
        }
      }
      return;
    }

    // 需要从后端获取属性的查询
    if (!id) return;

    try {
      const resp = await pdmsGetUiAttr(id);
      if (!resp.success) {
        store.addLog('error', resp.error_message || 'Failed to fetch attributes');
        return;
      }

      const attrs = resp.attrs as Record<string, unknown>;

      // Helper function to get attribute value (case-insensitive)
      const getAttr = (name: string): unknown => {
        return attrs[name] ?? attrs[name.toUpperCase()] ?? attrs[name.toLowerCase()];
      };

      // Helper function to format position/orientation
      const formatVec3 = (val: unknown): string | null => {
        if (val === null || val === undefined) return null;
        if (typeof val === 'string') return val;
        if (Array.isArray(val) && val.length >= 3) {
          const x = typeof val[0] === 'number' ? val[0].toFixed(2) : val[0];
          const y = typeof val[1] === 'number' ? val[1].toFixed(2) : val[1];
          const z = typeof val[2] === 'number' ? val[2].toFixed(2) : val[2];
          return `${x} ${y} ${z}`;
        }
        if (typeof val === 'object' && val !== null) {
          const obj = val as Record<string, number>;
          if ('x' in obj && 'y' in obj && 'z' in obj) {
            return `${obj.x?.toFixed?.(2) ?? obj.x} ${obj.y?.toFixed?.(2) ?? obj.y} ${obj.z?.toFixed?.(2) ?? obj.z}`;
          }
        }
        return String(val);
      };

      // Handle Q WPOS / Q POS WRT /* - 查询世界坐标位置
      if (cmd === 'WPOS' || cmd === 'POS WRT /*') {
        const pos = getAttr('WPOS') ?? getAttr('POS');
        if (pos !== undefined) {
          if (Array.isArray(pos) && pos.length >= 3 && typeof pos[0] === 'number' && typeof pos[1] === 'number' && typeof pos[2] === 'number') {
            store.addLog('output', `Position (World): ${formatPosFromRawMaybe(viewer, [pos[0], pos[1], pos[2]])}`);
          } else {
            const formatted = formatVec3(pos);
            store.addLog('output', `Position (World): ${formatted}`);
          }
        } else {
          // 尝试从场景 AABB 推导中心点
          const aabb = viewer.scene.getAABB([id]);
          if (aabb && aabb.length === 6) {
            const cx = (aabb[0] + aabb[3]) / 2;
            const cy = (aabb[1] + aabb[4]) / 2;
            const cz = (aabb[2] + aabb[5]) / 2;
            store.addLog('output', `Position (World): ${formatPosSceneMeters([cx, cy, cz])}`);
          } else {
            store.addLog('info', 'World position not available');
          }
        }
        return;
      }

      // Handle Q POS - 查询本地坐标位置（从世界变换矩阵提取）
      if (cmd === 'POS') {
        try {
          const transformResp = await pdmsGetTransform(id);
          if (transformResp.success && transformResp.world_transform) {
            const pos = extractPosition(transformResp.world_transform as TransformMatrix);
            store.addLog('output', `Position (World): ${formatPosFromRawMaybe(viewer, [pos[0], pos[1], pos[2]])}`);
          } else {
            // 回退：从属性读取
            const pos = getAttr('POS') ?? getAttr('POSITION');
            if (pos !== undefined) {
              const formatted = formatVec3(pos);
              store.addLog('output', `Position (Local): ${formatted}`);
            } else {
              store.addLog('info', 'Position not available');
            }
          }
        } catch (e) {
          store.addLog('error', `Failed to query transform: ${e}`);
        }
        return;
      }

      // Handle Q WORI / Q ORI WRT /* - 查询世界坐标方位
      if (cmd === 'WORI' || cmd === 'ORI WRT /*') {
        const ori = getAttr('WORI') ?? getAttr('ORI');
        if (ori !== undefined) {
          const formatted = formatVec3(ori);
          store.addLog('output', `Orientation (World): ${formatted}`);
        } else {
          store.addLog('info', 'World orientation not available');
        }
        return;
      }

      // Handle Q ORI - 查询本地坐标方位（从世界变换矩阵提取）
      if (cmd === 'ORI') {
        try {
          const transformResp = await pdmsGetTransform(id);
          if (transformResp.success && transformResp.world_transform) {
            const ori = extractEulerAnglesDegrees(transformResp.world_transform as TransformMatrix);
            store.addLog('output', `Orientation (World, degrees): ${formatTriple(ori as any)}`);
          } else {
            // 回退：从属性读取
            const ori = getAttr('ORI') ?? getAttr('ORIENTATION');
            if (ori !== undefined) {
              const formatted = formatVec3(ori);
              store.addLog('output', `Orientation (Local): ${formatted}`);
            } else {
              store.addLog('info', 'Orientation not available');
            }
          }
        } catch (e) {
          store.addLog('error', `Failed to query transform: ${e}`);
        }
        return;
      }

      // Handle Q POS WRT OWNER - 查询相对于拥有者的位置
      if (cmd === 'POS WRT OWNER') {
        try {
          // 查询元素的变换矩阵
          const elementResp = await pdmsGetTransform(id);
          if (!elementResp.success || !elementResp.world_transform) {
            store.addLog('error', 'Failed to query element transform');
            return;
          }

          const elementWorld = elementResp.world_transform as TransformMatrix;
          const ownerRefno = elementResp.owner;

          if (!ownerRefno || ownerRefno === id) {
            // 没有 owner 或 owner 就是自己，返回世界位置
            const pos = extractPosition(elementWorld);
            store.addLog('output', `Position (WRT OWNER - no owner): ${formatPosFromRawMaybe(viewer, [pos[0], pos[1], pos[2]])}`);
            return;
          }

          // 查询 owner 的变换矩阵
          const ownerResp = await pdmsGetTransform(ownerRefno);
          if (!ownerResp.success || !ownerResp.world_transform) {
            store.addLog('error', `Failed to query owner transform (${ownerRefno})`);
            return;
          }

          const ownerWorld = ownerResp.world_transform as TransformMatrix;

          // 计算相对变换
          const relativeTransform = computeRelativeTransform(elementWorld, ownerWorld);
          if (!relativeTransform) {
            store.addLog('error', 'Failed to compute relative transform (matrix not invertible)');
            return;
          }

          const pos = extractPosition(relativeTransform);
          store.addLog('output', `Position (WRT OWNER ${ownerRefno}): ${formatPosFromRawMaybe(viewer, [pos[0], pos[1], pos[2]])}`);
        } catch (e) {
          store.addLog('error', `Failed to compute position WRT owner: ${e}`);
        }
        return;
      }

      // Handle Q ORI WRT OWNER - 查询相对于拥有者的方位
      if (cmd === 'ORI WRT OWNER') {
        try {
          // 查询元素的变换矩阵
          const elementResp = await pdmsGetTransform(id);
          if (!elementResp.success || !elementResp.world_transform) {
            store.addLog('error', 'Failed to query element transform');
            return;
          }

          const elementWorld = elementResp.world_transform as TransformMatrix;
          const ownerRefno = elementResp.owner;

          if (!ownerRefno || ownerRefno === id) {
            // 没有 owner 或 owner 就是自己，返回世界方位
            const ori = extractEulerAnglesDegrees(elementWorld);
            store.addLog('output', `Orientation (WRT OWNER - no owner, degrees): ${formatTriple(ori as any)}`);
            return;
          }

          // 查询 owner 的变换矩阵
          const ownerResp = await pdmsGetTransform(ownerRefno);
          if (!ownerResp.success || !ownerResp.world_transform) {
            store.addLog('error', `Failed to query owner transform (${ownerRefno})`);
            return;
          }

          const ownerWorld = ownerResp.world_transform as TransformMatrix;

          // 计算相对变换
          const relativeTransform = computeRelativeTransform(elementWorld, ownerWorld);
          if (!relativeTransform) {
            store.addLog('error', 'Failed to compute relative transform (matrix not invertible)');
            return;
          }

          const ori = extractEulerAnglesDegrees(relativeTransform);
          store.addLog('output', `Orientation (WRT OWNER ${ownerRefno}, degrees): ${formatTriple(ori as any)}`);
        } catch (e) {
          store.addLog('error', `Failed to compute orientation WRT owner: ${e}`);
        }
        return;
      }

      // Handle Q ATT <Attribute>
      if (cmd.startsWith('ATT')) {
        const attrName = args[1];
        if (!attrName) {
          store.addLog('error', 'Usage: Q ATT <attribute_name>');
          return;
        }

        const val = getAttr(attrName);
        if (val !== undefined) {
          store.addLog('output', `${attrName}: ${val}`);
        } else {
          store.addLog('info', `Attribute ${attrName} not found on ${id}`);
        }
        return;
      }

      // Fallback: Query any attribute directly: "Q NAME" -> implicit attribute query
      if (args.length === 1) {
        const attr = args[0];
        if (!attr) return;

        const val = getAttr(attr);
        if (val !== undefined) {
          store.addLog('output', `${attr}: ${val}`);
        } else {
          store.addLog('info', `Property '${attr}' not found.`);
        }
        return;
      }

      store.addLog('info', `Unknown Query: ${cmd}`);
    } catch (e) {
      store.addLog('error', `API Error: ${e}`);
    }
  });

  // = <Refno> (Go to Refno)
  store.registerCommand('=', async (args: string[]) => {
    const refno = parsePdmsRefnoFromArgs(args);
    if (!refno) {
      const raw = args.join(' ').trim();
      const hint = raw.startsWith('{') || raw.startsWith('[')
        ? '（你似乎粘贴了 JSON 片段；这里需要的是 refno，例如 17496/171640）'
        : '';
      store.addLog('error', `Usage: = <refno> 例如：= 17496/171640 ${hint}`);
      return;
    }

    const tree = getModelTreeInstance();
    if (!tree) {
      store.addLog('error', 'Model tree not initialized');
      return;
    }

    try {
      // Use focusNodeById to expand ancestors and select the node
      await tree.focusNodeById(refno, {
        flyTo: true,
        syncSceneSelection: true,
        clearSearch: true
      });

      // 设置全局 selection，触发 ModelTreePanel 的 watcher
      // 使树自动滚动到目标节点并居中显示
      setGlobalSelectedRefno(refno.replace(/\//g, '_'));

      store.addLog('output', `CE set to: ${refno}`);
    } catch (e) {
      store.addLog('error', `Navigation failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  // / <Name> (Go to Name)
  store.registerCommand('/', async (args: string[]) => {
    const name = args.join(' ');
    if (!name) {
      store.addLog('error', 'Usage: / <name>');
      return;
    }

    store.addLog('input', `Searching for '${name}'...`);

    try {
      const resp = await e3dSearch({ keyword: name, limit: 10 });
      if (resp.success && resp.items.length > 0) {
        const match = resp.items.find(i => i.name === name || i.name === `/${name}`) || resp.items[0];

        if (match) {
          const refno = match.refno;
          store.addLog('output', `Found: ${match.name} (${refno})`);

          const tree = getModelTreeInstance();
          if (!tree) {
            store.addLog('error', 'Model tree not initialized');
            return;
          }

          try {
            // Use focusNodeById to expand ancestors and select the node
            await tree.focusNodeById(refno, {
              flyTo: true,
              syncSceneSelection: true,
              clearSearch: true
            });
            store.addLog('output', `CE set to: ${match.name} (${refno})`);
          } catch (e) {
            store.addLog('error', `Navigation failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      } else {
        store.addLog('error', `Name '${name}' not found.`);
      }
    } catch (e) {
      store.addLog('error', `Search failed: ${e}`);
    }
  });
}
