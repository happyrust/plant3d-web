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

  const meshlineVert = ShaderChunk.meshline_vert;
  const commonChunk = ShaderChunk.common;

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

  ShaderChunk.meshline_vert = `${commonChunk}\n${meshlineVert}`;
  applied = true;
}

applyMeshLineShaderCompat();
