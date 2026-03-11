export type EmbedModeParams = {
  formId: string | null;
  userToken: string | null;
  userId: string | null;
  projectId: string | null;
  isEmbedMode: boolean;
};

export type EmbedLandingTarget = 'designer' | 'reviewer';

export function resolveEmbedLandingTarget(params: {
  isEmbedMode: boolean;
  isDesigner: boolean;
  isReviewer: boolean;
}): EmbedLandingTarget | null {
  if (!params.isEmbedMode) return null;
  if (params.isDesigner) return 'designer';
  if (params.isReviewer) return 'reviewer';
  return null;
}

export function getEmbedLandingPanelIds(target: EmbedLandingTarget): string[] {
  return target === 'designer'
    ? ['initiateReview', 'myTasks']
    : ['review', 'reviewerTasks'];
}

export function applyEmbedLandingState<TPanel extends { api: { setActive: () => void } }>(options: {
  ensurePanel: (panelId: string) => TPanel | undefined;
  activatePanel: (panelId: string) => void;
  sessionStorageLike?: Pick<Storage, 'setItem' | 'removeItem'>;
  embedModeParams: EmbedModeParams;
  target: EmbedLandingTarget;
  switchProjectById?: (projectId: string) => boolean;
}) {
  // 如果有 projectId，尝试切换项目并直接进入查看器
  if (options.embedModeParams.projectId && options.switchProjectById) {
    const switched = options.switchProjectById(options.embedModeParams.projectId);
    if (switched) {
      // 项目切换成功，直接打开查看器和模型树
      options.activatePanel('modelTree');
      options.activatePanel('viewer');
      
      const storage = options.sessionStorageLike;
      if (storage) {
        storage.setItem('embed_mode_params', JSON.stringify(options.embedModeParams));
      }
      
      return {
        target: options.target,
        primaryPanelId: 'viewer',
        visiblePanelIds: ['modelTree', 'viewer'],
      };
    }
  }

  const panelIds = getEmbedLandingPanelIds(options.target);
  const primaryPanelId = panelIds[0];
  if (!primaryPanelId) return null;

  const panel = options.ensurePanel(primaryPanelId);
  if (panel) {
    panel.api.setActive();
  } else {
    options.activatePanel(primaryPanelId);
  }

  const storage = options.sessionStorageLike;
  if (storage) {
    storage.setItem('embed_mode_params', JSON.stringify(options.embedModeParams));
    storage.setItem(
      'embed_landing_state',
      JSON.stringify({
        target: options.target,
        formId: options.embedModeParams.formId,
        primaryPanelId,
        visiblePanelIds: panelIds,
      })
    );
  }

  return {
    target: options.target,
    primaryPanelId,
    visiblePanelIds: panelIds,
  };
}
