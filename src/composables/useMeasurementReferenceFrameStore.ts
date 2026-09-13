import { computed, ref, shallowRef } from 'vue';

import { getGlobalSelectedRefno } from './useSelectionStore';

import {
  ReferenceFrameResolver,
  createPdmsTransformReferenceFramePort,
  type ReferenceFrameError,
  type ReferenceFrameInput,
  type ReferenceFrameResult,
  type ResolvedReferenceFrame,
} from '@/measurement/reference-frame';
import { formatPdmsRef } from '@/utils/pdmsRefno';

export type MeasurementReferenceFrameMode =
  | 'world'
  | 'current-element'
  | 'owner'
  | 'explicit-refno';

export type MeasurementReferenceFrameResolver = Readonly<{
  resolve(
    input: ReferenceFrameInput,
  ): Promise<ReferenceFrameResult<ResolvedReferenceFrame>>;
}>;

const WORLD_VECTOR_ZERO = Object.freeze([0, 0, 0] as const);
const WORLD_BASIS = Object.freeze({
  u: Object.freeze([1, 0, 0] as const),
  v: Object.freeze([0, 1, 0] as const),
  w: Object.freeze([0, 0, 1] as const),
});

/** Immediately usable frame while the first asynchronous resolver call settles. */
export const DEFAULT_MEASUREMENT_WORLD_FRAME: ResolvedReferenceFrame = Object.freeze({
  kind: 'world',
  refno: null,
  origin: WORLD_VECTOR_ZERO,
  basis: WORLD_BASIS,
  axisLabels: Object.freeze(['X', 'Y', 'Z'] as const),
  provenance: Object.freeze({
    resolution: 'world',
    selector: Object.freeze({ kind: 'world' as const }),
    currentElementRefno: null,
    resolvedRefno: null,
    resolvedOwnerRefno: null,
    element: null,
    basis: Object.freeze({
      policy: 'orthonormalize' as const,
      action: 'identity' as const,
      rawNorms: Object.freeze([1, 1, 1] as const),
      maxOrthogonalityError: 0,
      rawHandedness: 1,
      tolerance: 1e-6,
    }),
  }),
});

function inputForMode(
  mode: MeasurementReferenceFrameMode,
  explicitRefno: string,
): ReferenceFrameInput {
  switch (mode) {
    case 'world':
      return 'World';
    case 'current-element':
      return 'CE';
    case 'owner':
      return 'Owner';
    case 'explicit-refno':
      return explicitRefno;
  }
}

function frameLabel(frame: ResolvedReferenceFrame): string {
  const refno = frame.refno ? formatPdmsRef(frame.refno) : '';
  switch (frame.provenance.resolution) {
    case 'world':
      return 'World';
    case 'current-element':
      return `CE ${refno}`;
    case 'owner':
      return `Owner ${refno}`;
    case 'explicit-refno':
      return `DBREF ${refno}`;
  }
}

export function createMeasurementReferenceFrameSession(
  resolver: MeasurementReferenceFrameResolver,
) {
  const mode = ref<MeasurementReferenceFrameMode>('world');
  const explicitRefno = ref('');
  const resolvedFrame = shallowRef<ResolvedReferenceFrame>(DEFAULT_MEASUREMENT_WORLD_FRAME);
  const resolutionError = shallowRef<ReferenceFrameError | null>(null);
  const isResolving = ref(false);
  const requestedInput = ref<ReferenceFrameInput>('World');
  let requestGeneration = 0;

  const resolvedLabel = computed(() => frameLabel(resolvedFrame.value));
  const axisLabels = computed(() => resolvedFrame.value.axisLabels);

  async function resolveCurrent(): Promise<boolean> {
    const input = inputForMode(mode.value, explicitRefno.value);
    const generation = ++requestGeneration;
    requestedInput.value = input;
    isResolving.value = true;

    let result: ReferenceFrameResult<ResolvedReferenceFrame>;
    try {
      result = await resolver.resolve(input);
    } catch (error) {
      result = {
        ok: false,
        error: {
          code: 'FRAME_DATA_UNAVAILABLE',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }

    if (generation !== requestGeneration) return false;
    isResolving.value = false;
    if (!result.ok) {
      resolutionError.value = result.error;
      return false;
    }
    resolvedFrame.value = result.value;
    resolutionError.value = null;
    return true;
  }

  async function setMode(next: MeasurementReferenceFrameMode): Promise<boolean> {
    mode.value = next;
    if (next === 'explicit-refno') {
      resolutionError.value = null;
      return true;
    }
    return resolveCurrent();
  }

  function setExplicitRefno(value: string): void {
    explicitRefno.value = value;
  }

  function reset(): void {
    requestGeneration += 1;
    mode.value = 'world';
    explicitRefno.value = '';
    resolvedFrame.value = DEFAULT_MEASUREMENT_WORLD_FRAME;
    resolutionError.value = null;
    isResolving.value = false;
    requestedInput.value = 'World';
  }

  return {
    mode,
    explicitRefno,
    resolvedFrame,
    resolutionError,
    isResolving,
    requestedInput,
    resolvedLabel,
    axisLabels,
    resolveCurrent,
    setMode,
    setExplicitRefno,
    reset,
  };
}

const productionResolver = new ReferenceFrameResolver(
  createPdmsTransformReferenceFramePort({
    currentElementRefno: getGlobalSelectedRefno,
  }),
);
const measurementReferenceFrameSession = createMeasurementReferenceFrameSession(
  productionResolver,
);

export function useMeasurementReferenceFrameStore() {
  return measurementReferenceFrameSession;
}
