/**
 * 弯管中心线弧的半径（`elementArcRadius.ts` 的取数侧）。
 *
 * E3D 的 `arc()` 把半径当输入：BEND 读元素自己的 `RADI`，ELBO 读**目录**的 `parameter[2]`
 * ——元素 `SPRE` → SPCO `CATR` → SCOM `PARA` 第 2 项（`edgelbow.pmlobj` 58 / `edgbend.pmlobj` 62，
 * 实机核对见 golden MD §39.4）。悬停链路本来不取属性，这里按 `measurementSnapLabel` 的 noun 缓存同一套做法：
 * 同步读缓存 + fire-and-forget 预取 + 一个自增 revision 让 computed 在数据到达后重算。
 *
 * 取不到（请求失败 / 没有 `SPRE` / `PARA` 缺那一项 / 值 ≤ 0）就缓存 `null`：E3D 那一侧 `arc()` 抛
 * `(2,888) Attempt to create invalid arc`，同样没有弧操作数，所以「没有半径 = 没有弧」与产品一致。
 * 目录参数按 `CATR` 另缓存一份——同一型号的上千个弯头只查一次。
 */
import { ref } from 'vue';

import {
  elementArcRadiusFromAttributes,
  elementArcRadiusSourceFor,
  parseCatalogueParameters,
} from '@/measurement/kernel/elementArcRadius';

/** `refno` → 半径（mm，设计单位）；`null` = 查过但没有。 */
const radiusByRefno = new Map<string, number | null>();
/** 目录 `CATR` → `PARA` 数组；`null` = 查过但读不出。 */
const parametersByCatref = new Map<string, readonly number[] | null>();
const pendingRefnos = new Set<string>();
/** 缓存写入时自增，让读到它的 computed 在异步半径到达后重新求值。 */
const radiusCacheRevision = ref(0);

function cacheKey(refno: string): string {
  return refno.replace(/\//g, '_').trim();
}

/** 属性名大小写按数据源可能不同（gen-model 给 E3D 原名，旧后端不保证），统一按大写查。 */
function attrValue(attrs: Record<string, unknown> | null | undefined, name: string): unknown {
  if (!attrs) return undefined;
  if (name in attrs) return attrs[name];
  const upper = name.toUpperCase();
  for (const [key, value] of Object.entries(attrs)) {
    if (key.trim().toUpperCase() === upper) return value;
  }
  return undefined;
}

/** 引用类属性的值：`13246/465625`、`=13246/465625`、`pe:13246/465625` 都收；`0/0`（未设）不收。 */
function refText(value: unknown): string | null {
  const text = String(value ?? '').trim().replace(/^pe:/i, '').replace(/^=/, '');
  if (!text || text === '0/0') return null;
  return text;
}

async function fetchRadius(refno: string, noun: string): Promise<number | null> {
  const source = elementArcRadiusSourceFor(noun);
  if (!source) return null;
  // 动态 import：测量链路不静态背上数据源模块（同 measurementSnapLabel 的 noun 预取）。
  const { getModelSource } = await import('@/model-source');
  const attributes = getModelSource().attributes;

  const own = await attributes.uiAttr(refno);
  if (!own?.success) return null;
  if (source === 'radi') {
    return elementArcRadiusFromAttributes(noun, { radi: attrValue(own.attrs, 'RADI') });
  }

  const spref = refText(attrValue(own.attrs, 'SPRE'));
  if (!spref) return null;
  const spco = await attributes.uiAttr(spref);
  if (!spco?.success) return null;
  const catref = refText(attrValue(spco.attrs, 'CATR'));
  if (!catref) return null;

  let parameters = parametersByCatref.get(catref);
  if (parameters === undefined) {
    const scom = await attributes.uiAttr(catref);
    parameters = scom?.success ? parseCatalogueParameters(attrValue(scom.attrs, 'PARA')) : null;
    parametersByCatref.set(catref, parameters);
  }
  return elementArcRadiusFromAttributes(noun, { catalogueParameters: parameters });
}

/** 读已缓存的弧半径；没查过 / 没有都回 null（同时建立响应式依赖）。 */
export function getCachedElementArcRadius(refno: string | null | undefined): number | null {
  void radiusCacheRevision.value;
  if (!refno) return null;
  return radiusByRefno.get(cacheKey(refno)) ?? null;
}

/** 异步预取这一枚元素的弧半径（fire-and-forget，带去重；noun 没有 fillet 弧时直接跳过）。 */
export function requestElementArcRadius(refno: string | null | undefined, noun: string | null | undefined): void {
  if (!refno || !elementArcRadiusSourceFor(noun)) return;
  const key = cacheKey(refno);
  if (radiusByRefno.has(key) || pendingRefnos.has(key)) return;
  pendingRefnos.add(key);
  fetchRadius(refno, String(noun))
    .then((radius) => {
      radiusByRefno.set(key, radius);
    })
    .catch(() => {
      radiusByRefno.set(key, null);
    })
    .finally(() => {
      pendingRefnos.delete(key);
      radiusCacheRevision.value += 1;
    });
}

/** 测试专用：清空半径与目录参数缓存。 */
export function __resetElementArcRadiusCacheForTest(): void {
  radiusByRefno.clear();
  parametersByCatref.clear();
  pendingRefnos.clear();
  radiusCacheRevision.value += 1;
}
