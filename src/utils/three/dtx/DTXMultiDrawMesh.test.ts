import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BufferGeometry, Mesh, MeshBasicMaterial } from 'three';

import { DTXMultiDrawMesh } from './DTXMultiDrawMesh';

const threeSource = readFileSync(resolve(process.cwd(), 'node_modules/three/build/three.module.js'), 'utf8');

describe('DTXMultiDrawMesh', () => {
  it('以 BatchedMesh 的内部字段暴露同一份段表', () => {
    const ranges = { starts: new Int32Array([0, 30]), counts: new Int32Array([9, 3]), count: 2 };
    const mesh = new DTXMultiDrawMesh(new BufferGeometry(), new MeshBasicMaterial(), ranges);
    expect(mesh).toBeInstanceOf(Mesh);
    expect(mesh.isBatchedMesh).toBe(true);
    expect(mesh._multiDrawStarts).toBe(ranges.starts);
    expect(mesh._multiDrawCounts).toBe(ranges.counts);
    expect(mesh._multiDrawCount).toBe(2);
    ranges.count = 0;
    expect(mesh._multiDrawCount).toBe(0);
  });

  it('关掉多段绘制后退回普通 Mesh', () => {
    const mesh = new DTXMultiDrawMesh(new BufferGeometry(), new MeshBasicMaterial(), {
      starts: new Int32Array(1), counts: new Int32Array(1), count: 1,
    });
    mesh.multiDrawEnabled = false;
    expect(mesh.isBatchedMesh).toBe(false);
  });

  it('toJSON 按普通 Mesh 序列化', () => {
    const mesh = new DTXMultiDrawMesh(new BufferGeometry(), new MeshBasicMaterial(), {
      starts: new Int32Array(1), counts: new Int32Array(1), count: 1,
    });
    const json = mesh.toJSON() as { object: { type: string } };
    expect(json.object.type).toBe('Mesh');
    expect(mesh.isBatchedMesh).toBe(true);
  });

  // 锁住借用的 three r162 内部约定：升级 three 后这里失败，就要重新核对 DTXMultiDrawMesh
  it('three 仍按 isBatchedMesh 走 renderMultiDraw，且 0 段时跳过', () => {
    expect(threeSource).toMatch(/const REVISION = '162'/);
    expect(threeSource).toContain(
      'renderer.renderMultiDraw( object._multiDrawStarts, object._multiDrawCounts, object._multiDrawCount );',
    );
    expect(threeSource).toMatch(/function renderMultiDraw\( starts, counts, drawCount \) \{\s+if \( drawCount === 0 \) return;/);
    expect(threeSource).toContain('extension.multiDrawArraysWEBGL( mode, starts, 0, counts, 0, drawCount );');
    // isBatchedMesh 只给程序前缀加 USE_BATCHING、只在对象上有 _matricesTexture 时绑 batchingTexture
    expect(threeSource).toContain('parameters.batching ? \'#define USE_BATCHING\' : \'\',');
    expect(threeSource).toContain('p_uniforms.setValue( _gl, \'batchingTexture\', object._matricesTexture, textures );');
  });
});
