/**
 * 批注视口降级外观（ADR-0050「面板与视口以降级样式提示，沿用尺寸系统 STALE 视觉语义」）——three.js 材质与 DOM 的适配层，无状态。
 *
 * 口径见 `ANNOTATION_DEGRADE_VIEWPORT_STYLE`：记录里任一绑定 missing、或锚点 stale 时，云线轮廓、bbox3d 波浪盒、锚点小针、引线与
 * DOM 图钉一律改中性灰 + 虚线；missing / stale 的区分交给左上角一枚小徽标——云线挂在轮廓参考框左上角外侧，图钉挂在自身左上角。
 * 渲染仍只读记录里的坐标快照；这里只换外观，不动几何、不写记录。
 *
 * 由 `useDtxTools` 在 syncFromStore（创建时）与解析表变化（就地更新，不重建 DOM / 几何）两处调用。
 */

import type { MeshLineMaterial } from '@lume/three-meshline';
import type { LineDashedMaterial } from 'three';

import { ANNOTATION_DEGRADE_VIEWPORT_STYLE, type AnnotationDegrade } from '@/review/domain/bindingResolve';

/**
 * MeshLine 的 `dashArray` 以整条折线的 counters（0..1）计，不是世界单位：
 * 引线 2 个点 → 约 8 段；云线轮廓（16–200 段波浪）→ 约 48 段，肉眼看是均匀的短虚线。
 */
export const LEADER_DASH_ARRAY = 1 / 8;
export const CLOUD_OUTLINE_DASH_ARRAY = 1 / 48;
export const DEGRADE_DASH_RATIO = 0.5;

/** 同一记录两次算出的降级态是否等价（状态 + tooltip 文本）——相同就不重设材质 / 不重绘图钉 */
export function sameDegrade(a: AnnotationDegrade | null | undefined, b: AnnotationDegrade | null | undefined): boolean {
  return (a?.state ?? null) === (b?.state ?? null) && (a?.title ?? '') === (b?.title ?? '');
}

/** 带 MeshLine 材质的引线（`useDtxTools` 的 AnnotationLeaderVisual 结构子集） */
export type DegradableLeader = {
  coreMaterial: MeshLineMaterial;
  haloMaterial: MeshLineMaterial;
  /** 上次应用的降级态；就地更新时据此跳过没变的 */
  degrade?: AnnotationDegrade | null;
};

/** 引线：芯线换灰 + 虚线；halo 同步虚线，否则空档里会露出实心 halo。恢复时芯线回 `normalColor`。 */
export function applyLeaderDegrade(leader: DegradableLeader, normalColor: number, degrade: AnnotationDegrade | null): void {
  const dashed = degrade !== null;
  leader.coreMaterial.color.setHex(dashed ? ANNOTATION_DEGRADE_VIEWPORT_STYLE.lineColor : normalColor);
  for (const material of [leader.coreMaterial, leader.haloMaterial]) {
    // dashArray 的 setter 会同步 useDash（非 0 开、0 关）
    material.dashArray = dashed ? LEADER_DASH_ARRAY : 0;
    material.dashRatio = DEGRADE_DASH_RATIO;
  }
  leader.degrade = degrade;
}

/** MeshLine 轮廓（云线 billboard 波浪线）：颜色 + 虚线 */
export function applyMeshLineDegrade(
  material: MeshLineMaterial,
  normalColor: number,
  degrade: AnnotationDegrade | null,
  dashArray: number = CLOUD_OUTLINE_DASH_ARRAY,
): void {
  const dashed = degrade !== null;
  material.color.setHex(dashed ? ANNOTATION_DEGRADE_VIEWPORT_STYLE.lineColor : normalColor);
  material.dashArray = dashed ? dashArray : 0;
  material.dashRatio = DEGRADE_DASH_RATIO;
}

/**
 * three 的 `LineDashedMaterial`：`gapSize = 0` 时 shader 里 `mod(d, dashSize + 0) > dashSize` 永不成立、永不 discard，
 * 等价实线——所以正常态也用它，不必在 LineBasicMaterial 与 LineDashedMaterial 之间来回换材质（换材质要管 dispose）。
 * 几何必须先 `computeLineDistances()`，否则 `lineDistance` 属性缺失时一律按 0 算（也是实线，不会报错）。
 * `dashSize` 是世界单位，由调用方按几何尺度给；给 0 = 这一帧算不出尺度，退回实线灰。
 */
export function applyDashedLineDegrade(
  material: LineDashedMaterial,
  normalColor: number,
  degrade: AnnotationDegrade | null,
  dashSize: number,
): void {
  const degraded = degrade !== null;
  const dashed = degraded && Number.isFinite(dashSize) && dashSize > 0;
  material.color.setHex(degraded ? ANNOTATION_DEGRADE_VIEWPORT_STYLE.lineColor : normalColor);
  material.dashSize = dashed ? dashSize : 1;
  material.gapSize = dashed ? dashSize * 0.75 : 0;
}

/** 波浪盒的虚线节拍：包围盒对角线的 1.5%（一条边约 40 段）；对角线退化 / 非法回 0 */
export function dashSizeFromBounds(min: ArrayLike<number>, max: ArrayLike<number>): number {
  const dx = (max[0] ?? Number.NaN) - (min[0] ?? Number.NaN);
  const dy = (max[1] ?? Number.NaN) - (min[1] ?? Number.NaN);
  const dz = (max[2] ?? Number.NaN) - (min[2] ?? Number.NaN);
  const diagonal = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return Number.isFinite(diagonal) && diagonal > 0 ? diagonal * 0.015 : 0;
}

/** 锚点小针的虚线节拍：针长 ≈ 锚点到文字框距离的 24%，取距离的 4% 让针身约 6 段 */
export function pinDashSizeFromDistance(distance: number): number {
  return Number.isFinite(distance) && distance > 0 ? distance * 0.04 : 0;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 小徽标 HTML（图钉内嵌与云线独立元素共用）；`extraStyle` 追加定位样式 */
export function buildAnnotationDegradeBadgeHtml(degrade: AnnotationDegrade, extraStyle = ''): string {
  const badge = ANNOTATION_DEGRADE_VIEWPORT_STYLE.badge[degrade.state];
  return [
    `<div data-role="annotation-binding-badge" data-binding-state="${degrade.state}" title="${escapeHtml(degrade.title)}" style="`,
    'display:inline-block;height:14px;padding:0 5px;border-radius:999px;',
    `border:1px solid ${badge.border};background:${badge.background};color:${badge.color};`,
    'font:700 9px/12px \'Segoe UI\',\'PingFang SC\',sans-serif;white-space:nowrap;letter-spacing:0.02em;',
    `box-shadow:0 1px 2px rgba(15,23,42,0.18);${extraStyle}">`,
    escapeHtml(degrade.label),
    '</div>',
  ].join('');
}

/** 图钉 SVG 的降级取色：填充灰、描边深灰 + 虚线；正常态回原色（红填充、白描边、深底字泡） */
export function pinSvgPaint(degrade: AnnotationDegrade | null): {
  fill: string;
  stroke: string;
  /** 直接拼进 `<path … />` 的属性串（含前导空格），正常态为空 */
  dashAttr: string;
  bubbleBackground: string;
} {
  if (!degrade) {
    return { fill: '#ef4444', stroke: '#ffffff', dashAttr: '', bubbleBackground: '#0f172a' };
  }
  return {
    fill: ANNOTATION_DEGRADE_VIEWPORT_STYLE.lineColorCss,
    stroke: ANNOTATION_DEGRADE_VIEWPORT_STYLE.strokeColorCss,
    dashAttr: ` stroke-dasharray="${ANNOTATION_DEGRADE_VIEWPORT_STYLE.svgDashArray}"`,
    bubbleBackground: ANNOTATION_DEGRADE_VIEWPORT_STYLE.strokeColorCss,
  };
}

/** 图钉元素上的降级标记：`data-binding-state` 给测试 / CSS 用，title 换成徽标文字 + 原因 */
export function markPinElDegrade(el: HTMLElement, degrade: AnnotationDegrade | null, normalTitle: string): void {
  if (degrade) {
    el.dataset.bindingState = degrade.state;
    el.title = `${degrade.label}\n${degrade.title}`;
  } else {
    delete el.dataset.bindingState;
    el.title = normalTitle;
  }
}

/** 云线的独立徽标元素：挂在 overlay 上；位置由 `positionCloudDegradeBadge` 在轮廓变化时更新 */
export function createCloudDegradeBadgeEl(parent: HTMLElement, degrade: AnnotationDegrade): HTMLDivElement {
  const el = parent.ownerDocument.createElement('div');
  el.className = 'dtx-anno-badge';
  el.style.cssText = [
    'position:absolute',
    'left:0',
    'top:0',
    // 参考框左上角外侧上方 4px，左缘对齐参考框左缘
    'transform:translate(0,calc(-100% - 4px))',
    'pointer-events:auto',
    'cursor:default',
    'user-select:none',
    'z-index:921',
    'opacity:0',
  ].join(';');
  el.innerHTML = buildAnnotationDegradeBadgeHtml(degrade);
  el.dataset.bindingState = degrade.state;
  el.title = degrade.title;
  parent.appendChild(el);
  return el;
}

/**
 * 定位云线徽标：有屏幕参考框 → 参考框左上角；没有（bbox3d 八角点越界、本帧没算出轮廓）→ 退到锚点图钉的左上角
 * （图钉 22×28、translate(-50%,-100%)，左上角 = 锚点 - (11, 28)）。轮廓不可见时徽标也藏。
 */
export function positionCloudDegradeBadge(
  el: HTMLElement,
  frameTopLeft: { x: number; y: number } | null,
  anchorScreen: { x: number; y: number; visible: boolean },
  shapeVisible: boolean,
): void {
  if (frameTopLeft) {
    el.style.left = `${frameTopLeft.x}px`;
    el.style.top = `${frameTopLeft.y}px`;
    el.style.opacity = shapeVisible ? '1' : '0';
    return;
  }
  el.style.left = `${anchorScreen.x - 11}px`;
  el.style.top = `${anchorScreen.y - 28}px`;
  el.style.opacity = anchorScreen.visible ? '1' : '0';
}
