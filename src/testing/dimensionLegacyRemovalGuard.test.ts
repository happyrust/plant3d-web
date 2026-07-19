import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

const forbidden = [
  'Linear' + 'Dimension3D',
  'Angle' + 'Dimension3D',
  'Dimension' + 'AnnotationManager',
  'use' + 'DimensionAnnotation',
  'dimension_' + 'linear',
  'dimension_' + 'angle',
];

function productionTsFiles(dir = join(process.cwd(), 'src')): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'fixtures') return [];
      return productionTsFiles(path);
    }
    return ['.ts', '.tsx', '.vue'].includes(extname(entry.name)) ? [path] : [];
  });
}

describe('legacy dimension removal guard', () => {
  it('keeps forbidden runtime symbols out of production source', () => {
    const offenders = productionTsFiles()
      .filter((path) => !path.endsWith('dimensionLegacyRemovalGuard.test.ts'))
      .filter((path) => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(path))
      .flatMap((path) => {
        const source = readFileSync(path, 'utf8');
        return forbidden
          .filter((token) => source.includes(token))
          .map((token) => `${path}:${token}`);
      });

    expect(offenders).toEqual([]);
  });
});
