import { describe, expect, it } from 'vitest';

import { MBD_FUNCTION_LOD_TIERS, mbdFunctionLodTier } from './mbdFunctionLod';

import type { MbdLodTier, MbdNonPipeAnnotationType } from './mbdFunctionLod';
import type { MbdPrimitiveKind } from './mbdV2Contract';

type Row = readonly [mbdFunction: string, tier: MbdLodTier, kinds: readonly MbdPrimitiveKind[]];

/**
 * plant-mbd `docs/field-dictionary.md`「`function` 封闭词表」（2026-11-07）逐类型登记的原文，带各自
 * 产出的 V2 kind（「不产出」的「材料」按 PML 的 MLABEL 记成 `label`），以及模块注释里定的档位。
 * 原文个数与字典一致：EM4 支架 14、EM9 仪表支架 9、EM9 仪表管支架 4、土建 12、建筑 7、设备 10。
 */
const EQUIPMENT: readonly Row[] = [
  ['定位尺寸', 'primary', ['linear_dim']],
  ['标注方向', 'detail', ['aid_text']],
  ['Dim dir', 'detail', ['aid_text']],
  ['定位墙体', 'secondary', ['label']],
  ['定位楼板', 'secondary', ['label']],
  ['楼板标高', 'secondary', ['label']],
  ['楼板厚度', 'secondary', ['label']],
  ['偏转角度', 'detail', ['angle_dim', 'aid_text', 'aid_line']],
  ['设备信息', 'primary', ['label', 'leader_line']],
  ['设备坐标', 'secondary', ['label']],
];

const REGISTERED: Readonly<Record<MbdNonPipeAnnotationType, readonly Row[]>> = {
  em4_supp: [
    ['一级尺寸', 'primary', ['linear_dim']],
    ['二级尺寸', 'secondary', ['linear_dim']],
    ['定位尺寸', 'primary', ['linear_dim']],
    ['调整焊附加长度', 'primary', ['aid_text']],
    ['螺栓孔角度', 'secondary', ['angle_dim']],
    ['型钢斜角', 'secondary', ['angle_dim']],
    ['材料', 'detail', ['label']],
    ['焊缝', 'secondary', ['label', 'leader_line']],
    ['钢板孔洞信息', 'secondary', ['label', 'leader_line']],
    ['拉杆材料', 'secondary', ['label', 'leader_line']],
    ['加工方式', 'secondary', ['label', 'leader_line']],
    ['护板说明', 'secondary', ['label', 'leader_line']],
    ['管道信息', 'secondary', ['label', 'leader_line', 'aid_circle']],
    ['管道中心标识', 'secondary', ['aid_line']],
  ],
  em9_inst_supp: [
    ['一级尺寸', 'primary', ['linear_dim']],
    ['二级尺寸', 'secondary', ['linear_dim']],
    ['定位尺寸', 'primary', ['linear_dim']],
    ['标注方向', 'detail', ['aid_text']],
    ['Dim dir', 'detail', ['aid_text']],
    ['定位墙体', 'secondary', ['label']],
    ['材料', 'detail', ['label']],
    ['位号', 'primary', ['label', 'leader_line']],
    ['坐标信息', 'secondary', ['label']],
  ],
  em9_pipe_supp: [
    ['一级尺寸', 'primary', ['linear_dim']],
    ['二级尺寸', 'secondary', ['linear_dim']],
    ['材料', 'detail', ['label']],
    ['支架功能', 'primary', ['label', 'leader_line']],
  ],
  civil: [
    ['尺寸标注', 'primary', ['linear_dim']],
    ['尺寸标注', 'detail', ['label', 'leader_line']],
    ['孔洞尺寸', 'detail', ['linear_dim']],
    ['偏转角度', 'detail', ['angle_dim', 'aid_arc', 'aid_line', 'aid_text']],
    ['弧度半径', 'detail', ['label', 'leader_line']],
    ['名称', 'primary', ['label']],
    ['厚度', 'secondary', ['label', 'aid_circle']],
    ['强度等级', 'secondary', ['label']],
    ['标高', 'secondary', ['label', 'leader_line']],
    ['局部坐标系', 'detail', ['aid_line', 'label']],
    ['房间号', 'primary', ['label']],
    ['预埋件编号', 'detail', ['label']],
    ['预埋件名称', 'detail', ['label']],
  ],
  arch: [
    ['孔洞尺寸', 'detail', ['linear_dim']],
    ['名称', 'primary', ['label']],
    ['门', 'primary', ['label', 'leader_line']],
    ['房间号', 'primary', ['label']],
    ['建筑标高', 'secondary', ['label', 'aid_circle', 'aid_text']],
    ['预埋件编号', 'detail', ['label']],
    ['预埋件名称', 'detail', ['label']],
  ],
  em4_equi: EQUIPMENT,
  em9_equi: EQUIPMENT,
};

const NON_PIPE_TYPES = Object.keys(REGISTERED) as MbdNonPipeAnnotationType[];

const ALL_KINDS: readonly MbdPrimitiveKind[] = [
  'linear_dim', 'angle_dim', 'label', 'leader_line', 'aid_line', 'aid_arc',
  'aid_circle', 'aid_point', 'aid_text', 'weld_mark', 'slope_mark',
];

describe('mbdFunctionLodTier', () => {
  it('maps every registered function of every non-pipe type to its tier, per kind it is drawn as', () => {
    for (const annotationType of NON_PIPE_TYPES) {
      for (const [mbdFunction, tier, kinds] of REGISTERED[annotationType]) {
        for (const kind of kinds) {
          expect(mbdFunctionLodTier(annotationType, mbdFunction, kind), `${annotationType} ${mbdFunction} ${kind}`)
            .toBe(tier);
        }
      }
    }
  });

  it('registers exactly the dictionary vocabulary of each type, nothing more', () => {
    expect(Object.keys(MBD_FUNCTION_LOD_TIERS).sort()).toEqual([...NON_PIPE_TYPES].sort());
    const counts: Record<string, number> = {};
    for (const annotationType of NON_PIPE_TYPES) {
      const registered = [...new Set(REGISTERED[annotationType].map(([mbdFunction]) => mbdFunction))];
      expect(Object.keys(MBD_FUNCTION_LOD_TIERS[annotationType]).sort(), annotationType).toEqual(registered.sort());
      counts[annotationType] = registered.length;
    }
    expect(counts).toEqual({
      em4_supp: 14, em9_inst_supp: 9, em9_pipe_supp: 4, civil: 12, arch: 7, em4_equi: 10, em9_equi: 10,
    });
  });

  it('gives one tier to every kind of a function except the civil 尺寸标注', () => {
    // Kinds the dictionary never pairs with a function still get that function's tier
    // (a leader that carries its label's function follows it, whatever the producer).
    expect(mbdFunctionLodTier('em4_equi', '设备坐标', 'leader_line')).toBe('secondary');
    expect(mbdFunctionLodTier('civil', '局部坐标系', 'aid_text')).toBe('detail');
    // Wall-segment chains are primary; the hole / embedded-part locating values are not.
    expect(mbdFunctionLodTier('civil', '尺寸标注', 'linear_dim')).toBe('primary');
    expect(mbdFunctionLodTier('civil', '尺寸标注', 'aid_text')).toBe('primary');
    expect(mbdFunctionLodTier('civil', '尺寸标注', 'label')).toBe('detail');
    expect(mbdFunctionLodTier('civil', '尺寸标注', 'leader_line')).toBe('detail');
  });

  it('leaves pipe packages alone, whatever function they declare', () => {
    const everyFunction = new Set([
      ...NON_PIPE_TYPES.flatMap(annotationType => Object.keys(MBD_FUNCTION_LOD_TIERS[annotationType])),
      // The pipe vocabulary itself, some of it shared with the tables above.
      '尺寸', '定位尺寸', '定位墙体', '标高', '位号', '材料', '连接信息', '管道名称', '坡度',
    ]);
    for (const annotationType of ['em4_pipe', 'em9_pipe', undefined] as const) {
      for (const mbdFunction of everyFunction) {
        for (const kind of ALL_KINDS) {
          expect(mbdFunctionLodTier(annotationType, mbdFunction, kind)).toBeUndefined();
        }
      }
    }
  });

  it('has no say on an undeclared or unregistered function, so the record keeps its own default', () => {
    for (const annotationType of NON_PIPE_TYPES) {
      expect(mbdFunctionLodTier(annotationType, undefined, 'label')).toBeUndefined();
      expect(mbdFunctionLodTier(annotationType, '', 'label')).toBeUndefined();
      // Prototype keys are not registrations.
      for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
        expect(mbdFunctionLodTier(annotationType, key, 'label'), `${annotationType} ${key}`).toBeUndefined();
      }
    }
    // Registered for another type only, a historical value, and a pipe value.
    expect(mbdFunctionLodTier('em9_pipe_supp', '管道信息', 'label')).toBeUndefined();
    expect(mbdFunctionLodTier('arch', '标高', 'label')).toBeUndefined();
    expect(mbdFunctionLodTier('em4_supp', '管夹标号', 'label')).toBeUndefined();
    expect(mbdFunctionLodTier('em4_supp', '三级尺寸', 'linear_dim')).toBeUndefined();
    expect(mbdFunctionLodTier('em4_equi', '连接信息', 'label')).toBeUndefined();
  });
});
