import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveAt, type ResolveError } from './timeResolve';

import type { ScrubVersion } from './tickLayout';

/**
 * 共享样例对拍（tasks.md 12.5，Requirement 8.10、10.2）。
 *
 * 同一份 `docs/fixtures/version-time-resolve-cases.json` 在两个仓各放一份、内容逐字节一致：
 * Rust `resolve_at_rows` 与 TS `resolveAt` 都按它逐条对拍，所以「按时刻取到哪一版」
 * 在前后端不会各说一套。
 */
type Case = {
  name: string;
  rows: { sesno: number; session_time: string | null }[];
  at: string;
  expect: { sesno?: number; session_time?: string; error?: ResolveError };
};

const fixturePath = resolve(__dirname, '../../../docs/fixtures/version-time-resolve-cases.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { cases: Case[] };

describe('共享样例：时间点解析', () => {
  it('样例文件存在且非空', () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
  });

  it('resolveAt 逐条对拍记录下来的预期', () => {
    for (const item of fixture.cases) {
      const versions: ScrubVersion[] = item.rows.map((row) => ({
        sesno: row.sesno,
        sessionTime: row.session_time,
        impactKind: 'mesh',
      }));
      const got = resolveAt(versions, item.at);
      if (item.expect.error !== undefined) {
        expect(got, item.name).toEqual({ ok: false, error: item.expect.error });
      } else {
        expect(got, item.name).toEqual({
          ok: true,
          sesno: item.expect.sesno!,
          sessionTime: item.expect.session_time!,
        });
      }
    }
  });

  it('行序打乱后结论不变（链序只看 sesno）', () => {
    for (const item of fixture.cases) {
      const versions: ScrubVersion[] = item.rows.map((row) => ({
        sesno: row.sesno,
        sessionTime: row.session_time,
        impactKind: 'mesh',
      }));
      const reversed = [...versions].reverse();
      expect(resolveAt(reversed, item.at), item.name).toEqual(resolveAt(versions, item.at));
    }
  });
});
