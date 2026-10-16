import { describe, expect, it } from 'vitest';

import {
  E3D_DEFAULT_ELEMENT_COLOUR,
  E3D_GRAPHICS_COLOUR_DEFAULTS,
  PDMS_COLOUR_DICTIONARY,
  PDMS_COLOUR_TABLE,
  isPdmsColourRef,
  normalizePdmsColourName,
  pdmsColourByIndex,
  pdmsColourByName,
  pdmsColourHex,
  pdmsHexString
} from './pdmsColourTable';

describe('pdmsColourTable —— E3D 3.1 颜色表（core.dll FWSCOL + DruidNet ColourTableManager）', () => {
  it('365 项、颜色号 1..365 连续升序；61 个字典色', () => {
    expect(PDMS_COLOUR_TABLE).toHaveLength(365);
    PDMS_COLOUR_TABLE.forEach((e, i) => expect(e[0]).toBe(i + 1));
    expect(Object.keys(PDMS_COLOUR_DICTIONARY)).toHaveLength(61);
  });

  it('装填结构：1..16 基本色、17..272 调色板 + 名字覆盖、296/298..303 固定辅助色、305..365 字典顺序', () => {
    expect(pdmsColourByIndex(1)).toEqual([1, 'grey', 0x828282]);
    expect(pdmsColourByIndex(16)).toEqual([16, 'magenta', 0xff00ff]);
    expect(pdmsColourByIndex(20)?.[1]).toBe(''); // 无名调色板槽位
    expect(pdmsColourByIndex(268)).toEqual([268, 'darkgrey', 0x505050]);
    expect(pdmsColourByIndex(270)).toEqual([270, 'grey', 0x828282]);
    expect(pdmsColourByIndex(271)).toEqual([271, 'lightgrey', 0xbdbdbd]);
    expect(pdmsColourByIndex(296)).toEqual([296, '', 0x5681ad]);
    expect(pdmsColourByIndex(299)).toEqual([299, 'white', 0xffffff]);
    expect(pdmsColourByIndex(300)).toEqual([300, 'midnight', 0x00134f]);
    expect(pdmsColourByIndex(303)).toEqual([303, 'gold', 0xffbe00]);
    expect(pdmsColourByIndex(305)).toEqual([305, 'black', 0x000000]);
    expect(pdmsColourByIndex(310)).toEqual([310, 'lightgrey', 0xbdbdbd]);
    expect(pdmsColourByIndex(365)).toEqual([365, 'stateblue', 0x7d7dbc]);
    expect(pdmsColourByIndex(0)).toBeUndefined();
    expect(pdmsColourByIndex(366)).toBeUndefined();
  });

  it('按名查：大小写 / 空格不敏感，同名多槽取最小颜色号，RGB 与真机一致', () => {
    expect(pdmsColourByName('lightgrey')).toEqual([271, 'lightgrey', 0xbdbdbd]);
    expect(pdmsColourByName('Light Grey')).toEqual([271, 'lightgrey', 0xbdbdbd]);
    expect(pdmsColourByName('GREY')).toEqual([1, 'grey', 0x828282]);
    expect(pdmsColourByName('yellow')?.[2]).toBe(0xffff00);
    expect(pdmsColourByName('orange')?.[2]).toBe(0xffbe00);
    expect(pdmsColourByName('blue')?.[2]).toBe(0x0000ff);
    expect(pdmsColourByName('red')?.[2]).toBe(0xbc0000);
    expect(pdmsColourByName('green')?.[2]).toBe(0x00bc00);
    expect(pdmsColourByName('whitesmoke')?.[2]).toBe(0xffffff); // 只在字典里
    expect(pdmsColourByName('nosuchcolour')).toBeUndefined();
    expect(normalizePdmsColourName('  Bright-Red ')).toBe('brightred');
  });

  it('pdmsColourHex 接受名字 / 颜色号 / pdms: 前缀', () => {
    expect(pdmsColourHex('lightgrey')).toBe(0xbdbdbd);
    expect(pdmsColourHex(271)).toBe(0xbdbdbd);
    expect(pdmsColourHex('271')).toBe(0xbdbdbd);
    expect(pdmsColourHex('pdms:lightgrey')).toBe(0xbdbdbd);
    expect(pdmsColourHex('PDMS: 1')).toBe(0x828282);
    expect(pdmsColourHex('pdms:nope')).toBeUndefined();
    expect(isPdmsColourRef('pdms:grey')).toBe(true);
    expect(isPdmsColourRef('#828282')).toBe(false);
    expect(isPdmsColourRef(0x828282)).toBe(false);
    expect(pdmsHexString(0xbdbdbd)).toBe('#bdbdbd');
    expect(pdmsHexString(0x00134f)).toBe('#00134f');
  });

  it('出厂图形颜色：元素 lightgrey #bdbdbd、背景 grey #828282、CE yellow、aids blue、highlight white', () => {
    expect(E3D_GRAPHICS_COLOUR_DEFAULTS.addElement).toBe('lightgrey');
    expect(E3D_GRAPHICS_COLOUR_DEFAULTS.background).toBe('grey');
    expect(E3D_DEFAULT_ELEMENT_COLOUR).toBe(0xbdbdbd);
    expect(pdmsColourHex(E3D_GRAPHICS_COLOUR_DEFAULTS.background)).toBe(0x828282);
    expect(pdmsColourHex(E3D_GRAPHICS_COLOUR_DEFAULTS.ce)).toBe(0xffff00);
    expect(pdmsColourHex(E3D_GRAPHICS_COLOUR_DEFAULTS.aids)).toBe(0x0000ff);
    expect(pdmsColourHex(E3D_GRAPHICS_COLOUR_DEFAULTS.highlight)).toBe(0xffffff);
    // 与 CSS 同名色不是一回事，别混用
    expect(E3D_DEFAULT_ELEMENT_COLOUR).not.toBe(0xd3d3d3);
  });
});
