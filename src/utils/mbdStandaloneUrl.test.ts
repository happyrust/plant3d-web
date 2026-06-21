import { describe, expect, it } from 'vitest';

import {
  isMbdDrawingPresetUrl,
  isMbdStandaloneUrl,
  normalizeMbdRefnoFromUrl,
  resolveMbdStandaloneDisplayMode,
} from './mbdStandaloneUrl';

describe('mbdStandaloneUrl', () => {
  it('normalizes standalone MBD refno from mbd_refno or mbd_pipe', () => {
    expect(normalizeMbdRefnoFromUrl('?mbd_refno=2013286704_476')).toBe('2013286704_476');
    expect(normalizeMbdRefnoFromUrl('?mbd_pipe=2013286704/476')).toBe('2013286704/476');
    expect(isMbdStandaloneUrl('?output_project=demo')).toBe(false);
  });

  it('opens standalone MBD URLs in full interactive 3D mode by default', () => {
    expect(isMbdDrawingPresetUrl('?mbd_refno=2013286704_476')).toBe(false);
    expect(isMbdDrawingPresetUrl('?mbd_pipe=2013286704/476')).toBe(false);
    expect(resolveMbdStandaloneDisplayMode('?mbd_refno=2013286704_476')).toBe('full');
    expect(resolveMbdStandaloneDisplayMode('?mbd_pipe=2013286704/476')).toBe('full');
    expect(isMbdDrawingPresetUrl('?output_project=demo')).toBe(false);
  });

  it('supports explicit drawing presets and length-only presets', () => {
    expect(isMbdDrawingPresetUrl('?mbd_refno=2013286704_476&mbd_preset=drawing')).toBe(true);
    expect(isMbdDrawingPresetUrl('?mbd_refno=2013286704_476&mbd_preset=sheet')).toBe(true);
    expect(isMbdDrawingPresetUrl('?mbd_refno=2013286704_476&mbd_sheet=1')).toBe(true);
    expect(isMbdDrawingPresetUrl('?mbd_refno=2013286704_476&mbd_preset=length')).toBe(false);
    expect(isMbdDrawingPresetUrl('?mbd_refno=2013286704_476&mbd_mode=core')).toBe(false);
    expect(resolveMbdStandaloneDisplayMode('?mbd_refno=2013286704_476&mbd_preset=drawing')).toBe('drawing');
    expect(resolveMbdStandaloneDisplayMode('?mbd_refno=2013286704_476&mbd_preset=length')).toBe('length');
    expect(resolveMbdStandaloneDisplayMode('?output_project=demo&mbd_full=1')).toBe('full');
  });
});
