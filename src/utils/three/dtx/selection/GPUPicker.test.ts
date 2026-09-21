import { describe, expect, it } from 'vitest';

import { computePickViewOffset } from './GPUPicker';

// -----------------------------------------------------------------------------------------------
// GPUPicker 的 setViewOffset 尺寸：整幅缺省是整个 renderer；给了子视口（版本对比分屏的左 / 右一格）整幅就是那一格——
// three 的 setViewOffset 会把相机 aspect 置成 fullWidth / fullHeight，分屏拾取靠的正是这一点。
// -----------------------------------------------------------------------------------------------

describe('computePickViewOffset', () => {
  const renderer = { x: 450, y: 727 };

  it('不给子视口：整幅 = renderer，小窗以指针为中心、贴边时夹在整幅之内（原行为）', () => {
    expect(computePickViewOffset({ x: 100, y: 200 }, renderer, 1, 1)).toEqual({
      fullWidth: 450, fullHeight: 727, offsetX: 99, offsetY: 199, viewSize: 3,
    });
    expect(computePickViewOffset({ x: 0, y: 726.9 }, renderer, 1, 1)).toEqual({
      fullWidth: 450, fullHeight: 727, offsetX: 0, offsetY: 724, viewSize: 3,
    });
    // devicePixelRatio 2：整幅与指针都乘上去
    expect(computePickViewOffset({ x: 100, y: 200 }, renderer, 2, 1)).toEqual({
      fullWidth: 900, fullHeight: 1454, offsetX: 199, offsetY: 399, viewSize: 3,
    });
  });

  it('给了右半格子视口：整幅 = 那一格（aspect 随之变成格的宽高比），偏移按格内位置算、贴格边夹住', () => {
    const right = { x: 225, y: 0, width: 225, height: 727 };
    expect(computePickViewOffset({ x: 434.6, y: 251.9 }, renderer, 1, 1, right)).toEqual({
      fullWidth: 225, fullHeight: 727, offsetX: 208, offsetY: 250, viewSize: 3,
    });
    // 压在格的左边界上：格内 x = 0 → 偏移夹到 0
    expect(computePickViewOffset({ x: 225, y: 10 }, renderer, 1, 1, right).offsetX).toBe(0);
    // 格的右边界之外一个像素也夹回最后一个小窗
    expect(computePickViewOffset({ x: 450, y: 10 }, renderer, 1, 1, right).offsetX).toBe(222);
  });
});
