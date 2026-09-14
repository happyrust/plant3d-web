/**
 * PDMS / E3D 的方向罗盘字串（`DIRECTION.string()`）。
 *
 * 形如 `W 11.7755 N 66.1215 D WRT /*`：先在水平面里从**主轴字母**朝**次轴字母**转 `11.7755°`，
 * 再从这个水平方向朝 `D`（下）倾 `66.1215°`，尾巴是这条方向的 wrt。水平分量正好落在某一根轴上时
 * 省掉「角度 + 次轴字母」那一段（`N 78.6901 U`）；方向就在水平面里时省掉倾角那一段（`S`）；
 * 纯竖直只剩 `U` / `D`。
 *
 * 主轴取水平两个分量里**绝对值大的那个**，所以第一个角总在 0–45°；正好 45° 时 E3D 出的是
 * `E 45 N`（G2-03 `E 45 N 35.2644 U`），所以打平给 E / W。
 *
 * **数字是 PML REAL 的缺省字串：6 位有效数字、去尾零**，不是固定 4 位小数 ——
 * `N 6.66615 W 78.3493 U`（G4-03）、`S 20.416 W 12.6584 D`（G3-02）、`N 0.285797 D`（G8）。
 * 角度窗体另有一档：`gphanglemeasure.pmlfrm` 374–385 把 `.string()` 按空格拆开，能解析成 REAL
 * 的每一段再按 `Decimal Places` 走一遍 `!!realFmt`（固定小数位、留尾零）—— 传 `decimals` 走这条路。
 *
 * 三个轴与字母的对应按当前参考系的三根轴走（E3D 在旋转 WRT 下也出罗盘字母，字母指的是那个帧的轴，
 * G3-02 `S 11.7755 W 66.1215 D WRT /Copy-of-RCS151MM`）：轴 1 → `E` / `W`，轴 2 → `N` / `S`，
 * 轴 3 → `U` / `D`。
 *
 * `WRT` 尾巴：`DIRECTION.string()` 自带 ` WRT <名字>`（World 是 `/*`）。E3D 三张结果表里只有
 * Measure Distance 的标准结果表原样显示它（`gphmeasure.pmlfrm` 403 只 `.trim()`；截图
 * `G1-02-result.png`），Perpendicular（666）与角度窗体（371 / 392）都 `.before('WRT')` 切掉 ——
 * 由调用方决定传不传 `wrt`。
 *
 * 对过的 golden（`docs/verification/e3d-measurement-runtime-golden-capture.md` §7 / §8 与 trace）：
 * - G1 标准距离：`W 11.7755 N 66.1215 D WRT /*`；
 * - G3-02 旋转 WRT：分量 `U -400.28 / V -1920.14 / W -4430.67` → `S 11.7755 W 66.1215 D`；
 * - G4-01 点→线垂距：`Vertical 2500 / Horizontal 500`、水平纯 N → `N 78.6901 U`；
 * - G4-03 点退化垂距：`N 6.66615 W 78.3493 U`；
 * - G6-02 三点角 Direction1 `W 11.7755 N 66.8266 D`（Decimal Places 2 → `W 11.78 N 66.83 D`）。
 */
export type CompassVector = readonly [number, number, number];

export type CompassDirectionOptions = Readonly<{
  /**
   * 给了就走角度窗体那条路：每个角度按这个小数位重新格式化（`!!realFmt`，留尾零）。
   * 不给就是 `DIRECTION.string()` 本身的样子（6 位有效数字、去尾零）。
   */
  decimals?: number;
  /** 只在给了 `decimals` 时有意义：`false` 去尾零。缺省 `true`（`realFmt` 只设了 `dp`）。 */
  trailZeros?: boolean;
  /** 方向不可用（零向量）时回这个，缺省 `--`（`gphmeasure.pmlfrm` 394 / 663）。 */
  fallback?: string;
  /** 给了就在尾巴加 ` WRT <wrt>`（World 传 `/*`）。零向量的 fallback 不加。 */
  wrt?: string;
}>;

/** 小于它就当那一路分量是 0（单位向量上约等于 6e-9 度）。 */
const ZERO = 1e-10;

/** PML REAL 缺省字串的有效数字位数。 */
const REAL_SIGNIFICANT_DIGITS = 6;

function clampDecimals(value: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return 4;
  return Math.max(0, Math.min(8, n));
}

function stripTrailingZeros(text: string): string {
  if (!text.includes('.')) return text;
  return text.replace(/0+$/, '').replace(/\.$/, '');
}

/** PML REAL → 字串：6 位有效数字、去尾零、不出指数记法。 */
export function formatPmlReal(value: number): string {
  const magnitude = Math.abs(value);
  const precise = magnitude.toPrecision(REAL_SIGNIFICANT_DIGITS);
  // 极小的数 toPrecision 会给指数记法；PML 不会，退回固定小数位（这种角度肉眼就是 0）。
  const text = precise.includes('e') ? magnitude.toFixed(REAL_SIGNIFICANT_DIGITS) : precise;
  return stripTrailingZeros(text);
}

function formatAngle(deg: number, options: CompassDirectionOptions | undefined): string {
  const pml = formatPmlReal(deg);
  if (options?.decimals === undefined) return pml;
  // 角度窗体：先拿到 `.string()` 的 6 位字串，再 REAL() 回来按 Decimal Places 出 —— 两次取整照做。
  const fixed = Number(pml).toFixed(clampDecimals(options.decimals));
  return options.trailZeros === false ? stripTrailingZeros(fixed) : fixed;
}

/**
 * 把一个方向向量写成罗盘字串。入参不必是单位向量（内部归一）；零向量回 `fallback`。
 */
export function formatCompassDirection(
  vector: CompassVector,
  options?: CompassDirectionOptions,
): string {
  const fallback = options?.fallback ?? '--';
  const [x, y, z] = vector.map((component) => (Number.isFinite(component) ? Number(component) : 0));
  const length = Math.hypot(x!, y!, z!);
  if (!(length > ZERO)) return fallback;

  const east = x! / length;
  const north = y! / length;
  const up = z! / length;
  const horizontal = Math.hypot(east, north);
  const suffix = options?.wrt ? ` WRT ${options.wrt}` : '';

  // 纯竖直：只有 U / D 一个字母。
  if (horizontal <= ZERO) return `${up >= 0 ? 'U' : 'D'}${suffix}`;

  const eastLetter = east >= 0 ? 'E' : 'W';
  const northLetter = north >= 0 ? 'N' : 'S';
  // 主轴取水平分量绝对值大的那个；打平给 E / W（G2-03 `E 45 N 35.2644 U`）。
  const eastDominant = Math.abs(east) >= Math.abs(north);
  const primaryLetter = eastDominant ? eastLetter : northLetter;
  const secondaryLetter = eastDominant ? northLetter : eastLetter;
  const primaryValue = eastDominant ? Math.abs(east) : Math.abs(north);
  const secondaryValue = eastDominant ? Math.abs(north) : Math.abs(east);

  const parts: string[] = [primaryLetter];
  if (secondaryValue > ZERO) {
    const swing = (Math.atan2(secondaryValue, primaryValue) * 180) / Math.PI;
    parts.push(formatAngle(swing, options), secondaryLetter);
  }
  if (Math.abs(up) > ZERO) {
    const tilt = (Math.atan2(Math.abs(up), horizontal) * 180) / Math.PI;
    parts.push(formatAngle(tilt, options), up >= 0 ? 'U' : 'D');
  }
  return `${parts.join(' ')}${suffix}`;
}

const COMPASS_TOKEN = /^([NSEW])(?:\s+(\d+(?:\.\d+)?)\s+([NSEW]))?(?:\s+(\d+(?:\.\d+)?)\s+([UD]))?$|^([UD])$/;

/**
 * 反解一条罗盘字串（不含 WRT 尾巴）成单位向量；解析不了回 null。
 * 主要给 golden 用例做 round-trip，与 `formatCompassDirection` 同一套字母 ↔ 轴约定。
 */
export function parseCompassDirection(text: string): CompassVector | null {
  const body = text.split('WRT')[0]!.trim();
  const match = COMPASS_TOKEN.exec(body);
  if (!match) return null;
  if (match[6]) return match[6] === 'U' ? [0, 0, 1] : [0, 0, -1];
  const axis = (letter: string): readonly [number, number] => {
    switch (letter) {
      case 'E': return [1, 0];
      case 'W': return [-1, 0];
      case 'N': return [0, 1];
      default: return [0, -1];
    }
  };
  const [fx, fy] = axis(match[1]!);
  const swing = match[2] === undefined ? 0 : (Number(match[2]) * Math.PI) / 180;
  const [tx, ty] = match[3] === undefined ? [0, 0] : axis(match[3]);
  const tilt = match[4] === undefined ? 0 : (Number(match[4]) * Math.PI) / 180;
  const horizontal = Math.cos(tilt);
  const vertical = match[5] === 'D' ? -Math.sin(tilt) : Math.sin(tilt);
  return [
    horizontal * (fx * Math.cos(swing) + tx * Math.sin(swing)),
    horizontal * (fy * Math.cos(swing) + ty * Math.sin(swing)),
    vertical,
  ];
}
