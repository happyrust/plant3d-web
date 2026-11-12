import { describe, expect, it } from 'vitest';

import {
  MBD_DROPPED_PRIMITIVE_RULE_ID,
  mbdDroppedPrimitivesHeadline,
  summarizeMbdDroppedPrimitives,
} from './mbdDroppedPrimitives';

import type { MbdV2Issue } from '../adapters/mbdV2Contract';

/** 求解器出口自检的原话（plant-mbd `validity.rs`）：一个图元不合契约、被拿掉。 */
function dropped(refno: string, index: number, overrides: Partial<MbdV2Issue> = {}): MbdV2Issue {
  return {
    id: `${refno}:contract.invalid_primitive:${index}`,
    severity: 'warning',
    category: 'data',
    message: `label ${refno}:support:label:${index} cannot be drawn and was dropped: `
      + 'text_height_mm = 0.0 is not a finite number of at least 0.001 mm',
    refno,
    object_refno: `${refno}-part-${index}`,
    rule_id: 'contract.invalid_primitive',
    ...overrides,
  };
}

/** 直段表的那一条：轴线按未声明下发，一个图元都没少。 */
function isolineWithoutAxis(refno: string, index: number): MbdV2Issue {
  return {
    id: `${refno}:contract.invalid_isoline:${index}:axis`,
    severity: 'info',
    category: 'data',
    message: `isoline ${index} has an axis whose ends coincide or are not finite; sent without an axis`,
    refno,
    isoline_idx: index,
    rule_id: 'contract.invalid_isoline',
  };
}

function source(refno: string, issues: readonly MbdV2Issue[], loadError: string | null = null) {
  return { refno, issues, loadError };
}

function snapshot(sources: readonly ReturnType<typeof source>[]) {
  return {
    sourceId: sources.length > 0 ? sources.map(entry => entry.refno).join(',') : null,
    issues: sources.flatMap(entry => entry.issues),
    loadError: null,
    sources,
  };
}

describe('summarizeMbdDroppedPrimitives', () => {
  it('names the rule the solver exit self-check reports', () => {
    expect(MBD_DROPPED_PRIMITIVE_RULE_ID).toBe('contract.invalid_primitive');
  });

  it('returns null when no package carries the rule', () => {
    expect(summarizeMbdDroppedPrimitives(snapshot([]))).toBeNull();
    expect(summarizeMbdDroppedPrimitives(snapshot([source('A', [])]))).toBeNull();
    expect(summarizeMbdDroppedPrimitives(snapshot([
      source('A', [{ id: 'A:locate.no_wall', severity: 'warning', category: 'other', message: 'x', rule_id: 'locate.no_wall' }]),
    ]))).toBeNull();
  });

  it('does not count contract.invalid_isoline: the isoline table changed, no primitive was dropped', () => {
    const rowLeftOut: MbdV2Issue = {
      id: 'A:contract.invalid_isoline:3',
      severity: 'warning',
      category: 'data',
      message: 'isoline 3 has cheight 0 mm / od 0 mm, not positive finite numbers; its row is left out of meta.isolines',
      refno: 'A',
      isoline_idx: 3,
      rule_id: 'contract.invalid_isoline',
    };
    expect(summarizeMbdDroppedPrimitives(snapshot([
      source('A', [isolineWithoutAxis('A', 0), rowLeftOut]),
    ]))).toBeNull();
  });

  it('counts one place per diagnostic and carries rule id, object and reason', () => {
    const first = dropped('24381_25804', 0, { object_refno: '24381_25804' });
    const second = dropped('24381_25804', 1, { object_refno: undefined });
    const summary = summarizeMbdDroppedPrimitives(snapshot([
      source('24381_25804', [isolineWithoutAxis('24381_25804', 0), first, second]),
    ]));

    expect(summary).toEqual({
      total: 2,
      multiSource: false,
      sources: [{
        refno: '24381_25804',
        dropped: [
          { issueId: first.id, ruleId: 'contract.invalid_primitive', objectRefno: '24381_25804', reason: first.message },
          { issueId: second.id, ruleId: 'contract.invalid_primitive', objectRefno: null, reason: second.message },
        ],
      }],
    });
  });

  it('recognises the diagnostic by its rule id alone, never by wording, level or category', () => {
    const sameWordsOtherRule = dropped('A', 0, { rule_id: 'support.part_geometry_missing' });
    const sameWordsNoRule = dropped('A', 1, { rule_id: undefined });
    const otherWords = dropped('A', 2, { message: '随便一句', severity: 'info', category: 'other' });

    const summary = summarizeMbdDroppedPrimitives(snapshot([
      source('A', [sameWordsOtherRule, sameWordsNoRule, otherWords]),
    ]));

    expect(summary?.total).toBe(1);
    expect(summary?.sources[0]?.dropped.map(entry => entry.issueId)).toEqual([otherWords.id]);
    expect(summary?.sources[0]?.dropped[0]?.reason).toBe('随便一句');
  });

  it('counts each package separately and sums them, in mbd_refno order', () => {
    const summary = summarizeMbdDroppedPrimitives(snapshot([
      source('S', [dropped('S', 0)]),
      source('P', [isolineWithoutAxis('P', 0)]),
      source('W', [dropped('W', 0), dropped('W', 1)]),
    ]));

    expect(summary?.total).toBe(3);
    expect(summary?.multiSource).toBe(true);
    expect(summary?.sources.map(entry => [entry.refno, entry.dropped.length])).toEqual([['S', 1], ['W', 2]]);
  });

  it('stays in multi-package form when only one of several packages lost primitives', () => {
    const summary = summarizeMbdDroppedPrimitives(snapshot([
      source('P', []),
      source('S', [dropped('S', 0)]),
    ]));

    expect(summary).toMatchObject({ total: 1, multiSource: true });
    expect(summary?.sources.map(entry => entry.refno)).toEqual(['S']);
  });

  it('leaves out a package that failed to load: nothing of it is on screen', () => {
    expect(summarizeMbdDroppedPrimitives(snapshot([
      source('A', [dropped('A', 0)], 'MBD 负载整包拒绝：1 个图元无法映射'),
    ]))).toBeNull();

    const summary = summarizeMbdDroppedPrimitives(snapshot([
      source('A', [dropped('A', 0)], 'MBD 负载整包拒绝：1 个图元无法映射'),
      source('B', [dropped('B', 0)]),
    ]));
    expect(summary?.total).toBe(1);
    expect(summary?.sources.map(entry => entry.refno)).toEqual(['B']);
  });

  it('falls back to the top-level issues when the caller gave no per-package sources', () => {
    const issue = dropped('A', 0);
    expect(summarizeMbdDroppedPrimitives({
      sourceId: 'A',
      issues: [issue],
      loadError: null,
      sources: [],
    })).toEqual({
      total: 1,
      multiSource: false,
      sources: [{
        refno: 'A',
        dropped: [{ issueId: issue.id, ruleId: 'contract.invalid_primitive', objectRefno: 'A-part-0', reason: issue.message }],
      }],
    });

    expect(summarizeMbdDroppedPrimitives({
      sourceId: 'A',
      issues: [issue],
      loadError: 'HTTP 502',
      sources: [],
    })).toBeNull();
  });
});

describe('mbdDroppedPrimitivesHeadline', () => {
  it('says how many places the exit self-check took out of the one package on screen', () => {
    const summary = summarizeMbdDroppedPrimitives(snapshot([source('A', [dropped('A', 0), dropped('A', 1)])]));

    expect(mbdDroppedPrimitivesHeadline(summary!))
      .toBe('本图不完整：求解器的出口自检拿掉了 2 处不合契约的图元。');
  });

  it('says how many packages are affected when several share the view', () => {
    const summary = summarizeMbdDroppedPrimitives(snapshot([
      source('S', [dropped('S', 0)]),
      source('P', []),
      source('W', [dropped('W', 0), dropped('W', 1)]),
    ]));

    expect(mbdDroppedPrimitivesHeadline(summary!))
      .toBe('本图不完整：求解器的出口自检从 2 个标注包里拿掉了 3 处不合契约的图元。');
  });
});
