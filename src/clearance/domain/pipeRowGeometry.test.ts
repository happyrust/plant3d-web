import { describe, expect, it } from 'vitest';

import type { SpatialCenterlineSegment } from '@/api/genModelV1Api';
import type { PipeRowRunInput } from '@/clearance/domain/pipeRowGeometry';

import {
  detectPipeRows,
  isFormalPipeRowGroup,
  runAnchorRefno,
} from '@/clearance/domain/pipeRowGeometry';
import {
  buildStraightRuns,
  type BranCenterlineInput,
  type OutsideDiameterEvidence,
  type Vec3Mm,
} from '@/composables/branParallelSpacing';

type P = [number, number, number];

/** 手搓直段（跳过中心线）：锚点 refno 经 segments[0] 提供。 */
function fakeRun(
  branRefno: string,
  anchor: string,
  start: Vec3Mm,
  end: Vec3Mm,
  odMm: number | null = 114.3,
  odEvidence: OutsideDiameterEvidence = 'catalogue',
): PipeRowRunInput {
  const len = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  return {
    branRefno,
    run: {
      branRefno,
      start,
      end,
      direction: { x: (end.x - start.x) / len, y: (end.y - start.y) / len, z: (end.z - start.z) / len },
      lengthMm: len,
      segments: [seg(anchor, 0, [start.x, start.y, start.z], [end.x, end.y, end.z], { outside_diameter_mm: odMm })],
      outsideDiameterMm: odMm,
      odEvidence,
    },
  };
}

function seg(
  refno: string,
  order: number,
  start: P,
  end: P,
  extra: Partial<Pick<SpatialCenterlineSegment, 'noun' | 'implicit' | 'outside_diameter_mm' | 'diameter_evidence'>> = {},
): SpatialCenterlineSegment {
  const implicit = extra.implicit ?? refno.includes('~');
  return {
    refno,
    order,
    noun: extra.noun ?? (implicit ? 'TUBI' : 'UNKNOWN'),
    implicit,
    start: { x: start[0], y: start[1], z: start[2] },
    end: { x: end[0], y: end[1], z: end[2] },
    length_mm: Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]),
    outside_diameter_mm: extra.outside_diameter_mm ?? null,
    diameter_evidence: extra.diameter_evidence,
  };
}

function catalogueEvidence(od: number): SpatialCenterlineSegment['diameter_evidence'] {
  return { source: 'catalogue', catalogue_od_mm: od, arrive_bore_mm: null };
}

/** 单根沿 x 的直管 BRAN：一根隐式管身一段。 */
function straightBran(refno: string, y: number, z: number, x0 = 0, x1 = 3000, odMm = 114.3): PipeRowRunInput[] {
  const centerline: BranCenterlineInput = {
    refno,
    outside_diameter_mm: odMm,
    segments: [seg(`${refno}~b`, 0, [x0, y, z], [x1, y, z], { outside_diameter_mm: odMm, diameter_evidence: catalogueEvidence(odMm) })],
  };
  return buildStraightRuns(centerline, { maxJointGapMm: 1 }).map(run => ({ branRefno: refno, run }));
}

/** 指定逐段外径证据的直管（catalogue / bore-estimate / missing / unverified）。 */
function straightBranWithEvidence(
  refno: string,
  y: number,
  z: number,
  odMm: number | null,
  evidence: OutsideDiameterEvidence,
): PipeRowRunInput[] {
  const diameterEvidence: SpatialCenterlineSegment['diameter_evidence'] =
    evidence === 'catalogue' ? { source: 'catalogue', catalogue_od_mm: odMm, arrive_bore_mm: null }
      : evidence === 'bore-estimate' ? { source: 'bore-estimate', catalogue_od_mm: null, arrive_bore_mm: odMm }
        : evidence === 'missing' ? { source: 'missing', catalogue_od_mm: null, arrive_bore_mm: null }
          : null; // unverified：OD 有值但服务端没给证据
  const centerline: BranCenterlineInput = {
    refno,
    outside_diameter_mm: odMm,
    segments: [seg(`${refno}~b`, 0, [0, y, z], [3000, y, z], { outside_diameter_mm: odMm, diameter_evidence: diameterEvidence })],
  };
  return buildStraightRuns(centerline, { maxJointGapMm: 1 }).map(run => ({ branRefno: refno, run }));
}

function pairKeys(detection: ReturnType<typeof detectPipeRows>): string[] {
  return detection.groups.flatMap(g => g.pairs.map(p => p.pairKey)).sort();
}

describe('detectPipeRows：管中心成排', () => {
  it('R01：一排 4 根平行等径管 → 3 对相邻，不全连接', () => {
    const inputs = [0, 200, 400, 600].flatMap((y, i) => straightBran(`b${i}`, y, 0));
    const detection = detectPipeRows(inputs, { alignMode: 'center' });

    expect(detection.groups).toHaveLength(1);
    const group = detection.groups[0]!;
    // 排向坐标 = 截面二维坐标（e2 取 −y）：y 大者排前
    expect(group.members.map(m => m.branRefno)).toEqual(['b3', 'b2', 'b1', 'b0']);
    expect(group.pairs).toHaveLength(3);
    for (const pair of group.pairs) {
      expect(pair.centerDistanceMm).toBeCloseTo(200, 6);
      expect(pair.signedGapMm).toBeCloseTo(200 - 114.3, 6);
      expect(pair.gapEstimated).toBe(false);
    }
    // 相邻按排向坐标，不是点选顺序：输入顺序打乱结果一致
    const shuffled = [...inputs].reverse();
    const again = detectPipeRows(shuffled, { alignMode: 'center' });
    expect(pairKeys(again)).toEqual(pairKeys(detection));
    expect(again.groups[0]!.key).toBe(group.key);
  });

  it('R02：两排各 3 根管 → 每排 2 对、不跨排串联；并行两排不误报歧义', () => {
    const lower = [0, 200, 400].flatMap((y, i) => straightBran(`l${i}`, y, 0));
    const upper = [50, 250, 450].flatMap((y, i) => straightBran(`u${i}`, y, 1000));
    const detection = detectPipeRows([...lower, ...upper], { alignMode: 'center' });

    expect(detection.groups).toHaveLength(2);
    for (const group of detection.groups) {
      expect(group.members).toHaveLength(3);
      expect(group.pairs).toHaveLength(2);
      expect(group.ambiguous).toBe(false);
    }
    const keys = pairKeys(detection);
    expect(keys.every(k => !k.includes('l') || !k.includes('u'))).toBe(true);
  });

  it('R03：打乱输入顺序相邻关系与身份键不变', () => {
    const inputs = [0, 300, 600, 900].flatMap((y, i) => straightBran(`p${i}`, y, 0));
    const base = detectPipeRows(inputs, { alignMode: 'center' });
    const rotated = detectPipeRows([...inputs.slice(2), ...inputs.slice(0, 2)], { alignMode: 'center' });
    expect(pairKeys(rotated)).toEqual(pairKeys(base));
    expect(rotated.groups.map(g => g.key)).toEqual(base.groups.map(g => g.key));
  });

  it('R05：A/B 前半段重叠、B/C 后半段重叠 → 不伪造三管共同截面', () => {
    const inputs = [
      ...straightBran('a', 0, 0, 0, 1000),
      ...straightBran('b', 200, 0, 500, 1500),
      ...straightBran('c', 400, 0, 1000, 2000),
    ];
    const detection = detectPipeRows(inputs, { alignMode: 'center' });
    expect(pairKeys(detection)).toEqual(['a~b|b~b', 'b~b|c~b']);
    expect(detection.sections).toHaveLength(2);
  });

  it('R10：容差内轻微夹角同组；方向写反的直段按无向归一仍同组', () => {
    const inputs = [
      ...straightBran('m0', 0, 0, 0, 3000),
      ...straightBran('m1', 200, 0),
      ...straightBran('m2', 400, 0),
    ];
    // m1 的中心线方向写反（end<->start），归一化后仍是同一无向方向
    const reversed: PipeRowRunInput = {
      branRefno: 'm1',
      run: { ...inputs[1]!.run, direction: { x: -1, y: 0, z: 0 } },
    };
    const detection = detectPipeRows([inputs[0]!, reversed, inputs[2]!], { alignMode: 'center' });
    expect(detection.groups).toHaveLength(1);
    expect(detection.groups[0]!.pairs).toHaveLength(2);
  });

  it('R08 管底对齐：半径 10 / 40、横向 40 → 中心距 50、推导间隔 0', () => {
    // 管底齐平：A 中心 z=10（OD 20），B 中心 z=40（OD 80），横向 y 差 40
    const a = fakeRun('a', 'a~1', { x: 0, y: 0, z: 10 }, { x: 3000, y: 0, z: 10 }, 20);
    const b = fakeRun('b', 'b~1', { x: 0, y: 40, z: 40 }, { x: 3000, y: 40, z: 40 }, 80);
    const detection = detectPipeRows([a, b], { alignMode: 'bottom', supportNormal: { x: 0, y: 0, z: 1 } });
    expect(detection.supportNormalDegenerate).toBe(false);
    expect(detection.groups).toHaveLength(1);
    const pair = detection.groups[0]!.pairs[0]!;
    expect(pair.centerDistanceMm).toBeCloseTo(50, 6);
    expect(pair.signedGapMm).toBeCloseTo(0, 6);
  });

  it('R11：主管向近铅直 + 管底模式 → 支承法向退化，要求人工指定', () => {
    const vertical = (refno: string, x: number) =>
      fakeRun(refno, `${refno}~1`, { x, y: 0, z: 0 }, { x, y: 0, z: 3000 });
    const detection = detectPipeRows([vertical('v0', 0), vertical('v1', 300)], { alignMode: 'bottom' });
    expect(detection.supportNormalDegenerate).toBe(true);
    expect(detection.groups).toHaveLength(0);
    // 人工指定支承法向后可解
    const fixed = detectPipeRows([vertical('v0', 0), vertical('v1', 300)], {
      alignMode: 'bottom',
      supportNormal: { x: 0, y: 1, z: 0 },
    });
    expect(fixed.supportNormalDegenerate).toBe(false);
    expect(fixed.groups.flatMap(g => g.pairs)).toHaveLength(1);
  });

  it('R09：中心重合 / 推导间隔为负 → 保留有符号名义重叠', () => {
    // 两根同 y/z、不同 x 段的管：截面内中心点重合
    const inputs = [
      ...straightBran('o0', 0, 0, 0, 2000),
      ...straightBran('o1', 0, 0, 500, 3000),
    ];
    const detection = detectPipeRows(inputs, { alignMode: 'center' });
    const pair = detection.groups[0]?.pairs[0];
    expect(pair).toBeDefined();
    expect(pair!.centerDistanceMm).toBeCloseTo(0, 6);
    expect(pair!.signedGapMm).toBeCloseTo(-114.3, 6);
    expect(detection.groups[0]!.ambiguous).toBe(true); // 中心重合的退化排标歧义
  });

  it('R07：逐段外径缺失 → 中心距照算，推导间隔 null；unverified 外径不当推导依据', () => {
    const inputs = [
      ...straightBranWithEvidence('k0', 0, 0, 114.3, 'catalogue'),
      ...straightBranWithEvidence('k1', 200, 0, null, 'missing'),
      ...straightBranWithEvidence('k2', 400, 0, 200, 'unverified'),
      ...straightBranWithEvidence('k3', 600, 0, 60.3, 'bore-estimate'),
    ];
    const detection = detectPipeRows(inputs, { alignMode: 'center' });
    const pairs = detection.groups[0]!.pairs;
    expect(pairs).toHaveLength(3);
    // 排内次序沿 −y：k3|k2、k2|k1、k1|k0
    // k3(bore-estimate)|k2(unverified)：k2 外径 200mm 来源不可证 → 间隔不可得
    expect(pairs[0]!.signedGapMm).toBeNull();
    expect(pairs[0]!.gapEstimated).toBe(true);
    // k2|k1、k1|k0：一侧 missing / unverified → null
    expect(pairs[1]!.signedGapMm).toBeNull();
    expect(pairs[1]!.gapEstimated).toBe(false);
    expect(pairs[2]!.signedGapMm).toBeNull();
    // 但中心距照算
    for (const pair of pairs) expect(pair.centerDistanceMm).toBeCloseTo(200, 6);
  });

  it('同一 BRAN 的两条不同直段（U 形回折腿）允许成相邻对', () => {
    const centerline: BranCenterlineInput = {
      refno: 'u0',
      outside_diameter_mm: 114.3,
      segments: [
        seg('u0~a', 0, [0, 0, 0], [3000, 0, 0], { outside_diameter_mm: 114.3, diameter_evidence: catalogueEvidence(114.3) }),
        seg('u0_elbo', 1, [3000, 0, 0], [3000, 200, 0], { noun: 'ELBO', implicit: false }),
        seg('u0~c', 2, [3000, 200, 0], [0, 200, 0], { outside_diameter_mm: 114.3, diameter_evidence: catalogueEvidence(114.3) }),
      ],
    };
    const runs = buildStraightRuns(centerline, { maxJointGapMm: 1 });
    expect(runs).toHaveLength(2);
    const detection = detectPipeRows(runs.map(run => ({ branRefno: 'u0', run })), { alignMode: 'center' });
    expect(detection.groups.flatMap(g => g.pairs)).toHaveLength(1);
    expect(detection.groups[0]!.pairs[0]!.centerDistanceMm).toBeCloseTo(200, 6);
  });

  it('网格状 2×2 排布 → 歧义标记进预览，不强行压成一维排序', () => {
    const inputs = [
      ...straightBran('g0', 0, 0),
      ...straightBran('g1', 200, 0),
      ...straightBran('g2', 0, 200),
      ...straightBran('g3', 200, 200),
    ];
    const detection = detectPipeRows(inputs, { alignMode: 'center' });
    expect(detection.groups.every(g => g.ambiguous)).toBe(true);
    expect(detection.groups.some(isFormalPipeRowGroup)).toBe(false);
  });

  it('同一截面里两排、其中一排有根管半途结束 → 两排都跨区段合并，留下的相邻对不因成员退出而重复量', () => {
    const rowA = [0, 300, 600].flatMap((y, i) => straightBran(`a${i}`, y, 0, 0, 10000));
    const rowB = [
      ...straightBran('b0', 0, 1000, 0, 10000),
      ...straightBran('b1', 300, 1000, 0, 10000),
      ...straightBran('b2', 600, 1000, 0, 5000),
    ];
    const detection = detectPipeRows([...rowA, ...rowB], { alignMode: 'center' });
    expect(detection.sections).toHaveLength(2);
    expect(detection.groups.every(isFormalPipeRowGroup)).toBe(true);

    const rowAGroups = detection.groups.filter(g => g.members.every(m => m.branRefno.startsWith('a')));
    expect(rowAGroups).toHaveLength(1);
    expect(rowAGroups[0]!.section.axialStartMm).toBeCloseTo(0, 6);
    expect(rowAGroups[0]!.section.axialEndMm).toBeCloseTo(10000, 6);
    expect(rowAGroups[0]!.pairs).toHaveLength(2);
    // B 排：b2 在 5000 处结束，b1–b2 只量 [0,5000]；b0–b1 在两段里一直相邻，合成一条 [0,10000]
    expect(detection.groups).toHaveLength(2);
    const rowBGroup = detection.groups.find(g => g.members.some(m => m.branRefno === 'b2'))!;
    expect(Object.fromEntries(rowBGroup.pairs.map(p => [p.pairKey, [p.section.axialStartMm, p.section.axialEndMm]]))).toEqual({
      'b0~b|b1~b': [0, 10000],
      'b1~b|b2~b': [0, 5000],
    });
  });

  it('管廊里起点错开的 4 根管 → 一排 3 对，每对只量一次，截面点落在两管中心中点（§5.6）', () => {
    const inputs = [
      ...straightBran('s0', 0, 0, 0, 6000),
      ...straightBran('s1', 200, 0, 0, 6000),
      ...straightBran('s2', 400, 0, 1500, 6000),
      ...straightBran('s3', 600, 0, 3000, 6000),
    ];
    const detection = detectPipeRows(inputs, { alignMode: 'center' });
    expect(detection.sections).toHaveLength(3);
    expect(detection.groups).toHaveLength(1);
    const group = detection.groups[0]!;
    expect(isFormalPipeRowGroup(group)).toBe(true);
    expect(group.members.map(m => m.branRefno)).toEqual(['s3', 's2', 's1', 's0']);
    expect(Object.fromEntries(group.pairs.map(p => [p.pairKey, [p.section.axialStartMm, p.section.axialEndMm]]))).toEqual({
      's0~b|s1~b': [0, 6000],
      's1~b|s2~b': [1500, 6000],
      's2~b|s3~b': [3000, 6000],
    });
    for (const pair of group.pairs) expect(pair.centerDistanceMm).toBeCloseTo(200, 6);
    const s1s2 = group.pairs.find(p => p.pairKey === 's1~b|s2~b')!;
    expect(s1s2.section.sectionT).toBeCloseTo(3750, 6);
    expect(s1s2.section.origin).toEqual({ x: 3750, y: 300, z: 0 });
  });

  it('剥离主排后剩下两根不相干的管 → 不凭两点成排出正式结果；与主排平行的第二层两根照常成排', () => {
    const mainRow = [0, 300, 600].flatMap((y, i) => straightBran(`r${i}`, y, 0));
    // 一高一低、横向错开的两根：连线与主排不平行
    const strays = [...straightBran('x0', 1500, 800), ...straightBran('x1', 3000, 1400)];
    const detection = detectPipeRows([...mainRow, ...strays], { alignMode: 'center' });
    const main = detection.groups.find(g => g.members.some(m => m.branRefno === 'r0'))!;
    const stray = detection.groups.find(g => g.members.some(m => m.branRefno === 'x0'))!;
    expect(isFormalPipeRowGroup(main)).toBe(true);
    expect(main.pairs).toHaveLength(2);
    expect(stray.ambiguous).toBe(true);
    expect(stray.diagnostics.some(d => d.includes('只凭两点连线成排'))).toBe(true);

    const tier = [...straightBran('t0', 0, 1000), ...straightBran('t1', 300, 1000)];
    const tiered = detectPipeRows([...mainRow, ...tier], { alignMode: 'center' });
    expect(tiered.groups).toHaveLength(2);
    expect(tiered.groups.every(isFormalPipeRowGroup)).toBe(true);
  });

  it('截面内两管中心相距不到成排偏差（共轴 / 重复建模）→ 标歧义，不出正式结果', () => {
    const detection = detectPipeRows([...straightBran('c0', 0, 0), ...straightBran('c1', 0.5, 0)], { alignMode: 'center' });
    expect(detection.groups).toHaveLength(1);
    expect(isFormalPipeRowGroup(detection.groups[0]!)).toBe(false);
    expect(detection.groups[0]!.pairs[0]!.centerDistanceMm).toBeCloseTo(0.5, 6);
  });

  it('管底对齐按估算外径（孔径估算 / 旧服务端成员外径）归的排 → estimatedGrouping，待人工确认（§4.2）', () => {
    const a = fakeRun('a', 'a~1', { x: 0, y: 0, z: 10 }, { x: 3000, y: 0, z: 10 }, 20, 'legacy-member');
    const b = fakeRun('b', 'b~1', { x: 0, y: 40, z: 40 }, { x: 3000, y: 40, z: 40 }, 80, 'bore-estimate');
    const bottom = detectPipeRows([a, b], { alignMode: 'bottom' });
    expect(bottom.groups[0]!.estimatedGrouping).toBe(true);
    expect(isFormalPipeRowGroup(bottom.groups[0]!)).toBe(false);
    expect(bottom.groups[0]!.pairs[0]!.signedGapMm).toBeCloseTo(0, 6);
    expect(bottom.groups[0]!.pairs[0]!.gapEstimated).toBe(true);
    // 中心模式归排不看外径：同样的估算外径只让推导间隔带估算标记，不挡正式结果
    const center = detectPipeRows([a, b], { alignMode: 'center' });
    expect(isFormalPipeRowGroup(center.groups[0]!)).toBe(true);
    expect(center.groups[0]!.pairs[0]!.gapEstimated).toBe(true);
  });

  it('R11：竖管组用人工指定的竖管支承法向，水平管组照旧按世界向上归排', () => {
    const vertical = (refno: string, x: number) => fakeRun(refno, `${refno}~1`, { x, y: 0, z: 0 }, { x, y: 0, z: 3000 });
    const horizontal = (refno: string, y: number) => fakeRun(refno, `${refno}~1`, { x: 0, y, z: 0 }, { x: 3000, y, z: 0 });
    const inputs = [vertical('v0', 0), vertical('v1', 300), horizontal('h0', 5000), horizontal('h1', 5300)];
    const unresolved = detectPipeRows(inputs, { alignMode: 'bottom' });
    expect(unresolved.supportNormalDegenerate).toBe(true);
    expect(unresolved.groups.flatMap(g => g.members.map(m => m.branRefno)).sort()).toEqual(['h0', 'h1']);
    const resolved = detectPipeRows(inputs, { alignMode: 'bottom', fallbackSupportNormal: { x: 0, y: 1, z: 0 } });
    expect(resolved.supportNormalDegenerate).toBe(false);
    expect(resolved.groups).toHaveLength(2);
    expect(resolved.groups.map(g => g.members.map(m => m.branRefno).sort())).toEqual(expect.arrayContaining([['h0', 'h1'], ['v0', 'v1']]));
    expect(resolved.groups.every(isFormalPipeRowGroup)).toBe(true);
  });

  it('同一 BRAN 首尾搭接的两条直段在截面里重合 → 当同一根管，不和邻管凑出退化的待确认排', () => {
    const detection = detectPipeRows([
      fakeRun('q', 'q~1', { x: 0, y: 0, z: 0 }, { x: 1000, y: 0, z: 0 }),
      fakeRun('q', 'q~2', { x: 995, y: 0, z: 0 }, { x: 2000, y: 0, z: 0 }),
      fakeRun('w', 'w~1', { x: 0, y: 300, z: 0 }, { x: 2000, y: 300, z: 0 }),
    ], { alignMode: 'center' });
    expect(detection.groups.every(isFormalPipeRowGroup)).toBe(true);
    expect(detection.groups.flatMap(g => g.pairs.map(p => p.pairKey)).sort()).toEqual(['q~1|w~1', 'q~2|w~1']);
  });

  it('设了排内相邻上限：两组管廊之间的空档不量，在此断开成两排', () => {
    const rackA = [0, 300, 600].flatMap((y, i) => straightBran(`a${i}`, y, 0));
    const rackB = [5400, 5700].flatMap((y, i) => straightBran(`b${i}`, y, 0));
    const unlimited = detectPipeRows([...rackA, ...rackB], { alignMode: 'center' });
    expect(unlimited.groups.flatMap(g => g.pairs)).toHaveLength(4);
    const limited = detectPipeRows([...rackA, ...rackB], { alignMode: 'center', maxAdjacentCenterDistanceMm: 2000 });
    expect(limited.groups.map(g => g.pairs.length).sort()).toEqual([1, 2]);
    expect(limited.groups.every(isFormalPipeRowGroup)).toBe(true);
    expect(limited.sections[0]!.diagnostics.some(d => d.includes('超过相邻上限'))).toBe(true);
  });
});

describe('buildStraightRuns：端点连接检查与诊断', () => {
  it('R06：同轴但中心线存在缺口 → 不跨空档合并，报 joint-gap 断链', () => {
    const gapped: BranCenterlineInput = {
      refno: 'g',
      outside_diameter_mm: 114.3,
      segments: [
        seg('g~a', 0, [0, 0, 0], [800, 0, 0]),
        // 缺了 [800,1000] 区间的成员：下一根直接从 1000 起
        seg('g~b', 1, [1000, 0, 0], [2000, 0, 0]),
      ],
    };
    const diagnostics: string[] = [];
    const runs = buildStraightRuns(gapped, {
      maxJointGapMm: 1,
      onDiagnostic: d => diagnostics.push(`${d.kind}:${d.reason}`),
    });
    expect(runs).toHaveLength(2);
    expect(diagnostics).toContain('chain-break:joint-gap');
    // 不设连接容差保持旧行为：共线同径照旧合并
    expect(buildStraightRuns(gapped)).toHaveLength(1);
  });

  it('零长穿过件不制造假断链；无效段跳过有诊断', () => {
    const diagnostics: string[] = [];
    const runs = buildStraightRuns({
      refno: 't',
      outside_diameter_mm: 114.3,
      segments: [
        seg('t~a', 0, [0, 0, 0], [500, 0, 0]),
        seg('t_instr', 1, [500, 0, 0], [500, 0, 0], { noun: 'INST', implicit: false }), // 穿过件 start==end
        seg('t~b', 2, [500, 0, 0], [1500, 0, 0]),
      ],
    }, { maxJointGapMm: 1, onDiagnostic: d => diagnostics.push(`${d.kind}:${d.reason}`) });
    expect(runs).toHaveLength(1);
    expect(diagnostics).toContain('segment-skipped:too-short');
  });
});
