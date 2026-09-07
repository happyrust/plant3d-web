/**
 * gen-model-v1 的 `AttributeSource`（plan P4-1 / P4-2）。
 *
 * - `uiAttr(refno)` → `POST /api/v1/element/attributes` → 现有属性面板吃的 `PdmsUiAttrResponse`：
 *   `attributes[]` 摊成 `attrs: Record<name, value>`；`is_unset` 的不进（E3D 的 unset 就是「没有值」，
 *   23 条 `unset` 挤在面板里只会淹掉有值的）；UDA 名前加 `:`（面板按 `:` 前缀分到「UDA属性」组）；
 *   `bool` / `real` / `int` 转成 JS 布尔 / 数值，其余保留服务端 `display` 原文（`ref` 是 `a/b`，面板会自己认）。
 *   `full_name` 取 `NAME`（E3D 的 NAME 本来就是全路径名）；`ref_full_names` 不给（要逐个回查，P4 不做）。
 *   `diagnostics.undecoded` / `shape_conflicts` / `complete` 原样透出，面板尾部给一行提示。
 * - `typeInfo(refno)`：noun / owner / owner_noun 都在树节点上，`tree.node()` 两跳就够，不另开端点。
 *
 * 一切 `GenModelV1ApiError` 折成 `{ success:false, error_message }`，与旧后端契约同形。
 */
import type { AttributeSource, TreeSource } from '../ports';
import type { PdmsTypeInfoResponse, PdmsUiAttrResponse } from '@/api/genModelPdmsAttrApi';

import { genModelV1ElementAttributes, isGenModelV1ApiError, type ElementAttribute, type ElementAttributesResponse } from '@/api/genModelV1Api';

export type AttributeApi = {
  elementAttributes: typeof genModelV1ElementAttributes;
};

export const defaultAttributeApi: AttributeApi = {
  elementAttributes: genModelV1ElementAttributes,
};

function coerceValue(attribute: ElementAttribute): unknown {
  const display = String(attribute.display ?? '');
  switch ((attribute.value_type ?? '').toLowerCase()) {
    case 'bool': {
      const lower = display.trim().toLowerCase();
      if (lower === 'true' || lower === 'yes' || lower === '1') return true;
      if (lower === 'false' || lower === 'no' || lower === '0') return false;
      return display;
    }
    case 'real':
    case 'int':
    case 'integer':
    case 'number': {
      const trimmed = display.trim();
      if (!trimmed) return display;
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : display;
    }
    default:
      return display;
  }
}

/** 面板按 `:` 前缀识别 UDA；服务端 UDA 名字不带冒号，这里补上。 */
export function uiAttrKey(attribute: ElementAttribute): string {
  const name = String(attribute.name ?? '').trim();
  if (attribute.is_uda && name && !name.startsWith(':')) return `:${name}`;
  return name;
}

function errorMessage(error: unknown): string {
  if (isGenModelV1ApiError(error)) return `${error.code}${error.status ? ` (${error.status})` : ''}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

/** `element/attributes` 响应 → 属性面板契约。 */
export function elementAttributesToUiAttr(refno: string, resp: ElementAttributesResponse): PdmsUiAttrResponse {
  const attrs: Record<string, unknown> = {};
  let fullName: string | null = null;
  for (const attribute of resp.attributes ?? []) {
    const key = uiAttrKey(attribute);
    if (!key || attribute.is_unset) continue;
    const value = coerceValue(attribute);
    attrs[key] = value;
    if (key.toUpperCase() === 'NAME' && typeof value === 'string' && value.trim().startsWith('/')) {
      fullName = value.trim();
    }
  }
  const undecoded = (resp.diagnostics?.undecoded ?? [])
    .map((item) => (typeof item === 'string' ? item : (item as { name?: unknown } | null)?.name))
    .filter((name): name is string => typeof name === 'string' && name.length > 0);
  const shapeConflicts = ((resp.diagnostics as { shape_conflicts?: unknown[] } | null | undefined)?.shape_conflicts ?? [])
    .map((item) => (typeof item === 'string' ? item : (item as { name?: unknown } | null)?.name))
    .filter((name): name is string => typeof name === 'string' && name.length > 0);
  return {
    success: true,
    refno,
    attrs,
    full_name: fullName,
    ref_full_names: null,
    diagnostics: {
      source: resp.source,
      complete: resp.complete,
      undecoded,
      shape_conflicts: shapeConflicts,
    },
  };
}

/** `pdmsGetTypeInfo` 的 v1 版：noun 与属主都在树节点上，两跳 `node()` 就够。 */
export async function typeInfoFromTree(tree: TreeSource, refno: string): Promise<PdmsTypeInfoResponse> {
  const resp = await tree.node(refno);
  if (!resp.success || !resp.node) {
    return { success: false, refno, error_message: resp.error_message ?? `找不到节点 ${refno}` };
  }
  const owner = resp.node.owner ?? null;
  let ownerNoun: string | null = null;
  if (owner) {
    const ownerResp = await tree.node(owner);
    ownerNoun = ownerResp.success && ownerResp.node ? ownerResp.node.noun : null;
  }
  return { success: true, refno: resp.node.refno, noun: resp.node.noun, owner_refno: owner, owner_noun: ownerNoun };
}

export type GenModelV1AttributeSourceOptions = {
  tree: TreeSource;
  api?: AttributeApi;
};

export function createGenModelV1AttributeSource(options: GenModelV1AttributeSourceOptions): AttributeSource {
  const api = options.api ?? defaultAttributeApi;
  return {
    async uiAttr(refno) {
      try {
        const resp = await api.elementAttributes(refno);
        return elementAttributesToUiAttr(refno, resp);
      } catch (error) {
        return { success: false, refno, attrs: {}, error_message: errorMessage(error) };
      }
    },
    typeInfo: (refno) => typeInfoFromTree(options.tree, refno),
  };
}
