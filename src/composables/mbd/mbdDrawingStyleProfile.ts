import { reactive, ref, watch } from 'vue';

export type MbdDrawingStyleProfile = {
  dimension: {
    lineColor: number
    lineHoverColor: number
    lineSelectedColor: number
    lineOpacity: number
    arrowSizePx: number
    arrowAngleDeg: number
    lineWidthPx: number
    extensionLineWidthRatio: number
    extensionLineOpacity: number
  }
  leader: {
    lineColor: number
    lineOpacity: number
    tubeOpacity: number
    lineTubeRadiusRatio: number
    lineTubeRadiusMin: number
    lineTubeRadiusMax: number
    lineTubeRadiusFallback: number
    extensionTubeRadiusRatio: number
    extensionTubeRadiusMin: number
    extensionTubeRadiusMax: number
    extensionTubeRadiusFallback: number
  }
  modelEdges: {
    color: number
    opacity: number
    lineWidthPx: number
    thresholdAngleDeg: number
  }
  modelMaterials: {
    pipeColor: number
    pipeOpacity: number
    fittingColor: number
    fittingOpacity: number
    flangeColor: number
    flangeOpacity: number
    valveColor: number
    valveOpacity: number
    defaultColor: number
    defaultOpacity: number
    metalness: number
    roughness: number
  }
  pipeEmphasis: {
    ringsPerSegment: number
    bandsPerSegment: number
    railsPerSegment: number
    outlineRailsPerSegment: number
    bodyColor: number
    bodyOpacity: number
    ringColor: number
    ringOpacity: number
    ringTubeRadiusRatio: number
    ringTubeRadiusMin: number
    ringTubeRadiusMax: number
    ringTubeRadiusFallback: number
    bandColor: number
    bandOpacity: number
    bandThicknessRatio: number
    bandThicknessMin: number
    bandThicknessMax: number
    bandThicknessFallback: number
    railColor: number
    railOpacity: number
    railRadiusRatio: number
    railRadiusMin: number
    railRadiusMax: number
    railRadiusFallback: number
    outlineColor: number
    outlineOpacity: number
    outlineOffsetScale: number
    outlineRadiusRatio: number
    outlineRadiusMin: number
    outlineRadiusMax: number
    outlineRadiusFallback: number
    spineOpacity: number
  }
  fittingEmphasis: {
    coreRingsPerFitting: number
    minPortRingsPerFitting: number
    minArmsPerFitting: number
    coreColor: number
    coreOpacity: number
    coreRadiusScale: number
    coreTubeRadiusRatio: number
    coreTubeRadiusMin: number
    coreTubeRadiusMax: number
    coreTubeRadiusFallback: number
    portColor: number
    portOpacity: number
    portOffsetScale: number
    portRadiusScale: number
    portTubeRadiusRatio: number
    portTubeRadiusMin: number
    portTubeRadiusMax: number
    portTubeRadiusFallback: number
    armColor: number
    armOpacity: number
    armLengthScale: number
    armTubeRadiusRatio: number
    armTubeRadiusMin: number
    armTubeRadiusMax: number
    armTubeRadiusFallback: number
  }
}

export type MbdDrawingStylePreset = 'drawing' | 'dark' | 'light';

const STORAGE_KEY = 'plant3d-web-mbd-drawing-style-v1';

export const DEFAULT_MBD_DRAWING_STYLE_PROFILE: MbdDrawingStyleProfile = {
  dimension: {
    lineColor: 0x7f1d1d,
    lineHoverColor: 0x991b1b,
    lineSelectedColor: 0xdc2626,
    lineOpacity: 1,
    arrowSizePx: 34,
    arrowAngleDeg: 19,
    lineWidthPx: 5.4,
    extensionLineWidthRatio: 0.5,
    extensionLineOpacity: 0.58,
  },
  leader: {
    lineColor: 0x7f1d1d,
    lineOpacity: 0.96,
    tubeOpacity: 0.62,
    lineTubeRadiusRatio: 0.0046,
    lineTubeRadiusMin: 1.45,
    lineTubeRadiusMax: 3.25,
    lineTubeRadiusFallback: 1.9,
    extensionTubeRadiusRatio: 0.0094,
    extensionTubeRadiusMin: 1.55,
    extensionTubeRadiusMax: 3.35,
    extensionTubeRadiusFallback: 2.1,
  },
  modelEdges: {
    color: 0x06245f,
    opacity: 1,
    lineWidthPx: 3.65,
    thresholdAngleDeg: 24,
  },
  modelMaterials: {
    pipeColor: 0x18c9f2,
    pipeOpacity: 1,
    fittingColor: 0x12b7e9,
    fittingOpacity: 1,
    flangeColor: 0x0988df,
    flangeOpacity: 1,
    valveColor: 0x0876d5,
    valveOpacity: 1,
    defaultColor: 0x0a94e4,
    defaultOpacity: 1,
    metalness: 0.02,
    roughness: 0.34,
  },
  pipeEmphasis: {
    ringsPerSegment: 2,
    bandsPerSegment: 2,
    railsPerSegment: 4,
    outlineRailsPerSegment: 4,
    bodyColor: 0x18c9f2,
    bodyOpacity: 1,
    ringColor: 0x00216f,
    ringOpacity: 0.92,
    ringTubeRadiusRatio: 0.052,
    ringTubeRadiusMin: 1.85,
    ringTubeRadiusMax: 5.0,
    ringTubeRadiusFallback: 2.75,
    bandColor: 0x0758bd,
    bandOpacity: 0.42,
    bandThicknessRatio: 0.06,
    bandThicknessMin: 1.75,
    bandThicknessMax: 5.0,
    bandThicknessFallback: 2.65,
    railColor: 0x003996,
    railOpacity: 0.84,
    railRadiusRatio: 0.07,
    railRadiusMin: 2.65,
    railRadiusMax: 6.7,
    railRadiusFallback: 3.6,
    outlineColor: 0x003c9f,
    outlineOpacity: 0.82,
    outlineOffsetScale: 1.16,
    outlineRadiusRatio: 0.086,
    outlineRadiusMin: 3.0,
    outlineRadiusMax: 7.9,
    outlineRadiusFallback: 4.1,
    spineOpacity: 0.05,
  },
  fittingEmphasis: {
    coreRingsPerFitting: 2,
    minPortRingsPerFitting: 2,
    minArmsPerFitting: 2,
    coreColor: 0x0042a7,
    coreOpacity: 0.86,
    coreRadiusScale: 1.22,
    coreTubeRadiusRatio: 0.062,
    coreTubeRadiusMin: 2.05,
    coreTubeRadiusMax: 5.5,
    coreTubeRadiusFallback: 3.0,
    portColor: 0x00318a,
    portOpacity: 0.9,
    portOffsetScale: 1.14,
    portRadiusScale: 1.04,
    portTubeRadiusRatio: 0.056,
    portTubeRadiusMin: 1.95,
    portTubeRadiusMax: 5.2,
    portTubeRadiusFallback: 2.75,
    armColor: 0x0042a7,
    armOpacity: 0.78,
    armLengthScale: 3.8,
    armTubeRadiusRatio: 0.058,
    armTubeRadiusMin: 1.95,
    armTubeRadiusMax: 5.4,
    armTubeRadiusFallback: 2.8,
  },
};

const PRESETS: Record<MbdDrawingStylePreset, MbdDrawingStyleProfile> = {
  drawing: DEFAULT_MBD_DRAWING_STYLE_PROFILE,
  dark: {
    ...cloneProfile(DEFAULT_MBD_DRAWING_STYLE_PROFILE),
    dimension: {
      ...DEFAULT_MBD_DRAWING_STYLE_PROFILE.dimension,
      lineColor: 0xe11d48,
      lineHoverColor: 0xfb7185,
      lineSelectedColor: 0xbe123c,
    },
    leader: {
      ...DEFAULT_MBD_DRAWING_STYLE_PROFILE.leader,
      lineColor: 0xe11d48,
    },
    modelEdges: {
      ...DEFAULT_MBD_DRAWING_STYLE_PROFILE.modelEdges,
      color: 0x0f172a,
      lineWidthPx: 4.2,
    },
    pipeEmphasis: {
      ...DEFAULT_MBD_DRAWING_STYLE_PROFILE.pipeEmphasis,
      bodyColor: 0x11b7dd,
      ringColor: 0x001342,
      railColor: 0x001e64,
      outlineColor: 0x002a7a,
    },
  },
  light: {
    ...cloneProfile(DEFAULT_MBD_DRAWING_STYLE_PROFILE),
    dimension: {
      ...DEFAULT_MBD_DRAWING_STYLE_PROFILE.dimension,
      lineColor: 0xb91c1c,
      lineHoverColor: 0xef4444,
      lineSelectedColor: 0x991b1b,
      lineWidthPx: 4.4,
      arrowSizePx: 28,
      extensionLineOpacity: 0.46,
    },
    leader: {
      ...DEFAULT_MBD_DRAWING_STYLE_PROFILE.leader,
      lineColor: 0xb91c1c,
      lineOpacity: 0.9,
      tubeOpacity: 0.48,
    },
    modelEdges: {
      ...DEFAULT_MBD_DRAWING_STYLE_PROFILE.modelEdges,
      opacity: 0.78,
      lineWidthPx: 2.6,
    },
    pipeEmphasis: {
      ...DEFAULT_MBD_DRAWING_STYLE_PROFILE.pipeEmphasis,
      ringOpacity: 0.72,
      railOpacity: 0.64,
      outlineOpacity: 0.58,
      bandOpacity: 0.3,
    },
  },
};

function cloneProfile(profile: MbdDrawingStyleProfile): MbdDrawingStyleProfile {
  return JSON.parse(JSON.stringify(profile)) as MbdDrawingStyleProfile;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sanitizeColor(value: unknown, fallback: number): number {
  const n = typeof value === 'string' && value.startsWith('#')
    ? Number.parseInt(value.slice(1), 16)
    : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(0xffffff, Math.floor(n)));
}

function normalizeProfile(raw: Partial<MbdDrawingStyleProfile> | null | undefined): MbdDrawingStyleProfile {
  const next = cloneProfile(DEFAULT_MBD_DRAWING_STYLE_PROFILE);
  if (!raw || typeof raw !== 'object') return next;

  for (const section of Object.keys(next) as (keyof MbdDrawingStyleProfile)[]) {
    const source = raw[section] as Record<string, unknown> | undefined;
    const target = next[section] as Record<string, number>;
    if (!source || typeof source !== 'object') continue;
    for (const key of Object.keys(target)) {
      const fallback = target[key] ?? 0;
      if (key.toLowerCase().includes('color')) {
        target[key] = sanitizeColor(source[key], fallback);
      } else if (key.toLowerCase().includes('opacity')) {
        target[key] = clampNumber(source[key], 0, 1, fallback);
      } else if (key.toLowerCase().includes('ratio')) {
        target[key] = clampNumber(source[key], 0, 1, fallback);
      } else if (key.toLowerCase().includes('angle')) {
        target[key] = clampNumber(source[key], 1, 89, fallback);
      } else if (key.toLowerCase().includes('width')) {
        target[key] = clampNumber(source[key], 0.1, 20, fallback);
      } else if (key.toLowerCase().includes('radius')) {
        target[key] = clampNumber(source[key], 0, 100, fallback);
      } else {
        target[key] = clampNumber(source[key], 0, 1000, fallback);
      }
    }
  }

  return next;
}

function loadPersisted(): MbdDrawingStyleProfile {
  if (typeof localStorage === 'undefined') {
    return cloneProfile(DEFAULT_MBD_DRAWING_STYLE_PROFILE);
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneProfile(DEFAULT_MBD_DRAWING_STYLE_PROFILE);
    return normalizeProfile(JSON.parse(raw) as Partial<MbdDrawingStyleProfile>);
  } catch {
    return cloneProfile(DEFAULT_MBD_DRAWING_STYLE_PROFILE);
  }
}

function persistProfile(profile: MbdDrawingStyleProfile): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // ignore storage failures
  }
}

export const MBD_DRAWING_STYLE_PROFILE = reactive<MbdDrawingStyleProfile>(loadPersisted());
const version = ref(0);

watch(
  MBD_DRAWING_STYLE_PROFILE,
  (profile) => {
    persistProfile(profile);
    version.value += 1;
  },
  { deep: true },
);

export function useMbdDrawingStyleStore() {
  function resetToDefaults(): void {
    Object.assign(MBD_DRAWING_STYLE_PROFILE.dimension, DEFAULT_MBD_DRAWING_STYLE_PROFILE.dimension);
    Object.assign(MBD_DRAWING_STYLE_PROFILE.leader, DEFAULT_MBD_DRAWING_STYLE_PROFILE.leader);
    Object.assign(MBD_DRAWING_STYLE_PROFILE.modelEdges, DEFAULT_MBD_DRAWING_STYLE_PROFILE.modelEdges);
    Object.assign(MBD_DRAWING_STYLE_PROFILE.modelMaterials, DEFAULT_MBD_DRAWING_STYLE_PROFILE.modelMaterials);
    Object.assign(MBD_DRAWING_STYLE_PROFILE.pipeEmphasis, DEFAULT_MBD_DRAWING_STYLE_PROFILE.pipeEmphasis);
    Object.assign(MBD_DRAWING_STYLE_PROFILE.fittingEmphasis, DEFAULT_MBD_DRAWING_STYLE_PROFILE.fittingEmphasis);
  }

  function applyPreset(preset: MbdDrawingStylePreset): void {
    const next = PRESETS[preset] ?? DEFAULT_MBD_DRAWING_STYLE_PROFILE;
    Object.assign(MBD_DRAWING_STYLE_PROFILE.dimension, next.dimension);
    Object.assign(MBD_DRAWING_STYLE_PROFILE.leader, next.leader);
    Object.assign(MBD_DRAWING_STYLE_PROFILE.modelEdges, next.modelEdges);
    Object.assign(MBD_DRAWING_STYLE_PROFILE.modelMaterials, next.modelMaterials);
    Object.assign(MBD_DRAWING_STYLE_PROFILE.pipeEmphasis, next.pipeEmphasis);
    Object.assign(MBD_DRAWING_STYLE_PROFILE.fittingEmphasis, next.fittingEmphasis);
  }

  function updateSection<K extends keyof MbdDrawingStyleProfile>(
    section: K,
    partial: Partial<MbdDrawingStyleProfile[K]>,
  ): void {
    Object.assign(MBD_DRAWING_STYLE_PROFILE[section], partial);
  }

  return {
    profile: MBD_DRAWING_STYLE_PROFILE,
    version,
    resetToDefaults,
    applyPreset,
    updateSection,
  };
}
