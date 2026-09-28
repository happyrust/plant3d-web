import { onBeforeUnmount, ref, watch, type Ref } from 'vue';

import {
  formatMeasurementEntityId,
  formatMeasurementPath,
  type MeasurementDisplayRecord,
} from './measurementDisplay';
import { resolveMeasurementEntityPath } from './measurementPathLookup';

export type MeasurementPathPointKey = 'origin' | 'corner' | 'target';

export type MeasurementPathDisplayPoint = {
  key: MeasurementPathPointKey;
  rawEntityId: string;
  fallbackLabel: string;
};

export type MeasurementPathDisplayRecord = MeasurementDisplayRecord & {
  id: string;
  pathDisplayId?: string;
};

type MeasurementPathLabelResolver = (point: MeasurementPathDisplayPoint) => string | undefined;

function getRecordLookupId(record: MeasurementPathDisplayRecord): string {
  return record.pathDisplayId || record.id;
}

function toDisplayPoint(
  key: MeasurementPathPointKey,
  rawEntityId: unknown,
): MeasurementPathDisplayPoint {
  return {
    key,
    rawEntityId: String(rawEntityId ?? '').trim(),
    fallbackLabel: formatMeasurementEntityId(rawEntityId),
  };
}

export function getMeasurementPathDisplayPoints(
  record: MeasurementPathDisplayRecord,
): MeasurementPathDisplayPoint[] {
  const points = [
    toDisplayPoint('origin', record.origin?.entityId),
  ];

  if (record.kind === 'angle') {
    points.push(toDisplayPoint('corner', record.corner?.entityId));
  }

  points.push(toDisplayPoint('target', record.target?.entityId));
  return points;
}

export function formatMeasurementPathWithResolvedLabels(
  record: MeasurementPathDisplayRecord,
  resolveLabel: MeasurementPathLabelResolver,
): string {
  const [origin, maybeCorner, target] = getMeasurementPathDisplayPoints(record);
  const originLabel = resolveLabel(origin) || origin.fallbackLabel;
  const targetPoint = record.kind === 'angle' ? target : maybeCorner;
  const targetLabel = resolveLabel(targetPoint) || targetPoint.fallbackLabel;

  if (record.kind === 'angle') {
    const corner = maybeCorner;
    const cornerLabel = resolveLabel(corner) || corner.fallbackLabel;
    return `起点 ${originLabel} -> 拐点 ${cornerLabel} -> 终点 ${targetLabel}`;
  }

  return `起点 ${originLabel} -> 终点 ${targetLabel}`;
}

function createLookupKey(record: MeasurementPathDisplayRecord, point: MeasurementPathDisplayPoint): string {
  return `${getRecordLookupId(record)}:${point.key}:${point.rawEntityId}`;
}

export function useMeasurementPathSummaries(records: Readonly<Ref<MeasurementPathDisplayRecord[]>>) {
  const labelsByKey = ref<Record<string, string>>({});
  const pendingKeys = new Set<string>();
  let activeKeys = new Set<string>();
  let disposed = false;

  function pruneInactiveLabels() {
    const current = labelsByKey.value;
    const next: Record<string, string> = {};
    let changed = false;

    for (const [key, value] of Object.entries(current)) {
      if (activeKeys.has(key)) {
        next[key] = value;
      } else {
        changed = true;
      }
    }

    if (changed) {
      labelsByKey.value = next;
    }
  }

  function queueLookup(record: MeasurementPathDisplayRecord, point: MeasurementPathDisplayPoint) {
    if (!point.rawEntityId) return;

    const key = createLookupKey(record, point);
    if (labelsByKey.value[key] || pendingKeys.has(key)) return;

    pendingKeys.add(key);
    void resolveMeasurementEntityPath(point.rawEntityId)
      .then((result) => {
        if (disposed || !activeKeys.has(key)) return;
        labelsByKey.value = {
          ...labelsByKey.value,
          [key]: result.status === 'resolved' ? result.displayPath : result.fallbackLabel,
        };
      })
      .finally(() => {
        pendingKeys.delete(key);
      });
  }

  watch(
    records,
    (items) => {
      const nextActiveKeys = new Set<string>();

      for (const record of items) {
        for (const point of getMeasurementPathDisplayPoints(record)) {
          if (!point.rawEntityId) continue;
          const key = createLookupKey(record, point);
          nextActiveKeys.add(key);
          queueLookup(record, point);
        }
      }

      activeKeys = nextActiveKeys;
      pruneInactiveLabels();
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    disposed = true;
    pendingKeys.clear();
  });

  function getMeasurementSummary(record: MeasurementPathDisplayRecord): string {
    if (Object.keys(labelsByKey.value).length === 0) {
      return formatMeasurementPath(record);
    }

    return formatMeasurementPathWithResolvedLabels(record, (point) => {
      const key = createLookupKey(record, point);
      return labelsByKey.value[key];
    });
  }

  return {
    getMeasurementSummary,
  };
}
