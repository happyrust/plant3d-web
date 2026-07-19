import type {
  LegacyDimensionArchive,
  LegacyDimensionBridgeArchive,
} from '../../migrations/legacyDimensionV5Archive';

const V5_ARCHIVE_KEY_PREFIX = 'plant3d-web-dimensions-v5-archive';
const V6_BRIDGE_ARCHIVE_KEY_PREFIX =
  'plant3d-web-dimensions-v6-bridge-archive';

export type ArchivedDimensionStorage = Pick<Storage, 'getItem'>;

export type ArchivedDimensionEnvelope =
  | LegacyDimensionArchive
  | LegacyDimensionBridgeArchive;

export function legacyDimensionV5ArchiveKey(scope: string): string {
  return `${V5_ARCHIVE_KEY_PREFIX}:${scope}`;
}

export function legacyDimensionBridgeArchiveKey(scope: string): string {
  return `${V6_BRIDGE_ARCHIVE_KEY_PREFIX}:${scope}`;
}

function parseObject(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
}

function parseV5Archive(
  raw: string | null,
  scope: string,
): LegacyDimensionArchive | null {
  const parsed = parseObject(raw);
  if (
    !parsed
    || parsed.version !== 1
    || (parsed.sourceVersion !== 4 && parsed.sourceVersion !== 5)
    || parsed.scope !== scope
    || typeof parsed.archivedAt !== 'number'
    || !Number.isFinite(parsed.archivedAt)
    || !Array.isArray(parsed.records)
  ) {
    return null;
  }
  return {
    version: 1,
    sourceVersion: parsed.sourceVersion,
    scope,
    archivedAt: parsed.archivedAt,
    records: parsed.records,
  };
}

function parseBridgeArchive(
  raw: string | null,
  scope: string,
): LegacyDimensionBridgeArchive | null {
  const parsed = parseObject(raw);
  if (
    !parsed
    || parsed.version !== 1
    || parsed.sourceVersion !== 'v6-bridge'
    || parsed.scope !== scope
    || typeof parsed.archivedAt !== 'number'
    || !Number.isFinite(parsed.archivedAt)
    || !Array.isArray(parsed.records)
  ) {
    return null;
  }
  return {
    version: 1,
    sourceVersion: 'v6-bridge',
    scope,
    archivedAt: parsed.archivedAt,
    records: parsed.records,
  };
}

export function loadArchivedDimensionArchives(
  storage: ArchivedDimensionStorage,
  scope: string,
): readonly ArchivedDimensionEnvelope[] {
  const v5 = parseV5Archive(
    storage.getItem(legacyDimensionV5ArchiveKey(scope)),
    scope,
  );
  const bridge = parseBridgeArchive(
    storage.getItem(legacyDimensionBridgeArchiveKey(scope)),
    scope,
  );
  return [v5, bridge].filter(
    (archive): archive is ArchivedDimensionEnvelope => archive !== null,
  );
}

export class ArchivedV5Source {
  constructor(private readonly storage: ArchivedDimensionStorage) {}

  load(scope: string): readonly ArchivedDimensionEnvelope[] {
    return loadArchivedDimensionArchives(this.storage, scope);
  }
}
