import { describe, expect, it } from 'vitest';

import { pipeConnection, pipeConnectivityLine, type PipeConnectivityLine } from './pipeConnectivity';

type Segment = { noun: string; start: [number, number, number]; end: [number, number, number]; od?: number };

function line(refno: string, segments: Segment[]): PipeConnectivityLine {
  const point = ([x, y, z]: [number, number, number]) => ({ x, y, z });
  const built = pipeConnectivityLine(refno, {
    segments: segments.map(segment => ({
      noun: segment.noun,
      start: point(segment.start),
      end: point(segment.end),
      outside_diameter_mm: segment.od ?? 114.3,
    })),
  });
  if (!built) throw new Error(`${refno} 没有可用的中心线`);
  return built;
}

describe('pipeConnection', () => {
  it('首尾点重合是确定相连', () => {
    const a = line('A', [{ noun: 'TUBI', start: [0, 0, 0], end: [1000, 0, 0] }]);
    const b = line('B', [{ noun: 'TUBI', start: [1000.5, 0, 0], end: [2000, 0, 0] }]);
    expect(pipeConnection(a, b)).toBe('ends');
    expect(pipeConnection(b, a)).toBe('ends');
  });

  it('支管端点在三通够得着的范围里是疑似相连（24381/145037 的尾端离三通段 117 mm）', () => {
    const header = line('H', [
      { noun: 'TUBI', start: [-1000, 0, 0], end: [0, 0, 0], od: 168.3 },
      { noun: 'TEE', start: [0, 0, 0], end: [286, 0, 0], od: 168.3 },
      { noun: 'TUBI', start: [286, 0, 0], end: [1286, 0, 0], od: 168.3 },
    ]);
    const branch = line('B', [{ noun: 'TUBI', start: [143, 1117, 0], end: [143, 117, 0], od: 60.3 }]);
    expect(pipeConnection(branch, header)).toBe('branch');
    expect(pipeConnection(header, branch)).toBe('branch');
  });

  it('直接焊在主管管身上的支管是疑似相连', () => {
    const header = line('H', [{ noun: 'TUBI', start: [0, 0, 0], end: [2000, 0, 0], od: 114.3 }]);
    const stub = line('S', [{ noun: 'TUBI', start: [800, 0, 57], end: [800, 0, 600], od: 33.4 }]);
    expect(pipeConnection(stub, header)).toBe('branch');
  });

  it('零长度三通被后端折叠进直管段时，支管首端距主管中心线 ~124 mm 仍判疑似相连（24381/145018 ↔ 24381/145060）', () => {
    const header = line('24381_145018', [{ noun: 'TUBI', start: [0, 0, 0], end: [2000, 0, 0], od: 60.3 }]);
    const branch = line('24381_145060', [{ noun: 'TUBI', start: [900, 124, 0], end: [900, 800, 0], od: 60.3 }]);
    expect(pipeConnection(header, branch)).toBe('branch');
    expect(pipeConnection(branch, header)).toBe('branch');
  });

  it('平行并排、端点离对方管身和三通都远的两根管不相连', () => {
    const a = line('A', [
      { noun: 'TUBI', start: [0, 0, 0], end: [2000, 0, 0] },
      { noun: 'TEE', start: [2000, 0, 0], end: [2200, 0, 0] },
    ]);
    const b = line('B', [{ noun: 'TUBI', start: [0, 300, 0], end: [2000, 300, 0] }]);
    expect(pipeConnection(a, b)).toBeNull();
    expect(pipeConnection(b, a)).toBeNull();
  });

  it('没有段、段坐标不全或没有响应时不判相连', () => {
    expect(pipeConnectivityLine('A', { segments: [] })).toBeNull();
    expect(pipeConnectivityLine('A', { segments: [{ noun: 'TUBI', start: { x: 0, y: 0, z: Number.NaN }, end: { x: 1, y: 0, z: 0 } }] })).toBeNull();
    expect(pipeConnectivityLine('A', null)).toBeNull();
  });
});
