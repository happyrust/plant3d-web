export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export type LegacyDimensionArchive = Readonly<{
  version: 1;
  sourceVersion: 4 | 5;
  scope: string;
  archivedAt: number;
  records: readonly unknown[];
}>;

export type LegacyDimensionBridgeArchive = Readonly<{
  version: 1;
  sourceVersion: 'v6-bridge';
  scope: string;
  archivedAt: number;
  records: readonly unknown[];
}>;

export type ArchiveLegacyDimensionsOptions = Readonly<{
  sourceKey: string;
  archiveKey: string;
  scope: string;
  now: () => number;
}>;

export function parseLegacyDimensionArchive(
  raw: string,
  input: Readonly<{ scope: string; archivedAt: number }>,
): LegacyDimensionArchive | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const candidate = parsed as Record<string, unknown>;
  if (candidate.version !== 4 && candidate.version !== 5) {
    return null;
  }
  if (candidate.dimensions !== undefined && !Array.isArray(candidate.dimensions)) {
    return null;
  }

  return {
    version: 1,
    sourceVersion: candidate.version,
    scope: input.scope,
    archivedAt: input.archivedAt,
    records: candidate.dimensions ?? [],
  };
}

export function archiveLegacyDimensions(
  storage: StorageLike,
  options: ArchiveLegacyDimensionsOptions,
): 'created' | 'exists' | 'empty' | 'invalid' {
  if (storage.getItem(options.archiveKey) !== null) return 'exists';

  const raw = storage.getItem(options.sourceKey);
  if (!raw) return 'empty';

  const archive = parseLegacyDimensionArchive(raw, {
    scope: options.scope,
    archivedAt: options.now(),
  });
  if (!archive) return 'invalid';
  if (archive.records.length === 0) return 'empty';

  storage.setItem(options.archiveKey, JSON.stringify(archive));
  return 'created';
}

export function parseLegacyDimensionBridgeArchive(
  raw: string,
  input: Readonly<{ scope: string; archivedAt: number }>,
): LegacyDimensionBridgeArchive | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const candidate = parsed as Record<string, unknown>;
  if (candidate.version !== 6) return null;
  if (candidate.dimensions !== undefined && !Array.isArray(candidate.dimensions)) {
    return null;
  }

  return {
    version: 1,
    sourceVersion: 'v6-bridge',
    scope: input.scope,
    archivedAt: input.archivedAt,
    records: candidate.dimensions ?? [],
  };
}

export function archiveLegacyDimensionBridge(
  storage: StorageLike,
  options: ArchiveLegacyDimensionsOptions,
): 'created' | 'exists' | 'empty' | 'invalid' {
  if (storage.getItem(options.archiveKey) !== null) return 'exists';

  const raw = storage.getItem(options.sourceKey);
  if (!raw) return 'empty';

  const archive = parseLegacyDimensionBridgeArchive(raw, {
    scope: options.scope,
    archivedAt: options.now(),
  });
  if (!archive) return 'invalid';
  if (archive.records.length === 0) return 'empty';

  storage.setItem(options.archiveKey, JSON.stringify(archive));
  return 'created';
}
