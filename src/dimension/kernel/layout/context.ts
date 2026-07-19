import type { DimensionFormatPolicy } from '../format';
import type { LffFont } from '../glyph/lffParser';
import type { ViewportProjector } from '../projector';
import type { DimensionTheme } from '../theme';
import type { InteractionState } from '../types';

export type LayoutContext = Readonly<{
  projector: ViewportProjector;
  font: LffFont;
  theme: DimensionTheme;
  format: DimensionFormatPolicy;
  interaction: InteractionState;
}>;
