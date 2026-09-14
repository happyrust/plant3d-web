import { computed, shallowRef } from 'vue';

import {
  aidLineFromDirection,
  aidPlaneFromThreePoints,
  createAidLine,
  createAidPlane,
  nextAidNumber,
  type AidGeometryResult,
  type AidLineFromDirectionInput,
  type AidLineInput,
  type AidPlaneFromThreePointsInput,
  type AidPlaneInput,
  type MeasurementAid,
  type MeasurementAidLine,
  type MeasurementAidPlane,
} from '@/measurement/aids/designAid';

/**
 * Session store of the Web's design aids (E3D `!!aidNumbers` + `GPHLINE` / `GPHPLANE`
 * for the measurement commands; plan 2026-09-12 §7 Q3). Aids are **session-only**, like
 * E3D's graphical aids (no persistence): they are drawn in the viewer, picked under the
 * `Aid` filter and serve as Perpendicular-to / Intersect LINE / PLANE targets.
 *
 * All geometry is design World metres (see `designAid.ts`).
 */
type AidCreationInput<T> = Omit<T, 'id' | 'number'> & Readonly<{ id?: string; number?: number }>;

export type AidLineCreationInput = AidCreationInput<AidLineInput>;
export type AidLineFromDirectionCreationInput = AidCreationInput<AidLineFromDirectionInput>;
export type AidPlaneCreationInput = AidCreationInput<AidPlaneInput>;
export type AidPlaneFromThreePointsCreationInput = AidCreationInput<AidPlaneFromThreePointsInput>;

function newAidId(kind: MeasurementAid['kind']): string {
  return `aid-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createMeasurementAidSession() {
  const aids = shallowRef<readonly MeasurementAid[]>([]);
  /** Bumps on every change; the viewer redraws the aid graphics from it. */
  const revision = shallowRef(0);

  const visibleAids = computed(() => aids.value.filter((aid) => aid.visible));
  const lines = computed(() => aids.value.filter((aid): aid is MeasurementAidLine => aid.kind === 'line'));
  const planes = computed(() => aids.value.filter((aid): aid is MeasurementAidPlane => aid.kind === 'plane'));

  function commit(next: readonly MeasurementAid[]): void {
    aids.value = next;
    revision.value += 1;
  }

  function identity<T extends { id?: string; number?: number }>(input: T, kind: MeasurementAid['kind']): T & { id: string; number: number } {
    return {
      ...input,
      id: input.id ?? newAidId(kind),
      number: input.number ?? nextAidNumber(aids.value),
    };
  }

  function insert<T extends MeasurementAid>(result: AidGeometryResult<T>): AidGeometryResult<T> {
    if (!result.ok) return result;
    commit([...aids.value.filter((aid) => aid.id !== result.value.id), result.value]);
    return result;
  }

  /** `GPHLINE(LINE)` from two points. */
  function addLine(input: AidLineCreationInput): AidGeometryResult<MeasurementAidLine> {
    return insert(createAidLine(identity(input, 'line')));
  }

  /** E3D line edit form: pinned position + direction + length. */
  function addLineFromDirection(input: AidLineFromDirectionCreationInput): AidGeometryResult<MeasurementAidLine> {
    return insert(aidLineFromDirection(identity(input, 'line')));
  }

  /** `GPHPLANE(PLANE)`: position + normal (+ Y hint, size). */
  function addPlane(input: AidPlaneCreationInput): AidGeometryResult<MeasurementAidPlane> {
    return insert(createAidPlane(identity(input, 'plane')));
  }

  /** E3D plane edit form "Through three points". */
  function addPlaneFromThreePoints(input: AidPlaneFromThreePointsCreationInput): AidGeometryResult<MeasurementAidPlane> {
    return insert(aidPlaneFromThreePoints(identity(input, 'plane')));
  }

  function remove(id: string): boolean {
    const next = aids.value.filter((aid) => aid.id !== id);
    if (next.length === aids.value.length) return false;
    commit(next);
    return true;
  }

  function setVisible(id: string, visible: boolean): void {
    let changed = false;
    const next = aids.value.map((aid) => {
      if (aid.id !== id || aid.visible === visible) return aid;
      changed = true;
      return { ...aid, visible } as MeasurementAid;
    });
    if (changed) commit(next);
  }

  function setDescription(id: string, description: string): void {
    const trimmed = description.trim();
    let changed = false;
    const next = aids.value.map((aid) => {
      if (aid.id !== id || aid.description === trimmed) return aid;
      changed = true;
      return { ...aid, description: trimmed } as MeasurementAid;
    });
    if (changed) commit(next);
  }

  function byId(id: string): MeasurementAid | null {
    return aids.value.find((aid) => aid.id === id) ?? null;
  }

  /** `AID CLEAR ALL` for the whole session. */
  function clear(): void {
    if (aids.value.length === 0) return;
    commit([]);
  }

  function reset(): void {
    aids.value = [];
    revision.value = 0;
  }

  return {
    aids,
    revision,
    visibleAids,
    lines,
    planes,
    addLine,
    addLineFromDirection,
    addPlane,
    addPlaneFromThreePoints,
    remove,
    setVisible,
    setDescription,
    byId,
    clear,
    reset,
  };
}

export type MeasurementAidSession = ReturnType<typeof createMeasurementAidSession>;

const measurementAidSession = createMeasurementAidSession();

export function useMeasurementAidStore(): MeasurementAidSession {
  return measurementAidSession;
}
