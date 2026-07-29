/**
 * DTXGeometry - DTX 专用几何体
 *
 * 核心职责：
 * 1. 创建虚拟顶点数组（实际数据从纹理获取）
 * 2. 通过 gl_VertexID 索引顶点
 * 3. 设置正确的绘制范围
 */

import { BufferGeometry, Sphere, Vector3 } from 'three';

/**
 * DTXGeometry - 数据纹理层专用几何体
 *
 * 与传统几何体不同，DTXGeometry 不存储实际的顶点数据。
 * 它只包含一个虚拟的顶点数组，让 WebGL 知道要绘制多少个顶点。
 * 实际的顶点位置在 Vertex Shader 中通过 gl_VertexID 从纹理获取。
 */
export class DTXGeometry extends BufferGeometry {
  /** 总索引数（决定绘制的顶点数） */
  private _totalIndices: number;

  /**
   * 构造 DTX 几何体
   * @param totalIndices 总索引数（= 总三角形数 * 3）
   */
  constructor(totalIndices: number) {
    super();

    this._totalIndices = totalIndices;

    // Shader 只依赖 gl_VertexID。没有 position 属性时 Three.js 会直接使用
    // drawRange 作为 drawArrays 顶点数，无需按顶点分配占位缓冲。
    this.boundingSphere = new Sphere(new Vector3(), 1e12);

    // 不使用索引缓冲区，直接用 gl_VertexID
    this.setDrawRange(0, totalIndices);
  }

  /**
   * 获取总索引数
   */
  get totalIndices(): number {
    return this._totalIndices;
  }

  /**
   * 更新绘制范围
   * 可用于实现可见性裁剪（只绘制可见对象的图元）
   */
  updateDrawRange(start: number, count: number): void {
    this.setDrawRange(start, count);
  }

  /**
   * 重置为绘制全部
   */
  resetDrawRange(): void {
    this.setDrawRange(0, this._totalIndices);
  }
}
