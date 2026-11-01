import { ShaderChunk } from 'three';

import '@lume/three-meshline';

let applied = false;

/**
 * 兼容 three@0.162 的 log depth vertex chunk。
 *
 * 背景：
 * - @lume/three-meshline 4.0.5 注册的 `meshline_vert` 会注入 `logdepthbuf_pars_vertex`
 * - three@0.162 的 `logdepthbuf_vertex` 依赖 `common` chunk 中的 `isPerspectiveMatrix`
 * - 但 meshline 自定义 vertex shader 没有拼入 `common`，导致运行时编译失败
 *
 * 现象：
 * - Material Type: MeshLineMaterial
 * - 'isPerspectiveMatrix' : no matching overloaded function found
 */
export function applyMeshLineShaderCompat(): void {
  if (applied) return;

  // `@lume/three-meshline` 在模块求值时把 `meshline_vert` / `meshline_frag` 注册进
  // `THREE.ShaderChunk`（见包内 `meshline.glsl.js`），但 `@types/three` 的 `ShaderChunk`
  // 只声明了 three 自带的 chunk，没有这两个键。这里按「三方扩展过的注册表」读，
  // 运行时对象不变，只是补上索引签名。
  const chunks = ShaderChunk as typeof ShaderChunk & Record<string, string | undefined>;
  const meshlineVert = chunks.meshline_vert;
  const commonChunk = chunks.common;

  if (typeof meshlineVert !== 'string' || meshlineVert.length === 0) {
    applied = true;
    return;
  }

  if (typeof commonChunk !== 'string' || commonChunk.length === 0) {
    applied = true;
    return;
  }

  if (meshlineVert.includes('bool isPerspectiveMatrix(')) {
    applied = true;
    return;
  }

  chunks.meshline_vert = `${commonChunk}\n${meshlineVert}`;
  applied = true;
}

applyMeshLineShaderCompat();
