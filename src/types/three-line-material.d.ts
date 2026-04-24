/**
 * `three/examples/jsm/lines/LineMaterial` 类型扩展。
 *
 * `@types/three` 的 LineMaterial 声明漏了 `scale` 属性（dash scaling，
 * 见 three.js 官方 `LineMaterial.js`），但我们的 XeokitDistance /
 * XeokitAngle / XeokitElevation* 几条 annotation 代码在控制虚线比例时
 * 都会 `material.scale = 1`。不加这层 augmentation 就会报 TS2339。
 *
 * 只补缺失字段，不动已有签名；未来 @types/three 版本自己补了这个字段
 * 时，此声明将退化为无副作用的重叠声明，不用主动删除。
 */
declare module 'three/examples/jsm/lines/LineMaterial.js' {
  interface LineMaterial {
    /** 虚线比例：控制 `dashSize/gapSize` 的单位缩放 */
    scale: number;
  }
}

export {};
