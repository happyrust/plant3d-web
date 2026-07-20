import { LffFont } from '../kernel/glyph/lffParser';

export async function loadDimensionFont(
  url = '/fonts/unicode.lff.bin',
): Promise<LffFont> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error(
      'Dimension font loading requires browser gzip DecompressionStream support',
    );
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load dimension font: ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const stream = new Blob([bytes]).stream().pipeThrough(
    new DecompressionStream('gzip'),
  );
  return LffFont.fromText(await new Response(stream).text());
}
