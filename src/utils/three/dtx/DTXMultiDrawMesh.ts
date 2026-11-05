import { Mesh } from 'three';

import type { BufferGeometry, Material } from 'three';

/** 多段绘制的段表；不透明 / 透明两条通道共用一份 */
export type DTXDrawRangeBuffers = {
  /** 段起点（顶点） */
  starts: Int32Array;
  /** 段长度（顶点） */
  counts: Int32Array;
  /** 有效段数；0 时 three 直接跳过这次绘制 */
  count: number;
};

/**
 * 用 WEBGL_multi_draw 按段绘制的 DTX 网格。
 *
 * three r162 的 `renderBufferDirect` 只对 `object.isBatchedMesh` 走
 * `renderer.renderMultiDraw(object._multiDrawStarts, object._multiDrawCounts, object._multiDrawCount)`，
 * 而且 `drawCount === 0` 时直接返回。这里借用这套内部约定：`isBatchedMesh` 为真并以 getter 暴露段表。
 * 副作用是程序前缀多一个 `#define USE_BATCHING`——DTX 着色器不 include three 的 batching 片段，所以不受影响。
 * 升级 three 时以 `DTXMultiDrawMesh.test.ts` 为准重新核对这些约定。
 *
 * `multiDrawEnabled = false` 时退回普通 Mesh（按 geometry.drawRange 一次画完）：three 在缺 WEBGL_multi_draw 时
 * 会逐段 drawArrays，但每帧都打一条 "extension not supported" 警告。
 */
export class DTXMultiDrawMesh extends Mesh {
  readonly drawRanges: DTXDrawRangeBuffers;
  multiDrawEnabled = true;

  constructor(geometry: BufferGeometry, material: Material, drawRanges: DTXDrawRangeBuffers) {
    super(geometry, material);
    this.drawRanges = drawRanges;
  }

  get isBatchedMesh(): boolean {
    return this.multiDrawEnabled;
  }

  get _multiDrawStarts(): Int32Array {
    return this.drawRanges.starts;
  }

  get _multiDrawCounts(): Int32Array {
    return this.drawRanges.counts;
  }

  get _multiDrawCount(): number {
    return this.drawRanges.count;
  }

  // Object3D.toJSON 见到 isBatchedMesh 会去读 BatchedMesh 独有的字段，序列化时按普通 Mesh 处理
  override toJSON(meta?: Parameters<Mesh['toJSON']>[0]): ReturnType<Mesh['toJSON']> {
    const enabled = this.multiDrawEnabled;
    this.multiDrawEnabled = false;
    try {
      return super.toJSON(meta);
    } finally {
      this.multiDrawEnabled = enabled;
    }
  }
}
