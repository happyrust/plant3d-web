export type ViewerToolbarSelectionInput = {
  selectedRefno?: string | null;
  sceneSelectedObjectIds?: readonly string[] | null;
};

export type ViewerToolbarSelection = {
  primaryRefno: string | null;
  sceneSelectedRefnos: string[];
};

function normalizeId(value: string | null | undefined): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

export function resolveViewerToolbarSelection(
  input: ViewerToolbarSelectionInput,
): ViewerToolbarSelection {
  const sceneSelectedRefnos: string[] = [];
  const seen = new Set<string>();

  for (const raw of input.sceneSelectedObjectIds ?? []) {
    const normalized = normalizeId(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    sceneSelectedRefnos.push(normalized);
  }

  const primaryRefno = normalizeId(input.selectedRefno);

  return {
    primaryRefno:
      primaryRefno ?? (sceneSelectedRefnos.length === 1 ? sceneSelectedRefnos[0] ?? null : null),
    sceneSelectedRefnos,
  };
}
