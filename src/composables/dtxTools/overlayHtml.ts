/**
 * 标签 / 图钉 / 卡片的 HTML 与样式串，标签点击动作。
 * 从 useDtxTools.ts 拆出（docs/plans/2026-10-26-usedtxtools-split-plan.md 第 1 步），实现未改。
 */
import { escapeAnnotationLabelText } from './geometry';

import type { AnnotationLabelClickResult, AnnotationLabelClickState, AnnotationOverlayKind } from './types';
import type { AnnotationDegrade } from '@/review/domain/bindingResolve';

import { buildAnnotationDegradeBadgeHtml, pinSvgPaint } from '@/composables/annotationDegradeViewport';

export function buildAnnotationLabelStyleText(): string {
  return [
    'position:absolute',
    'transform:translate(-50%,-110%)',
    'pointer-events:auto',
    'cursor:pointer',
    'user-select:none',
    'z-index:910',
    'max-width:280px',
    'padding:10px 12px',
    'border-radius:14px',
    'border:1px solid rgba(148,163,184,0.45)',
    'background:rgba(15,23,42,0.92)',
    'color:#e2e8f0',
    'box-shadow:0 14px 32px rgba(15,23,42,0.35)',
    'backdrop-filter:blur(10px)',
    'white-space:pre-wrap',
    'font-family:\'Segoe UI\',\'PingFang SC\',sans-serif',
    'line-height:1.45',
  ].join(';');
}

export function buildAnnotationLabelHtml(title: string, description: string): string {
  const safeTitle = escapeAnnotationLabelText(title);
  const safeDescription = escapeAnnotationLabelText(description || '');
  const descriptionHtml = safeDescription
    ? `<div data-role="annotation-description" style="margin-top:6px;font-size:12px;line-height:1.5;color:rgba(226,232,240,0.9);">${safeDescription}</div>`
    : '';
  return [
    `<div data-role="annotation-title" style="font-weight:700;font-size:13px;line-height:1.3;color:#f8fafc;">${safeTitle}</div>`,
    descriptionHtml,
  ].join('');
}

export function buildTextAnnotationMarkerStyleText(collapsed: boolean, color = '#ef4444'): string {
  if (collapsed) {
    return [
      'position:absolute',
      'transform:translate(-50%,-100%)',
      'pointer-events:auto',
      'user-select:none',
      'cursor:pointer',
      'z-index:920',
      'width:22px',
      'height:28px',
      'filter:drop-shadow(0 4px 8px rgba(15,23,42,0.28))',
      `color:${color}`,
    ].join(';');
  }
  return [
    'position:absolute',
    'transform:translate(-50%,-100%)',
    'pointer-events:auto',
    'user-select:none',
    'cursor:pointer',
    'z-index:920',
    'width:18px',
    'height:24px',
    'filter:drop-shadow(0 4px 8px rgba(15,23,42,0.24))',
    `color:${color}`,
  ].join(';');
}

/**
 * 图钉的降级外观（ADR-0050 视口降级）：`degrade` 非空 → 灰填充 + 深灰虚线描边；`badge` 为 true 时再在图钉左上角挂一枚小徽标。
 * 云线的图钉不带徽标（云线的徽标挂在轮廓参考框左上角，一条记录只出一枚）。
 */
export type MarkerDegradeOptions = {
  degrade: AnnotationDegrade | null
  badge: boolean
}

export function buildTextAnnotationMarkerHtml(
  glyph: string,
  collapsed: boolean,
  degradeOptions: MarkerDegradeOptions | null = null,
): string {
  const degrade = degradeOptions?.degrade ?? null;
  const paint = pinSvgPaint(degrade);
  // 徽标贴图钉左上角外侧：右缘离图钉左缘 4px，顶部与字泡同高
  const badgeHtml = degrade && degradeOptions?.badge
    ? buildAnnotationDegradeBadgeHtml(degrade, 'position:absolute;left:-4px;top:-6px;transform:translate(-100%,0);pointer-events:none;')
    : '';
  if (collapsed) {
    return [
      '<div data-marker-kind="location-pin" style="position:relative;width:22px;height:28px;">',
      '<svg viewBox="0 0 24 32" width="22" height="28" aria-hidden="true">',
      `<path d="M12 1.5C6.2 1.5 1.5 6.2 1.5 12c0 7.6 8.5 16.1 9.6 17.1a1.3 1.3 0 0 0 1.8 0c1.1-1 9.6-9.5 9.6-17.1C22.5 6.2 17.8 1.5 12 1.5Z" fill="${paint.fill}" stroke="${paint.stroke}" stroke-width="1.4"${paint.dashAttr}/>`,
      '<circle cx="12" cy="12" r="4.2" fill="#ffffff"/>',
      '</svg>',
      badgeHtml,
      '</div>',
    ].join('');
  }
  return [
    '<div data-marker-kind="push-pin" style="position:relative;width:18px;height:24px;">',
    '<svg viewBox="0 0 18 24" width="18" height="24" aria-hidden="true">',
    `<path d="M6 2.5h6l-.8 4.2 2.5 2.5v1.5H4.3V9.2l2.5-2.5L6 2.5Z" fill="${paint.fill}" stroke="${paint.stroke}" stroke-width="1.1" stroke-linejoin="round"${paint.dashAttr}/>`,
    `<path d="M9 10.8V21.8" stroke="${degrade ? paint.stroke : '#ffffff'}" stroke-width="1.4" stroke-linecap="round"${paint.dashAttr}/>`,
    `<circle cx="9" cy="22.4" r="1.2" fill="${paint.fill}"/>`,
    '</svg>',
    `<div data-role="annotation-glyph" style="position:absolute;right:-10px;top:-6px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:${paint.bubbleBackground};color:#f8fafc;font:700 10px/16px 'Segoe UI',sans-serif;text-align:center;">${escapeAnnotationLabelText(glyph)}</div>`,
    badgeHtml,
    '</div>',
  ].join('');
}

export function buildInlineAnnotationCardHtml(kindLabel: string, title: string, description: string): string {
  const safeTitle = escapeAnnotationLabelText(title);
  const safeDescription = escapeAnnotationLabelText(description || '');
  const safeKindLabel = escapeAnnotationLabelText(kindLabel);
  return [
    '<div data-role="annotation-card-shell" style="display:flex;flex-direction:column;gap:8px;">',
    '<div data-role="annotation-drag-handle" style="display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:grab;color:rgba(226,232,240,0.8);font-size:11px;letter-spacing:0.04em;text-transform:uppercase;">',
    `<span>${safeKindLabel}</span>`,
    '<span style="display:inline-flex;gap:3px;"><span style="width:4px;height:4px;border-radius:999px;background:rgba(226,232,240,0.55);"></span><span style="width:4px;height:4px;border-radius:999px;background:rgba(226,232,240,0.55);"></span><span style="width:4px;height:4px;border-radius:999px;background:rgba(226,232,240,0.55);"></span></span>',
    '</div>',
    `<input data-role="annotation-title-input" value="${safeTitle}" placeholder="输入批注标题" style="height:28px;border:none;outline:none;background:transparent;color:#f8fafc;font:700 13px/1.3 'Segoe UI','PingFang SC',sans-serif;padding:0;" />`,
    `<textarea data-role="annotation-description-input" placeholder="输入批注描述（可选）" style="min-height:52px;border:none;outline:none;resize:none;background:transparent;color:rgba(226,232,240,0.92);font:400 12px/1.5 'Segoe UI','PingFang SC',sans-serif;padding:0;">${safeDescription}</textarea>`,
    '</div>',
  ].join('');
}

export function buildTextAnnotationCardHtml(title: string, description: string): string {
  return buildInlineAnnotationCardHtml('批注', title, description);
}

export function resolveAnnotationLabelClickAction(
  prevState: AnnotationLabelClickState | null,
  annotationType: AnnotationOverlayKind,
  annotationId: string,
  timestamp: number,
  thresholdMs = 400,
): AnnotationLabelClickResult {
  const isDoubleClick = !!prevState
    && prevState.annotationId === annotationId
    && prevState.annotationType === annotationType
    && timestamp - prevState.timestamp < thresholdMs;

  if (isDoubleClick) {
    return {
      action: 'edit',
      nextState: null,
    };
  }

  return {
    action: 'activate',
    nextState: {
      annotationId,
      annotationType,
      timestamp,
    },
  };
}
