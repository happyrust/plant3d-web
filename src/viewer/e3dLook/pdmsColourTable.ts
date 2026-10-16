/**
 * PDMS / E3D 3.1 颜色表（运行时表 `DruidNet.dll ColourTableManager`，由 `core.dll FWSCOL` 启动时装填）。
 *
 * 由 `D:\ida_scratch\plant3\render\e3d31-colour-table.json`（2026-09-20 逆向，365 项）生成，勿手改：
 *   1..16     基本色名 grey red orange yellow green cyan blue violet brown white pink mauve turquoise indigo black magenta
 *   17..272   256 项 PDMS 调色板（其中 61 个槽位被字典色名覆盖，如 268 darkgrey / 270 grey / 271 lightgrey）
 *   296       固定辅助色 RGB(0.341, 0.506, 0.682)；298..303 lightyellow / white / midnight / lightyellow / gold
 *   305..365  61 个字典色按字典顺序（305 black … 310 lightgrey … 365 stateblue）
 * hex 按 `ColourTableManager` 的 `(int)(x·255)` 截断，即 E3D 屏幕上真正显示的字节。
 *
 * 与 CSS 颜色名不是一套：PDMS `lightgrey` = #bdbdbd（CSS lightgrey = #d3d3d3），`grey` = #828282（CSS gray = #808080）。
 */

/** 一条颜色：PDMS 颜色号（1 起）、颜色名（无名槽位为空串）、0xRRGGBB */
export type PdmsColourEntry = readonly [index: number, name: string, hex: number];

/** 全表 365 项，按颜色号升序 */
export const PDMS_COLOUR_TABLE: readonly PdmsColourEntry[] = Object.freeze([
  [1, 'grey', 0x828282],
  [2, 'red', 0xbc0000],
  [3, 'orange', 0xffbe00],
  [4, 'yellow', 0xffff00],
  [5, 'green', 0x00bc00],
  [6, 'cyan', 0x00ffff],
  [7, 'blue', 0x0000ff],
  [8, 'violet', 0xffaaea],
  [9, 'brown', 0x683400],
  [10, 'white', 0xffffff],
  [11, 'pink', 0xbc7d8d],
  [12, 'mauve', 0x5f0081],
  [13, 'turquoise', 0x00bcbc],
  [14, 'indigo', 0x340068],
  [15, 'black', 0x000000],
  [16, 'magenta', 0xff00ff],
  [17, 'black', 0x000000],
  [18, 'brightred', 0xff0000],
  [19, 'yellow', 0xffff00],
  [20, '', 0x00ff00], // palette256
  [21, 'cyan', 0x00ffff],
  [22, 'blue', 0x0000ff],
  [23, 'magenta', 0xff00ff],
  [24, 'white', 0xffffff],
  [25, '', 0x414141], // palette256
  [26, '', 0x808080], // palette256
  [27, '', 0xff0000], // palette256
  [28, '', 0xffaaaa], // palette256
  [29, 'red', 0xbc0000],
  [30, 'indianred', 0xbc7d7d],
  [31, '', 0x810000], // palette256
  [32, '', 0x815555], // palette256
  [33, '', 0x680000], // palette256
  [34, '', 0x684545], // palette256
  [35, '', 0x4f0000], // palette256
  [36, '', 0x4f3535], // palette256
  [37, 'tomato', 0xff3e00],
  [38, 'salmon', 0xffbeaa],
  [39, 'coralred', 0xbc2d00],
  [40, '', 0xbc8d7d], // palette256
  [41, '', 0x811f00], // palette256
  [42, '', 0x815f55], // palette256
  [43, '', 0x681800], // palette256
  [44, '', 0x684e45], // palette256
  [45, '', 0x4f1300], // palette256
  [46, '', 0x4f3a35], // palette256
  [47, 'orangered', 0xff7e00],
  [48, 'wheat', 0xffd3aa],
  [49, 'tan', 0xbc8d7d],
  [50, '', 0xbc9d7d], // palette256
  [51, 'sienna', 0x814000],
  [52, '', 0x816b55], // palette256
  [53, 'brown', 0x683400],
  [54, '', 0x685545], // palette256
  [55, 'chocolate', 0x4f2700],
  [56, '', 0x4f4235], // palette256
  [57, 'orange', 0xffbe00],
  [58, 'lightgold', 0xffeaaa],
  [59, 'sandybrown', 0xbc8d00],
  [60, 'beige', 0xbcac7d],
  [61, '', 0x815f00], // palette256
  [62, '', 0x817655], // palette256
  [63, '', 0x684e00], // palette256
  [64, '', 0x685f45], // palette256
  [65, 'darkbrown', 0x4f3a00],
  [66, '', 0x4f4835], // palette256
  [67, '', 0xffff00], // palette256
  [68, 'ivory', 0xffffaa],
  [69, '', 0xbcbc00], // palette256
  [70, '', 0xbcbc7d], // palette256
  [71, '', 0x818100], // palette256
  [72, 'khaki', 0x818155],
  [73, '', 0x686800], // palette256
  [74, '', 0x686845], // palette256
  [75, '', 0x4f4f00], // palette256
  [76, '', 0x4f4f35], // palette256
  [77, '', 0xbeff00], // palette256
  [78, '', 0xeaffaa], // palette256
  [79, 'yellowgreen', 0x8dbc00],
  [80, '', 0xacbc7d], // palette256
  [81, '', 0x5f8100], // palette256
  [82, '', 0x768155], // palette256
  [83, '', 0x4e6800], // palette256
  [84, '', 0x5f6845], // palette256
  [85, '', 0x3a4f00], // palette256
  [86, '', 0x484f35], // palette256
  [87, '', 0x7eff00], // palette256
  [88, '', 0xd3ffaa], // palette256
  [89, '', 0x5ebc00], // palette256
  [90, '', 0x9dbc7d], // palette256
  [91, '', 0x408100], // palette256
  [92, '', 0x6b8155], // palette256
  [93, '', 0x346800], // palette256
  [94, '', 0x556845], // palette256
  [95, '', 0x274f00], // palette256
  [96, '', 0x424f35], // palette256
  [97, 'limegreen', 0x3eff00],
  [98, '', 0xbeffaa], // palette256
  [99, '', 0x2dbc00], // palette256
  [100, '', 0x8dbc7d], // palette256
  [101, 'forestgreen', 0x1f8100],
  [102, '', 0x5f8155], // palette256
  [103, '', 0x186800], // palette256
  [104, '', 0x4e6845], // palette256
  [105, '', 0x134f00], // palette256
  [106, '', 0x3a4f35], // palette256
  [107, '', 0x00ff00], // palette256
  [108, '', 0xaaffaa], // palette256
  [109, 'green', 0x00bc00],
  [110, '', 0x7dbc7d], // palette256
  [111, '', 0x008100], // palette256
  [112, '', 0x558155], // palette256
  [113, '', 0x006800], // palette256
  [114, '', 0x456845], // palette256
  [115, '', 0x004f00], // palette256
  [116, '', 0x354f35], // palette256
  [117, '', 0x00ff3e], // palette256
  [118, '', 0xaaffbe], // palette256
  [119, '', 0x00bc2d], // palette256
  [120, '', 0x7dbc8d], // palette256
  [121, '', 0x00811f], // palette256
  [122, '', 0x55815f], // palette256
  [123, '', 0x006818], // palette256
  [124, '', 0x45684e], // palette256
  [125, 'darkgreen', 0x004f13],
  [126, '', 0x354f3a], // palette256
  [127, 'springgreen', 0x00ff7e],
  [128, '', 0xaaffd3], // palette256
  [129, '', 0x00bc5e], // palette256
  [130, '', 0x7dbc9d], // palette256
  [131, '', 0x008140], // palette256
  [132, '', 0x55816b], // palette256
  [133, '', 0x006834], // palette256
  [134, '', 0x456855], // palette256
  [135, '', 0x004f27], // palette256
  [136, '', 0x354f42], // palette256
  [137, 'aquamarine', 0x00ffbe],
  [138, 'mediumaquamarine', 0xaaffea],
  [139, '', 0x00bc8d], // palette256
  [140, '', 0x7dbcac], // palette256
  [141, '', 0x00815f], // palette256
  [142, '', 0x558176], // palette256
  [143, '', 0x00684e], // palette256
  [144, '', 0x45685f], // palette256
  [145, '', 0x004f3a], // palette256
  [146, 'darkslate', 0x354f48],
  [147, '', 0x00ffff], // palette256
  [148, '', 0xaaffff], // palette256
  [149, 'turquoise', 0x00bcbc],
  [150, '', 0x7dbcbc], // palette256
  [151, '', 0x008181], // palette256
  [152, '', 0x558181], // palette256
  [153, '', 0x006868], // palette256
  [154, '', 0x456868], // palette256
  [155, '', 0x004f4f], // palette256
  [156, '', 0x354f4f], // palette256
  [157, '', 0x00beff], // palette256
  [158, 'powderblue', 0xaaeaff],
  [159, '', 0x008dbc], // palette256
  [160, 'steelblue', 0x008dbc],
  [161, '', 0x005f81], // palette256
  [162, '', 0x557681], // palette256
  [163, '', 0x004e68], // palette256
  [164, '', 0x455f68], // palette256
  [165, '', 0x003a4f], // palette256
  [166, '', 0x35484f], // palette256
  [167, '', 0x007eff], // palette256
  [168, 'lightblue', 0xaad3ff],
  [169, '', 0x005ebc], // palette256
  [170, '', 0x7d9dbc], // palette256
  [171, '', 0x004081], // palette256
  [172, '', 0x556b81], // palette256
  [173, '', 0x003468], // palette256
  [174, '', 0x455568], // palette256
  [175, '', 0x00274f], // palette256
  [176, '', 0x35424f], // palette256
  [177, 'royalblue', 0x003eff],
  [178, '', 0xaabeff], // palette256
  [179, '', 0x002dbc], // palette256
  [180, '', 0x7d8dbc], // palette256
  [181, '', 0x001f81], // palette256
  [182, '', 0x555f81], // palette256
  [183, '', 0x001868], // palette256
  [184, '', 0x454e68], // palette256
  [185, 'midnight', 0x00134f],
  [186, '', 0x353a4f], // palette256
  [187, '', 0x0000ff], // palette256
  [188, '', 0xaaaaff], // palette256
  [189, '', 0x0000bc], // palette256
  [190, 'stateblue', 0x7d7dbc],
  [191, '', 0x000081], // palette256
  [192, '', 0x555581], // palette256
  [193, 'navyblue', 0x000068],
  [194, '', 0x454568], // palette256
  [195, '', 0x00004f], // palette256
  [196, '', 0x35354f], // palette256
  [197, '', 0x3e00ff], // palette256
  [198, '', 0xbeaaff], // palette256
  [199, '', 0x2d00bc], // palette256
  [200, '', 0x8d7dbc], // palette256
  [201, '', 0x1f0081], // palette256
  [202, '', 0x5f5581], // palette256
  [203, '', 0x180068], // palette256
  [204, '', 0x4e4568], // palette256
  [205, '', 0x13004f], // palette256
  [206, '', 0x3a354f], // palette256
  [207, 'blueviolet', 0x7e00ff],
  [208, '', 0xd3aaff], // palette256
  [209, '', 0x5e00bc], // palette256
  [210, '', 0x9d7dbc], // palette256
  [211, '', 0x400081], // palette256
  [212, '', 0x6b5581], // palette256
  [213, 'indigo', 0x340068],
  [214, '', 0x554568], // palette256
  [215, '', 0x27004f], // palette256
  [216, '', 0x42354f], // palette256
  [217, '', 0xbe00ff], // palette256
  [218, '', 0xedaaff], // palette256
  [219, 'darkorchid', 0x8d00bc],
  [220, '', 0xac7dbc], // palette256
  [221, 'mauve', 0x5f0081],
  [222, '', 0x765581], // palette256
  [223, '', 0x4e0068], // palette256
  [224, '', 0x5f4568], // palette256
  [225, '', 0x3a004f], // palette256
  [226, '', 0x48354f], // palette256
  [227, '', 0xff00ff], // palette256
  [228, '', 0xffaaff], // palette256
  [229, '', 0xbc00bc], // palette256
  [230, '', 0xbc7dbc], // palette256
  [231, '', 0x810081], // palette256
  [232, 'plum', 0x815581],
  [233, '', 0x680068], // palette256
  [234, '', 0x684568], // palette256
  [235, '', 0x4f004f], // palette256
  [236, '', 0x4f354f], // palette256
  [237, '', 0xff00be], // palette256
  [238, 'violet', 0xffaaea],
  [239, '', 0xbc008d], // palette256
  [240, '', 0xbc7dac], // palette256
  [241, '', 0x81005f], // palette256
  [242, '', 0x815576], // palette256
  [243, 'maroon', 0x68004e],
  [244, '', 0x68455f], // palette256
  [245, '', 0x4f003a], // palette256
  [246, '', 0x4f3548], // palette256
  [247, 'deeppink', 0xff007e],
  [248, '', 0xffaad3], // palette256
  [249, '', 0xbc005e], // palette256
  [250, '', 0xbc7d9d], // palette256
  [251, '', 0x810040], // palette256
  [252, '', 0x81556b], // palette256
  [253, '', 0x680034], // palette256
  [254, '', 0x684555], // palette256
  [255, '', 0x4f0027], // palette256
  [256, '', 0x4f3542], // palette256
  [257, '', 0xff003e], // palette256
  [258, '', 0xffaabe], // palette256
  [259, '', 0xbc002d], // palette256
  [260, 'pink', 0xbc7d8d],
  [261, '', 0x81001f], // palette256
  [262, '', 0x81555f], // palette256
  [263, '', 0x680018], // palette256
  [264, '', 0x68454e], // palette256
  [265, '', 0x4f0013], // palette256
  [266, '', 0x4f353a], // palette256
  [267, '', 0x333333], // palette256
  [268, 'darkgrey', 0x505050],
  [269, 'dimgrey', 0x696969],
  [270, 'grey', 0x828282],
  [271, 'lightgrey', 0xbdbdbd],
  [272, '', 0xffffff], // palette256
  [273, '', 0xffffff], // init-white
  [274, '', 0xffffff], // init-white
  [275, '', 0xffffff], // init-white
  [276, '', 0xffffff], // init-white
  [277, '', 0xffffff], // init-white
  [278, '', 0xffffff], // init-white
  [279, '', 0xffffff], // init-white
  [280, '', 0xffffff], // init-white
  [281, '', 0xffffff], // init-white
  [282, '', 0xffffff], // init-white
  [283, '', 0xffffff], // init-white
  [284, '', 0xffffff], // init-white
  [285, '', 0xffffff], // init-white
  [286, '', 0xffffff], // init-white
  [287, '', 0xffffff], // init-white
  [288, '', 0xffffff], // init-white
  [289, '', 0xffffff], // init-white
  [290, '', 0xffffff], // init-white
  [291, '', 0xffffff], // init-white
  [292, '', 0xffffff], // init-white
  [293, '', 0xffffff], // init-white
  [294, '', 0xffffff], // init-white
  [295, '', 0xffffff], // init-white
  [296, '', 0x5681ad], // fixed-rgb
  [297, '', 0xffffff], // init-white
  [298, 'lightyellow', 0xffffaa],
  [299, 'white', 0xffffff],
  [300, 'midnight', 0x00134f],
  [301, '', 0xffffff], // init-white
  [302, 'lightyellow', 0xffffaa],
  [303, 'gold', 0xffbe00],
  [304, '', 0xffffff], // init-white
  [305, 'black', 0x000000],
  [306, 'white', 0xffffff],
  [307, 'whitesmoke', 0xffffff],
  [308, 'ivory', 0xffffaa],
  [309, 'grey', 0x828282],
  [310, 'lightgrey', 0xbdbdbd],
  [311, 'darkgrey', 0x505050],
  [312, 'darkslate', 0x354f48],
  [313, 'red', 0xbc0000],
  [314, 'brightred', 0xff0000],
  [315, 'coralred', 0xbc2d00],
  [316, 'tomato', 0xff3e00],
  [317, 'plum', 0x815581],
  [318, 'deeppink', 0xff007e],
  [319, 'pink', 0xbc7d8d],
  [320, 'salmon', 0xffbeaa],
  [321, 'orange', 0xffbe00],
  [322, 'brightorange', 0xffbe00],
  [323, 'orangered', 0xff7e00],
  [324, 'maroon', 0x68004e],
  [325, 'yellow', 0xffff00],
  [326, 'gold', 0xffbe00],
  [327, 'lightyellow', 0xffffaa],
  [328, 'lightgold', 0xffeaaa],
  [329, 'yellowgreen', 0x8dbc00],
  [330, 'springgreen', 0x00ff7e],
  [331, 'green', 0x00bc00],
  [332, 'forestgreen', 0x1f8100],
  [333, 'darkgreen', 0x004f13],
  [334, 'cyan', 0x00ffff],
  [335, 'turquoise', 0x00bcbc],
  [336, 'aquamarine', 0x00ffbe],
  [337, 'blue', 0x0000ff],
  [338, 'royalblue', 0x003eff],
  [339, 'navyblue', 0x000068],
  [340, 'powderblue', 0xaaeaff],
  [341, 'midnight', 0x00134f],
  [342, 'steelblue', 0x008dbc],
  [343, 'indigo', 0x340068],
  [344, 'mauve', 0x5f0081],
  [345, 'violet', 0xffaaea],
  [346, 'magenta', 0xff00ff],
  [347, 'beige', 0xbcac7d],
  [348, 'wheat', 0xffd3aa],
  [349, 'tan', 0xbc8d7d],
  [350, 'sandybrown', 0xbc8d00],
  [351, 'brown', 0x683400],
  [352, 'khaki', 0x818155],
  [353, 'chocolate', 0x4f2700],
  [354, 'darkbrown', 0x4f3a00],
  [355, 'blueviolet', 0x7e00ff],
  [356, 'coral', 0xff7e00],
  [357, 'darkorchid', 0x8d00bc],
  [358, 'dimgrey', 0x696969],
  [359, 'firebrick', 0xbc2d00],
  [360, 'indianred', 0xbc7d7d],
  [361, 'lightblue', 0xaad3ff],
  [362, 'limegreen', 0x3eff00],
  [363, 'mediumaquamarine', 0xaaffea],
  [364, 'sienna', 0x814000],
  [365, 'stateblue', 0x7d7dbc],
]);

/** 61 个字典色名 → 0xRRGGBB（`ColourTableManager` 自己的字典，`COLOUR <name>` 认的就是这些） */
export const PDMS_COLOUR_DICTIONARY: Readonly<Record<string, number>> = Object.freeze({
  black: 0x000000,
  white: 0xffffff,
  whitesmoke: 0xffffff,
  ivory: 0xffffaa,
  grey: 0x828282,
  lightgrey: 0xbdbdbd,
  darkgrey: 0x505050,
  darkslate: 0x354f48,
  red: 0xbc0000,
  brightred: 0xff0000,
  coralred: 0xbc2d00,
  tomato: 0xff3e00,
  plum: 0x815581,
  deeppink: 0xff007e,
  pink: 0xbc7d8d,
  salmon: 0xffbeaa,
  orange: 0xffbe00,
  brightorange: 0xffbe00,
  orangered: 0xff7e00,
  maroon: 0x68004e,
  yellow: 0xffff00,
  gold: 0xffbe00,
  lightyellow: 0xffffaa,
  lightgold: 0xffeaaa,
  yellowgreen: 0x8dbc00,
  springgreen: 0x00ff7e,
  green: 0x00bc00,
  forestgreen: 0x1f8100,
  darkgreen: 0x004f13,
  cyan: 0x00ffff,
  turquoise: 0x00bcbc,
  aquamarine: 0x00ffbe,
  blue: 0x0000ff,
  royalblue: 0x003eff,
  navyblue: 0x000068,
  powderblue: 0xaaeaff,
  midnight: 0x00134f,
  steelblue: 0x008dbc,
  indigo: 0x340068,
  mauve: 0x5f0081,
  violet: 0xffaaea,
  magenta: 0xff00ff,
  beige: 0xbcac7d,
  wheat: 0xffd3aa,
  tan: 0xbc8d7d,
  sandybrown: 0xbc8d00,
  brown: 0x683400,
  khaki: 0x818155,
  chocolate: 0x4f2700,
  darkbrown: 0x4f3a00,
  blueviolet: 0x7e00ff,
  coral: 0xff7e00,
  darkorchid: 0x8d00bc,
  dimgrey: 0x696969,
  firebrick: 0xbc2d00,
  indianred: 0xbc7d7d,
  lightblue: 0xaad3ff,
  limegreen: 0x3eff00,
  mediumaquamarine: 0xaaffea,
  sienna: 0x814000,
  stateblue: 0x7d7dbc,
});

const _byIndex = new Map<number, PdmsColourEntry>(PDMS_COLOUR_TABLE.map((e) => [e[0], e] as const));
const _byName = new Map<string, PdmsColourEntry>();
for (const e of PDMS_COLOUR_TABLE) {
  // 同名多槽（如 grey 在 1 与 270）取最小颜色号，RGB 一致（生成时已校验）
  if (e[1] && !_byName.has(e[1])) _byName.set(e[1], e);
}

/** 颜色名归一：去空白、小写、`light grey` → `lightgrey` */
export function normalizePdmsColourName(name: string): string {
  return String(name ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

/** 按颜色号（1..365）查 */
export function pdmsColourByIndex(index: number): PdmsColourEntry | undefined {
  return _byIndex.get(index);
}

/** 按颜色名查（大小写 / 空格不敏感）；先查表里的命名槽位，再退到 61 色字典 */
export function pdmsColourByName(name: string): PdmsColourEntry | undefined {
  const key = normalizePdmsColourName(name);
  if (!key) return undefined;
  const hit = _byName.get(key);
  if (hit) return hit;
  const dict = PDMS_COLOUR_DICTIONARY[key];
  return dict === undefined ? undefined : [0, key, dict];
}

/**
 * 名字或颜色号 → 0xRRGGBB；查不到返回 undefined。
 * 也接受 `pdms:lightgrey` / `pdms:271` 这种带前缀的写法（materialConfig 颜色字符串用它区分 CSS 颜色名）。
 */
export function pdmsColourHex(nameOrIndex: string | number): number | undefined {
  if (typeof nameOrIndex === 'number') return pdmsColourByIndex(nameOrIndex)?.[2];
  let s = String(nameOrIndex).trim();
  if (/^pdms:/i.test(s)) s = s.slice(5).trim();
  if (/^\d+$/.test(s)) return pdmsColourByIndex(Number(s))?.[2];
  return pdmsColourByName(s)?.[2];
}

/** `pdms:` 前缀判定（故意不做类型谓词：对已知是 string 的变量做 `value is string` 会把 else 分支收窄成 never） */
export function isPdmsColourRef(value: unknown): boolean {
  return typeof value === 'string' && /^\s*pdms:/i.test(value);
}

/** 0xRRGGBB → `#rrggbb` */
export function pdmsHexString(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/**
 * E3D 3.1 出厂图形颜色（`PMLLIB\common\objects\gphcolopt.pmlobj .default()` 与 `gphviewopt.pmlobj .default()`）：
 * 新加元素 / 可见元素 lightgrey，CE yellow，active orange，辅助 aids blue，highlight white（Draft brightred），tracing magenta，
 * 背景 grey，剖切盒封口 lightgrey。Design 模块出厂 `autoColour = false`（只有 Spooler 预置 Spool/Field 两条规则），
 * 所以未配自动着色规则的 E3D 把所有元素都画成 lightgrey #bdbdbd。
 */
export const E3D_GRAPHICS_COLOUR_DEFAULTS = Object.freeze({
  addElement: 'lightgrey',
  visible: 'lightgrey',
  ce: 'yellow',
  active: 'orange',
  aids: 'blue',
  highlight: 'white',
  tracing: 'magenta',
  background: 'grey',
  clipBoxCap: 'lightgrey',
} as const);

/** 出厂 E3D 3.1 元素默认色 lightgrey = #bdbdbd（真机管子暗边 94 = 189 × Ka 0.5 ✓） */
export const E3D_DEFAULT_ELEMENT_COLOUR = pdmsColourHex(E3D_GRAPHICS_COLOUR_DEFAULTS.addElement)!;
