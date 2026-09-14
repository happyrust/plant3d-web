import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LABEL_PREFERENCE,
  LABEL_SAFE_INSET_PX,
  LABEL_SIDE_GAP_PX,
  chooseNearestFeasibleLabelRect,
  closestSegmentPair,
  closestStrokeRectanglePair,
  desiredLabelTopLeft,
  labelOffsetFromTopLeft,
  layoutCloudLabel,
  polygonIntersectsRect,
  rectToCloudFrame,
  type RectPx,
} from './labelLayout';

const viewport: RectPx = { x: 0, y: 0, width: 1600, height: 900 };
const bounds: RectPx = { x: 400, y: 300, width: 300, height: 200 };
const frame = rectToCloudFrame(bounds);
const label = { width: 220, height: 90 };

describe('closestSegmentPair / closestStrokeRectanglePair', () => {
  it('不相交线段：最近点对落在端点与对方线段的垂足上', () => {
    const pair = closestSegmentPair({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 4, y: 5 }, { x: 4, y: 15 });
    expect(pair.p).toEqual({ x: 4, y: 0 });
    expect(pair.q).toEqual({ x: 4, y: 5 });
    expect(pair.distanceSq).toBe(25);
  });

  it('相交线段距离为 0', () => {
    expect(closestSegmentPair({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }).distanceSq).toBe(0);
  });

  it('引线取「轮廓线段 × 矩形四边」的最近线段对，不是最近顶点、也不是距文字中心最近的点', () => {
    // 文字框在参考框右侧偏下：最近对应是参考框右边 (700, y) ↔ 文字框左边 (760, y)，y 取两边重叠区间里的点
    const rect: RectPx = { x: 760, y: 420, width: 200, height: 80 };
    const pair = closestStrokeRectanglePair(frame.visibleStrokes, rect)!;
    expect(pair.distanceSq).toBe(60 * 60);
    expect(pair.onStroke.x).toBe(700);
    expect(pair.onRectangle.x).toBe(760);
    expect(pair.onStroke.y).toBe(pair.onRectangle.y);
    expect(pair.onStroke.y).toBeGreaterThanOrEqual(420);
    expect(pair.onStroke.y).toBeLessThanOrEqual(500);
    // 若按「最近顶点」算会是参考框右下角 (700,500) → 距离更大
    expect(pair.distanceSq).toBeLessThan((760 - 700) ** 2 + (500 - 420) ** 2);
  });

  it('同分保留先遇到的线段对，重复调用结果稳定', () => {
    // 文字框正好在参考框右上角对角线外：右边与上边到矩形距离相同
    const rect: RectPx = { x: 740, y: 200, width: 100, height: 60 };
    const a = closestStrokeRectanglePair(frame.visibleStrokes, rect)!;
    const b = closestStrokeRectanglePair(frame.visibleStrokes, rect)!;
    expect(a).toEqual(b);
  });
});

describe('polygonIntersectsRect', () => {
  it('分离 / 顶点互含 / 仅边相交三种情形', () => {
    expect(polygonIntersectsRect(frame.enclosure, { x: 800, y: 300, width: 100, height: 100 })).toBe(false);
    expect(polygonIntersectsRect(frame.enclosure, { x: 650, y: 450, width: 100, height: 100 })).toBe(true); // 矩形角在多边形内
    expect(polygonIntersectsRect(frame.enclosure, { x: 300, y: 200, width: 600, height: 400 })).toBe(true); // 多边形整个在矩形内
    expect(polygonIntersectsRect(frame.enclosure, { x: 350, y: 380, width: 400, height: 20 })).toBe(true); // 只有边穿过
  });
});

describe('layoutCloudLabel', () => {
  it('默认右上角 + 18 px：期望位置可放就原样落下，引线从参考框右边引到文字框左边', () => {
    const result = layoutCloudLabel(frame, DEFAULT_LABEL_PREFERENCE, label, viewport);
    expect(result.rect).toEqual({ x: 718, y: 300, width: 220, height: 90 });
    expect(result.displaced).toBe(false);
    expect(result.overlaps).toBe(false);
    expect(result.leader).toEqual({ start: { x: 700, y: 300 }, end: { x: 718, y: 300 } });
  });

  it('夹紧可逆：视口缩小时文字框被夹进安全区，意图偏移不变；视口恢复后回到原位', () => {
    const preference = { uv: [1, 0] as const, offsetPx: { x: 18, y: 0 } };
    const wide = layoutCloudLabel(frame, preference, label, viewport);
    const narrow = layoutCloudLabel(frame, preference, label, { x: 0, y: 0, width: 800, height: 900 });
    expect(narrow.displaced).toBe(true);
    expect(narrow.rect.x + narrow.rect.width).toBe(800 - LABEL_SAFE_INSET_PX);
    // 由夹紧后的位置反算出的偏移 ≠ 意图偏移；持久化只存意图，所以视口恢复后仍回原位
    expect(labelOffsetFromTopLeft(bounds, preference.uv, narrow.rect)).not.toEqual(preference.offsetPx);
    expect(layoutCloudLabel(frame, preference, label, viewport).rect).toEqual(wide.rect);
  });

  it('意图偏移与文字框左上角互逆（拖动提交用）', () => {
    const topLeft = { x: 123.5, y: 456.25 };
    const offset = labelOffsetFromTopLeft(bounds, [1, 0], topLeft);
    expect(desiredLabelTopLeft(bounds, { uv: [1, 0], offsetPx: offset })).toEqual(topLeft);
  });

  it('期望位置压进云线内部时改到最近的一侧，并避免与云线重叠', () => {
    // 意图偏移把文字框拖进参考框内部
    const preference = { uv: [1, 0] as const, offsetPx: { x: -250, y: 40 } };
    const result = layoutCloudLabel(frame, preference, label, viewport);
    expect(result.overlaps).toBe(false);
    expect(result.displaced).toBe(true);
    expect(polygonIntersectsRect(frame.enclosure, result.rect)).toBe(false);
    // 期望左上角 (450, 340)。候选：右 (712, 340) 距 262、左 (168, 340) 距 282、下 (450, 512) 距 172、上 (450, 198) 距 142 → 取上
    expect(result.rect.x).toBe(450);
    expect(result.rect.y).toBe(bounds.y - LABEL_SIDE_GAP_PX - label.height);
    // 引线：参考框上边 (·, 300) ↔ 文字框下边 (·, 288)，间距 12 px
    expect(result.leader).not.toBeNull();
    expect(result.leader!.start.y).toBe(300);
    expect(result.leader!.end.y).toBe(288);
  });

  it('四侧候选同分时按 右 → 左 → 下 → 上 固定顺序取', () => {
    const square: RectPx = { x: 700, y: 400, width: 200, height: 200 };
    const squareFrame = rectToCloudFrame(square);
    const size = { width: 100, height: 100 };
    // 期望位置正好在参考框中心：右 / 左 / 下 / 上 到期望位置的距离两两相等
    const desired = { x: 750, y: 450 };
    const picked = chooseNearestFeasibleLabelRect({ desired, size, safeViewport: viewport, enclosure: squareFrame.enclosure, referenceBounds: square });
    expect(picked.overlaps).toBe(false);
    // 右侧 x = 912，左侧 x = 588：|912-750| = |588-750| = 162 → 取右
    expect(picked.rect.x).toBe(square.x + square.width + LABEL_SIDE_GAP_PX);
  });

  it('云线盖满视口、四侧都放不下：允许覆盖显示，标记 overlaps 且不画引线', () => {
    const huge = rectToCloudFrame({ x: -100, y: -100, width: 1800, height: 1100 });
    const result = layoutCloudLabel(huge, DEFAULT_LABEL_PREFERENCE, label, viewport);
    expect(result.overlaps).toBe(true);
    expect(result.leader).toBeNull();
    // 仍夹在安全区内
    expect(result.rect.x).toBeGreaterThanOrEqual(LABEL_SAFE_INSET_PX);
    expect(result.rect.y).toBeGreaterThanOrEqual(LABEL_SAFE_INSET_PX);
  });

  it('文字框比安全区还大时先压到安全区尺寸', () => {
    const result = layoutCloudLabel(frame, DEFAULT_LABEL_PREFERENCE, { width: 5000, height: 60 }, viewport);
    expect(result.rect.width).toBe(viewport.width - LABEL_SAFE_INSET_PX * 2);
    expect(result.rect.x).toBe(LABEL_SAFE_INSET_PX);
  });

  it('文字框紧贴云线边界（距离 ≤ 1 px）时不画零长度引线', () => {
    const preference = { uv: [1, 0] as const, offsetPx: { x: 0.5, y: 0 } };
    const result = layoutCloudLabel(frame, preference, label, viewport);
    expect(result.overlaps).toBe(false);
    expect(result.leader).toBeNull();
  });
});
