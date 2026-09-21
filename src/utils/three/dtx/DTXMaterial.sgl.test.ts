import { describe, expect, it } from 'vitest';

import { DTXMaterial } from './DTXMaterial';

import { isSglNormalDepthProvider } from '@/viewer/e3dLook/sglLookPipeline';

function makeMaterial(transparent = false): DTXMaterial {
  return new DTXMaterial({
    positionsTexture: null,
    indicesTexture: null,
    normalsTexture: null,
    matricesTexture: null,
    colorsAndFlagsTexture: null,
    primitiveToObjectTexture: null,
    transparent,
  });
}

describe('DTXMaterial —— SGL 法线/深度输出的「参与边线」标记', () => {
  it('是 SglNormalDepthProvider，program key 随着色器结构升级到 v16', () => {
    const m = makeMaterial();
    expect(isSglNormalDepthProvider(m)).toBe(true);
    expect(m.customProgramCacheKey()).toBe('DTXMaterial_v16');
  });

  it('默认边线 + 伪阴影都参与（sglEffectFlag = 1）；两位标记编码进法线长度；片元着色器里法线乘该标记', () => {
    const m = makeMaterial();
    expect(m.uniforms.sglEffectFlag!.value).toBe(1);
    expect(m.sglEffectFlags).toEqual({ edges: true, shadows: true });
    m.setSglEffectParticipation({ edges: false, shadows: true });
    expect(m.uniforms.sglEffectFlag!.value).toBe(0.75);
    expect(m.sglEffectFlags).toEqual({ edges: false, shadows: true });
    m.setSglEffectParticipation({ edges: true, shadows: false });
    expect(m.uniforms.sglEffectFlag!.value).toBe(0.5);
    expect(m.sglEffectFlags).toEqual({ edges: true, shadows: false });
    m.setSglEffectParticipation({ edges: false, shadows: false });
    expect(m.uniforms.sglEffectFlag!.value).toBe(0.25);
    expect(m.sglEffectFlags).toEqual({ edges: false, shadows: false });
    m.setSglEffectParticipation({ edges: true, shadows: true });
    expect(m.uniforms.sglEffectFlag!.value).toBe(1);
    expect(m.fragmentShader).toContain('fragColor = vec4(faceN * sglEffectFlag, -vViewPosition.z);');
  });

  it('sglIsTranslucentPass 在法线/深度输出期间（transparent 被临时关掉）仍给出材质本来的半透明属性', () => {
    const opaque = makeMaterial(false);
    const translucent = makeMaterial(true);
    expect(opaque.sglIsTranslucentPass).toBe(false);
    expect(translucent.sglIsTranslucentPass).toBe(true);
    translucent.setSglNormalDepthOutput(true);
    expect(translucent.transparent).toBe(false);
    expect(translucent.sglIsTranslucentPass).toBe(true);
    translucent.setSglNormalDepthOutput(false);
    expect(translucent.transparent).toBe(true);
    expect(translucent.sglIsTranslucentPass).toBe(true);
  });
});
