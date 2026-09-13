/**
 * `.mesh`（rkyv 0.7 归档 PlantMesh）解析器的金样测试。
 *
 * 金样是 gen-model `assets/meshes` 里的**真实语料原件**（内容寻址，永不改写）：
 * - `1.mesh` 单位盒（36 顶点 / 12 三角 / 逐角法向，aabb=Some(±0.5)）
 * - `3.mesh` 单位球（629 顶点 / 1080 三角，索引网格，aabb=Some(±0.5)）
 * - `23708_26903_1361.mesh` aabb=None 的真实构件
 * - `24381_158031_66.mesh` 60 字节空网格（服务端转 GLB 也会 422），必须回 null
 *
 * 期望值来自 2026-09-09 的全量语料扫描（48,590 份全过，最大 aabb 偏差 2.8e-6，
 * 见 docs/plans 收口计划 §.mesh 直连）；布局说明见 parseMeshGeometry.ts 头注。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseMeshGeometry, parseMeshGeometryResult } from './parseMeshGeometry';

// jsdom 环境下 import.meta.url 会被改写，按 vitest 的项目根（cwd）取金样
function fixture(name: string): ArrayBuffer {
  const buf = readFileSync(join(process.cwd(), 'src', 'fixtures', 'meshes', name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function boundsOf(positions: number[]): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], positions[i + axis]);
      max[axis] = Math.max(max[axis], positions[i + axis]);
    }
  }
  return { min, max };
}

describe('parseMeshGeometry（rkyv 布局金样）', () => {
  it('单位盒 1.mesh：36 顶点逐角展开，包围盒恰为 ±0.5', () => {
    const parsed = parseMeshGeometry(fixture('1.mesh'));
    expect(parsed).not.toBeNull();
    expect(parsed!.positions).toHaveLength(36 * 3);
    expect(parsed!.indices).toHaveLength(36);
    expect(parsed!.normals).toHaveLength(36 * 3);
    expect(Math.max(...parsed!.indices)).toBeLessThan(36);
    const { min, max } = boundsOf(parsed!.positions);
    expect(min).toEqual([-0.5, -0.5, -0.5]);
    expect(max).toEqual([0.5, 0.5, 0.5]);
    // 单位法向：每条模长 ≈ 1
    for (let i = 0; i < parsed!.normals!.length; i += 3) {
      const [x, y, z] = parsed!.normals!.slice(i, i + 3);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
    }
  });

  it('单位球 3.mesh：索引网格（629 顶点 / 1080 三角），索引全部在界内', () => {
    const parsed = parseMeshGeometry(fixture('3.mesh'));
    expect(parsed).not.toBeNull();
    expect(parsed!.positions).toHaveLength(629 * 3);
    expect(parsed!.indices).toHaveLength(3240);
    expect(parsed!.normals).toHaveLength(629 * 3);
    expect(Math.max(...parsed!.indices)).toBeLessThan(629);
    const { min, max } = boundsOf(parsed!.positions);
    expect(min).toEqual([-0.5, -0.5, -0.5]);
    expect(max).toEqual([0.5, 0.5, 0.5]);
  });

  it('aabb=None 的真实构件照常解（tag=0 只是没有包围盒，不是坏文件）', () => {
    const parsed = parseMeshGeometry(fixture('23708_26903_1361.mesh'));
    expect(parsed).not.toBeNull();
    expect(parsed!.positions).toHaveLength(24 * 3);
    expect(parsed!.indices).toHaveLength(24);
    expect(parsed!.normals).toHaveLength(24 * 3);
  });

  it('60 字节空网格回 null（与服务端「编不成三角网格→422」同一判定）', () => {
    expect(parseMeshGeometry(fixture('24381_158031_66.mesh'))).toBeNull();
  });

  it('截断 / 过短 / 未对齐的字节串一律回 null，不抛异常', () => {
    const whole = fixture('1.mesh');
    expect(parseMeshGeometry(whole.slice(0, whole.byteLength - 8))).toBeNull(); // 根结构被截
    expect(parseMeshGeometry(whole.slice(0, 40))).toBeNull(); // 装不下根
    expect(parseMeshGeometry(whole.slice(0, whole.byteLength - 2))).toBeNull(); // 长度不是 4 的倍数
    expect(parseMeshGeometry(new ArrayBuffer(0))).toBeNull();
  });

  it('诊断入口返回文件名、字节位置、期望值和实际值', () => {
    const result = parseMeshGeometryResult(new ArrayBuffer(12), 'broken.mesh');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issue).toMatchObject({
      source: 'broken.mesh',
      format: 'mesh',
      expected: '至少 60 字节',
      actual: '12 字节',
      byteOffset: 12,
    });
  });

  it('索引越界的坏字节串回 null（防上游写坏或传输损伤静默画歪）', () => {
    const corrupted = fixture('1.mesh');
    const view = new DataView(corrupted);
    const root = corrupted.byteLength - 60;
    const indicesAt = root + 28 + view.getInt32(root + 28, true);
    view.setUint32(indicesAt, 999, true); // 顶点只有 36 个
    expect(parseMeshGeometry(corrupted)).toBeNull();
  });
});
