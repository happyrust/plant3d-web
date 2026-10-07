import type { ExternalDimensionRecord } from './normalizeExternalDimensions';
import type { Vec3 } from '../kernel/types';
import type { ElementAttribute, ElementAttributesResponse, ModelBoundsResponse, SpatialCenterlineResponse } from '@/api/genModelV1Api';

export type PipeInformationField = { key: string; label: string; text: string; source: string; status: 'read' | 'derived' | 'missing' | 'unconfirmed' };
export type PipeInformationRecord = {
  refno: string; name: string; sesno: number; fetchedAt: string; stale: boolean;
  anchorMm: Vec3; fields: PipeInformationField[]; warnings: string[];
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
  const od = centerline?.outside_diameter_mm;
  const modelBox = bounds ? bounds.max_mm.map((value, axis) => mm(value - bounds.min_mm[axis]!)).join(' × ') : null;
  const fields = [
    field('head-bore', '首端通径', numericAttr('HBOR'), `${source}:HBOR`),
    field('tail-bore', '末端通径', numericAttr('TBOR'), `${source}:TBOR`),
    field('outer-diameter', '首个成员外径参考', typeof od === 'number' && Number.isFinite(od) && od > 0 ? mm(od) : null,
      '首个给出外径的成员；目录值或通径回退值，不能代表变径管道全部外径', 'unconfirmed'),
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
  warnings.push('外径参考可能含估算且只代表首个成员；几何会话尚未与属性会话核实，外径和模型盒不得作为专业包络验收值');
  for (const warning of centerline?.warnings ?? []) warnings.push(warning);
  return { refno, name: attributeText(attrs, 'NAME') ?? refno, sesno: attrs.sesno!, fetchedAt: new Date().toISOString(),
    stale: false, anchorMm: anchor, fields, warnings: [...new Set(warnings)] };
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
  return { ...record, stale: true };
}
