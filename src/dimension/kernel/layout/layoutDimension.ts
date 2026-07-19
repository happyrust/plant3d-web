import { layoutAngular } from './angular';
import { layoutExplicit } from './explicit';
import { layoutLinear } from './linear';
import { layoutProjected } from './projected';
import { layoutRadial } from './radial';

import type { LayoutContext } from './context';
import type {
  ExplicitLayoutInput,
  LayoutResult,
  NormalizedDimensionInput,
} from '../types';

export function layoutDimension(
  input: NormalizedDimensionInput | ExplicitLayoutInput,
  context: LayoutContext,
): LayoutResult {
  if ('lines' in input) return layoutExplicit(input, context);
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
}
