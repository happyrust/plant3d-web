import { describe, expect, it } from 'vitest';

import { isSoftwareRendererName, readWebGLRendererInfo } from './webglRendererInfo';

function fakeGl(options: { unmasked?: string | null; masked?: string; vendor?: string; throws?: boolean }) {
  const RENDERER = 0x1f01;
  const VENDOR = 0x1f00;
  const UNMASKED_RENDERER_WEBGL = 0x9246;
  const UNMASKED_VENDOR_WEBGL = 0x9245;
  return {
    RENDERER,
    VENDOR,
    getExtension: (name: string) => (name === 'WEBGL_debug_renderer_info' && options.unmasked !== undefined ? { UNMASKED_RENDERER_WEBGL, UNMASKED_VENDOR_WEBGL } : null),
    getParameter: (pname: number) => {
      if (options.throws) throw new Error('context lost');
      if (pname === UNMASKED_RENDERER_WEBGL) return options.unmasked ?? null;
      if (pname === UNMASKED_VENDOR_WEBGL) return options.vendor ?? 'Google Inc.';
      if (pname === RENDERER) return options.masked ?? 'WebKit WebGL';
      if (pname === VENDOR) return 'WebKit';
      return null;
    },
  };
}

describe('webglRendererInfo（分屏描边合成器要不要走，P3-c）', () => {
  it('认得出常见软渲染器名字；真显卡 / 空 / 非字串都不是', () => {
    expect(isSoftwareRendererName('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')).toBe(true);
    expect(isSoftwareRendererName('ANGLE (Mesa, llvmpipe (LLVM 15.0.7, 256 bits), OpenGL 4.5)')).toBe(true);
    expect(isSoftwareRendererName('Mesa/X.org, softpipe')).toBe(true);
    expect(isSoftwareRendererName('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(true);
    expect(isSoftwareRendererName('Google SwiftShader')).toBe(true);
    expect(isSoftwareRendererName('ANGLE (AMD, AMD Radeon RX 590 Series (0x000067DF) Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.21912.14)')).toBe(false);
    expect(isSoftwareRendererName('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(false);
    expect(isSoftwareRendererName('Apple M2')).toBe(false);
    expect(isSoftwareRendererName('WebKit WebGL')).toBe(false);
    expect(isSoftwareRendererName('')).toBe(false);
    expect(isSoftwareRendererName(null)).toBe(false);
    expect(isSoftwareRendererName(undefined)).toBe(false);
  });

  it('先读 WEBGL_debug_renderer_info 的 UNMASKED_RENDERER_WEBGL，没扩展退回 RENDERER；读不到 / 抛错 / 没上下文都当「不知道 = 不是软渲染」', () => {
    expect(readWebGLRendererInfo(fakeGl({ unmasked: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)' }))).toEqual({
      renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)',
      vendor: 'Google Inc.',
      software: true,
    });
    expect(readWebGLRendererInfo(fakeGl({ unmasked: 'ANGLE (AMD, AMD Radeon RX 590 Series Direct3D11 vs_5_0 ps_5_0, D3D11)', vendor: 'Google Inc. (AMD)' }))).toEqual({
      renderer: 'ANGLE (AMD, AMD Radeon RX 590 Series Direct3D11 vs_5_0 ps_5_0, D3D11)',
      vendor: 'Google Inc. (AMD)',
      software: false,
    });
    // 没扩展：Chrome 的 RENDERER 只回「WebKit WebGL」→ 不认为软渲染（读不出就不降级）
    expect(readWebGLRendererInfo(fakeGl({ masked: 'WebKit WebGL' }))).toEqual({ renderer: 'WebKit WebGL', vendor: 'WebKit', software: false });
    // 没扩展但 RENDERER 本身就说了 llvmpipe（Firefox 一类）
    expect(readWebGLRendererInfo(fakeGl({ masked: 'llvmpipe (LLVM 15.0.7, 256 bits)' })).software).toBe(true);
    // 扩展在但值为空 → 退回 RENDERER
    expect(readWebGLRendererInfo(fakeGl({ unmasked: null, masked: 'Mesa Intel(R) UHD Graphics' }))).toEqual({ renderer: 'Mesa Intel(R) UHD Graphics', vendor: 'Google Inc.', software: false });
    expect(readWebGLRendererInfo(fakeGl({ unmasked: 'x', throws: true }))).toEqual({ renderer: null, vendor: null, software: false });
    expect(readWebGLRendererInfo(null)).toEqual({ renderer: null, vendor: null, software: false });
    expect(readWebGLRendererInfo(undefined)).toEqual({ renderer: null, vendor: null, software: false });
  });
});
