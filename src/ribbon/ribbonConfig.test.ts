import { describe, expect, it, vi } from 'vitest';

import {
  filterReviewDockAnnotationTab,
  shouldHideAnnotationTabForReviewDock,
} from './ribbonConfig';

import type { RibbonTabConfig } from './ribbonTypes';

function makeUrl(path: string): URL {
  return new URL(path, 'http://127.0.0.1:3101');
}

const sampleTabs: RibbonTabConfig[] = [
  { id: 'file', label: '文件', groups: [] },
  { id: 'annotation', label: '批注', groups: [] },
  { id: 'review', label: '校审', groups: [] },
];

describe('shouldHideAnnotationTabForReviewDock', () => {
  it('普通三维页面不隐藏批注 tab', () => {
    expect(shouldHideAnnotationTabForReviewDock(makeUrl('/?output_project=AvevaMarineSample'))).toBe(false);
  });

  it('校审详情路径隐藏批注 tab', () => {
    expect(shouldHideAnnotationTabForReviewDock(makeUrl('/review/3d-view?output_project=AvevaMarineSample'))).toBe(true);
  });

  it('带 form_id 的入口隐藏批注 tab', () => {
    expect(shouldHideAnnotationTabForReviewDock(makeUrl('/?form_id=FORM-001'))).toBe(true);
  });

  it('带 task_id 的入口隐藏批注 tab', () => {
    expect(shouldHideAnnotationTabForReviewDock(makeUrl('/?task_id=task-001'))).toBe(true);
  });

  it('automation_review=1 的入口隐藏批注 tab', () => {
    expect(shouldHideAnnotationTabForReviewDock(makeUrl('/?automation_review=1'))).toBe(true);
  });
});

describe('filterReviewDockAnnotationTab', () => {
  it('普通页面保留批注 tab', () => {
    expect(filterReviewDockAnnotationTab(sampleTabs, false).map((tab) => tab.id)).toEqual([
      'file',
      'annotation',
      'review',
    ]);
  });

  it('校审 Dock 页面移除批注 tab，保留其他 tab', () => {
    expect(filterReviewDockAnnotationTab(sampleTabs, true).map((tab) => tab.id)).toEqual([
      'file',
      'review',
    ]);
  });
});

describe('RIBBON_TABS', () => {
  it('当前 URL 是校审详情页时不导出工具、尺寸标注和批注 tab', async () => {
    vi.resetModules();
    window.history.replaceState({}, '', '/review/3d-view?form_id=FORM-001&task_id=task-001&automation_review=1');

    const { RIBBON_TABS } = await import('./ribbonConfig');

    expect(RIBBON_TABS.some((tab) => tab.id === 'tools')).toBe(false);
    expect(RIBBON_TABS.some((tab) => tab.id === 'dimension')).toBe(false);
    expect(RIBBON_TABS.some((tab) => tab.id === 'annotation')).toBe(false);
    expect(RIBBON_TABS.some((tab) => tab.id === 'review')).toBe(true);
    expect(RIBBON_TABS.some((tab) => tab.id === 'settings')).toBe(true);
  });

  it('当前 URL 是普通页面时不导出工具、尺寸标注和批注 tab', async () => {
    vi.resetModules();
    window.history.replaceState({}, '', '/?output_project=AvevaMarineSample');

    const { RIBBON_TABS } = await import('./ribbonConfig');

    expect(RIBBON_TABS.some((tab) => tab.id === 'tools')).toBe(false);
    expect(RIBBON_TABS.some((tab) => tab.id === 'dimension')).toBe(false);
    expect(RIBBON_TABS.some((tab) => tab.id === 'annotation')).toBe(false);
    expect(RIBBON_TABS.some((tab) => tab.id === 'measurement')).toBe(true);
    expect(RIBBON_TABS.some((tab) => tab.id === 'review')).toBe(true);
    expect(RIBBON_TABS.some((tab) => tab.id === 'settings')).toBe(true);
  });

  it('设置菜单提供批注样式入口', async () => {
    vi.resetModules();
    window.history.replaceState({}, '', '/?output_project=AvevaMarineSample');

    const { RIBBON_TABS } = await import('./ribbonConfig');
    const settingsTab = RIBBON_TABS.find((tab) => tab.id === 'settings');

    expect(settingsTab?.label).toBe('设置');
    expect(settingsTab?.groups.some((group) => group.items.some((item) => (
      item.kind === 'button'
        && item.id === 'settings.annotationStyle'
        && item.commandId === 'annotation.settings'
    )))).toBe(true);
  });

  it('不导出任何尺寸面板或尺寸命令入口', async () => {
    vi.resetModules();
    window.history.replaceState({}, '', '/?output_project=AvevaMarineSample');

    const { RIBBON_TABS } = await import('./ribbonConfig');
    const commandIds = RIBBON_TABS.flatMap((tab) => tab.groups.flatMap((group) => (
      group.items.flatMap((item) => (
        item.kind === 'button'
          ? [item.commandId]
          : item.items.map((subItem) => subItem.commandId)
      ))
    )));

    expect(RIBBON_TABS.flatMap((tab) => tab.groups.map((group) => group.id)))
      .not.toContain('view.panel.dimension');
    expect(commandIds).not.toContain('panel.dimension');
    expect(commandIds.some((commandId) => commandId.startsWith('dimension.'))).toBe(false);
  });

});
