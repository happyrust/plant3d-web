import { describe, expect, it } from 'vitest';

import { canEditUserDimension } from './permissions';
import { linearRecord } from './testFixtures';

describe('canEditUserDimension', () => {
  const record = linearRecord({ authorId: 'owner' });

  it('allows the author', () => {
    expect(canEditUserDimension(
      { id: 'owner', role: 'designer' },
      record,
    )).toBe(true);
  });

  it('allows an admin regardless of role casing', () => {
    expect(canEditUserDimension(
      { id: 'admin', role: 'ADMIN' },
      record,
    )).toBe(true);
  });

  it('rejects another participant and an anonymous user', () => {
    expect(canEditUserDimension(
      { id: 'reviewer', role: 'reviewer' },
      record,
    )).toBe(false);
    expect(canEditUserDimension(null, record)).toBe(false);
  });
});
