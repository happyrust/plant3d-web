import { computed, ref } from 'vue';

import type { ElementAttributesResponse } from '@/api/genModelV1Api';
import type { PipeInformationRecord } from '@/dimension';

import { genModelV1ElementAttributes, genModelV1ModelBounds, genModelV1SpatialCenterline } from '@/api/genModelV1Api';
import { createScopedResultPersistence } from '@/clearance/services/scopedResultPersistence';
import { attributeText, buildPipeInformation, pipeInformationRefno, validatePipeInformationRecord } from '@/dimension';

const records = ref<PipeInformationRecord[]>([]);
const suggestedRefno = ref('');
const showAnnotations = ref(true);
const hiddenRefnos = ref<string[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
let sequence = 0;
let allowed = true;
const persistence = createScopedResultPersistence({
  prefix: 'plant3d-pipe-information-v1', sources: [records, showAnnotations, hiddenRefnos],
  capture: () => ({ coordinateSpace: 'e3d-world-mm', records: records.value, showAnnotations: showAnnotations.value, hiddenRefnos: hiddenRefnos.value }),
  restore: value => {
    if (value === null) { records.value = []; showAnnotations.value = true; hiddenRefnos.value = []; error.value = null; return; }
    const snapshot = value as { coordinateSpace: string; records: unknown[]; showAnnotations: boolean; hiddenRefnos: string[] };
    if (!snapshot || snapshot.coordinateSpace !== 'e3d-world-mm' || !Array.isArray(snapshot.records) || typeof snapshot.showAnnotations !== 'boolean'
      || !Array.isArray(snapshot.hiddenRefnos) || !snapshot.hiddenRefnos.every(item => typeof item === 'string')) throw new Error('管道信息快照格式无效');
    const restored = snapshot.records.map(validatePipeInformationRecord);
    if (new Set(restored.map(item => item.refno)).size !== restored.length) throw new Error('管道信息参考号重复');
    records.value = restored;
    showAnnotations.value = snapshot.showAnnotations;
    hiddenRefnos.value = snapshot.hiddenRefnos.filter(refno => restored.some(item => item.refno === refno));
  },
  invalidate: allow => { allowed = allow; sequence += 1; loading.value = false; },
});

async function readMaterial(root: ElementAttributesResponse, warnings: string[]): Promise<{ text: string; source: string; status?: 'read' | 'unconfirmed' } | undefined> {
  let attrs = root;
  if (!attributeText(attrs, 'MATN') && !attributeText(attrs, 'MATR')) {
    const owner = attributeText(attrs, 'OWNER');
    if (owner) {
      try {
        const parent = await genModelV1ElementAttributes(owner);
        if (pipeInformationRefno(parent.refno ?? '') !== pipeInformationRefno(owner)) throw new Error('PIPE 引用所属上下文不匹配');
        if (!Number.isSafeInteger(parent.sesno) || parent.sesno! < 0) throw new Error('PIPE 属性会话缺失');
        if (parent.noun === 'PIPE') attrs = parent;
      } catch { warnings.push('所属 PIPE 属性读取失败，不能补全业务材质'); }
    }
  }
  const source = `${attrs.refno}@${attrs.sesno}`;
  const materialName = attributeText(attrs, 'MATN');
  if (materialName) return { text: materialName, source: `${source}:MATN` };
  const reference = attributeText(attrs, 'MATR');
  if (!reference) return undefined;
  try {
    const material = await genModelV1ElementAttributes(reference);
    if (pipeInformationRefno(material.refno ?? '') !== pipeInformationRefno(reference)) throw new Error('材质引用不匹配');
    if (!Number.isSafeInteger(material.sesno) || material.sesno! < 0) throw new Error('材质会话缺失');
    const text = attributeText(material, 'DESC') ?? attributeText(material, 'NAME');
    if (text) return { text, source: `${source}:MATR → ${material.refno}@${material.sesno}` };
  } catch { warnings.push('业务材质引用无法解析，请核对材料库'); }
  return { text: `待解析（${reference}）`, source: `${source}:MATR（未解析）`, status: 'unconfirmed' };
}

export function usePipeInformationStore() {
  async function refresh(refnoInput: string): Promise<boolean> {
    const stamp = ++sequence;
    loading.value = false;
    const refno = pipeInformationRefno(refnoInput);
    if (!allowed) { error.value = '历史版本对比中不能读取当前管道信息，请退出对比后更新。'; return false; }
    if (!/^\d+_\d+$/.test(refno)) { error.value = '请输入 BRAN 参考号，例如 24381/145018'; return false; }
    loading.value = true; error.value = null;
    try {
      const attributes = await genModelV1ElementAttributes(refno);
      if (stamp !== sequence) return false;
      if (attributes.noun !== 'BRAN') throw new Error('请选择管道 BRAN；风管或其他构件请使用对应标注');
      const warnings: string[] = [];
      const [centerlineResult, boundsResult, materialResult] = await Promise.allSettled([
        genModelV1SpatialCenterline(refno), genModelV1ModelBounds(refno), readMaterial(attributes, warnings),
      ]);
      if (stamp !== sequence) return false;
      // The backend route rejects HVAC branches. Never annotate an unsupported
      // BRAN merely because a model box exists for it.
      if (centerlineResult.status === 'rejected') throw new Error(`管道中心线不可用，风管支管不创建此标注：${centerlineResult.reason instanceof Error ? centerlineResult.reason.message : String(centerlineResult.reason)}`);
      if (boundsResult.status === 'rejected') warnings.push('当前模型边界不可用，模型包围尺寸缺失');
      const record = buildPipeInformation({ refno, attributes, warnings,
        centerline: centerlineResult.status === 'fulfilled' ? centerlineResult.value : undefined,
        bounds: boundsResult.status === 'fulfilled' ? boundsResult.value : undefined,
        material: materialResult.status === 'fulfilled' ? materialResult.value : undefined,
      });
      const index = records.value.findIndex(item => item.refno === refno);
      records.value = index < 0 ? [...records.value, record] : records.value.map((item, i) => i === index ? record : item);
      return true;
    } catch (cause) {
      if (stamp !== sequence) return false;
      error.value = `管道信息读取失败，原标注已保留：${cause instanceof Error ? cause.message : String(cause)}`;
      return false;
    } finally { if (stamp === sequence) loading.value = false; }
  }
  function remove(refno: string) { sequence += 1; loading.value = false; records.value = records.value.filter(item => item.refno !== refno); hiddenRefnos.value = hiddenRefnos.value.filter(item => item !== refno); }
  function setHidden(refno: string, hidden: boolean) {
    hiddenRefnos.value = hidden ? [...new Set([...hiddenRefnos.value, refno])] : hiddenRefnos.value.filter(item => item !== refno);
  }
  function clear() { sequence += 1; loading.value = false; records.value = []; hiddenRefnos.value = []; }
  const visibleRecords = computed(() => showAnnotations.value ? records.value.filter(item => !hiddenRefnos.value.includes(item.refno)) : []);
  return { records, suggestedRefno, showAnnotations, hiddenRefnos, visibleRecords, loading, error, refresh, remove, setHidden, clear,
    bindPersistence: persistence.bindPersistence, detachPersistence: persistence.detachPersistence,
    persistRecords: persistence.persistRecords, persistenceLabel: persistence.persistenceLabel, persistenceError: persistence.persistenceError };
}
