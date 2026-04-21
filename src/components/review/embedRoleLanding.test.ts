import { beforeEach, describe, expect, it } from 'vitest';

import {
  applyEmbedLandingState,
  buildPersistedEmbedModeParams,
  getEmbedLandingPanelIds,
  readEmbedModeParamsFromSearch,
  resolvePassiveEmbedViewTarget,
  resolveTrustedEmbedIdentity,
  resolveEmbedLandingTarget,
  resolveEmbedLandingTargetFromRole,
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

  it('reads token-primary embed params from URL search and ignores query user/project identity fields', () => {
    expect(readEmbedModeParamsFromSearch('?form_id=FORM-1&user_token=token-1&user_id=query-user&workflow_role=sh&role=pz&user_role=jd&project_id=query-project&workflow_mode=external')).toEqual({
      formId: 'FORM-1',
      userToken: 'token-1',
      userId: null,
      workflowRole: null,
      projectId: null,
      workflowMode: 'external',
      isEmbedMode: true,
      launchInput: {
        formId: 'FORM-1',
        userId: 'query-user',
        workflowRole: 'sh',
        projectId: 'query-project',
        workflowMode: 'external',
      },
      verifiedClaims: null,
    });
  });

  it('keeps workflow_role from URL identity fields when token is absent', () => {
    expect(readEmbedModeParamsFromSearch('?form_id=FORM-2&user_id=query-user&workflow_role=jd&project_id=query-project')).toEqual({
      formId: 'FORM-2',
      userToken: null,
      userId: 'query-user',
      workflowRole: 'jd',
      projectId: 'query-project',
      workflowMode: null,
      isEmbedMode: true,
      launchInput: {
        formId: 'FORM-2',
        userId: 'query-user',
        workflowRole: 'jd',
        projectId: 'query-project',
        workflowMode: null,
      },
      verifiedClaims: null,
    });
  });

  it('falls back to legacy role when workflow_role is absent', () => {
    expect(readEmbedModeParamsFromSearch('?form_id=FORM-2&user_id=query-user&role=sh&project_id=query-project')).toEqual({
      formId: 'FORM-2',
      userToken: null,
      userId: 'query-user',
      workflowRole: 'sh',
      projectId: 'query-project',
      workflowMode: null,
      isEmbedMode: true,
      launchInput: {
        formId: 'FORM-2',
        userId: 'query-user',
        workflowRole: 'sh',
        projectId: 'query-project',
        workflowMode: null,
      },
      verifiedClaims: null,
    });
  });

  it('falls back to legacy user_role only when workflow_role and role are both absent', () => {
    expect(readEmbedModeParamsFromSearch('?form_id=FORM-2&user_id=query-user&user_role=pz&project_id=query-project')).toEqual({
      formId: 'FORM-2',
      userToken: null,
      userId: 'query-user',
      workflowRole: 'pz',
      projectId: 'query-project',
      workflowMode: null,
      isEmbedMode: true,
      launchInput: {
        formId: 'FORM-2',
        userId: 'query-user',
        workflowRole: 'pz',
        projectId: 'query-project',
        workflowMode: null,
      },
      verifiedClaims: null,
    });
  });

  it('routes designers to the initiate-review workspace with a unique CTA landing', () => {
    expect(resolveEmbedLandingTarget({
      isEmbedMode: true,
      isDesigner: true,
      isReviewer: false,
    })).toBe('designer');

    expect(getEmbedLandingPanelIds('designer')).toEqual(['initiateReview']);
  });

  it('omits myTasks from designer landing when workflow is externally driven', () => {
    const result = applyEmbedLandingState({
      ensurePanel: () => ({ api: { setActive: () => undefined } }),
      activatePanel: () => undefined,
      sessionStorageLike: sessionStorage,
      embedModeParams: {
        formId: 'FORM-EXT-1',
        userToken: 'token-ext',
        userId: 'designer_001',
        projectId: 'project-9',
        isEmbedMode: true,
        workflowMode: 'external',
      } as never,
      target: 'designer',
    });

    expect(result).toEqual({
      target: 'designer',
      primaryPanelId: 'initiateReview',
      visiblePanelIds: ['initiateReview'],
    });

    expect(JSON.parse(sessionStorage.getItem('embed_landing_state') || '{}')).toEqual({
      target: 'designer',
      formId: 'FORM-EXT-1',
      primaryPanelId: 'initiateReview',
      visiblePanelIds: ['initiateReview'],
    });
  });

  it('routes reviewer roles to the review workspace with a unique CTA landing', () => {
    expect(resolveEmbedLandingTarget({
      isEmbedMode: true,
      isDesigner: false,
      isReviewer: true,
    })).toBe('reviewer');

    expect(getEmbedLandingPanelIds('reviewer')).toEqual(['review']);
  });

  it('maps only canonical backend roles to the expected landing targets', () => {
    expect(resolveEmbedLandingTargetFromRole('sj')).toBe('designer');
    expect(resolveEmbedLandingTargetFromRole('jd')).toBe('reviewer');
    expect(resolveEmbedLandingTargetFromRole('sh')).toBe('reviewer');
    expect(resolveEmbedLandingTargetFromRole('pz')).toBe('reviewer');
    expect(resolveEmbedLandingTargetFromRole('admin')).toBe('reviewer');
    expect(resolveEmbedLandingTargetFromRole('jh')).toBe('reviewer');
    expect(resolveEmbedLandingTargetFromRole('designer')).toBeNull();
    expect(resolveEmbedLandingTargetFromRole('reviewer')).toBeNull();
    expect(resolveEmbedLandingTargetFromRole('proofreader')).toBeNull();
    expect(resolveEmbedLandingTargetFromRole('manager')).toBeNull();
  });

  it('falls back to reviewer view when passive external reopen uses sj token for a non-sj task', () => {
    expect(resolvePassiveEmbedViewTarget({
      workflowRole: 'sj',
      passiveWorkflowMode: true,
      restoredTaskSummary: {
        title: '三维校审单',
        status: 'submitted',
        currentNode: 'jd',
      },
    })).toBe('reviewer');

    expect(resolvePassiveEmbedViewTarget({
      workflowRole: 'sj',
      passiveWorkflowMode: true,
      restoredTaskSummary: {
        title: '三维校审单',
        status: 'draft',
        currentNode: 'sj',
      },
    })).toBeNull();

    expect(resolvePassiveEmbedViewTarget({
      workflowRole: 'jd',
      passiveWorkflowMode: true,
      restoredTaskSummary: {
        title: '三维校审单',
        status: 'submitted',
        currentNode: 'jd',
      },
    })).toBeNull();
  });

  it('uses verified token claims for trusted user identity while keeping explicit form lineage', () => {
    expect(resolveTrustedEmbedIdentity({
      formId: 'FORM-QUERY',
      userToken: 'token-1',
      userId: 'query-user',
      workflowRole: 'jd',
      projectId: 'query-project',
      isEmbedMode: true,
      verifiedClaims: {
        userId: 'JH',
        projectId: 'AvevaMarineSample',
        role: 'sj',
        workflowMode: 'external',
        exp: 1774949170,
        iat: 1774862770,
      },
    })).toEqual({
      userId: 'JH',
      workflowRole: 'sj',
      formId: 'FORM-QUERY',
      projectId: 'AvevaMarineSample',
      workflowMode: 'external',
    });
  });

  it('rejects verified embed identity when token claims omit role even if URL user_role is present', () => {
    expect(resolveTrustedEmbedIdentity({
      formId: 'FORM-QUERY',
      userToken: 'token-1',
      userId: 'query-user',
      workflowRole: 'jd',
      projectId: 'query-project',
      isEmbedMode: true,
      verifiedClaims: {
        userId: 'JH',
        projectId: 'AvevaMarineSample',
        exp: 1775001441,
        iat: 1774915041,
      },
    })).toBeNull();
  });

  it('persists token-primary embed params without legacy URL identity fields', () => {
    expect(buildPersistedEmbedModeParams({
      formId: 'FORM-1',
      userToken: 'token-1',
      userId: 'JH',
      workflowRole: 'jd',
      projectId: 'AvevaMarineSample',
      workflowMode: 'external',
      isEmbedMode: true,
      launchInput: {
        formId: 'FORM-1',
        userId: 'query-user',
        workflowRole: 'jd',
        projectId: 'query-project',
        workflowMode: 'external',
      },
      verifiedClaims: {
        userId: 'JH',
        projectId: 'AvevaMarineSample',
        role: 'jd',
        workflowMode: 'manual',
        exp: 1,
        iat: 1,
      },
    })).toEqual({
      formId: 'FORM-1',
      userToken: 'token-1',
      userId: 'JH',
      workflowRole: 'jd',
      projectId: 'AvevaMarineSample',
      workflowMode: 'manual',
      isEmbedMode: true,
      launchInput: {
        formId: 'FORM-1',
        userId: null,
        workflowRole: null,
        projectId: null,
        workflowMode: 'external',
      },
      verifiedClaims: {
        userId: 'JH',
        projectId: 'AvevaMarineSample',
        role: 'jd',
        workflowMode: 'manual',
        exp: 1,
        iat: 1,
      },
    });
  });

  it('returns null when verified claims are absent even if query parameters look usable', () => {
    expect(resolveTrustedEmbedIdentity({
      formId: 'FORM-QUERY',
      userToken: 'token-1',
      userId: 'query-user',
      workflowRole: 'jd',
      projectId: 'query-project',
      isEmbedMode: true,
      verifiedClaims: null,
    })).toBeNull();
  });

  it('rejects trusted embed identity when explicit form lineage is missing', () => {
    expect(resolveTrustedEmbedIdentity({
      formId: null,
      userToken: 'token-1',
      userId: 'query-user',
      workflowRole: 'jd',
      projectId: 'query-project',
      isEmbedMode: true,
      verifiedClaims: {
        userId: 'JH',
        projectId: 'AvevaMarineSample',
        role: 'sj',
        workflowMode: 'external',
        exp: 1774949170,
        iat: 1774862770,
      },
    })).toBeNull();
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
      visiblePanelIds: ['review'],
    });

    expect(JSON.parse(sessionStorage.getItem('embed_mode_params') || '{}')).toMatchObject({
      formId: 'FORM-123',
      userId: 'reviewer_001',
    });
    expect(JSON.parse(sessionStorage.getItem('embed_landing_state') || '{}')).toEqual({
      target: 'reviewer',
      formId: 'FORM-123',
      primaryPanelId: 'review',
      visiblePanelIds: ['review'],
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
        workflowMode: 'manual',
        isEmbedMode: true,
      },
      target: 'designer',
    });

    expect(JSON.parse(sessionStorage.getItem('embed_landing_state') || '{}')).toEqual({
      target: 'designer',
      formId: 'FORM-XYZ',
      primaryPanelId: 'initiateReview',
      visiblePanelIds: ['initiateReview'],
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
      visiblePanelIds: ['review'],
    });
  });

  it('switches project but keeps the designer landing workspace when projectId is provided', () => {
    let switchedProjectId: string | null = null;
    let activatedPanelId: string | null = null;

    const mockSwitchProjectById = (projectId: string) => {
      switchedProjectId = projectId;
      return true;
    };

    const result = applyEmbedLandingState({
      ensurePanel: (panelId: string) => ({
        api: {
          setActive: () => {
            activatedPanelId = panelId;
          },
        },
      }),
      activatePanel: (panelId: string) => {
        activatedPanelId = panelId;
      },
      sessionStorageLike: sessionStorage,
      embedModeParams: {
        formId: 'FORM-123',
        userToken: 'token-1',
        userId: 'user_001',
        projectId: 'AvevaMarineSample',
        workflowMode: 'manual',
        isEmbedMode: true,
      },
      target: 'designer',
      switchProjectById: mockSwitchProjectById,
    });

    expect(switchedProjectId).toBe('AvevaMarineSample');
    expect(activatedPanelId).toBe('initiateReview');
    expect(result).toEqual({
      target: 'designer',
      primaryPanelId: 'initiateReview',
      visiblePanelIds: ['initiateReview'],
    });
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
