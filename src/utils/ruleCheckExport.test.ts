import { describe, expect, it, vi } from 'vitest';

import {
  buildRuleCheckCsv,
  buildRuleCheckJson,
  escapeCsvCell,
  formatExportTimestamp,
  triggerTextDownload,
} from './ruleCheckExport';

import type { UnifiedRuleViolation } from '@/api/ruleCheckApi';

describe('ruleCheckExport', () => {
  it('escapes commas, double quotes, and newlines according to RFC 4180', () => {
    expect(escapeCsvCell('plain')).toBe('plain');
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvCell(undefined)).toBe('');
  });

  it('builds UTF-8 BOM CSV with Chinese headers, firezone color, hasColumn, and numeric metrics', () => {
    const violations: UnifiedRuleViolation[] = [
      {
        key: 'k1',
        engine: 'rooms',
        ruleId: 'ELEC-250',
        issue: 250,
        discipline: '电气',
        title: '配电室通道',
        requirement: '>=1500mm',
        sourceLabel: '24381_100',
        targetLabel: '24381_101',
        roomNum: 'R101',
        measuredMm: 1100.5,
        thresholdMm: 1500,
        marginMm: -399.5,
        hasColumn: true,
        severity: 'violation',
        highlightRefnos: ['24381_100', '24381_101'],
        detail: '通道局部有柱, 实测不足',
      },
      {
        key: 'k2',
        engine: 'attrs',
        ruleId: 'ELEC-282',
        issue: 282,
        discipline: '电气',
        title: '火灾分区',
        requirement: '扩散性红/局部性黄',
        sourceLabel: 'CTRAY 24381_500',
        targetLabel: '-',
        severity: 'violation',
        highlightColor: 'red',
        highlightRefnos: ['24381_500'],
        detail: '扩散性火灾分区',
      },
    ];

    const csv = buildRuleCheckCsv(violations);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('引擎,规则ID,工单号,专业');
    expect(lines[1]).toContain('房间语义,ELEC-250,#250,电气');
    expect(lines[1]).toContain(',R101,是,');
    expect(lines[1]).toContain('1100.5,1500.0,-399.5,24381_100;24381_101,"通道局部有柱, 实测不足"');
    expect(lines[2]).toContain('红(扩散性火灾)');
  });

  it('builds structured schema v1 JSON report and formats timestamp', () => {
    const jsonText = buildRuleCheckJson({
      exportedAt: '2026-11-22T14:00:00.000Z',
      summary: {
        rulesRun: 2,
        totalReported: 1,
        violations: 1,
        reminders: 0,
        semiAuto: 0,
        firezones: 1,
        totalElapsedMs: 14,
      },
      warnings: ['w1'],
      batches: [],
      results: [],
      violations: [],
    });
    const parsed = JSON.parse(jsonText);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.exportedAt).toBe('2026-11-22T14:00:00.000Z');
    expect(parsed.summary.firezones).toBe(1);
    expect(formatExportTimestamp(new Date(2026, 10, 22, 9, 5, 3))).toBe('20261122-090503');
  });

  it('creates an anchor download and revokes object URL cleanly', () => {
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rule-check-1');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    triggerTextDownload('hello', 'report.csv', 'text/csv;charset=utf-8;');

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith('blob:rule-check-1');

    createSpy.mockRestore();
    revokeSpy.mockRestore();
    clickSpy.mockRestore();
  });
});
