import { computed, ref } from 'vue';

import type { ElementAttributesResponse, SpatialCenterlineResponse } from '@/api/genModelV1Api';
import type { PipeBendAngle, PipeInformationRecord, PipeInsulationRow, PipeMemberMaterial } from '@/dimension';

import { genModelV1ElementAttributes, genModelV1ModelBounds, genModelV1SpatialCenterline, genModelV1TreeChildren } from '@/api/genModelV1Api';
import { createScopedResultPersistence } from '@/clearance/services/scopedResultPersistence';
import { attributeText, buildPipeInformation, pipeAttribute, pipeInformationRefno, validatePipeInformationRecord } from '@/dimension';

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

function checkAttributeVersion(attrs: ElementAttributesResponse, version?: SpatialCenterlineResponse['source_version']) {
  if (!version) return false;
  if (!Number.isSafeInteger(attrs.dbnum) || attrs.dbnum! <= 0) throw new Error('属性缺少可核对的库号');
  const database = version.databases.find(database => database.dbnum === attrs.dbnum);
  if (database && attrs.sesno !== database.sesno) throw new Error(`属性版本不一致：${attrs.refno}@${attrs.sesno}，本次中心线读取 ${database.dbnum}@${database.sesno}`);
  return Boolean(database);
}

type MaterialValue = { text: string; source: string; status?: PipeMemberMaterial['status'] };

// Catalogue material through a spec reference: SPRE (component), HSTU/LSTU (tube) -> SPCO.MATX -> SMTE.XTEX,
// the text ISO/MTO use.
async function readSpecMaterial(attrs: ElementAttributesResponse, read: typeof genModelV1ElementAttributes,
  version?: SpatialCenterlineResponse['source_version'], specAttribute: 'SPRE' | 'HSTU' | 'LSTU' = 'SPRE'): Promise<MaterialValue | undefined> {
  const specRef = attributeText(attrs, specAttribute);
  if (!specRef) return undefined;
  const component = await read(specRef);
  if (pipeInformationRefno(component.refno ?? '') !== pipeInformationRefno(specRef) || component.noun !== 'SPCO'
    || !Number.isSafeInteger(component.sesno) || component.sesno! < 0) throw new Error(`规格引用 ${specRef} 不是可核对的 SPCO`);
  const source = `${attrs.refno}@${attrs.sesno}:${specAttribute} → ${component.refno}@${component.sesno}:MATX`;
  const textRef = attributeText(component, 'MATX');
  if (!textRef) return { text: '未设置', source: `${source}（未设置）`, status: 'missing' };
  const material = await read(textRef);
  if (pipeInformationRefno(material.refno ?? '') !== pipeInformationRefno(textRef) || material.noun !== 'SMTE'
    || !Number.isSafeInteger(material.sesno) || material.sesno! < 0) throw new Error(`材质文本引用 ${textRef} 不是可核对的 SMTE`);
  const matched = [component, material].map(item => checkAttributeVersion(item, version)).every(Boolean);
  const text = attributeText(material, 'XTEX');
  if (!text) return { text: '未设置', source: `${source} → ${material.refno}@${material.sesno}:XTEX（未设置）`, status: 'missing' };
  return { text, source: `${source} → ${material.refno}@${material.sesno}:XTEX`, status: version && !matched ? 'unconfirmed' : 'read' };
}

type InsulationPick = Pick<PipeInsulationRow, 'para1Mm' | 'status' | 'text' | 'source'>;

// Walk an insulation SPEC the way E3D selects: each node's QUES (TYPE/TEMP/PBOR) is answered by a child
// SELE/SPCO whose TANS or ANSW..MAXA matches, down to the SPCO whose CATR is the GTYP INSU component.
async function selectInsulation(specRef: string, temperature: number | null, bore: number, read: typeof genModelV1ElementAttributes,
  version?: SpatialCenterlineResponse['source_version']): Promise<InsulationPick> {
  let node = await read(specRef);
  if (pipeInformationRefno(node.refno ?? '') !== pipeInformationRefno(specRef) || node.noun !== 'SPEC') throw new Error(`保温规格 ${specRef} 不是 SPEC`);
  const matched = [checkAttributeVersion(node, version)];
  const path = [`${node.refno}@${node.sesno}(${attributeText(node, 'NAME') ?? 'SPEC'})`];
  for (let depth = 0; depth < 6; depth += 1) {
    const question = attributeText(node, 'QUES');
    const answer = question === 'TYPE' ? 'INSU' : question === 'TEMP' ? temperature : question === 'PBOR' ? bore : null;
    if (answer === null) return { para1Mm: null, status: 'unconfirmed', text: `无法回答选择问题 ${question ?? '未设置'}`, source: path.join(' → ') };
    let next: ElementAttributesResponse | undefined;
    for (const kid of (await genModelV1TreeChildren(node.refno!)).nodes.filter(kid => kid.noun === 'SELE' || kid.noun === 'SPCO')) {
      const child = await read(kid.refno);
      const low = pipeAttribute(child, 'ANSW')?.value; const high = pipeAttribute(child, 'MAXA')?.value;
      const hit = typeof answer === 'string' ? attributeText(child, 'TANS') === answer
        : typeof low === 'number' && answer >= low && answer <= (typeof high === 'number' && high > low ? high : low);
      if (hit) { next = child; break; }
    }
    if (!next) return { para1Mm: null, status: 'missing', text: `${question} ${answer} 无匹配行`, source: path.join(' → ') };
    matched.push(checkAttributeVersion(next, version));
    path.push(`${question}=${answer} ${next.refno}@${next.sesno}(${attributeText(next, 'NAME') ?? next.noun})`);
    if (next.noun === 'SPCO') {
      const catalogue = attributeText(next, 'CATR');
      if (!catalogue) return { para1Mm: null, status: 'missing', text: '保温规格行未挂目录件', source: path.join(' → ') };
      const component = await read(catalogue);
      matched.push(checkAttributeVersion(component, version));
      const para = pipeAttribute(component, 'PARA')?.value;
      const first = Array.isArray(para) ? para[0] : para;
      const source = `${path.join(' → ')} → ${component.refno}@${component.sesno}(${attributeText(component, 'NAME') ?? component.noun}):PARA[1]`;
      if (attributeText(component, 'GTYP') !== 'INSU' || typeof first !== 'number' || !Number.isFinite(first) || first <= 0)
        return { para1Mm: null, status: 'missing', text: '保温目录件不是 INSU 或缺 PARA[1]', source };
      return { para1Mm: first, status: version && !matched.every(Boolean) ? 'unconfirmed' : 'read', text: `PARA[1] ${Number(first.toFixed(2))} mm`, source };
    }
    node = next;
  }
  return { para1Mm: null, status: 'unconfirmed', text: '保温规格层级过深', source: path.join(' → ') };
}

async function readMaterial(root: ElementAttributesResponse, warnings: string[], read = genModelV1ElementAttributes,
  version?: SpatialCenterlineResponse['source_version']): Promise<MaterialValue | undefined> {
  let attrs = root;
  checkAttributeVersion(attrs, version);
  if (!attributeText(attrs, 'MATN') && !attributeText(attrs, 'MATR')) {
    const owner = attributeText(attrs, 'OWNER');
    if (owner) {
      try {
        const parent = await read(owner);
        if (pipeInformationRefno(parent.refno ?? '') !== pipeInformationRefno(owner)) throw new Error('PIPE 引用所属上下文不匹配');
        if (!Number.isSafeInteger(parent.sesno) || parent.sesno! < 0) throw new Error('PIPE 属性会话缺失');
        checkAttributeVersion(parent, version);
        if (parent.noun === 'PIPE') attrs = parent;
      } catch { warnings.push('所属 PIPE 属性读取失败，不能补全业务材质'); }
    }
  }
  const source = `${attrs.refno}@${attrs.sesno}`;
  const materialName = attributeText(attrs, 'MATN');
  if (materialName) return { text: materialName, source: `${source}:MATN`, status: version && !checkAttributeVersion(attrs, version) ? 'unconfirmed' : 'read' };
  const reference = attributeText(attrs, 'MATR');
  // Only the element's own spec counts; a PIPE/BRAN material is never inherited by members.
  if (!reference) return attrs === root ? readSpecMaterial(attrs, read, version) : undefined;
  try {
    const material = await read(reference);
    if (pipeInformationRefno(material.refno ?? '') !== pipeInformationRefno(reference)) throw new Error('材质引用不匹配');
    if (!Number.isSafeInteger(material.sesno) || material.sesno! < 0) throw new Error('材质会话缺失');
    const matched = checkAttributeVersion(material, version);
    const text = attributeText(material, 'DESC') ?? attributeText(material, 'NAME');
    if (text) return { text, source: `${source}:MATR → ${material.refno}@${material.sesno}`, status: version && !matched ? 'unconfirmed' : 'read' };
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
      const [centerlineResult, boundsResult] = await Promise.allSettled([
        genModelV1SpatialCenterline(refno), genModelV1ModelBounds(refno),
      ]);
      if (stamp !== sequence) return false;
      // The backend route rejects HVAC branches. Never annotate an unsupported
      // BRAN merely because a model box exists for it.
      if (centerlineResult.status === 'rejected') throw new Error(`管道中心线不可用，风管支管不创建此标注：${centerlineResult.reason instanceof Error ? centerlineResult.reason.message : String(centerlineResult.reason)}`);
      if (boundsResult.status === 'rejected') warnings.push('当前模型边界不可用，模型包围尺寸缺失');
      const centerline = centerlineResult.value;
      // Reject a mixed root before reading further member/material references.
      buildPipeInformation({ refno, attributes, centerline });
      const cache = new Map<string, Promise<ElementAttributesResponse>>([[refno, Promise.resolve(attributes)]]);
      const read = (input: string) => {
        const key = pipeInformationRefno(input);
        if (!cache.has(key)) cache.set(key, genModelV1ElementAttributes(key));
        return cache.get(key)!;
      };
      const material = await readMaterial(attributes, warnings, read, centerline.source_version);
      const seen = new Set<string>();
      const targets = centerline.segments.filter(segment => {
        if (segment.implicit) return true;
        if (seen.has(segment.refno)) return false;
        seen.add(segment.refno); return true;
      });
      const memberMaterials: PipeMemberMaterial[] = new Array(targets.length);
      const bendAngles: PipeBendAngle[] = [];
      const insulationSpecs: { ispe: string | null; source: string }[] = new Array(targets.length);
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(4, targets.length) }, async () => {
        while (next < targets.length && stamp === sequence) {
          const index = next++; const segment = targets[index]!;
          try {
            if (segment.implicit) {
              // Implicit tube `from~to`: the head tube uses BRAN HSTU, every other tube its upstream member's LSTU.
              const from = segment.refno.split('~')[0] ?? '';
              const head = from === 'Head' || pipeInformationRefno(from) === refno;
              const owner = head ? attributes : await read(from);
              if (pipeInformationRefno(owner.refno ?? '') !== (head ? refno : pipeInformationRefno(from))
                || !Number.isSafeInteger(owner.sesno) || owner.sesno! < 0) throw new Error('直管段所属成员不匹配');
              checkAttributeVersion(owner, centerline.source_version);
              insulationSpecs[index] = { ispe: attributeText(owner, 'ISPE'), source: `${owner.refno}@${owner.sesno}:ISPE` };
              const tubeSpec = head ? 'HSTU' : 'LSTU';
              const value = await readSpecMaterial(owner, read, centerline.source_version, tubeSpec);
              memberMaterials[index] = { refno: segment.refno, noun: segment.noun, implicit: true, text: value?.text ?? '未设置',
                source: value?.source ?? `${owner.refno}@${owner.sesno}:${tubeSpec}`, status: value ? value.status ?? 'read' : 'missing' };
              continue;
            }
            const attrs = await read(segment.refno);
            if (pipeInformationRefno(attrs.refno ?? '') !== pipeInformationRefno(segment.refno)
              || !Number.isSafeInteger(attrs.sesno) || attrs.sesno! < 0
              || (segment.noun !== 'UNKNOWN' && attrs.noun !== segment.noun)) throw new Error('成员属性所属对象或类型不匹配');
            checkAttributeVersion(attrs, centerline.source_version);
            insulationSpecs[index] = { ispe: attributeText(attrs, 'ISPE'), source: `${attrs.refno}@${attrs.sesno}:ISPE` };
            if (['BEND', 'ELBO'].includes(segment.noun)) {
              const angle = pipeAttribute(attrs, 'ANGL')?.value;
              bendAngles.push({ refno: segment.refno, angleDeg: typeof angle === 'number' ? angle : null, source: `${attrs.refno}@${attrs.sesno}:ANGL` });
            }
            const value = await readMaterial(attrs, warnings, read, centerline.source_version);
            memberMaterials[index] = { refno: segment.refno, noun: segment.noun, text: value?.text ?? '未设置',
              source: value?.source ?? `${attrs.refno}@${attrs.sesno}:MATN/MATR/SPRE`,
              status: value ? value.status ?? (attrs.complete ? 'read' : 'unconfirmed') : 'missing' };
          } catch (cause) {
            memberMaterials[index] = { refno: segment.refno, noun: segment.noun, ...(segment.implicit ? { implicit: true } : {}),
              text: '未核实', status: 'unconfirmed', source: cause instanceof Error ? cause.message : String(cause) };
          }
        }
      }));
      if (stamp !== sequence) return false;
      // E3D takes the insulation temperature from the BRAN; the bore is each segment's own.
      const temperatureValue = pipeAttribute(attributes, 'TEMP')?.value;
      const temperature = typeof temperatureValue === 'number' && Number.isFinite(temperatureValue) ? temperatureValue : null;
      const picks = new Map<string, Promise<InsulationPick>>();
      const insulationRows = await Promise.all(targets.map(async (segment, index): Promise<PipeInsulationRow> => {
        const od = segment.outside_diameter_mm; const bore = segment.diameter_evidence?.arrive_bore_mm;
        const base = { refno: segment.refno, order: segment.order,
          boreMm: typeof bore === 'number' && Number.isFinite(bore) && bore > 0 ? bore : null,
          outsideDiameterMm: typeof od === 'number' && Number.isFinite(od) && od > 0 ? od : null };
        const spec = insulationSpecs[index];
        if (!spec) return { ...base, para1Mm: null, status: 'unconfirmed', text: '成员属性未读到，保温未核实', source: memberMaterials[index]?.source ?? '' };
        if (!spec.ispe) return { ...base, para1Mm: null, status: 'none', text: '无保温规格', source: spec.source };
        if (base.boreMm === null) return { ...base, para1Mm: null, status: 'unconfirmed', text: '该段通径未知，不能选取保温', source: spec.source };
        const key = `${pipeInformationRefno(spec.ispe)}|${temperature}|${base.boreMm}`;
        if (!picks.has(key)) picks.set(key, selectInsulation(spec.ispe, temperature, base.boreMm, read, centerline.source_version));
        try {
          const pick = await picks.get(key)!;
          return { ...base, ...pick, source: `${spec.source} → ${pick.source}` };
        } catch (cause) {
          return { ...base, para1Mm: null, status: 'unconfirmed', text: '保温规格读取失败', source: cause instanceof Error ? cause.message : String(cause) };
        }
      }));
      if (stamp !== sequence) return false;
      const record = buildPipeInformation({ refno, attributes, warnings,
        centerline,
        bounds: boundsResult.status === 'fulfilled' ? boundsResult.value : undefined,
        material, memberMaterials, bendAngles, insulationRows,
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
