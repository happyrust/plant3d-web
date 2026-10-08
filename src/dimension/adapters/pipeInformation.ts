import type { ExternalDimensionRecord } from './normalizeExternalDimensions';
import type { Vec3 } from '../kernel/types';
import type { ElementAttribute, ElementAttributesResponse, ModelBoundsResponse, SpatialCenterlineResponse } from '@/api/genModelV1Api';

export type PipeInformationField = { key: string; label: string; text: string; source: string; status: 'read' | 'derived' | 'missing' | 'unconfirmed' };
export type PipeMemberDiameter = {
  refno: string; order: number; noun: string; implicit: boolean; outsideDiameterMm: number | null;
  source: 'catalogue' | 'bore-estimate' | 'missing' | 'unknown'; sourceText: string;
};
export type PipeInformationRecord = {
  refno: string; name: string; sesno: number; fetchedAt: string; stale: boolean;
  anchorMm: Vec3; fields: PipeInformationField[]; warnings: string[];
  memberDiameters?: PipeMemberDiameter[];
};
export const PIPE_INFORMATION_SOURCE = 'pipe-information' as const;
export const pipeInformationRefno = (value: string) => value.trim().replace(/^=/, '').replace('/', '_');
export function pipeAttribute(response: ElementAttributesResponse, name: string): ElementAttribute | undefined {
  return response.attributes.find(attr => attr.name.toUpperCase() === name && !attr.is_unset
    && !['', 'unset', 'null', '0/0', '=0/0'].includes(attr.display.trim().toLowerCase()));
}
export function attributeText(response: ElementAttributesResponse, name: string): string | null {
  const attr = pipeAttribute(response, name);
  return attr ? attr.display.trim() : null;
}
function finitePoint(point: unknown): point is Vec3 {
  return Array.isArray(point) && point.length === 3 && point.every(value => typeof value === 'number' && Number.isFinite(value));
}
function field(key: string, label: string, text: string | null, source: string, status: PipeInformationField['status'] = 'read'): PipeInformationField {
  return { key, label, text: text ?? '未设置', source, status: text === null ? 'missing' : status };
}
const mm = (value: number) => `${Number(value.toFixed(2))} mm`;
export function buildPipeInformation(input: {
  refno: string; attributes: ElementAttributesResponse; centerline?: SpatialCenterlineResponse;
  bounds?: ModelBoundsResponse; material?: { text: string; source: string; status?: 'read' | 'unconfirmed' }; warnings?: string[];
}): PipeInformationRecord {
  const refno = pipeInformationRefno(input.refno);
  const attrs = input.attributes;
  if (attrs.noun !== 'BRAN' || pipeInformationRefno(attrs.refno ?? '') !== refno
    || !Number.isSafeInteger(attrs.sesno) || attrs.sesno! < 0) throw new Error('必须读取到这根 BRAN 的属性及会话');
  const warnings = [...(input.warnings ?? [])];
  if (!attrs.complete) warnings.push('属性读取不完整，缺失字段不能作为验收依据');
  const bounds = input.bounds;
  if (bounds && (pipeInformationRefno(bounds.refno) !== refno || bounds.scope !== 'subtree'
    || !finitePoint(bounds.min_mm) || !finitePoint(bounds.max_mm) || bounds.min_mm.some((value, axis) => value > bounds.max_mm[axis]!)))
    throw new Error('模型包围尺寸缺少可靠的世界毫米边界');
  const centerline = input.centerline;
  if (centerline && (pipeInformationRefno(centerline.refno) !== refno || !Array.isArray(centerline.segments))) throw new Error('中心线响应所属管道不匹配');
  const first = centerline?.segments[0]?.start;
  const anchor: Vec3 | null = first && [first.x, first.y, first.z].every(Number.isFinite)
    ? [first.x, first.y, first.z] : bounds ? bounds.min_mm.map((value, axis) => (value + bounds.max_mm[axis]!) / 2) as unknown as Vec3 : null;
  if (!anchor) throw new Error('缺少世界坐标，原有管道标注已保留；请先生成模型或修复中心线');
  const numericAttr = (key: string) => {
    const attr = pipeAttribute(attrs, key);
    const value = attr?.value;
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? mm(value) : null;
  };
  const straight = centerline?.segments.filter(segment => segment.implicit || ['TUBI', 'FTUB'].includes(segment.noun));
  const validLengths = straight?.every(segment => Number.isFinite(segment.length_mm) && segment.length_mm >= 0);
  const source = `${refno}@${attrs.sesno}`;
  const memberDiameters: PipeMemberDiameter[] = (centerline?.segments ?? []).map(segment => {
    const od = segment.outside_diameter_mm;
    const value = typeof od === 'number' && Number.isFinite(od) && od > 0 ? od : null;
    const evidence = segment.diameter_evidence;
    const catalogue = evidence?.catalogue_od_mm;
    const bore = evidence?.arrive_bore_mm;
    const matches = (expected: number) => value !== null && Math.abs(value - expected) <= Math.max(0.001, expected * 1e-6);
    const source = value === null ? 'missing' : evidence?.source === 'catalogue'
      && typeof catalogue === 'number' && Number.isFinite(catalogue) && catalogue > 0 && matches(catalogue) ? 'catalogue'
      : evidence?.source === 'bore-estimate' && evidence.catalogue_od_mm === null
        && typeof bore === 'number' && Number.isFinite(bore) && bore > 0 && matches(Math.min(bore * 1.1, bore + 10)) ? 'bore-estimate' : 'unknown';
    return { refno: segment.refno, order: segment.order, noun: segment.noun, implicit: segment.implicit, outsideDiameterMm: value, source,
      sourceText: source === 'catalogue' ? `管子目录 PARA[2]：${mm(catalogue!)}`
        : source === 'bore-estimate' ? `估算：min(通径×1.1, 通径+10)，到达通径 ${mm(bore!)}`
          : source === 'missing' ? '本段外径缺失，不能用首个成员值代替' : '接口未提供可核实的来源，需更新服务或核对目录' };
  });
  const diameters = memberDiameters.flatMap(member => member.outsideDiameterMm === null ? [] : [member.outsideDiameterMm]);
  const rangeText = diameters.length ? `${mm(Math.min(...diameters))}${Math.max(...diameters) !== Math.min(...diameters) ? ` ～ ${mm(Math.max(...diameters))}` : ''}（${diameters.length}/${memberDiameters.length}段）` : null;
  const modelBox = bounds ? bounds.max_mm.map((value, axis) => mm(value - bounds.min_mm[axis]!)).join(' × ') : null;
  const fields = [
    field('head-bore', '首端通径', numericAttr('HBOR'), `${source}:HBOR`),
    field('tail-bore', '末端通径', numericAttr('TBOR'), `${source}:TBOR`),
    field('outer-diameter', '成员外径范围', rangeText, '逐段读取；详情区分管子目录值、通径估算及缺失，不包含构件实体最大包络',
      memberDiameters.length && memberDiameters.every(member => member.source === 'catalogue') ? 'read' : 'unconfirmed'),
    field('material', '业务材质', input.material?.text ?? attributeText(attrs, 'MATN'), input.material?.source ?? `${source}:MATN/MATR`, input.material?.status ?? 'read'),
    field('insulation', '保温规格', attributeText(attrs, 'ISPE'), `${source}:ISPE（规格参考号）`),
    field('envelope', '业务包络', '口径待确认（是否含保温/操作空间）', '专业确认', 'unconfirmed'),
    field('model-bounds', '模型包围尺寸', modelBox, bounds?.source ?? '未生成模型', 'unconfirmed'),
    field('straight-length', '直管段总长', straight?.length && validLengths ? mm(straight.reduce((sum, segment) => sum + segment.length_mm, 0)) : null,
      '中心线的隐式直段和 TUBI/FTUB；不含弯头弧长', 'derived'),
    field('elevation', '标注锚点标高', mm(anchor[2]), 'E3D 世界 Z，非管顶/管底', 'derived'),
    field('coordinates', '标注锚点坐标', anchor.map(mm).join(', '), 'E3D 世界 X/Y/Z', 'derived'),
  ];
  if (bounds?.stale) warnings.push('模型包围尺寸来源已过期，请重新生成模型');
  if (memberDiameters.some(member => member.source !== 'catalogue')) warnings.push('部分成员外径为估算、来源未核实或缺失；不可据此完成外径验收');
  warnings.push('外径是各槽位管子目录参考，非管件实体最大包络；几何会话尚未与属性会话核实，外径和模型盒不得作为专业包络验收值');
  for (const warning of centerline?.warnings ?? []) warnings.push(warning);
  return { refno, name: attributeText(attrs, 'NAME') ?? refno, sesno: attrs.sesno!, fetchedAt: new Date().toISOString(),
    stale: false, anchorMm: anchor, fields, memberDiameters, warnings: [...new Set(warnings)] };
}

export function pipeInformationToExternalDimensions(records: readonly PipeInformationRecord[]): ExternalDimensionRecord[] {
  return records.map(record => {
    const id = `${PIPE_INFORMATION_SOURCE}:${record.refno}`;
    const target = record.anchorMm.map(value => value / 1000) as unknown as Vec3;
    const lines = [
      { text: `${record.stale ? '（过期）' : ''}${record.name}` },
      ...record.fields.map(item => ({ text: `${item.label}：${item.text}` })),
    ];
    return { id, source: PIPE_INFORMATION_SOURCE, sourceLabel: `${record.refno}@${record.sesno} 管道信息`, role: 'external-reference', category: 'annotation',
      layout: { id, role: 'external-reference', labelPinned: false, formattedLabel: record.name,
        lines: [], arrowLines: [], labelAnchor: [target[0], target[1] + 0.5, target[2] + 0.5],
        tag: { style: 'card', target, subject: record.refno, dot: true, lines } } };
  });
}

export function validatePipeInformationRecord(value: unknown): PipeInformationRecord {
  const record = value as PipeInformationRecord;
  if (!record || typeof record.refno !== 'string' || !/^\d+_\d+$/.test(record.refno)
    || typeof record.name !== 'string' || !Number.isSafeInteger(record.sesno) || record.sesno < 0
    || !finitePoint(record.anchorMm) || typeof record.fetchedAt !== 'string' || !Number.isFinite(Date.parse(record.fetchedAt))
    || !Array.isArray(record.fields) || record.fields.length > 32 || !record.fields.every(item => item
      && [item.key, item.label, item.text, item.source].every(value => typeof value === 'string')
      && ['read', 'derived', 'missing', 'unconfirmed'].includes(item.status))
    || !Array.isArray(record.warnings) || !record.warnings.every(item => typeof item === 'string')) throw new Error('管道信息保存格式无效');
  if (record.memberDiameters !== undefined && (!Array.isArray(record.memberDiameters) || !record.memberDiameters.every(member => member
    && typeof member.refno === 'string' && Number.isSafeInteger(member.order) && member.order >= 0
    && typeof member.noun === 'string' && typeof member.implicit === 'boolean' && typeof member.sourceText === 'string'
    && ['catalogue', 'bore-estimate', 'missing', 'unknown'].includes(member.source)
    && (member.outsideDiameterMm === null ? member.source === 'missing' : typeof member.outsideDiameterMm === 'number'
      && Number.isFinite(member.outsideDiameterMm) && member.outsideDiameterMm > 0 && member.source !== 'missing')))) throw new Error('成员外径保存格式无效');
  return { ...record, memberDiameters: record.memberDiameters ?? [], stale: true };
}
