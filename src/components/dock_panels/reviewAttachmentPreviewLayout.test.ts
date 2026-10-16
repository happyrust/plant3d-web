import { describe, expect, it, vi } from 'vitest';

import { createDockview } from 'dockview-core';

import {
  openReviewAttachmentSplit,
  popoutReviewAttachmentPanel,
  type PreviewDockApi,
} from './reviewAttachmentPreviewLayout';

describe('reviewAttachmentPreviewLayout', () => {
  it('新建时沿用调用方给出的查看器右侧面板，并按查看器宽度分屏', () => {
    const viewer = {
      api: { setActive: vi.fn() },
      group: { api: { width: 1000, setSize: vi.fn() }, panels: [] as unknown[] },
    };
    const created = {
      api: { setActive: vi.fn(), location: { type: 'grid' } },
      group: { api: { width: 0, setSize: vi.fn() }, panels: [] as unknown[] },
    };
    created.group.panels.push(created);
    const createPanel = vi.fn(() => created);

    openReviewAttachmentSplit(
      {
        getPanel: (id) => (id === 'viewer' ? viewer : undefined),
      },
      createPanel,
    );

    expect(createPanel).toHaveBeenCalledTimes(1);
    expect(created.group.api.setSize).toHaveBeenCalledWith({ width: 500 });
    expect(created.api.setActive).toHaveBeenCalledTimes(1);
  });

  it('已经塞进右侧页签堆时拆到查看器右侧，不新建第二块', () => {
    const viewerGroup = { api: { width: 1000, setSize: vi.fn() }, panels: [] as unknown[] };
    const viewer = { api: { setActive: vi.fn() }, group: viewerGroup };
    const sharedGroup = { api: { width: 350, setSize: vi.fn() }, panels: [] as unknown[] };
    const measurement = { id: 'measurement' };
    const splitGroup = { api: { width: 0, setSize: vi.fn() }, panels: [] as unknown[] };
    const preview = {
      api: {
        setActive: vi.fn(),
        location: { type: 'grid' as string },
        moveTo: vi.fn(),
      },
      group: sharedGroup,
    };
    sharedGroup.panels.push(measurement, preview);
    preview.api.moveTo.mockImplementation(() => {
      splitGroup.panels.push(preview);
      preview.group = splitGroup;
    });
    const createPanel = vi.fn();

    openReviewAttachmentSplit(
      {
        getPanel: (id) => {
          if (id === 'viewer') return viewer;
          if (id === 'reviewAttachmentPreview') return preview;
          return undefined;
        },
      },
      createPanel,
    );

    expect(createPanel).not.toHaveBeenCalled();
    expect(preview.api.moveTo).toHaveBeenCalledWith({ group: viewerGroup, position: 'right' });
    expect(splitGroup.api.setSize).toHaveBeenCalledWith({ width: 500 });
    expect(sharedGroup.api.setSize).not.toHaveBeenCalled();
  });

  it('弹出只提交文档面板本身', () => {
    const documentPanel = { id: 'reviewAttachmentPreview', api: { location: { type: 'grid' } } };
    const measurementPanel = { id: 'measurement', api: { location: { type: 'grid' } } };
    const addPopoutGroup = vi.fn();

    const popped = popoutReviewAttachmentPanel({
      getPanel: (id) => (id === 'reviewAttachmentPreview' ? documentPanel : measurementPanel),
      addPopoutGroup,
    });

    expect(popped).toBe(true);
    expect(addPopoutGroup).toHaveBeenCalledTimes(1);
    expect(addPopoutGroup).toHaveBeenCalledWith(documentPanel);
    expect(addPopoutGroup).not.toHaveBeenCalledWith(measurementPanel);
  });

  it('在真实 dock 里分到查看器右侧，不进校审页签', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const api = createDockview(host, {
      disableAutoResizing: true,
      createComponent: () => {
        const element = document.createElement('div');
        return { element, init() {}, dispose() {} };
      },
    });
    api.layout(1200, 800);
    const viewer = api.addPanel({ id: 'viewer', component: 'viewer', title: '三维查看器' });
    const measurement = api.addPanel({
      id: 'measurement',
      component: 'measurement',
      title: '测量',
      position: { referencePanel: viewer, direction: 'right' },
    });
    api.addPanel({
      id: 'review',
      component: 'review',
      title: '校审',
      position: { referencePanel: measurement, direction: 'within' },
    });

    openReviewAttachmentSplit(api as unknown as PreviewDockApi, () => {
      const viewerPanel = api.getPanel('viewer');
      if (!viewerPanel) return undefined;
      return api.addPanel({
        id: 'reviewAttachmentPreview',
        component: 'preview',
        title: '文档预览',
        position: { referencePanel: viewerPanel, direction: 'right' },
      }) as never;
    });

    const preview = api.getPanel('reviewAttachmentPreview');
    expect(preview).toBeTruthy();
    expect(preview?.group).not.toBe(measurement.group);
    expect(preview?.group.panels.map((panel) => panel.id)).toEqual(['reviewAttachmentPreview']);
    expect(measurement.group.panels.map((panel) => panel.id).sort()).toEqual(['measurement', 'review']);
    expect(preview?.group.api.width).toBeGreaterThanOrEqual(480);
    const grid = JSON.stringify(api.toJSON().grid);
    const viewerAt = grid.indexOf('viewer');
    const previewAt = grid.indexOf('reviewAttachmentPreview');
    const reviewAt = grid.indexOf('"review"');
    expect(viewerAt).toBeGreaterThanOrEqual(0);
    expect(previewAt).toBeGreaterThan(viewerAt);
    expect(reviewAt).toBeGreaterThan(previewAt);

    const lateMeasurement = api.addPanel({
      id: 'measurement-late',
      component: 'measurement',
      title: '测量',
      position: { referencePanel: viewer, direction: 'right' },
    });
    expect(lateMeasurement.group).not.toBe(preview?.group);
    expect(preview?.group.panels.map((panel) => panel.id)).toEqual(['reviewAttachmentPreview']);

    api.dispose();
    host.remove();
  });
});
