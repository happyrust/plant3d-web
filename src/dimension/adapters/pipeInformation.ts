import type { ExternalDimensionRecord } from './normalizeExternalDimensions';
import type { Vec3 } from '../kernel/types';
import type { ElementAttribute, ElementAttributesResponse, ModelBoundsResponse, SpatialCenterlineResponse } from '@/api/genModelV1Api';

export type PipeInformationField = { key: string; label: string; text: string; source: string; status: 'read' | 'derived' | 'missing' | 'unconfirmed' };
export type PipeMemberDiameter = {
  refno: string; order: number; noun: string; implicit: boolean; outsideDiameterMm: number | null;
  source: 'catalogue' | 'bore-estimate' | 'missing' | 'unknown'; sourceText: string;
};
export type PipeMemberMaterial = { refno: string; noun: string; implicit?: boolean; text: string; source: string; status: PipeInformationField['status'] };
export type PipeBendAngle = { refno: string; angleDeg: number | null; source: string };
export type PipeBendArc = { refno: string; noun: string; angleDeg: number | null; chordMm: number | null; radiusMm: number | null; arcMm: number | null; source: string };
export type PipeSegmentElevation = {
  refno: string; order: number; slope: 'horizontal' | 'vertical' | 'sloped'; startZ: number; endZ: number;
  outsideDiameterMm: number | null; topMm: number | null; bottomMm: number | null;
};
export type PipeInformationRecord = {
  refno: string; name: string; sesno: number; fetchedAt: string; stale: boolean;
  anchorMm: Vec3; fields: PipeInformationField[]; warnings: string[];
  memberDiameters?: PipeMemberDiameter[];
  sourceVersion?: NonNullable<SpatialCenterlineResponse['source_version']>;
  memberMaterials?: PipeMemberMaterial[];
  bendArcs?: PipeBendArc[];
  straightElevations?: PipeSegmentElevation[];
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
function validSourceVersion(version: NonNullable<SpatialCenterlineResponse['source_version']>): boolean {
  return Number.isSafeInteger(version.dbnum) && version.dbnum > 0 && Number.isSafeInteger(version.sesno) && version.sesno >= 0
    && Array.isArray(version.databases) && version.databases.every(database => Number.isSafeInteger(database.dbnum) && database.dbnum > 0
      && Number.isSafeInteger(database.sesno) && database.sesno >= 0 && typeof database.db_type === 'string')
    && new Set(version.databases.map(database => database.dbnum)).size === version.databases.length
    && version.databases.some(database => database.dbnum === version.dbnum && database.sesno === version.sesno);
}
export function buildPipeInformation(input: {
  refno: string; attributes: ElementAttributesResponse; centerline?: SpatialCenterlineResponse;
  bounds?: ModelBoundsResponse; material?: { text: string; source: string; status?: PipeInformationField['status'] }; warnings?: string[];
  memberMaterials?: PipeMemberMaterial[]; bendAngles?: PipeBendAngle[];
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
  const version = centerline?.source_version;
  if (version) {
    if (!validSourceVersion(version))
      throw new Error('中心线版本信息无效，不能合并当前属性');
    if (attrs.dbnum !== version.dbnum || attrs.sesno !== version.sesno || centerline!.dbnum !== version.dbnum)
      throw new Error(`属性与中心线版本不一致（属性 ${attrs.dbnum ?? '未知'}@${attrs.sesno}，中心线 ${version.dbnum}@${version.sesno}），请重新读取`);
  }
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
  const straightTotal = straight?.length && validLengths ? straight.reduce((sum, segment) => sum + segment.length_mm, 0) : null;
  // Arc from the member's own ANGL and its port-to-port chord: R = c / (2·sin(θ/2)), arc = R·θ.
  const bendArcs: PipeBendArc[] = [...new Map((centerline?.segments ?? [])
    .filter(segment => !segment.implicit && ['BEND', 'ELBO'].includes(segment.noun)).map(segment => [segment.refno, segment])).values()].map(segment => {
    const angle = input.bendAngles?.find(item => item.refno === segment.refno);
    const degrees = typeof angle?.angleDeg === 'number' && Number.isFinite(angle.angleDeg) ? angle.angleDeg : null;
    const ports = [segment.start, segment.end].every(point => point && [point.x, point.y, point.z].every(Number.isFinite));
    const chord = ports ? Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y, segment.end.z - segment.start.z) : null;
    const half = degrees !== null && degrees > 0 && degrees < 180 && chord !== null && chord > 0 ? degrees * Math.PI / 360 : null;
    const radius = half === null ? null : chord! / (2 * Math.sin(half));
    return { refno: segment.refno, noun: segment.noun, angleDeg: degrees, chordMm: chord, radiusMm: radius,
      arcMm: radius === null ? null : radius * half! * 2, source: angle ? `${angle.source} + 中心线端口弦长` : '未读到 ANGL' };
  });
  const missingArcs = bendArcs.filter(bend => bend.arcMm === null).length;
  if (missingArcs) warnings.push(`${missingArcs} 个弯头/弯管缺少有效角度或端口，不能计算含弯头弧长的管长`);
  const lengthWithBends = straightTotal !== null && !missingArcs ? straightTotal + bendArcs.reduce((sum, bend) => sum + bend.arcMm!, 0) : null;
  const finiteSegment = (segment: SpatialCenterlineResponse['segments'][number]) =>
    [segment.start, segment.end].every(point => point && [point.x, point.y, point.z].every(Number.isFinite));
  const centerlineZ = (centerline?.segments ?? []).filter(finiteSegment).flatMap(segment => [segment.start.z, segment.end.z]);
  // A straight tube's surface rises r·√(1 − dz²) above its axis: r for horizontal runs, 0 for vertical ones.
  const straightElevations = (straight ?? []).filter(finiteSegment).flatMap((segment): PipeSegmentElevation[] => {
    const delta = [segment.end.x - segment.start.x, segment.end.y - segment.start.y, segment.end.z - segment.start.z];
    const length = Math.hypot(...delta);
    if (!(length > 0)) return [];
    const dz = Math.abs(delta[2]!) / length;
    const od = segment.outside_diameter_mm;
    const outside = typeof od === 'number' && Number.isFinite(od) && od > 0 ? od : null;
    const rise = outside === null ? null : outside / 2 * Math.sqrt(Math.max(0, 1 - dz * dz));
    return [{ refno: segment.refno, order: segment.order, slope: dz < 1e-4 ? 'horizontal' : dz > 1 - 1e-9 ? 'vertical' : 'sloped',
      startZ: segment.start.z, endZ: segment.end.z, outsideDiameterMm: outside,
      topMm: rise === null ? null : Math.max(segment.start.z, segment.end.z) + rise,
      bottomMm: rise === null ? null : Math.min(segment.start.z, segment.end.z) - rise }];
  });
  const sized = straightElevations.filter(item => item.topMm !== null);
  const topBottomText = sized.length ? `管顶最高 ${mm(Math.max(...sized.map(item => item.topMm!)))}，管底最低 ${mm(Math.min(...sized.map(item => item.bottomMm!)))}（${sized.length}/${straightElevations.length}段）` : null;
  // Field text is drawn with the bundled LFF font, which has no glyph for the full-width semicolon.
  let versionText = version ? `属性与中心线同版本（${version.dbnum}@${version.sesno}），模型版本待核实` : '中心线未提供版本，属性/几何对应关系待核实';
  if (bounds?.record_source_sessions) {
    const sessions = bounds.record_source_sessions;
    if (!Array.isArray(sessions) || !sessions.every(item => Number.isSafeInteger(item.dbnum) && item.dbnum > 0
      && Number.isSafeInteger(item.sesno) && item.sesno >= 0)) throw new Error('模型记录版本信息无效');
    const different = sessions.some(item => item.dbnum === attrs.dbnum && item.sesno !== attrs.sesno);
    const text = sessions.map(item => `${item.dbnum}@${item.sesno}`).join('、');
    versionText += `，模型记录来源 ${text || '未知'}${different ? '（不同版本）' : '（发布完整性未核实）'}`;
    if (different) warnings.push('模型边界包含不同源版本的生成记录，不能作为本版包络验收值');
  }
  const fields = [
    field('head-bore', '首端通径', numericAttr('HBOR'), `${source}:HBOR`),
    field('tail-bore', '末端通径', numericAttr('TBOR'), `${source}:TBOR`),
    field('outer-diameter', '成员外径范围', rangeText, '逐段读取；详情区分管子目录值、通径估算及缺失，不包含构件实体最大包络',
      memberDiameters.length && memberDiameters.every(member => member.source === 'catalogue') ? 'read' : 'unconfirmed'),
    field('material', '业务材质', input.material?.text ?? attributeText(attrs, 'MATN'), input.material?.source ?? `${source}:MATN/MATR`, input.material?.status ?? 'read'),
    field('insulation', '保温规格', attributeText(attrs, 'ISPE'), `${source}:ISPE（规格参考号）`),
    field('envelope', '业务包络', '口径待确认（是否含保温/操作空间）', '专业确认', 'unconfirmed'),
    field('model-bounds', '模型包围尺寸', modelBox, bounds?.source ?? '未生成模型', 'unconfirmed'),
    field('straight-length', '直管段总长', straightTotal === null ? null : mm(straightTotal),
      '中心线的隐式直段和 TUBI/FTUB；不含弯头弧长', 'derived'),
    field('length-with-bends', '管长（含弯头）', lengthWithBends === null ? null : mm(lengthWithBends),
      `直管段总长 + ${bendArcs.length} 个 BEND/ELBO 弧长（ANGL 与端口弦长推算）；不含阀门等其他管件，完整管长口径待专业确认`, 'unconfirmed'),
    field('elevation', '标注锚点标高', mm(anchor[2]), 'E3D 世界 Z，非管顶/管底', 'derived'),
    field('centerline-elevation', '中心线标高范围', centerlineZ.length ? `${mm(Math.min(...centerlineZ))} ～ ${mm(Math.max(...centerlineZ))}` : null,
      'E3D 世界 Z，全部中心线端点（含管件端口）', 'derived'),
    field('top-bottom-elevation', '管顶/管底标高', topBottomText,
      '直管段中心线 ± 外径/2 × √(1 − 轴向竖直分量²)；外径为逐段目录/估算值，管件实体外形未计入；业务标高取轴线、管顶或管底待专业确认', 'unconfirmed'),
    field('coordinates', '标注锚点坐标', anchor.map(mm).join(', '), 'E3D 世界 X/Y/Z', 'derived'),
    field('source-version', '版本核对', versionText, '属性/中心线实读会话；模型记录会话不替代完整生成及发布回执', 'unconfirmed'),
  ];
  if (input.memberMaterials?.length) {
    const members = input.memberMaterials;
    const names = [...new Set(members.filter(member => member.status === 'read').map(member => member.text))];
    const count = members.filter(member => member.status === 'read').length;
    fields.push(field('member-materials', '成员材质', names.length ? `${names.join('、')}（${count}/${members.length}段）` : null,
      '成员 MATN/MATR 优先，未设置时取自身规格 SPRE→MATX→SMTE:XTEX；隐式直管取 BRAN HSTU 或上游成员 LSTU 的同一规格链；不推断继承 BRAN/PIPE 材质',
      count === members.length ? 'read' : 'unconfirmed'));
  }
  if (bounds?.stale) warnings.push('模型包围尺寸来源已过期，请重新生成模型');
  if (memberDiameters.some(member => member.source !== 'catalogue')) warnings.push('部分成员外径为估算、来源未核实或缺失；不可据此完成外径验收');
  warnings.push('外径是各槽位管子目录参考，非管件实体最大包络；模型发布及目录依赖对应关系尚需核实，外径和模型盒不得作为专业包络验收值');
  for (const warning of centerline?.warnings ?? []) warnings.push(warning);
  return { refno, name: attributeText(attrs, 'NAME') ?? refno, sesno: attrs.sesno!, fetchedAt: new Date().toISOString(),
    stale: false, anchorMm: anchor, fields, memberDiameters, memberMaterials: input.memberMaterials, bendArcs, straightElevations,
    sourceVersion: version ?? undefined, warnings: [...new Set(warnings)] };
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
  if (record.sourceVersion && (!validSourceVersion(record.sourceVersion) || record.sourceVersion.sesno !== record.sesno)) throw new Error('管道版本保存格式无效');
  if (record.memberMaterials !== undefined && (!Array.isArray(record.memberMaterials) || !record.memberMaterials.every(member => member
    && [member.refno, member.noun, member.text, member.source].every(value => typeof value === 'string')
    && (member.implicit === undefined || typeof member.implicit === 'boolean')
    && ['read', 'derived', 'missing', 'unconfirmed'].includes(member.status)))) throw new Error('成员材质保存格式无效');
  if (record.bendArcs !== undefined && (!Array.isArray(record.bendArcs) || !record.bendArcs.every(bend => bend
    && [bend.refno, bend.noun, bend.source].every(value => typeof value === 'string')
    && [bend.angleDeg, bend.chordMm, bend.radiusMm, bend.arcMm].every(value => value === null || (typeof value === 'number' && Number.isFinite(value))))))
    throw new Error('弯头弧长保存格式无效');
  if (record.straightElevations !== undefined && (!Array.isArray(record.straightElevations) || !record.straightElevations.every(item => item
    && typeof item.refno === 'string' && Number.isSafeInteger(item.order) && ['horizontal', 'vertical', 'sloped'].includes(item.slope)
    && [item.startZ, item.endZ].every(Number.isFinite)
    && [item.outsideDiameterMm, item.topMm, item.bottomMm].every(value => value === null || (typeof value === 'number' && Number.isFinite(value))))))
    throw new Error('直管段标高保存格式无效');
  return { ...record, memberDiameters: record.memberDiameters ?? [], stale: true };
}
