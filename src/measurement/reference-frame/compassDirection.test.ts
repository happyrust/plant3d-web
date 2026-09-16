import { describe, expect, it } from 'vitest';

import {
  formatCompassDirection,
  formatPmlReal,
  parseCompassDirection,
  type CompassVector,
} from './compassDirection';

/** 两点（mm，E / N / U）连线方向：from → to。 */
function between(from: CompassVector, to: CompassVector): CompassVector {
  return [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
}

describe('formatCompassDirection · 对 E3D 已采 golden 的方向字串', () => {
  it('G1 标准距离：`W 11.7755 N 66.1215 D`（trace `G1-current-measure`，E3D 单元格另带 ` WRT /*`，Web 不带）', () => {
    const from: CompassVector = [9769.75, 10047.18, 18664.8];
    const to: CompassVector = [7849.61, 10447.46, 14234.127];
    expect(formatCompassDirection(between(from, to))).toBe('W 11.7755 N 66.1215 D');
  });

  it('G3-02 旋转 WRT：帧内分量 (-400.28, -1920.14, -4430.673) → `S 11.7755 W 66.1215 D`', () => {
    // 主轴是绝对值大的那一路（|V| > |U|），所以第一个字母是 S、第一个角 ≤ 45°；字母指的是帧的轴。
    expect(formatCompassDirection([-400.279999999999, -1920.14, -4430.673])).toBe('S 11.7755 W 66.1215 D');
    expect(formatCompassDirection([-1649.15759729034, -4430.673, -1061.81020775821])).toBe('S 20.416 W 12.6584 D');
  });

  it('G4-01 点→线垂距：Vertical 2500 / Horizontal 500 且水平纯 N → `N 78.6901 U`', () => {
    expect(formatCompassDirection([0, 500, 2500])).toBe('N 78.6901 U');
  });

  it('G4-02：水平纯 S、无倾角 → `S`', () => {
    expect(formatCompassDirection([0, -1500, 0])).toBe('S');
  });

  it('G4-03 点退化垂距：垂足 → 源点 `N 6.66615 W 78.3493 U`（6 位有效数字，不是 4 位小数）', () => {
    // trace 里 from / to 只印到 3 位小数（mm），水平两路分量各带 ±0.0005 mm 的取整，
    // 折到第一个角上是 ~5e-5°，正好碰到第 6 位有效数字；倾角由 vertical_db / horizontal_db 定，逐字对。
    const foot: CompassVector = [9897.433, 8954.701, 13330.416];
    const source: CompassVector = [9769.75, 10047.176, 18664.801];
    const text = formatCompassDirection(between(foot, source));
    expect(text).toMatch(/^N 6\.666\d{1,2} W 78\.3493 U$/);
    expect(formatCompassDirection([-1099.91194867441 * Math.sin(6.66615 * Math.PI / 180), 1099.91194867441 * Math.cos(6.66615 * Math.PI / 180), 5334.38438847279]))
      .toBe('N 6.66615 W 78.3493 U');
  });

  it('G2-03：ΔE = ΔN = ΔU = 1000 → `E 45 N 35.2644 U`（水平打平时 E / W 在前）', () => {
    expect(formatCompassDirection([1000, 1000, 1000])).toBe('E 45 N 35.2644 U');
  });

  it('G6-02 角度窗体：Decimal Places 2 把 `W 11.7755 N 66.8266 D` 出成 `W 11.78 N 66.83 D`（留尾零）', () => {
    const direction1 = parseCompassDirection('W 11.7755 N 66.8266 D')!;
    const direction2 = parseCompassDirection('W 12.9006 S 32.3892 D')!;
    expect(formatCompassDirection(direction1)).toBe('W 11.7755 N 66.8266 D');
    expect(formatCompassDirection(direction1, { decimals: 2 })).toBe('W 11.78 N 66.83 D');
    expect(formatCompassDirection(direction2, { decimals: 2 })).toBe('W 12.90 S 32.39 D');
    expect(formatCompassDirection(direction2, { decimals: 0 })).toBe('W 13 S 32 D');
  });

  it('G8 P-Point 方向串 round-trip（小角度出到 6 位有效数字）', () => {
    for (const text of [
      'S 39.8738 E 89.6276 D',
      'N 0.285797 D',
      'E 0.238736 U',
      'N 89.8263 U',
      'N 0.173675 D',
      'S 0.173675 U',
    ]) {
      expect(formatCompassDirection(parseCompassDirection(text)!)).toBe(text);
    }
  });
});

describe('formatCompassDirection · 边界', () => {
  it('纯竖直只出一个字母', () => {
    expect(formatCompassDirection([0, 0, 1])).toBe('U');
    expect(formatCompassDirection([0, 0, -3])).toBe('D');
  });

  it('正好落在水平轴上时省掉「角度 + 次轴字母」', () => {
    expect(formatCompassDirection([1, 0, 0])).toBe('E');
    expect(formatCompassDirection([-1, 0, 0])).toBe('W');
    expect(formatCompassDirection([0, 1, 1])).toBe('N 45 U');
  });

  it('主轴取水平分量绝对值大的那个，第一个角总在 0–45°', () => {
    // 60° from E toward N → 主轴换成 N，角变成 30°。
    const sixty = [Math.cos((60 * Math.PI) / 180), Math.sin((60 * Math.PI) / 180), 0] as const;
    expect(formatCompassDirection(sixty)).toBe('N 30 E');
    expect(formatCompassDirection([1, 1, 0])).toBe('E 45 N');
    expect(formatCompassDirection([-1, 1, 0])).toBe('W 45 N');
    expect(formatCompassDirection([1, -1, 0])).toBe('E 45 S');
  });

  it('零向量回 fallback；小数位与尾零可调', () => {
    expect(formatCompassDirection([0, 0, 0])).toBe('--');
    expect(formatCompassDirection([0, 0, 0], { fallback: '—' })).toBe('—');
    expect(formatCompassDirection([0, 1, 1], { decimals: 2 })).toBe('N 45.00 U');
    expect(formatCompassDirection([0, 1, 1], { decimals: 2, trailZeros: false })).toBe('N 45 U');
    expect(formatCompassDirection([0, 1, 1], { decimals: 0 })).toBe('N 45 U');
    expect(formatCompassDirection([0, 1, 1], { decimals: 3 })).toBe('N 45.000 U');
  });

  it('从不带 WRT 尾巴（E3D 标准距离表带、Web 三张表都不带，d-515）', () => {
    expect(formatCompassDirection([1000, 1000, 1000])).not.toContain('WRT');
    expect(formatCompassDirection([0, -1, 0])).toBe('S');
  });

  it('分量吸整（golden MD §35 补采 (3)）：归一后 < 1e-6 的分量当噪声归零——实机 P-Point Distance 那两条从 `N 2.71502 W 90 U` / `S 2.71505 E 90 D` 回到 `U` / `D`', () => {
    // 立管两端 ELBO P-Point 各沿自己方向进 200：A 的 API 方向是 (−1.1e-10, −6.3e-7, 1)，派生点继承了 1.26e-7 m 的横向分量（米）。
    expect(formatCompassDirection([2.3e-11, 1.26e-7, 1.199864])).toBe('U');
    // TUBING 轴线两端 P-Point 的 N 坐标差 0.1 µm（米）。
    expect(formatCompassDirection([-9.8e-11, -1.0e-7, -1.199898])).toBe('D');
    // 水平面里同样：纯 N 带 1e-7 的 E 噪声仍是 `N`；带 1e-7 的竖向噪声也不出倾角。
    expect(formatCompassDirection([1e-7, 1, 0])).toBe('N');
    expect(formatCompassDirection([0, 1, 1e-7])).toBe('N');
    // 阈值之上照实出：1e-5 的横向分量是 89.9994° 的倾角，不吸。
    expect(formatCompassDirection([1e-5, 0, 1])).toBe('E 89.9994 U');
    // 吸整只动噪声一路，其它角不变（G2-03 打平那一组照旧）。
    expect(formatCompassDirection([1000, 1000, 1000 + 1e-4])).toBe('E 45 N 35.2644 U');
  });
});

describe('formatPmlReal · PML REAL 缺省字串', () => {
  it('6 位有效数字、去尾零、不出指数记法', () => {
    expect(formatPmlReal(11.775499)).toBe('11.7755');
    expect(formatPmlReal(20.416)).toBe('20.416');
    expect(formatPmlReal(45)).toBe('45');
    expect(formatPmlReal(6.666149)).toBe('6.66615');
    expect(formatPmlReal(0.2857971)).toBe('0.285797');
    expect(formatPmlReal(1e-9)).toBe('0');
  });
});

describe('parseCompassDirection', () => {
  it('三种长度的串都解，WRT 尾巴忽略；解不了回 null', () => {
    expect(parseCompassDirection('U')).toEqual([0, 0, 1]);
    expect(parseCompassDirection('D WRT /*')).toEqual([0, 0, -1]);
    const south = parseCompassDirection('S')!;
    expect(south[0]).toBeCloseTo(0, 12);
    expect(south[1]).toBeCloseTo(-1, 12);
    expect(south[2]).toBeCloseTo(0, 12);
    const tilted = parseCompassDirection('N 45 U WRT /*')!;
    expect(tilted[1]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(tilted[2]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(parseCompassDirection('X 12 Y')).toBeNull();
    expect(parseCompassDirection('--')).toBeNull();
  });
});
