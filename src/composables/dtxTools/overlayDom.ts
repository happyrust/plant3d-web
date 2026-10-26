/**
 * overlay DOM 工厂：图钉 / 标签 / 卡片元素。
 * 从 useDtxTools.ts 拆出（docs/plans/2026-10-26-usedtxtools-split-plan.md 第 1 步），实现未改。
 */
import { type MarkerDegradeOptions, buildAnnotationLabelHtml, buildAnnotationLabelStyleText, buildInlineAnnotationCardHtml, buildTextAnnotationMarkerHtml, buildTextAnnotationMarkerStyleText } from './overlayHtml';

import type { LabelEl } from './types';
import type { AnnotationDegrade } from '@/review/domain/bindingResolve';

import { markPinElDegrade, sameDegrade } from '@/composables/annotationDegradeViewport';

export function ensureDiv(parent: HTMLElement, className: string, styleText: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  el.style.cssText = styleText;
  parent.appendChild(el);
  return el;
}

function makeMarkerEl(parent: HTMLElement, text: string, color: string): HTMLDivElement {
  // SolveSpace 风格：透明背景、纯文本+描边、无圆形气泡
  const el = ensureDiv(
    parent,
    'dtx-anno-marker',
    [
      'position:absolute',
      'transform:translate(-50%,-100%)',
      'pointer-events:auto',
      'user-select:none',
      'z-index:920',
      `color:${color}`,
      'font-family:\'Roboto Mono\',\'Consolas\',monospace',
      'font-size:12px',
      'font-weight:700',
      'background:transparent',
      'box-shadow:none',
      'border:none',
      'text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000',
    ].join(';')
  );
  el.textContent = text;
  return el;
}

const MARKER_NORMAL_TITLE = '单击选中，双击展开/收起';

export function makeTextAnnotationMarkerEl(
  parent: HTMLElement,
  glyph: string,
  collapsed: boolean,
  degradeOptions: MarkerDegradeOptions | null = null,
): HTMLDivElement {
  const el = ensureDiv(
    parent,
    'dtx-anno-marker',
    buildTextAnnotationMarkerStyleText(collapsed),
  );
  el.innerHTML = buildTextAnnotationMarkerHtml(glyph, collapsed, degradeOptions);
  markPinElDegrade(el, degradeOptions?.degrade ?? null, MARKER_NORMAL_TITLE);
  el.setAttribute('aria-label', '文字批注图钉，单击选中，双击展开或收起');
  if (collapsed) {
    el.dataset.markerKind = 'location-pin';
  } else {
    el.dataset.markerKind = 'push-pin';
  }
  return el;
}

/** 图钉降级态变了就原地重画 SVG（元素与事件监听不动）；没变直接返回 false */
export function repaintMarkerDegrade(entry: LabelEl, degrade: AnnotationDegrade | null): boolean {
  const meta = entry.marker;
  if (!meta || sameDegrade(meta.degrade, degrade)) return false;
  meta.degrade = degrade;
  entry.el.innerHTML = buildTextAnnotationMarkerHtml(meta.glyph, meta.collapsed, { degrade, badge: meta.kind !== 'cloud' });
  markPinElDegrade(entry.el, degrade, MARKER_NORMAL_TITLE);
  return true;
}

function makeLabelEl(parent: HTMLElement, title: string, description: string): HTMLDivElement {
  const el = ensureDiv(
    parent,
    'dtx-anno-label',
    buildAnnotationLabelStyleText()
  );
  el.innerHTML = buildAnnotationLabelHtml(title, description);
  return el;
}

export function makeTextAnnotationCardEl(parent: HTMLElement, title: string, description: string): HTMLDivElement {
  return makeInlineAnnotationCardEl(parent, '批注', title, description);
}

export function makeInlineAnnotationCardEl(
  parent: HTMLElement,
  kindLabel: string,
  title: string,
  description: string,
): HTMLDivElement {
  const el = ensureDiv(
    parent,
    'dtx-anno-label',
    buildAnnotationLabelStyleText(),
  );
  el.innerHTML = buildInlineAnnotationCardHtml(kindLabel, title, description);
  return el;
}
