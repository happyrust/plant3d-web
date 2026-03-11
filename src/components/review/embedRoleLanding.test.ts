import { beforeEach, describe, expect, it } from 'vitest';

import {
  applyEmbedLandingState,
  getEmbedLandingPanelIds,
  resolveEmbedLandingTarget,
} from './embedRoleLanding';

const localStorageMock = {
  getItem: (key: string) => sessionStorage.getItem(key),
  setItem: (key: string, value: string) => sessionStorage.setItem(key, value),
  removeItem: (key: string) => sessionStorage.removeItem(key),
  clear: () => sessionStorage.clear(),
};

describe('embed role landing', () => {
  beforeEach(() => {
    sessionStorage.clear();
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
  });

  it('routes designers to the initiate-review workspace with a unique CTA landing', () => {
    expect(resolveEmbedLandingTarget({
      isEmbedMode: true,
      isDesigner: true,
      isReviewer: false,
    })).toBe('designer');

    expect(getEmbedLandingPanelIds('designer')).toEqual(['initiateReview', 'myTasks']);
  });

  it('routes reviewer roles to the review workspace with a unique CTA landing', () => {
    expect(resolveEmbedLandingTarget({
      isEmbedMode: true,
      isDesigner: false,
      isReviewer: true,
    })).toBe('reviewer');

    expect(getEmbedLandingPanelIds('reviewer')).toEqual(['review', 'reviewerTasks']);
  });

  it('persists a shared form lineage while recording the chosen landing target', () => {
    let activatedPanelId: string | null = null;
    const ensurePanel = (panelId: string) => ({
      api: {
        setActive: () => {
          activatedPanelId = panelId;
        },
      },
    });

    const result = applyEmbedLandingState({
      ensurePanel,
      activatePanel: (panelId: string) => {
        activatedPanelId = panelId;
      },
      sessionStorageLike: sessionStorage,
      embedModeParams: {
        formId: 'FORM-123',
        userToken: 'token-1',
        userId: 'reviewer_001',
        projectId: 'project-1',
        isEmbedMode: true,
      },
      target: 'reviewer',
    });

    expect(activatedPanelId).toBe('review');
    expect(result).toEqual({
      target: 'reviewer',
      primaryPanelId: 'review',
      visiblePanelIds: ['review', 'reviewerTasks'],
    });

    expect(JSON.parse(sessionStorage.getItem('embed_mode_params') || '{}')).toMatchObject({
      formId: 'FORM-123',
      userId: 'reviewer_001',
    });
    expect(JSON.parse(sessionStorage.getItem('embed_landing_state') || '{}')).toEqual({
      target: 'reviewer',
      formId: 'FORM-123',
      primaryPanelId: 'review',
      visiblePanelIds: ['review', 'reviewerTasks'],
    });
  });

  it('stores enough landing metadata for unique designer and reviewer UI states', () => {
    applyEmbedLandingState({
      ensurePanel: () => ({ api: { setActive: () => undefined } }),
      activatePanel: () => undefined,
      sessionStorageLike: sessionStorage,
      embedModeParams: {
        formId: 'FORM-XYZ',
        userToken: 'token-designer',
        userId: 'designer_001',
        projectId: 'project-9',
        isEmbedMode: true,
      },
      target: 'designer',
    });

    expect(JSON.parse(sessionStorage.getItem('embed_landing_state') || '{}')).toEqual({
      target: 'designer',
      formId: 'FORM-XYZ',
      primaryPanelId: 'initiateReview',
      visiblePanelIds: ['initiateReview', 'myTasks'],
    });

    applyEmbedLandingState({
      ensurePanel: () => ({ api: { setActive: () => undefined } }),
      activatePanel: () => undefined,
      sessionStorageLike: sessionStorage,
      embedModeParams: {
        formId: 'FORM-XYZ',
        userToken: 'token-reviewer',
        userId: 'reviewer_001',
        projectId: 'project-9',
        isEmbedMode: true,
      },
      target: 'reviewer',
    });

    expect(JSON.parse(sessionStorage.getItem('embed_landing_state') || '{}')).toEqual({
      target: 'reviewer',
      formId: 'FORM-XYZ',
      primaryPanelId: 'review',
      visiblePanelIds: ['review', 'reviewerTasks'],
    });
  });

  it('switches project when projectId is provided in embed mode', () => {
    let switchedProjectId: string | null = null;
    const mockSwitchProjectById = (projectId: string) => {
      switchedProjectId = projectId;
      return true;
    };

    applyEmbedLandingState({
      ensurePanel: () => ({ api: { setActive: () => undefined } }),
      activatePanel: () => undefined,
      sessionStorageLike: sessionStorage,
      embedModeParams: {
        formId: 'FORM-123',
        userToken: 'token-1',
        userId: 'user_001',
        projectId: 'AvevaMarineSample',
        isEmbedMode: true,
      },
      target: 'designer',
      switchProjectById: mockSwitchProjectById,
    });

    expect(switchedProjectId).toBe('AvevaMarineSample');
  });

  it('does not switch project when projectId is null', () => {
    let switchCalled = false;
    const mockSwitchProjectById = () => {
      switchCalled = true;
      return true;
    };

    applyEmbedLandingState({
      ensurePanel: () => ({ api: { setActive: () => undefined } }),
      activatePanel: () => undefined,
      sessionStorageLike: sessionStorage,
      embedModeParams: {
        formId: 'FORM-123',
        userToken: 'token-1',
        userId: 'user_001',
        projectId: null,
        isEmbedMode: true,
      },
      target: 'designer',
      switchProjectById: mockSwitchProjectById,
    });

    expect(switchCalled).toBe(false);
  });

  it('works without switchProjectById callback', () => {
    expect(() => {
      applyEmbedLandingState({
        ensurePanel: () => ({ api: { setActive: () => undefined } }),
        activatePanel: () => undefined,
        sessionStorageLike: sessionStorage,
        embedModeParams: {
          formId: 'FORM-123',
          userToken: 'token-1',
          userId: 'user_001',
          projectId: 'project-1',
          isEmbedMode: true,
        },
        target: 'designer',
      });
    }).not.toThrow();
  });
});
