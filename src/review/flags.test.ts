import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  REVIEW_FLAG_NAMES,
  clearReviewFlagOverrides,
  isReviewFlagEnabled,
} from './flags';

describe('review flags', () => {
  beforeEach(() => {
    clearReviewFlagOverrides();
  });

  afterEach(() => {
    clearReviewFlagOverrides();
    vi.unstubAllEnvs();
  });

  it('exposes the full set of known flag names', () => {
    expect(REVIEW_FLAG_NAMES.length).toBeGreaterThan(0);
    for (const name of REVIEW_FLAG_NAMES) {
      expect(typeof name).toBe('string');
      expect(name.startsWith('REVIEW_')).toBe(true);
    }
  });

  it('defaults every known flag to false', () => {
    for (const name of REVIEW_FLAG_NAMES) {
      expect(isReviewFlagEnabled(name)).toBe(false);
    }
  });

  it('respects localStorage override = 1/true', () => {
    localStorage.setItem('review.flag.REVIEW_B_SNAPSHOT_LAYER_SHADOW', '1');
    expect(isReviewFlagEnabled('REVIEW_B_SNAPSHOT_LAYER_SHADOW')).toBe(true);

    localStorage.setItem('review.flag.REVIEW_C_EVENT_LOG', 'true');
    expect(isReviewFlagEnabled('REVIEW_C_EVENT_LOG')).toBe(true);
  });

  it('respects localStorage override = 0/false', () => {
    localStorage.setItem('review.flag.REVIEW_B_SNAPSHOT_LAYER_SHADOW', '0');
    expect(isReviewFlagEnabled('REVIEW_B_SNAPSHOT_LAYER_SHADOW')).toBe(false);

    localStorage.setItem('review.flag.REVIEW_C_EVENT_LOG', 'false');
    expect(isReviewFlagEnabled('REVIEW_C_EVENT_LOG')).toBe(false);
  });

  it('force_legacy beats every localStorage override', () => {
    localStorage.setItem('review.force_legacy', '1');
    localStorage.setItem('review.flag.REVIEW_B_SNAPSHOT_LAYER_SHADOW', '1');
    expect(isReviewFlagEnabled('REVIEW_B_SNAPSHOT_LAYER_SHADOW')).toBe(false);
  });

  it('falls back to VITE_ env flag when no localStorage override', () => {
    vi.stubEnv('VITE_REVIEW_B_SNAPSHOT_LAYER_SHADOW', '1');
    expect(isReviewFlagEnabled('REVIEW_B_SNAPSHOT_LAYER_SHADOW')).toBe(true);
  });

  it('localStorage override beats env flag', () => {
    vi.stubEnv('VITE_REVIEW_B_SNAPSHOT_LAYER_SHADOW', '1');
    localStorage.setItem('review.flag.REVIEW_B_SNAPSHOT_LAYER_SHADOW', '0');
    expect(isReviewFlagEnabled('REVIEW_B_SNAPSHOT_LAYER_SHADOW')).toBe(false);
  });

  it('clearReviewFlagOverrides removes all overrides but not env/defaults', () => {
    localStorage.setItem('review.flag.REVIEW_C_EVENT_LOG', '1');
    localStorage.setItem('review.force_legacy', '1');
    clearReviewFlagOverrides();
    expect(localStorage.getItem('review.flag.REVIEW_C_EVENT_LOG')).toBeNull();
    expect(localStorage.getItem('review.force_legacy')).toBeNull();
  });
});
