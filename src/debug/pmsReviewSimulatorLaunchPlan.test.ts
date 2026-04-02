import { describe, expect, it } from 'vitest';

import {
  buildTokenPrimaryPmsLaunchSearch,
  resolveDefaultSimulatorProjectId,
  resolvePmsLaunchFormId,
} from './pmsReviewSimulatorLaunchPlan';

describe('resolvePmsLaunchFormId', () => {
  it('prefers backend query form_id over caller preferred form_id', () => {
    expect(resolvePmsLaunchFormId({
      preferredFormId: 'FORM-PREFERRED',
      queryFormId: 'FORM-QUERY',
      directFormId: 'FORM-DIRECT',
    })).toBe('FORM-QUERY');
  });

  it('prefers verified token claim form_id over response and caller values', () => {
    expect(resolvePmsLaunchFormId({
      preferredFormId: 'FORM-PREFERRED',
      queryFormId: 'FORM-QUERY',
      directFormId: 'FORM-DIRECT',
      tokenClaimFormId: 'FORM-TOKEN',
    })).toBe('FORM-TOKEN');
  });

  it('falls back to preferred form_id when no backend lineage is available', () => {
    expect(resolvePmsLaunchFormId({
      preferredFormId: 'FORM-PREFERRED',
      queryFormId: null,
      directFormId: null,
      tokenClaimFormId: null,
    })).toBe('FORM-PREFERRED');
  });

  it('builds a token-primary simulator launch query without legacy identity params and reattaches selected output_project', () => {
    const search = buildTokenPrimaryPmsLaunchSearch({
      directQuery: new URLSearchParams(
        'workflow_mode=external&project_id=query-project&output_project=query-output&user_id=JH&user_role=jd&foo=bar&user_token=should-strip'
      ),
      outputProject: 'AvevaMarineSample',
    });

    expect(search.get('form_id')).toBeNull();
    expect(search.get('output_project')).toBe('AvevaMarineSample');
    expect(search.get('workflow_mode')).toBeNull();
    expect(search.get('foo')).toBe('bar');
    expect(search.has('project_id')).toBe(false);
    expect(search.has('user_id')).toBe(false);
    expect(search.has('user_role')).toBe(false);
    expect(search.has('user_token')).toBe(false);
  });
});

describe('resolveDefaultSimulatorProjectId', () => {
  it('prefers output_project over legacy project_id when resolving simulator project path', () => {
    expect(resolveDefaultSimulatorProjectId('?project_id=legacy-project&output_project=OutputPath&project=OtherProject', ['OutputPath', 'AvevaMarineSample'])).toBe('OutputPath');
  });

  it('falls back to the real default project when URL project is not present in backend project list', () => {
    expect(resolveDefaultSimulatorProjectId('?project=PROJECT-EMBED-001', ['AvevaMarineSample', 'OtherProject'])).toBe('AvevaMarineSample');
  });

  it('falls back to first available project when stable default project is absent', () => {
    expect(resolveDefaultSimulatorProjectId('?project=PROJECT-EMBED-001', ['OtherProject', 'FallbackProject'])).toBe('OtherProject');
  });

  it('still supports explicit project fallback when project list is not available yet', () => {
    expect(resolveDefaultSimulatorProjectId('?project=NamedProject')).toBe('NamedProject');
  });
});
