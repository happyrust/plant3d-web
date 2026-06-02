import { describe, expect, it } from 'vitest';

import {
  assertNever,
  isAidArc,
  isAidCircle,
  isAidLine,
  isAidPoint,
  isAidText,
  isLabel,
  isLeaderLine,
  isSlopeMark,
  isWeldMark,
  MBD_V2_PRIMITIVE_KINDS,
  primitiveId,
  primitiveVisible,
  type AidArcPrimitive,
  type AidCirclePrimitive,
  type AidLinePrimitive,
  type AidPointPrimitive,
  type AidTextPrimitive,
  type LabelPrimitive,
  type LeaderLinePrimitive,
  type MbdPrimitive,
  type MbdV2PipeData,
  type SlopeMarkPrimitive,
  type WeldMarkPrimitive,
} from './mbdV2';

/**
 * P0-B / MBD V2 Phase 1 类型契约测试。
 *
 * 目标：
 * - 验证类型守卫覆盖全部 9 种 primitive
 * - 验证 JSON.parse/stringify 往返保持结构
 * - 验证 `MBD_V2_PRIMITIVE_KINDS` 与类型守卫对齐
 * - 保证 `switch` 穷举触发 `assertNever`
 */

function commonFields(id: string) {
  return {
    id,
    node_names: [] as string[],
    visible: true,
  };
}

const sampleLabel: LabelPrimitive = {
  ...commonFields('lbl-1'),
  kind: 'label',
  anchor: [0, 0, 0],
  text_anchor: [10, 10, 0],
  content: 'T1',
  height_mm: 2.5,
  orientation: [1, 0, 0],
  up: [0, 1, 0],
  box_shape: 'none',
  box_padding_mm: 0,
};

const sampleLeaderLine: LeaderLinePrimitive = {
  ...commonFields('leader-1'),
  kind: 'leader_line',
  points: [[0, 0, 0], [10, 10, 0]],
  arrow_at: 'end',
};

const sampleAidLine: AidLinePrimitive = {
  ...commonFields('aid-line-1'),
  kind: 'aid_line',
  points: [[0, 0, 0], [100, 0, 0]],
  style: 'dashed',
};

const sampleAidArc: AidArcPrimitive = {
  ...commonFields('aid-arc-1'),
  kind: 'aid_arc',
  center: [0, 0, 0],
  radius_mm: 30,
  start_angle_rad: 0,
  sweep_rad: Math.PI,
  normal: [0, 0, 1],
};

const sampleAidCircle: AidCirclePrimitive = {
  ...commonFields('aid-circle-1'),
  kind: 'aid_circle',
  center: [0, 0, 0],
  radius_mm: 40,
  normal: [0, 0, 1],
};

const sampleAidPoint: AidPointPrimitive = {
  ...commonFields('aid-point-1'),
  kind: 'aid_point',
  position: [1, 2, 3],
  diameter_mm: 100,
};

const sampleAidText: AidTextPrimitive = {
  ...commonFields('aid-text-1'),
  kind: 'aid_text',
  position: [0, 0, 0],
  content: 'NOTE',
  height_mm: 2.5,
  orientation: [1, 0, 0],
  up: [0, 1, 0],
};

const sampleWeldMark: WeldMarkPrimitive = {
  ...commonFields('w-1'),
  kind: 'weld_mark',
  position: [0, 0, 0],
  cross_size_mm: 50,
  weld_type: 'shop',
};

const sampleSlopeMark: SlopeMarkPrimitive = {
  ...commonFields('s-1'),
  kind: 'slope_mark',
  start: [0, 0, 0],
  end: [1000, 10, 0],
  slope: 0.01,
  text: {
    anchor: [500, 5, 0],
    content: 'slope 1.0%',
    height_mm: 2.5,
    orientation: [1, 0, 0],
    up: [0, 1, 0],
  },
};

const samples: MbdPrimitive[] = [
  sampleLabel,
  sampleLeaderLine,
  sampleAidLine,
  sampleAidArc,
  sampleAidCircle,
  sampleAidPoint,
  sampleAidText,
  sampleWeldMark,
  sampleSlopeMark,
];

describe('mbdV2 primitive types', () => {
  it('MBD_V2_PRIMITIVE_KINDS 覆盖 9 种 primitive 与样本一一对应', () => {
    expect(MBD_V2_PRIMITIVE_KINDS.length).toBe(9);
    const sampleKinds = new Set(samples.map((p) => p.kind));
    expect(sampleKinds.size).toBe(9);
    for (const kind of MBD_V2_PRIMITIVE_KINDS) {
      expect(sampleKinds.has(kind)).toBe(true);
    }
  });

  it('类型守卫对样本列表正确分流', () => {
    expect(samples.filter(isLabel).length).toBe(1);
    expect(samples.filter(isLeaderLine).length).toBe(1);
    expect(samples.filter(isAidLine).length).toBe(1);
    expect(samples.filter(isAidArc).length).toBe(1);
    expect(samples.filter(isAidCircle).length).toBe(1);
    expect(samples.filter(isAidPoint).length).toBe(1);
    expect(samples.filter(isAidText).length).toBe(1);
    expect(samples.filter(isWeldMark).length).toBe(1);
    expect(samples.filter(isSlopeMark).length).toBe(1);
  });

  it('primitiveId / primitiveVisible 从 CommonFields 取值', () => {
    expect(primitiveId(sampleLabel)).toBe('lbl-1');
    expect(primitiveVisible(sampleLabel)).toBe(true);

    const hidden: MbdPrimitive = {
      ...sampleAidPoint,
      id: 'hidden',
      visible: false,
      suppressed_reason: 'out_of_viewport',
    };
    expect(primitiveId(hidden)).toBe('hidden');
    expect(primitiveVisible(hidden)).toBe(false);
  });

  it('MbdV2PipeData JSON 往返保持结构', () => {
    const data: MbdV2PipeData = {
      version: 'v2',
      input_refno: '=HANG/FOO',
      branch_refno: '=BRAN/HANG/FOO',
      primitives: [...samples],
      meta: {
        segments_count: 0,
        welds_count: 2,
        dims_by_kind: {},
        branch_attrs: {},
        generated_at: '2026-04-21T00:00:00Z',
      },
      issues: [
        {
          id: 'iss-1',
          severity: 'warning',
          category: 'geometry',
          message: '管段 OD 缺失',
          related_refnos: ['=123/456'],
          related_primitive_ids: [],
        },
      ],
    };

    const json = JSON.stringify(data);
    const back = JSON.parse(json) as MbdV2PipeData;
    expect(back).toEqual(data);
    expect(back.primitives).toHaveLength(9);
  });

  it('switch 穷举所有 kind，未覆盖时 assertNever 兜底', () => {
    function render(p: MbdPrimitive): string {
      switch (p.kind) {
        case 'label':
          return 'lbl';
        case 'leader_line':
          return 'leader';
        case 'aid_line':
          return 'aid-l';
        case 'aid_arc':
          return 'aid-a';
        case 'aid_circle':
          return 'aid-c';
        case 'aid_point':
          return 'aid-p';
        case 'aid_text':
          return 'aid-t';
        case 'weld_mark':
          return 'weld';
        case 'slope_mark':
          return 'slope';
        default:
          return assertNever(p);
      }
    }

    expect(samples.map(render)).toEqual([
      'lbl',
      'leader',
      'aid-l',
      'aid-a',
      'aid-c',
      'aid-p',
      'aid-t',
      'weld',
      'slope',
    ]);
  });

  it('可选字段在 undefined 时可正常 round-trip', () => {
    const minimal: AidPointPrimitive = {
      id: 'min-1',
      node_names: [],
      visible: true,
      kind: 'aid_point',
      position: [0, 0, 0],
      diameter_mm: 100,
    };
    const json = JSON.stringify(minimal);
    expect(json).not.toContain('"function"');
    expect(json).not.toContain('"source_refno"');
    expect(json).not.toContain('"suppressed_reason"');
    const back = JSON.parse(json) as AidPointPrimitive;
    expect(back).toEqual(minimal);
  });
});
