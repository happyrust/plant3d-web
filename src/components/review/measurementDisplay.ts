export type MeasurementDisplayPoint = {
  entityId?: string | null;
};

export type MeasurementDisplayRecord = {
  kind?: string;
  origin?: MeasurementDisplayPoint | null;
  corner?: MeasurementDisplayPoint | null;
  target?: MeasurementDisplayPoint | null;
};

export function normalizeMeasurementEntityId(raw: unknown): string {
  let value = String(raw ?? '').trim();
  if (!value) return '';

  const wrapped = value.match(/^[⟨<]([^⟩>]+)[⟩>]$/)?.[1];
  if (wrapped) value = wrapped.trim();

  value = value.replace(/^pe:/i, '').replace(/^=/, '').trim();

  const dtxObjectId = value.match(/^o:([^:]+):\d+$/i);
  if (dtxObjectId?.[1]) {
    value = dtxObjectId[1].trim();
  }

  if (/^\d+[/,_]\d+$/.test(value)) {
    return value.replace(/[/,]/g, '_');
  }

  return value;
}

export function formatMeasurementEntityId(raw: unknown): string {
  const normalized = normalizeMeasurementEntityId(raw);
  if (!normalized) return '-';
  const refno = normalized.match(/^(\d+)_(\d+)$/);
  return refno ? `${refno[1]}/${refno[2]}` : normalized;
}

export function formatMeasurementPath(record: MeasurementDisplayRecord): string {
  const origin = formatMeasurementEntityId(record.origin?.entityId);
  const target = formatMeasurementEntityId(record.target?.entityId);
  if (record.kind === 'angle') {
    const corner = formatMeasurementEntityId(record.corner?.entityId);
    return `起点 ${origin} -> 拐点 ${corner} -> 终点 ${target}`;
  }
  return `起点 ${origin} -> 终点 ${target}`;
}
