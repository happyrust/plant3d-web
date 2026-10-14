export const REVIEW_ATTACHMENT_PREVIEW_PANEL_ID = 'reviewAttachmentPreview';

const DOCUMENT_SPLIT_MIN_WIDTH = 480;
const DOCUMENT_SPLIT_FALLBACK_WIDTH = 640;

type PreviewGroup = {
  api: {
    width?: number;
    setSize: (size: { width?: number }) => void;
    location?: { type?: string };
  };
  panels?: unknown[];
};

type PreviewPanel = {
  api: {
    setActive: () => void;
    moveTo?: (options: { group?: PreviewGroup; position?: string }) => void;
    location?: { type?: string };
  };
  group?: PreviewGroup;
};

export type PreviewDockApi = {
  getPanel: (id: string) => PreviewPanel | undefined;
};

function isDetached(locationType: string | undefined): boolean {
  return locationType === 'popout' || locationType === 'floating';
}

function sharesTabStack(panel: PreviewPanel): boolean {
  return (panel.group?.panels?.length ?? 1) > 1;
}

function sizeDocumentSplit(panel: PreviewPanel, viewerWidth: number): void {
  const group = panel.group;
  if (!group) return;
  if ((group.panels?.length ?? 1) !== 1) return;
  const locationType = panel.api.location?.type ?? group.api.location?.type;
  if (isDetached(locationType)) return;
  const width = viewerWidth > 0
    ? Math.max(DOCUMENT_SPLIT_MIN_WIDTH, Math.round(viewerWidth * 0.5))
    : DOCUMENT_SPLIT_FALLBACK_WIDTH;
  group.api.setSize({ width });
}

/**
 * 打开文档预览：新建时由调用方放到查看器右侧；已经塞进别的页签时拆出来，再分到查看器右侧。
 * 已经弹出或浮动的不拽回主布局。
 */
export function openReviewAttachmentSplit(
  dockApi: PreviewDockApi,
  createPanel: () => PreviewPanel | undefined,
): PreviewPanel | undefined {
  const viewer = dockApi.getPanel('viewer');
  const viewerWidth = viewer?.group?.api.width ?? 0;
  const existing = dockApi.getPanel(REVIEW_ATTACHMENT_PREVIEW_PANEL_ID);
  if (existing) {
    if (!isDetached(existing.api.location?.type) && sharesTabStack(existing) && viewer?.group && existing.api.moveTo) {
      existing.api.moveTo({ group: viewer.group, position: 'right' });
      sizeDocumentSplit(existing, viewerWidth);
    }
    existing.api.setActive();
    return existing;
  }

  const created = createPanel();
  if (!created) return undefined;
  sizeDocumentSplit(created, viewerWidth);
  created.api.setActive();
  return created;
}

/** 只把文档预览这一块交给 dockview 弹出。组里还有别的面板时，dockview 会单独拆出这一块。 */
export function popoutReviewAttachmentPanel(dockApi: {
  getPanel: (id: string) => { api?: { location?: { type?: string } } } | undefined;
  addPopoutGroup: (item: unknown) => void;
}): boolean {
  const panel = dockApi.getPanel(REVIEW_ATTACHMENT_PREVIEW_PANEL_ID);
  if (!panel || panel.api?.location?.type === 'popout') return false;
  dockApi.addPopoutGroup(panel);
  return true;
}
