import { layoutAngular } from './angular';
import { layoutExplicit } from './explicit';
import { layoutLinear } from './linear';
import { layoutProjected } from './projected';
import { layoutRadial } from './radial';

import type { LayoutContext } from './context';
import type {
  ExplicitLayoutInput,
  InteractionState,
  LayoutResult,
  NormalizedDimensionInput,
} from '../types';

type LayoutInput = NormalizedDimensionInput | ExplicitLayoutInput;
type FormatCache = Map<InteractionState, LayoutResult>;
type ThemeCache = WeakMap<LayoutContext['format'], FormatCache>;
type FontCache = WeakMap<LayoutContext['theme'], ThemeCache>;
type ProjectorCache = WeakMap<LayoutContext['font'], FontCache>;
type InputCache = WeakMap<LayoutContext['projector'], ProjectorCache>;

const cache = new WeakMap<LayoutInput, InputCache>();

function cachedLayout(input: LayoutInput, context: LayoutContext): LayoutResult | null {
  return cache
    .get(input)
    ?.get(context.projector)
    ?.get(context.font)
    ?.get(context.theme)
    ?.get(context.format)
    ?.get(context.interaction) ?? null;
}

function rememberLayout(
  input: LayoutInput,
  context: LayoutContext,
  result: LayoutResult,
): LayoutResult {
  let inputCache = cache.get(input);
  if (!inputCache) {
    inputCache = new WeakMap();
    cache.set(input, inputCache);
  }
  let projectorCache = inputCache.get(context.projector);
  if (!projectorCache) {
    projectorCache = new WeakMap();
    inputCache.set(context.projector, projectorCache);
  }
  let fontCache = projectorCache.get(context.font);
  if (!fontCache) {
    fontCache = new WeakMap();
    projectorCache.set(context.font, fontCache);
  }
  let themeCache = fontCache.get(context.theme);
  if (!themeCache) {
    themeCache = new WeakMap();
    fontCache.set(context.theme, themeCache);
  }
  let formatCache = themeCache.get(context.format);
  if (!formatCache) {
    formatCache = new Map();
    themeCache.set(context.format, formatCache);
  }
  formatCache.set(context.interaction, result);
  return result;
}

export function layoutDimension(
  input: LayoutInput,
  context: LayoutContext,
): LayoutResult {
  const cached = cachedLayout(input, context);
  if (cached) return cached;
  if ('lines' in input) return rememberLayout(input, context, layoutExplicit(input, context));
  const result = (() => {
    switch (input.kind) {
      case 'linear':
        return layoutLinear(input, context);
      case 'projected':
        return layoutProjected(input, context);
      case 'angular':
        return layoutAngular(input, context);
      case 'radial':
        return layoutRadial(input, context);
    }
  })();
  return rememberLayout(input, context, result);
}
