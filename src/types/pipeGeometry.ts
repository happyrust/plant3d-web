import type { Vec3 } from '@/types/vec3';

export type PipeSegmentDto = {
  id: string;
  refno: string;
  noun: string;
  name?: string | null;
  arrive?: Vec3 | null;
  leave?: Vec3 | null;
  length: number;
  straight_length: number;
  outside_diameter?: number | null;
  bore?: number | null;
};

export type PipeClearanceLayoutHint = {
  pipe1_start?: Vec3 | null;
  pipe1_end?: Vec3 | null;
  pipe2_start?: Vec3 | null;
  pipe2_end?: Vec3 | null;
  [k: string]: unknown;
};

export type PipeClearanceDto = {
  id: string;
  pipe1_refno: string;
  pipe2_refno: string;
  start: Vec3;
  end: Vec3;
  distance: number;
  text: string;
  layout_hint?: PipeClearanceLayoutHint | null;
};
