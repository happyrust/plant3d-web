import { describe, expect, it } from 'vitest';

import {
  attributeText,
  buildPipeInformation,
  PIPE_INFORMATION_SOURCE,
  pipeAttribute,
  pipeInformationRefno,
  pipeInformationToExternalDimensions,
  validatePipeInformationRecord,
} from './pipeInformation';

import type {
  PipeInformationField,
  PipeInformationRecord,
  PipeInsulationRow,
  PipeMemberDiameter,
  PipeMemberMaterial,
} from './pipeInformation';
import type {
  ElementAttribute,
  ElementAttributesResponse,
  ModelBoundsResponse,
  SpatialCenterlineResponse,
  SpatialCenterlineSegment,
} from '@/api/genModelV1Api';

const REFNO = '24381/145018';

const VERSION = {
  dbnum: 24381,
  sesno: 100,
  databases: [{ dbnum: 24381, sesno: 100, db_type: 'DESI' }],
};

function attr(name: string, display: string, value?: unknown): ElementAttribute {
  return {
    name,
    value_type: 'string',
    display,
    is_unset: false,
    editable: false,
    is_uda: false,
    ...(value === undefined ? {} : { value }),
  };
}

function attrs(overrides: Partial<ElementAttributesResponse> = {}): ElementAttributesResponse {
  return {
    refno: REFNO,
    noun: 'BRAN',
    dbnum: 24381,
    sesno: 100,
    source: 'test',
    complete: true,
    attributes: [],
    ...overrides,
  };
}

function bounds(overrides: Partial<ModelBoundsResponse> = {}): ModelBoundsResponse {
  return {
    refno: REFNO,
    scope: 'subtree',
    min_mm: [0, 0, 0],
    max_mm: [200, 100, 50],
    model_count: 1,
    source: 'test-model',
    stale: false,
    publication_status: 'ok',
    ...overrides,
  };
}

function segment(overrides: Partial<SpatialCenterlineSegment> = {}): SpatialCenterlineSegment {
  return {
    refno: '9001_1',
    order: 1,
    noun: 'TUBI',
    implicit: false,
    start: { x: 0, y: 0, z: 0 },
    end: { x: 1000, y: 0, z: 0 },
    length_mm: 1000,
    outside_diameter_mm: 114.3,
    ...overrides,
  };
}

function centerline(
  segments: SpatialCenterlineSegment[],
  overrides: Partial<SpatialCenterlineResponse> = {},
): SpatialCenterlineResponse {
  return {
    refno: '24381_145018',
    dbnum: 24381,
    segment_count: segments.length,
    outside_diameter_mm: null,
    centerline_bbox: null,
    segments,
    warnings: [],
    ...overrides,
  };
}

function build(
  overrides: Partial<Parameters<typeof buildPipeInformation>[0]> = {},
): PipeInformationRecord {
  return buildPipeInformation({
    refno: REFNO,
    attributes: attrs(),
    bounds: bounds(),
    ...overrides,
  });
}

function fieldOf(record: PipeInformationRecord, key: string): PipeInformationField | undefined {
  return record.fields.find(item => item.key === key);
}

describe('pipeInformationRefno', () => {
  it('去前导等号并把斜杠归一成下划线', () => {
    expect(pipeInformationRefno('=24381/145018')).toBe('24381_145018');
    expect(pipeInformationRefno('  24381/145018  ')).toBe('24381_145018');
    expect(pipeInformationRefno('24381_145018')).toBe('24381_145018');
  });

  // 2026-10-29：此前只替换首个斜杠，多段 refno 会残留 '/'（`24381_145018/1`），
  // 与同文件 `validatePipeInformationRecord` 的 `^\d+_\d+$` 校验和下游键都不相等。
  // 现统一走 `toRefnoKey` 全量替换。
  it('全量替换斜杠，多段 refno 不再残留', () => {
    expect(pipeInformationRefno('24381/145018/1')).toBe('24381_145018_1');
    expect(pipeInformationRefno('a/b/c/d')).toBe('a_b_c_d');
    expect(pipeInformationRefno('=24381/145018/1')).toBe('24381_145018_1');
  });
});

describe('pipeAttribute / attributeText', () => {
  it('按存储名大小写不敏感命中，但查询名必须已是大写（现状钉住）', () => {
    const response = attrs({ attributes: [attr('hbor', '100')] });
    expect(pipeAttribute(response, 'HBOR')?.display).toBe('100');
    expect(pipeAttribute(response, 'hbor')).toBeUndefined();
  });

  it('is_unset 或显示为 unset/null/0/0/=0/0/空白的属性视为不存在', () => {
    const response = attrs({
      attributes: [
        { ...attr('AA', '有值'), is_unset: true },
        attr('BB', '   '),
        attr('CC', 'UnSet'),
        attr('DD', 'NULL'),
        attr('EE', '0/0'),
        attr('FF', '=0/0'),
      ],
    });
    for (const name of ['AA', 'BB', 'CC', 'DD', 'EE', 'FF']) {
      expect(pipeAttribute(response, name)).toBeUndefined();
    }
  });

  it('attributeText 返回 trim 后的文本，未命中返回 null', () => {
    const response = attrs({ attributes: [attr('NAME', '  /PIPE-A  ')] });
    expect(attributeText(response, 'NAME')).toBe('/PIPE-A');
    expect(attributeText(response, 'MATN')).toBeNull();
  });
});

describe('buildPipeInformation：前置校验', () => {
  it('属性 noun / refno / sesno 不满足 BRAN 前置条件时抛错', () => {
    const cases: Partial<ElementAttributesResponse>[] = [
      { noun: 'PIPE' },
      { refno: '999/888' },
      { refno: undefined },
      { sesno: -1 },
      { sesno: 1.5 },
      { sesno: undefined },
    ];
    for (const overrides of cases) {
      expect(() => buildPipeInformation({ refno: REFNO, attributes: attrs(overrides) }))
        .toThrow('必须读取到这根 BRAN 的属性及会话');
    }
  });

  it('包围盒 refno / scope / 坐标不可靠时抛错', () => {
    const cases: Partial<ModelBoundsResponse>[] = [
      { refno: '999/888' },
      { scope: 'element' as unknown as 'subtree' },
      { min_mm: [500, 0, 0] },
      { max_mm: [Number.NaN, 1, 1] },
    ];
    for (const overrides of cases) {
      expect(() => buildPipeInformation({ refno: REFNO, attributes: attrs(), bounds: bounds(overrides) }))
        .toThrow('模型包围尺寸缺少可靠的世界毫米边界');
    }
  });

  it('中心线 refno 不匹配或 segments 非数组时抛错', () => {
    expect(() => buildPipeInformation({
      refno: REFNO,
      attributes: attrs(),
      centerline: centerline([], { refno: '999_888' }),
    })).toThrow('中心线响应所属管道不匹配');
    expect(() => buildPipeInformation({
      refno: REFNO,
      attributes: attrs(),
      centerline: centerline([], { segments: 'x' as unknown as SpatialCenterlineSegment[] }),
    })).toThrow('中心线响应所属管道不匹配');
  });
});

describe('buildPipeInformation：版本核对', () => {
  it('source_version 结构不完整时抛错', () => {
    const bad = {
      dbnum: 24381,
      sesno: 100,
      databases: [{ dbnum: 1, sesno: 2, db_type: 'DESI' }],
    };
    expect(() => build({
      centerline: centerline([], { source_version: bad }),
    })).toThrow('中心线版本信息无效，不能合并当前属性');
  });

  it('属性或中心线与 source_version 不一致时抛错', () => {
    expect(() => build({
      attributes: attrs({ sesno: 101 }),
      centerline: centerline([], { source_version: VERSION }),
    })).toThrow('属性与中心线版本不一致');
    expect(() => build({
      centerline: centerline([], { dbnum: 999, source_version: VERSION }),
    })).toThrow('属性与中心线版本不一致');
  });

  it('同版本时标注版本一致，source_version 为 null 则标注待核实', () => {
    const withVersion = build({ centerline: centerline([], { source_version: VERSION }) });
    expect(withVersion.sourceVersion).toEqual(VERSION);
    expect(fieldOf(withVersion, 'source-version')?.text).toContain('属性与中心线同版本（24381@100）');

    const without = build({ centerline: centerline([], { source_version: null }) });
    expect(without.sourceVersion).toBeUndefined();
    expect(fieldOf(without, 'source-version')?.text).toContain('中心线未提供版本');
  });
});

describe('buildPipeInformation：锚点与字段', () => {
  it('没有中心线首点也没有包围盒时抛错', () => {
    expect(() => buildPipeInformation({ refno: REFNO, attributes: attrs() }))
      .toThrow('缺少世界坐标');
    expect(() => buildPipeInformation({
      refno: REFNO,
      attributes: attrs(),
      centerline: centerline([segment({ start: { x: Number.NaN, y: 0, z: 0 } })]),
    })).toThrow('缺少世界坐标');
  });

  it('锚点优先取中心线首段起点，其次包围盒中心', () => {
    const fromCenterline = build({
      centerline: centerline([segment({ start: { x: 7, y: 8, z: 9 } })]),
    });
    expect(fromCenterline.anchorMm).toEqual([7, 8, 9]);

    const fromBounds = build();
    expect(fromBounds.anchorMm).toEqual([100, 50, 25]);
    expect(fieldOf(fromBounds, 'coordinates')?.text).toBe('100 mm, 50 mm, 25 mm');
    expect(fieldOf(fromBounds, 'elevation')?.text).toBe('25 mm');
  });

  it('正常路径：refno 归一化、name 取 NAME、数值属性转 mm 文本', () => {
    const record = build({
      attributes: attrs({
        attributes: [
          attr('NAME', '/PIPE-A'),
          attr('HBOR', '100', 100),
          attr('TBOR', '80', 80),
          attr('MATN', '碳钢'),
        ],
      }),
      centerline: centerline([segment()]),
    });
    expect(record.refno).toBe('24381_145018');
    expect(record.name).toBe('/PIPE-A');
    expect(record.sesno).toBe(100);
    expect(record.stale).toBe(false);
    expect(Number.isFinite(Date.parse(record.fetchedAt))).toBe(true);
    expect(fieldOf(record, 'head-bore')).toMatchObject({ text: '100 mm', status: 'read' });
    expect(fieldOf(record, 'tail-bore')).toMatchObject({ text: '80 mm', status: 'read' });
    expect(fieldOf(record, 'material')).toMatchObject({ text: '碳钢', status: 'read' });
    expect(fieldOf(record, 'straight-length')).toMatchObject({ text: '1000 mm', status: 'derived' });
    expect(fieldOf(record, 'model-bounds')?.text).toBe('200 mm × 100 mm × 50 mm');
  });

  it('NAME 未设置时 name 回退为 refno，数值属性非正数按缺失处理', () => {
    const record = build({ attributes: attrs({ attributes: [attr('HBOR', '0', 0)] }) });
    expect(record.name).toBe('24381_145018');
    expect(fieldOf(record, 'head-bore')).toMatchObject({ text: '未设置', status: 'missing' });
  });

  it('input.material 覆盖 MATN 属性的文本与状态', () => {
    const record = build({
      attributes: attrs({ attributes: [attr('MATN', '碳钢')] }),
      material: { text: '业务材质X', source: 'SPEC', status: 'unconfirmed' },
    });
    expect(fieldOf(record, 'material'))
      .toMatchObject({ text: '业务材质X', source: 'SPEC', status: 'unconfirmed' });
  });
});

describe('buildPipeInformation：成员外径', () => {
  it('按目录值、通径估算、缺失、未知四种来源逐段标注', () => {
    const record = build({
      centerline: centerline([
        segment({
          refno: 'm1',
          order: 1,
          diameter_evidence: { source: 'catalogue', catalogue_od_mm: 114.3, arrive_bore_mm: 100 },
        }),
        segment({
          refno: 'm2',
          order: 2,
          outside_diameter_mm: 110,
          diameter_evidence: { source: 'bore-estimate', catalogue_od_mm: null, arrive_bore_mm: 100 },
        }),
        segment({ refno: 'm3', order: 3, outside_diameter_mm: null }),
        segment({ refno: 'm4', order: 4, outside_diameter_mm: 60 }),
      ]),
    });
    const members = new Map((record.memberDiameters ?? []).map(member => [member.refno, member]));
    expect(members.get('m1')).toMatchObject({ source: 'catalogue', outsideDiameterMm: 114.3 });
    expect(members.get('m1')?.sourceText).toContain('管子目录 PARA[2]：114.3 mm');
    expect(members.get('m2')).toMatchObject({ source: 'bore-estimate', outsideDiameterMm: 110 });
    expect(members.get('m3')).toMatchObject({ source: 'missing', outsideDiameterMm: null });
    expect(members.get('m4')).toMatchObject({ source: 'unknown', outsideDiameterMm: 60 });
    expect(fieldOf(record, 'outer-diameter'))
      .toMatchObject({ text: '60 mm ～ 114.3 mm（3/4段）', status: 'unconfirmed' });
    expect(record.warnings).toContain('部分成员外径为估算、来源未核实或缺失；不可据此完成外径验收');
  });

  it('全部来自管子目录时外径字段状态为 read 且无估算警告', () => {
    const record = build({
      centerline: centerline([
        segment({
          diameter_evidence: { source: 'catalogue', catalogue_od_mm: 114.3, arrive_bore_mm: 100 },
        }),
      ]),
    });
    expect(fieldOf(record, 'outer-diameter'))
      .toMatchObject({ text: '114.3 mm（1/1段）', status: 'read' });
    expect(record.warnings).not.toContain('部分成员外径为估算、来源未核实或缺失；不可据此完成外径验收');
  });
});

describe('buildPipeInformation：弯头弧长', () => {
  const bend = segment({
    refno: 'b1',
    order: 2,
    noun: 'BEND',
    start: { x: 1000, y: 0, z: 0 },
    end: { x: 1000, y: 100, z: 0 },
    length_mm: 0,
    outside_diameter_mm: null,
  });

  it('用 ANGL 与端口弦长推出半径与弧长，并计入管长（含弯头）', () => {
    const record = build({
      centerline: centerline([segment(), bend]),
      bendAngles: [{ refno: 'b1', angleDeg: 90, source: 'b1:ANGL' }],
    });
    const arc = record.bendArcs?.[0];
    expect(arc?.angleDeg).toBe(90);
    expect(arc?.chordMm).toBe(100);
    expect(arc?.radiusMm).toBeCloseTo(70.7107, 3);
    expect(arc?.arcMm).toBeCloseTo(111.0721, 3);
    expect(arc?.source).toBe('b1:ANGL + 中心线端口弦长');
    expect(fieldOf(record, 'length-with-bends'))
      .toMatchObject({ text: '1111.07 mm', status: 'unconfirmed' });
  });

  it('弯头缺 ANGL 时弧长为 null 并记警告，管长（含弯头）缺失', () => {
    const record = build({ centerline: centerline([segment(), bend]) });
    expect(record.bendArcs?.[0]?.arcMm).toBeNull();
    expect(record.bendArcs?.[0]?.source).toBe('未读到 ANGL');
    expect(fieldOf(record, 'length-with-bends')?.status).toBe('missing');
    expect(record.warnings)
      .toContain('1 个弯头/弯管缺少有效角度或端口，不能计算含弯头弧长的管长');
  });

  it('同 refno 的弯段去重只保留一条弧长记录', () => {
    const dup = (order: number) => segment({
      refno: 'b9',
      order,
      noun: 'ELBO',
      start: { x: 0, y: 0, z: 0 },
      end: { x: 0, y: 0, z: 0 },
      outside_diameter_mm: null,
    });
    const record = build({ centerline: centerline([dup(1), dup(2)]) });
    expect(record.bendArcs).toHaveLength(1);
    expect(record.bendArcs?.[0]?.refno).toBe('b9');
  });
});

describe('buildPipeInformation：标高与保温', () => {
  it('直段按坡度分类并用外径折算管顶/管底，零长段忽略', () => {
    const record = build({
      centerline: centerline([
        segment({
          refno: 's1',
          start: { x: 0, y: 0, z: 10 },
          end: { x: 100, y: 0, z: 10 },
          outside_diameter_mm: 20,
        }),
        segment({
          refno: 's2',
          order: 2,
          start: { x: 0, y: 0, z: 0 },
          end: { x: 0, y: 0, z: 50 },
          outside_diameter_mm: 20,
        }),
        segment({
          refno: 's3',
          order: 3,
          start: { x: 0, y: 0, z: 0 },
          end: { x: 30, y: 0, z: 40 },
          outside_diameter_mm: 20,
        }),
        segment({
          refno: 's4',
          order: 4,
          start: { x: 9, y: 9, z: 9 },
          end: { x: 9, y: 9, z: 9 },
          outside_diameter_mm: 20,
        }),
      ]),
    });
    const rows = new Map((record.straightElevations ?? []).map(row => [row.refno, row]));
    expect(record.straightElevations).toHaveLength(3);
    expect(rows.get('s1')?.slope).toBe('horizontal');
    expect(rows.get('s1')?.topMm).toBeCloseTo(20, 6);
    expect(rows.get('s1')?.bottomMm).toBeCloseTo(0, 6);
    expect(rows.get('s2')).toMatchObject({ slope: 'vertical', topMm: 50, bottomMm: 0 });
    expect(rows.get('s3')?.slope).toBe('sloped');
    expect(rows.get('s3')?.topMm).toBeCloseTo(46, 6);
    expect(fieldOf(record, 'top-bottom-elevation')?.text)
      .toBe('管顶最高 50 mm，管底最低 -6 mm（3/3段）');
    expect(fieldOf(record, 'centerline-elevation')?.text).toBe('0 mm ～ 50 mm');
  });

  it('存在非 none 保温行时追加保温参数与含保温外径字段', () => {
    const insulationRows: PipeInsulationRow[] = [
      {
        refno: 's1',
        order: 1,
        boreMm: 100,
        outsideDiameterMm: 114.3,
        para1Mm: 50,
        status: 'read',
        text: 'INSU',
        source: 'TEMP',
      },
      {
        refno: 's2',
        order: 2,
        boreMm: null,
        outsideDiameterMm: null,
        para1Mm: null,
        status: 'none',
        text: '无保温',
        source: '-',
      },
    ];
    const record = build({ insulationRows });
    expect(fieldOf(record, 'insulation-parameter')).toMatchObject({
      text: 'PARA[1] 50 mm（1/2段，含义待确认）',
      status: 'unconfirmed',
    });
    expect(fieldOf(record, 'insulated-od')?.text).toBe('按直径增量 164.3 mm，按厚度 214.3 mm');
    expect(record.insulationRows).toEqual(insulationRows);
  });

  it('保温行全部 status=none 时不追加保温字段', () => {
    const record = build({
      insulationRows: [
        {
          refno: 's1',
          order: 1,
          boreMm: null,
          outsideDiameterMm: null,
          para1Mm: null,
          status: 'none',
          text: '无',
          source: '-',
        },
      ],
    });
    expect(fieldOf(record, 'insulation-parameter')).toBeUndefined();
    expect(fieldOf(record, 'insulated-od')).toBeUndefined();
  });
});

describe('buildPipeInformation：成员材质与警告', () => {
  it('memberMaterials 传入时追加字段，只有全部读到才为 read', () => {
    expect(fieldOf(build(), 'member-materials')).toBeUndefined();

    const memberMaterials: PipeMemberMaterial[] = [
      { refno: 'm1', noun: 'TUBI', text: 'A106', source: 'MATN', status: 'read' },
      { refno: 'm2', noun: 'ELBO', text: '未设置', source: 'MATN', status: 'missing' },
    ];
    const record = build({ memberMaterials });
    expect(fieldOf(record, 'member-materials'))
      .toMatchObject({ text: 'A106（1/2段）', status: 'unconfirmed' });
    expect(record.memberMaterials).toEqual(memberMaterials);
  });

  it('属性不完整、包围盒过期、中心线与入参警告全部汇合并去重', () => {
    const record = build({
      attributes: attrs({ complete: false }),
      bounds: bounds({ stale: true }),
      centerline: centerline([], { warnings: ['中心线警告A'] }),
      warnings: ['重复警告', '重复警告'],
    });
    expect(record.warnings).toContain('属性读取不完整，缺失字段不能作为验收依据');
    expect(record.warnings).toContain('模型包围尺寸来源已过期，请重新生成模型');
    expect(record.warnings).toContain('中心线警告A');
    expect(record.warnings.filter(item => item === '重复警告')).toHaveLength(1);
  });
});

describe('buildPipeInformation：模型记录版本', () => {
  it('同库不同会话时在版本核对里标注不同版本并记警告', () => {
    const record = build({
      bounds: bounds({
        record_source_sessions: [
          { dbnum: 24381, sesno: 100 },
          { dbnum: 24381, sesno: 50 },
        ],
      }),
    });
    const item = fieldOf(record, 'source-version');
    expect(item?.text).toContain('模型记录来源 24381@100、24381@50');
    expect(item?.text).toContain('（不同版本）');
    expect(record.warnings).toContain('模型边界包含不同源版本的生成记录，不能作为本版包络验收值');
  });

  it('会话记录非法时抛错', () => {
    expect(() => build({
      bounds: bounds({ record_source_sessions: [{ dbnum: 0, sesno: 1 }] }),
    })).toThrow('模型记录版本信息无效');
  });
});

describe('pipeInformationToExternalDimensions', () => {
  it('映射成 external-reference 标注：mm 转 m、字段逐行进 tag', () => {
    const record = build({ attributes: attrs({ attributes: [attr('NAME', '/PIPE-A')] }) });
    const [ext] = pipeInformationToExternalDimensions([record]);
    expect(ext).toMatchObject({
      id: `${PIPE_INFORMATION_SOURCE}:24381_145018`,
      source: 'pipe-information',
      sourceLabel: '24381_145018@100 管道信息',
      role: 'external-reference',
      category: 'annotation',
    });
    const layout = ext?.layout;
    if (!layout || !('tag' in layout)) throw new Error('预期 ExplicitLayoutInput');
    expect(layout.labelPinned).toBe(false);
    expect(layout.formattedLabel).toBe('/PIPE-A');
    // 锚点 [100,50,25] mm → [0.1,0.05,0.025] m；labelAnchor 只在 y/z 上抬 0.5，x 不动
    expect(layout.tag?.target).toEqual([0.1, 0.05, 0.025]);
    expect(layout.labelAnchor).toEqual([0.1, 0.55, 0.525]);
    expect(layout.tag?.lines.map(line => line.text)).toContain('首端通径：未设置');
  });

  it('stale 记录的名称行带过期前缀', () => {
    const record = validatePipeInformationRecord(
      build({ attributes: attrs({ attributes: [attr('NAME', '/PIPE-A')] }) }),
    );
    const [ext] = pipeInformationToExternalDimensions([record]);
    const layout = ext?.layout;
    if (!layout || !('tag' in layout)) throw new Error('预期 ExplicitLayoutInput');
    expect(layout.tag?.lines[0]?.text).toBe('（过期）/PIPE-A');
  });
});

describe('validatePipeInformationRecord', () => {
  it('buildPipeInformation 的产出能通过校验，并被标记 stale', () => {
    const record = build({
      centerline: centerline([
        segment({
          diameter_evidence: { source: 'catalogue', catalogue_od_mm: 114.3, arrive_bore_mm: 100 },
        }),
      ]),
    });
    const validated = validatePipeInformationRecord(record);
    expect(validated.stale).toBe(true);
    expect(validated.refno).toBe('24381_145018');
    expect(validated.memberDiameters).toHaveLength(1);
  });

  it('memberDiameters 缺省时补成空数组，其余可选数组不补（现状钉住）', () => {
    const {
      memberDiameters: _a,
      memberMaterials: _b,
      bendArcs: _c,
      straightElevations: _d,
      insulationRows: _e,
      ...rest
    } = build();
    const validated = validatePipeInformationRecord(rest);
    expect(validated.memberDiameters).toEqual([]);
    expect(validated.memberMaterials).toBeUndefined();
    expect(validated.bendArcs).toBeUndefined();
    expect(validated.straightElevations).toBeUndefined();
    expect(validated.insulationRows).toBeUndefined();
  });

  it('核心字段非法时抛「管道信息保存格式无效」', () => {
    const base = build();
    const cases: unknown[] = [
      { ...base, refno: '24381/145018' },
      { ...base, refno: 'abc' },
      { ...base, name: 1 },
      { ...base, sesno: -1 },
      { ...base, anchorMm: [1, 2] },
      { ...base, fetchedAt: 'not-a-date' },
      { ...base, warnings: ['ok', 1] },
      {
        ...base,
        fields: [
          ...base.fields,
          { key: 'x', label: 'x', text: 'x', source: 'x', status: 'bogus' },
        ],
      },
    ];
    for (const record of cases) {
      expect(() => validatePipeInformationRecord(record)).toThrow('管道信息保存格式无效');
    }
    expect(() => validatePipeInformationRecord(null)).toThrow('管道信息保存格式无效');
  });

  it('fields 超过 32 条时抛错', () => {
    const base = build();
    const pad: PipeInformationField = { key: 'p', label: 'p', text: 'p', source: 'p', status: 'read' };
    const fields = [...base.fields, ...Array.from({ length: 32 }, () => ({ ...pad }))];
    expect(fields.length).toBeGreaterThan(32);
    expect(() => validatePipeInformationRecord({ ...base, fields }))
      .toThrow('管道信息保存格式无效');
  });

  it('成员外径的数值与来源必须互洽', () => {
    const base = build();
    const member: PipeMemberDiameter = {
      refno: 'm1',
      order: 0,
      noun: 'TUBI',
      implicit: false,
      outsideDiameterMm: 114.3,
      source: 'catalogue',
      sourceText: 'x',
    };
    expect(() => validatePipeInformationRecord({
      ...base,
      memberDiameters: [{ ...member, source: 'missing' }],
    })).toThrow('成员外径保存格式无效');
    expect(() => validatePipeInformationRecord({
      ...base,
      memberDiameters: [{ ...member, outsideDiameterMm: null }],
    })).toThrow('成员外径保存格式无效');
    expect(() => validatePipeInformationRecord({
      ...base,
      memberDiameters: [{ ...member, outsideDiameterMm: -1 }],
    })).toThrow('成员外径保存格式无效');
    expect(validatePipeInformationRecord({ ...base, memberDiameters: [member] }).memberDiameters)
      .toHaveLength(1);
  });

  it('sourceVersion 结构非法或与记录 sesno 不一致时抛错', () => {
    const base = build();
    expect(() => validatePipeInformationRecord({
      ...base,
      sourceVersion: { ...VERSION, databases: [] },
    })).toThrow('管道版本保存格式无效');
    expect(() => validatePipeInformationRecord({
      ...base,
      sourceVersion: {
        dbnum: 24381,
        sesno: 50,
        databases: [{ dbnum: 24381, sesno: 50, db_type: 'DESI' }],
      },
    })).toThrow('管道版本保存格式无效');
    expect(validatePipeInformationRecord({ ...base, sourceVersion: VERSION }).sourceVersion)
      .toEqual(VERSION);
  });

  it('可选数组元素非法时按各自消息抛错', () => {
    const base = build();
    expect(() => validatePipeInformationRecord({
      ...base,
      memberMaterials: [
        { refno: 'm', noun: 'TUBI', text: 'x', source: 's', status: 'bogus' as unknown as 'read' },
      ],
    })).toThrow('成员材质保存格式无效');
    expect(() => validatePipeInformationRecord({
      ...base,
      bendArcs: [
        { refno: 'b', noun: 'BEND', angleDeg: 90, chordMm: 1, radiusMm: 1, arcMm: Number.NaN, source: 's' },
      ],
    })).toThrow('弯头弧长保存格式无效');
    expect(() => validatePipeInformationRecord({
      ...base,
      straightElevations: [
        {
          refno: 's',
          order: 0,
          slope: 'diagonal' as unknown as 'horizontal',
          startZ: 0,
          endZ: 1,
          outsideDiameterMm: null,
          topMm: null,
          bottomMm: null,
        },
      ],
    })).toThrow('直管段标高保存格式无效');
    expect(() => validatePipeInformationRecord({
      ...base,
      insulationRows: [
        {
          refno: 's',
          order: 0,
          boreMm: null,
          outsideDiameterMm: null,
          para1Mm: 'x' as unknown as null,
          status: 'read',
          text: 't',
          source: 's',
        },
      ],
    })).toThrow('保温选取保存格式无效');
  });
});
