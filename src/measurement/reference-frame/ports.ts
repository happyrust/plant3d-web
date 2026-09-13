import type { ReferenceFrameElementData } from './types';

export type MaybePromise<T> = T | Promise<T>;

export type ReferenceFrameElementLookup =
  | Readonly<{
    ok: true;
    element: ReferenceFrameElementData;
  }>
  | Readonly<{
    ok: false;
    reason: 'not-found' | 'unavailable' | 'invalid-data';
    message: string;
  }>;

/**
 * Minimal data seam needed by the pure reference-frame resolver.
 *
 * The port owns I/O and source-specific unit conversion. `elementByRefno`
 * receives canonical `dbnum_seqno` refnos and must return design-world metres.
 */
export type ReferenceFrameDataPort = Readonly<{
  currentElementRefno(): MaybePromise<string | null>;
  elementByRefno(refno: string): MaybePromise<ReferenceFrameElementLookup>;
}>;
