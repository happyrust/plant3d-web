import { describe, expect, it, vi } from 'vitest';

import { createGenModelV1AttributeSource, elementAttributesToUiAttr, modelVersionAttributesToUiAttr, typeInfoFromTree, uiAttrKey } from './attributeSource';

import type { TreeSource } from '../ports';
import type { NodeResponse } from '@/api/genModelE3dTypes';

import { GenModelV1ApiError, type ElementAttribute, type ElementAttributesResponse } from '@/api/genModelV1Api';

function attr(name: string, value_type: string, display: string, extra: Partial<ElementAttribute> = {}): ElementAttribute {
  return { name, value_type, display, is_unset: false, editable: true, is_uda: false, ...extra };
}

// live :18082 BRAN 24381/145018 的形状（节选）
const RESPONSE: ElementAttributesResponse = {
  source: 'e3d-io',
  complete: false,
  attributes: [
    attr('NAME', 'text', '/Copy-of-RCS0014-1R43012新'),
    attr('TYPE', 'word', 'BRAN'),
    attr('OWNER', 'ref', '24381/144975'),
    attr('AEXCES', 'real', '0'),
    attr('BUIL', 'bool', 'false'),
    attr('DETA', 'bool', 'true'),
    attr('HSTU', 'ref', '13246/465801'),
    attr('HBOR', 'real', '150.5'),
    attr('SPAMAP', 'int-array', '[1, 2]'),
    attr('HPOS', 'vec3', '1000 2000 3000'),
    attr('AREA', 'unset', 'unset', { is_unset: true, is_uda: true, editable: false }),
    attr('BranHigh', 'real', '12', { is_uda: true }),
    attr(':ALREADY', 'text', 'x', { is_uda: true }),
    attr('CACHID', 'word', 'unset', { is_unset: true, editable: false }),
  ],
  diagnostics: {
    outside_schema: [],
    shape_conflicts: [{ name: 'TYPEX', found: 'RawWords[2]', declared: 'StringType' }],
    undecoded: [{ name: 'UDTYPE', reason: 'NonImplicit' }, { name: 'FUNC', reason: 'NonImplicit' }],
    uda_issues: [],
  } as unknown as ElementAttributesResponse['diagnostics'],
};

describe('elementAttributesToUiAttr', () => {
  it('unset 不进；bool/real 转成 JS 值；其余保留 display；UDA 加 : 前缀；NAME 当 full_name', () => {
    const ui = elementAttributesToUiAttr('24381_145018', RESPONSE);
    expect(ui.success).toBe(true);
    expect(ui.refno).toBe('24381_145018');
    expect(ui.full_name).toBe('/Copy-of-RCS0014-1R43012新');
    expect(ui.ref_full_names).toBeNull();
    expect(ui.attrs).toEqual({
      NAME: '/Copy-of-RCS0014-1R43012新',
      TYPE: 'BRAN',
      OWNER: '24381/144975',
      AEXCES: 0,
      BUIL: false,
      DETA: true,
      HSTU: '13246/465801',
      HBOR: 150.5,
      SPAMAP: '[1, 2]',
      HPOS: '1000 2000 3000',
      ':BranHigh': 12,
      ':ALREADY': 'x',
    });
    expect(ui.diagnostics).toEqual({
      source: 'e3d-io',
      complete: false,
      undecoded: ['UDTYPE', 'FUNC'],
      shape_conflicts: ['TYPEX'],
    });
  });

  it('diagnostics 缺省时给空数组，不是 undefined', () => {
    const ui = elementAttributesToUiAttr('1_1', { source: 'e3d-io', complete: true, attributes: [attr('NAME', 'text', 'X')] });
    expect(ui.full_name).toBeNull(); // 不以 / 开头的 NAME 不当全路径
    expect(ui.diagnostics).toEqual({ source: 'e3d-io', complete: true, undecoded: [], shape_conflicts: [] });
  });

  it('uiAttrKey：UDA 名字加冒号，已带冒号不重复', () => {
    expect(uiAttrKey(attr('AREA', 'real', '1', { is_uda: true }))).toBe(':AREA');
    expect(uiAttrKey(attr(':AREA', 'real', '1', { is_uda: true }))).toBe(':AREA');
    expect(uiAttrKey(attr('NAME', 'text', 'x'))).toBe('NAME');
  });
});

describe('createGenModelV1AttributeSource', () => {
  const node = (refno: string, noun: string, owner: string | null): NodeResponse => ({
    success: true,
    node: { refno, noun, name: refno, owner, children_count: 0 },
  });
  const tree = {
    node: vi.fn(async (refno: string) => {
      if (refno === '24381_145018') return node('24381_145018', 'BRAN', '24381_144975');
      if (refno === '24381_144975') return node('24381_144975', 'PIPE', '24381_101410');
      return { success: false, node: null, error_message: `no ${refno}` };
    }),
  } as unknown as TreeSource;

  it('typeInfo 两跳：noun 与 owner_noun 都来自树节点', async () => {
    const info = await typeInfoFromTree(tree, '24381_145018');
    expect(info).toEqual({ success: true, refno: '24381_145018', noun: 'BRAN', owner_refno: '24381_144975', owner_noun: 'PIPE' });
    const missing = await typeInfoFromTree(tree, '1_1');
    expect(missing.success).toBe(false);
  });

  it('uiAttr：API 错误折成 success:false + error_message', async () => {
    const source = createGenModelV1AttributeSource({
      tree,
      api: {
        elementAttributes: vi.fn(async () => {
          throw new GenModelV1ApiError({ code: 'not_found', status: 404, path: '/api/v1/element/attributes', message: 'gone' });
        }) as never,
      },
    });
    const resp = await source.uiAttr('1_1');
    expect(resp.success).toBe(false);
    expect(resp.attrs).toEqual({});
    expect(resp.error_message).toContain('not_found');

    const ok = createGenModelV1AttributeSource({ tree, api: { elementAttributes: vi.fn(async () => RESPONSE) as never } });
    expect((await ok.uiAttr('24381/145018')).attrs.TYPE).toBe('BRAN');
  });
});

describe('modelVersionAttributesToUiAttr（版本对比里点 A / B 构件，属性面板钉到那一版）', () => {
  it('行与 element/attributes 同型：走同一条折算——unset 不进、UDA 加冒号、real 转数值、NAME 当 full_name；source 标 history@sesno', () => {
    const ui = modelVersionAttributesToUiAttr('24384_23262', {
      sesno: 626,
      exists: true,
      noun: 'FTUB',
      attributes: [
        { name: 'NAME', valueType: 'text', display: '/C-OR-1R345-C/FTUB4', isUnset: false, isUda: false },
        { name: 'HEIG', valueType: 'real', display: '480', isUnset: false, isUda: false },
        { name: 'DESC', valueType: 'text', display: '', isUnset: true, isUda: false },
        { name: 'MYUDA', valueType: 'text', display: 'JS', isUnset: false, isUda: true },
      ],
    });
    expect(ui.success).toBe(true);
    expect(ui.attrs).toEqual({ NAME: '/C-OR-1R345-C/FTUB4', HEIG: 480, ':MYUDA': 'JS' });
    expect(ui.full_name).toBe('/C-OR-1R345-C/FTUB4');
    expect(ui.diagnostics?.source).toBe('history@626');
  });

  it('那一版里不存在：success:false 带说明，不是错误抛出', () => {
    const ui = modelVersionAttributesToUiAttr('24384_26495', { sesno: 618, exists: false, noun: null, attributes: [] });
    expect(ui.success).toBe(false);
    expect(ui.attrs).toEqual({});
    expect(ui.error_message).toContain('618');
  });
});
