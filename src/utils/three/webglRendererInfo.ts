/**
 * 这块 WebGL 上下文跑在真显卡上还是软渲染（SwiftShader / llvmpipe / Microsoft Basic Render Driver……远程桌面、虚拟机、
 * 缺省 headless 都会落到这里）。版本对比的分屏描边合成器（收口计划 P3-c，README §8.3）按它决定走不走：软渲染下合成器每格
 * +0.8–1.1 ms 的固定开销会把分屏压到 11 fps，那时退回直接 `renderer.render`。
 *
 * 读的是 `WEBGL_debug_renderer_info` 的 `UNMASKED_RENDERER_WEBGL`（Chrome 缺省 `RENDERER` 只回「WebKit WebGL」）；扩展拿不到
 * 就退回 `gl.RENDERER`，再拿不到就当不知道 = 按真显卡处理（缺省仍走合成器，不因为读不到就降级）。
 */

export type WebGLRendererInfo = {
  /** 显卡 / 驱动串；读不到为 null */
  renderer: string | null;
  vendor: string | null;
  /** 认出来是软渲染 */
  software: boolean;
};

/** 常见软渲染器的名字：SwiftShader（Chrome 无 GPU 时）、llvmpipe / softpipe（Mesa）、Microsoft Basic Render Driver（Windows 无驱动） */
const SOFTWARE_RENDERER_PATTERN = /swiftshader|llvmpipe|softpipe|microsoft basic render|software\s*(rasterizer|renderer|adapter|device)|mesa offscreen/i;

export function isSoftwareRendererName(name: string | null | undefined): boolean {
  return typeof name === 'string' && SOFTWARE_RENDERER_PATTERN.test(name);
}

type GlLike = {
  getExtension(name: string): unknown;
  getParameter(pname: number): unknown;
  RENDERER: number;
  VENDOR: number;
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function readWebGLRendererInfo(gl: GlLike | null | undefined): WebGLRendererInfo {
  if (!gl) return { renderer: null, vendor: null, software: false };
  let renderer: string | null = null;
  let vendor: string | null = null;
  try {
    const debug = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number; UNMASKED_VENDOR_WEBGL: number } | null;
    if (debug) {
      renderer = asString(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL));
      vendor = asString(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL));
    }
    renderer ??= asString(gl.getParameter(gl.RENDERER));
    vendor ??= asString(gl.getParameter(gl.VENDOR));
  } catch {
    // 上下文已丢 / 参数不认：当不知道
  }
  return { renderer, vendor, software: isSoftwareRendererName(renderer) };
}
