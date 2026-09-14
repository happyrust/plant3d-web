import { describe, expect, it } from 'vitest';

import { MeshLineMaterial } from '@lume/three-meshline';
import { LineDashedMaterial } from 'three';

import {
  applyDashedLineDegrade,
  applyLeaderDegrade,
  applyMeshLineDegrade,
  buildAnnotationDegradeBadgeHtml,
  CLOUD_OUTLINE_DASH_ARRAY,
  createCloudDegradeBadgeEl,
  dashSizeFromBounds,
  LEADER_DASH_ARRAY,
  markPinElDegrade,
  pinDashSizeFromDistance,
  pinSvgPaint,
  positionCloudDegradeBadge,
  sameDegrade,
  type DegradableLeader,
} from './annotationDegradeViewport';

import { ANNOTATION_DEGRADE_VIEWPORT_STYLE, type AnnotationDegrade } from '@/review/domain/bindingResolve';

/** MeshLineMaterial 的构造参数类型要求整份材质字段（源码里靠 type-check 基线放行）；测试里空参构造再 setHex */
function meshLineMaterial(color: number): MeshLineMaterial {
  const material = new MeshLineMaterial({} as ConstructorParameters<typeof MeshLineMaterial>[0]);
  material.color.setHex(color);
  return material;
}

const SUMMARY = { total: 1, resolved: 0, unloaded: 0, missing: 1, stale: 0, usable: 0 };
const MISSING: AnnotationDegrade = { state: 'missing', label: '⚠ 不存在', title: '模型中未找到该构件：HTTP 404', summary: SUMMARY };
const STALE: AnnotationDegrade = { state: 'stale', label: 'STALE', title: '锚点漂离', summary: { ...SUMMARY, missing: 0, stale: 1 } };
const RED = 0xef4444;

describe('annotationDegradeViewport · 材质', () => {
  it('引线：降级 → 芯线灰 + 芯 / halo 同步虚线并记住状态；恢复 → 回原色、dashArray 0（useDash 关）', () => {
    const leader: DegradableLeader = { coreMaterial: meshLineMaterial(RED), haloMaterial: meshLineMaterial(0xffffff) };
    applyLeaderDegrade(leader, RED, MISSING);
    expect(leader.coreMaterial.color.getHex()).toBe(ANNOTATION_DEGRADE_VIEWPORT_STYLE.lineColor);
    expect(leader.haloMaterial.color.getHex()).toBe(0xffffff);
    expect(leader.coreMaterial.dashArray).toBe(LEADER_DASH_ARRAY);
    expect(leader.haloMaterial.dashArray).toBe(LEADER_DASH_ARRAY);
    expect(leader.coreMaterial.useDash).toBe(true);
    expect(leader.degrade).toBe(MISSING);

    applyLeaderDegrade(leader, RED, null);
    expect(leader.coreMaterial.color.getHex()).toBe(RED);
    expect(leader.coreMaterial.dashArray).toBe(0);
    expect(leader.coreMaterial.useDash).toBe(false);
    expect(leader.haloMaterial.useDash).toBe(false);
    expect(leader.degrade).toBeNull();
  });

  it('云线轮廓 MeshLine：降级 → 灰 + 约 48 段虚线；恢复 → 原色实线', () => {
    const material = meshLineMaterial(RED);
    applyMeshLineDegrade(material, RED, STALE);
    expect(material.color.getHex()).toBe(ANNOTATION_DEGRADE_VIEWPORT_STYLE.lineColor);
    expect(material.dashArray).toBe(CLOUD_OUTLINE_DASH_ARRAY);
    expect(material.useDash).toBe(true);
    applyMeshLineDegrade(material, RED, null);
    expect(material.color.getHex()).toBe(RED);
    expect(material.useDash).toBe(false);
  });

  it('LineDashedMaterial：降级带尺度 → 灰 + dash/gap；尺度算不出（0）→ 灰实线；恢复 → 原色、gapSize 0（等价实线）', () => {
    const material = new LineDashedMaterial({ color: RED, dashSize: 1, gapSize: 0 });
    applyDashedLineDegrade(material, RED, MISSING, 2);
    expect(material.color.getHex()).toBe(ANNOTATION_DEGRADE_VIEWPORT_STYLE.lineColor);
    expect(material.dashSize).toBe(2);
    expect(material.gapSize).toBeCloseTo(1.5, 9);

    applyDashedLineDegrade(material, RED, MISSING, 0);
    expect(material.color.getHex()).toBe(ANNOTATION_DEGRADE_VIEWPORT_STYLE.lineColor);
    expect(material.gapSize).toBe(0);

    applyDashedLineDegrade(material, RED, null, 2);
    expect(material.color.getHex()).toBe(RED);
    expect(material.dashSize).toBe(1);
    expect(material.gapSize).toBe(0);
  });

  it('虚线节拍按几何尺度：包围盒对角线 1.5%、针身按距离 4%；退化 / 非法回 0', () => {
    expect(dashSizeFromBounds([0, 0, 0], [3, 4, 0])).toBeCloseTo(5 * 0.015, 9);
    expect(dashSizeFromBounds([0, 0, 0], [0, 0, 0])).toBe(0);
    expect(dashSizeFromBounds([0, 0], [1, 1, 1])).toBe(0);
    expect(pinDashSizeFromDistance(10)).toBeCloseTo(0.4, 9);
    expect(pinDashSizeFromDistance(0)).toBe(0);
    expect(pinDashSizeFromDistance(Number.NaN)).toBe(0);
  });

  it('sameDegrade：状态与 tooltip 都相同才算同一态，null 与 undefined 等价', () => {
    expect(sameDegrade(null, undefined)).toBe(true);
    expect(sameDegrade(MISSING, { ...MISSING })).toBe(true);
    expect(sameDegrade(MISSING, { ...MISSING, title: '别的原因' })).toBe(false);
    expect(sameDegrade(MISSING, STALE)).toBe(false);
    expect(sameDegrade(MISSING, null)).toBe(false);
  });
});

describe('annotationDegradeViewport · DOM', () => {
  it('徽标 HTML：状态色、文字与 title 都来自样式表，文本经 HTML 转义', () => {
    const html = buildAnnotationDegradeBadgeHtml({ ...MISSING, title: 'a<b>&"c"' }, 'position:absolute;');
    const host = document.createElement('div');
    host.innerHTML = html;
    const badge = host.firstElementChild as HTMLElement;
    expect(badge.dataset.role).toBe('annotation-binding-badge');
    expect(badge.dataset.bindingState).toBe('missing');
    expect(badge.textContent).toBe('⚠ 不存在');
    // happy-dom 不解码属性里的实体，直接对转义后的源码断言
    expect(html).toContain('title="a&lt;b&gt;&amp;&quot;c&quot;"');
    expect(badge.style.background).toContain('#fff1f2');
    expect(badge.style.position).toBe('absolute');
    expect(buildAnnotationDegradeBadgeHtml(STALE)).toContain('>STALE<');
  });

  it('图钉取色：降级灰填充 + 深灰虚线描边 + 灰字泡；正常态红填充白描边无虚线', () => {
    expect(pinSvgPaint(null)).toEqual({ fill: '#ef4444', stroke: '#ffffff', dashAttr: '', bubbleBackground: '#0f172a' });
    const degraded = pinSvgPaint(STALE);
    expect(degraded.fill).toBe(ANNOTATION_DEGRADE_VIEWPORT_STYLE.lineColorCss);
    expect(degraded.stroke).toBe(ANNOTATION_DEGRADE_VIEWPORT_STYLE.strokeColorCss);
    expect(degraded.dashAttr).toBe(' stroke-dasharray="3 2"');
  });

  it('图钉元素标记：data-binding-state + title = 徽标文字 + 原因；恢复时清掉并回原 title', () => {
    const el = document.createElement('div');
    markPinElDegrade(el, MISSING, '单击选中');
    expect(el.dataset.bindingState).toBe('missing');
    expect(el.title).toBe('⚠ 不存在\n模型中未找到该构件：HTTP 404');
    markPinElDegrade(el, null, '单击选中');
    expect(el.dataset.bindingState).toBeUndefined();
    expect(el.title).toBe('单击选中');
  });

  it('云线徽标元素：挂到 overlay、初始隐藏；有参考框贴左上角并随轮廓可见性显隐，没有参考框退到锚点图钉左上角', () => {
    const overlay = document.createElement('div');
    document.body.appendChild(overlay);
    const el = createCloudDegradeBadgeEl(overlay, STALE);
    expect(el.parentElement).toBe(overlay);
    expect(el.className).toBe('dtx-anno-badge');
    expect(el.style.opacity).toBe('0');
    expect(el.querySelector('[data-role="annotation-binding-badge"]')?.textContent).toBe('STALE');
    expect(el.dataset.bindingState).toBe('stale');

    positionCloudDegradeBadge(el, { x: 100, y: 40 }, { x: 0, y: 0, visible: true }, true);
    expect(el.style.left).toBe('100px');
    expect(el.style.top).toBe('40px');
    expect(el.style.opacity).toBe('1');

    positionCloudDegradeBadge(el, { x: 100, y: 40 }, { x: 0, y: 0, visible: true }, false);
    expect(el.style.opacity).toBe('0');

    positionCloudDegradeBadge(el, null, { x: 311, y: 228, visible: true }, false);
    expect(el.style.left).toBe('300px');
    expect(el.style.top).toBe('200px');
    expect(el.style.opacity).toBe('1');

    positionCloudDegradeBadge(el, null, { x: 311, y: 228, visible: false }, true);
    expect(el.style.opacity).toBe('0');
    overlay.remove();
  });
});
