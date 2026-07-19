# Dimension Document and Review Persistence Implementation Plan

> **Status:** Foundation Tasks 1–4 implemented and verified on 2026-07-19. Review/frontend integration Tasks 5–8 remain.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement editable user-dimension documents with intent commands, permissions, undo/redo, V5 migration, crash recovery, review-record persistence, and atomic optimistic concurrency.

**Architecture:** A pure reducer owns document transitions. A session facade owns preview-independent command history and a local command journal. Review adapters serialize one versioned `DimensionDocumentSnapshot` inside confirmed records; the Rust API conditionally updates `review_records` by `dimension_document_version`.

**Tech Stack:** TypeScript, Vue-independent domain code, Vitest, browser localStorage journal, existing review snapshot pipeline, Rust/Axum, SurrealDB.

## Global Constraints

- Plan 01 Gate 1 must be complete. Read V5 data only from `plant3d-web-dimensions-v5-archive:<scope>`.
- Domain and services live under `src/dimension/`; they do not import Vue, Three, or Canvas.
- User records contain no display unit, formatted text, reference toggle, pixel offset, or derived numeric value.
- Only author or admin may mutate an existing user dimension.
- One completed edit session produces one command and one undo entry.
- External dimensions never enter `DimensionDocumentState`.
- Backend save occurs with the existing review save/confirm transaction.
- A stale `baseVersion` returns HTTP 409 and the latest document; no last-write-wins.
- Changes to `plant-model-gen` are a coordinated external-repository task and must be verified there before frontend cutover.

---

## File Structure

```text
src/dimension/
├── domain/
│   ├── types.ts
│   ├── document.ts
│   ├── commands.ts
│   ├── reducer.ts
│   ├── reducer.test.ts
│   ├── testFixtures.ts
│   ├── permissions.ts
│   ├── permissions.test.ts
│   ├── anchors.ts
│   ├── migrationV5.ts
│   └── migrationV5.test.ts
├── ports/
│   ├── repository.ts
│   ├── anchorResolver.ts
│   └── externalSource.ts
├── services/
│   ├── dimensionDocumentSession.ts
│   ├── dimensionDocumentSession.test.ts
│   ├── commandJournal.ts
│   ├── commandJournal.test.ts
│   ├── replayPendingCommands.ts
│   ├── replayPendingCommands.test.ts
│   ├── reviewDimensionRepository.ts
│   └── reviewDimensionRepository.test.ts
├── adapters/
│   ├── reviewSnapshotAdapter.ts
│   ├── reviewSnapshotAdapter.test.ts
│   └── archivedV5Source.ts
└── index.ts
```

Existing frontend files and external Rust files are modified in Tasks 5–7.

---

### Task 1: Define the Domain Records, Commands, and Pure Reducer

**Files:**
- Create: `src/dimension/domain/types.ts`
- Create: `src/dimension/domain/document.ts`
- Create: `src/dimension/domain/commands.ts`
- Create: `src/dimension/domain/reducer.ts`
- Create: `src/dimension/domain/reducer.test.ts`
- Create: `src/dimension/domain/testFixtures.ts`
- Create: `src/dimension/index.ts`

**Interfaces:**
- Consumes: canonical types from the roadmap.
- Produces: `reduceDimensionDocument` for sessions, persistence, and conflict replay.

- [ ] **Step 1: Write reducer tests**

```ts
import { describe, expect, it } from 'vitest';

import { reduceDimensionDocument } from './reducer';
import { emptyDimensionDocument, linearRecord } from './testFixtures';

describe('reduceDimensionDocument', () => {
  it('creates one immutable record', () => {
    const record = linearRecord({ id: 'd1', authorId: 'u1' });
    const result = reduceDimensionDocument(emptyDimensionDocument(), {
      type: 'create',
      commandId: 'c1',
      actorId: 'u1',
      actorRole: 'designer',
      at: 10,
      record,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.records).toEqual([record]);
      expect(result.event.type).toBe('created');
    }
  });

  it('rejects mutation by a non-author non-admin', () => {
    const state = emptyDimensionDocument([linearRecord({ id: 'd1', authorId: 'owner' })]);
    const result = reduceDimensionDocument(state, {
      type: 'delete',
      commandId: 'c2',
      actorId: 'other',
      actorRole: 'reviewer',
      at: 20,
      dimensionId: 'd1',
    });
    expect(result).toEqual({ ok: false, reason: 'forbidden' });
  });
});
```

Create test-only factories in `src/dimension/domain/testFixtures.ts`.

- [ ] **Step 2: Run and verify failure**

```powershell
npx vitest run src/dimension/domain/reducer.test.ts
```

Expected: FAIL because domain files do not exist.

- [ ] **Step 3: Define records and document state**

Copy the canonical roadmap unions exactly into `types.ts` and `document.ts`. Add:

```ts
export const DIMENSION_DOCUMENT_SCHEMA_VERSION = 1 as const;

export function createEmptyDimensionDocument(input: Readonly<{
  documentId: string;
  taskId?: string;
  formId?: string;
  baseVersion?: number;
}>): DimensionDocumentState {
  return {
    schemaVersion: DIMENSION_DOCUMENT_SCHEMA_VERSION,
    documentId: input.documentId,
    taskId: input.taskId,
    formId: input.formId,
    baseVersion: input.baseVersion ?? 0,
    records: [],
  };
}
```

- [ ] **Step 4: Define commands and events**

Use the roadmap `DimensionCommandIntent` plus command metadata:

```ts
export type DimensionActor = Readonly<{
  actorId: string;
  actorRole: string;
}>;

export type DimensionEvent =
  | Readonly<{ type: 'created'; commandId: string; record: UserDimensionRecord }>
  | Readonly<{ type: 'deleted'; commandId: string; dimensionId: string; previous: UserDimensionRecord }>
  | Readonly<{ type: 'placement-replaced'; commandId: string; dimensionId: string; previous: UserDimensionRecord['placement']; next: UserDimensionRecord['placement'] }>
  | Readonly<{ type: 'angle-arc-set'; commandId: string; dimensionId: string; previous: DimensionArcChoice; next: DimensionArcChoice }>
  | Readonly<{ type: 'radial-display-set'; commandId: string; dimensionId: string; previous: RadialDisplay; next: RadialDisplay }>
  | Readonly<{ type: 'anchor-rebound'; commandId: string; dimensionId: string; anchorSlot: string; previous: DimensionAnchor; next: DimensionAnchor }>;

export type ReduceDimensionResult =
  | Readonly<{ ok: true; state: DimensionDocumentState; event: DimensionEvent; inverse: DimensionCommandIntent }>
  | Readonly<{ ok: false; reason: 'duplicate-id' | 'not-found' | 'forbidden' | 'kind-mismatch' | 'invalid-command' }>;
```

- [ ] **Step 5: Implement immutable reducer transitions**

Rules:
- `create`: actor must equal `record.authorId`; duplicate ids fail.
- existing-record mutation: author or `admin` only.
- `replace-placement`: supplied placement type must match record kind.
- `set-angle-arc`: angular only.
- `set-radial-display`: radial only.
- `rebind-anchor`: validate slots by kind, set `validity: 'valid'`, update `updatedAt`.
- no command changes `baseVersion`; server save does.
- each success returns an inverse `DimensionCommandIntent`; the session supplies a fresh command id, actor, role, and timestamp when undo materializes it.

- [ ] **Step 6: Run reducer tests**

```powershell
npx vitest run src/dimension/domain
npm run type-check
```

Expected: PASS.

---

### Task 2: Add Permissions, Anchor Resolution, and Invalid State

**Files:**
- Create: `src/dimension/domain/permissions.ts`
- Create: `src/dimension/domain/permissions.test.ts`
- Create: `src/dimension/domain/anchors.ts`
- Create: `src/dimension/ports/anchorResolver.ts`
- Create: `src/dimension/domain/anchors.test.ts`

**Interfaces:**
- Consumes: current user identity and `DimensionAnchor`.
- Produces: edit permission and batch model-version re-resolution.

- [ ] **Step 1: Write permission tests**

```ts
expect(canEditUserDimension({ id: 'owner', role: 'designer' }, recordBy('owner'))).toBe(true);
expect(canEditUserDimension({ id: 'admin', role: 'admin' }, recordBy('owner'))).toBe(true);
expect(canEditUserDimension({ id: 'reviewer', role: 'reviewer' }, recordBy('owner'))).toBe(false);
expect(canEditUserDimension(null, recordBy('owner'))).toBe(false);
```

- [ ] **Step 2: Implement permission function**

```ts
export function canEditUserDimension(
  user: Readonly<{ id: string; role: string }> | null,
  record: UserDimensionRecord,
): boolean {
  return !!user && (user.id === record.authorId || user.role.toLowerCase() === 'admin');
}
```

- [ ] **Step 3: Define the resolver port**

```ts
export type ResolveAnchorResult =
  | Readonly<{ ok: true; anchor: DimensionAnchor }>
  | Readonly<{ ok: false; reason: 'not-found' | 'ambiguous' | 'source-unavailable' }>;

export interface DimensionAnchorResolver {
  resolveMany(refs: readonly SemanticAnchorRef[]): Promise<readonly ResolveAnchorResult[]>;
}
```

- [ ] **Step 4: Implement one-shot model-version reconciliation**

```ts
export async function refreshDocumentAnchors(
  state: DimensionDocumentState,
  resolver: DimensionAnchorResolver,
  now: number,
): Promise<DimensionDocumentState>;
```

Collect semantic refs once, resolve in one batch, update successful snapshots, and mark any record with at least one failed semantic anchor as `invalid`. Keep last snapshots unchanged on failure. Do not perform per-frame resolution.

- [ ] **Step 5: Run tests**

```powershell
npx vitest run `
  src/dimension/domain/permissions.test.ts `
  src/dimension/domain/anchors.test.ts
```

Expected: PASS.

---

### Task 3: Migrate Archived V5 Records Without Guessing Coordinates

**Files:**
- Create: `src/dimension/adapters/archivedV5Source.ts`
- Create: `src/dimension/domain/migrationV5.ts`
- Create: `src/dimension/domain/migrationV5.test.ts`

**Interfaces:**
- Consumes: immutable V4/V5 archives and the final `LegacyDimensionBridgeArchive` from Plan 01.
- Produces: `DimensionDocumentState` plus explicit migration diagnostics.

- [ ] **Step 1: Write migration tests from frozen fixtures**

Assert:
- `designWorldPos` creates valid Design Space anchors.
- world-only points create invalid records and preserve raw diagnostics.
- when the same id exists in V5 and the later V6-bridge archive, the V6-bridge record wins.
- `linear_distance` maps to `linear`.
- old `angle.supplementary` maps to `arcChoice: 'major'`.
- `textOverride`, `isReference`, and display unit/precision do not enter user records.
- malformed entries produce diagnostics but do not abort the entire archive.

- [ ] **Step 2: Define migration output**

```ts
export type V5MigrationDiagnostic = Readonly<{
  legacyId?: string;
  level: 'warning' | 'error';
  code: 'world-only' | 'unsupported-kind' | 'malformed' | 'ignored-text-override' | 'ignored-reference';
  raw: unknown;
}>;

export type V5MigrationResult = Readonly<{
  state: DimensionDocumentState;
  diagnostics: readonly V5MigrationDiagnostic[];
}>;

export function migrateLegacyDimensionArchives(
  archives: readonly (LegacyDimensionArchive | LegacyDimensionBridgeArchive)[],
  context: Readonly<{ documentId: string; taskId?: string; formId?: string; actorId: string; actorRole: string }>,
): V5MigrationResult;
```

- [ ] **Step 3: Implement safe mapping**

Sort archives by `archivedAt`, then de-duplicate records by id with the newest archive winning. Use `designWorldPos` only when it is a finite three-number tuple. Never treat `worldPos` as Design Space. For unresolved records, keep finite world coordinates only in the diagnostic raw object; create invalid anchors with `snapshot: null`. Such records appear in the semantic list but produce no viewport layout until rebind supplies a trusted Design Space snapshot.

- [ ] **Step 4: Run migration tests**

```powershell
npx vitest run src/dimension/domain/migrationV5.test.ts
```

Expected: PASS.

---

### Task 4: Implement Session History and Local Command Journal

**Files:**
- Create: `src/dimension/services/dimensionDocumentSession.ts`
- Create: `src/dimension/services/dimensionDocumentSession.test.ts`
- Create: `src/dimension/services/commandJournal.ts`
- Create: `src/dimension/services/commandJournal.test.ts`
- Create: `src/dimension/services/replayPendingCommands.ts`
- Create: `src/dimension/services/replayPendingCommands.test.ts`

**Interfaces:**
- Consumes: pure reducer and browser `StorageLike`.
- Produces: one-command edit commits, undo/redo, dirty state, crash recovery, and explicit conflict replay preview.

- [ ] **Step 1: Test one-command history**

Cover:
- apply adds one undo entry.
- undo applies reducer-provided inverse and populates redo.
- new command clears redo.
- preview changes never call `apply`.
- successful server hydration clears history only after local journal reconciliation.

- [ ] **Step 2: Implement the session**

```ts
export class DimensionDocumentSession {
  constructor(input: Readonly<{
    initialState: DimensionDocumentState;
    journal: DimensionCommandJournal;
  }>);
  get state(): DimensionDocumentState;
  get dirty(): boolean;
  get canUndo(): boolean;
  get canRedo(): boolean;
  subscribe(listener: (state: DimensionDocumentState) => void): () => void;
  apply(command: DimensionCommand): ReduceDimensionResult;
  undo(actor: DimensionActor, at: number, commandId: string): ReduceDimensionResult;
  redo(actor: DimensionActor, at: number, commandId: string): ReduceDimensionResult;
  acceptSavedState(state: DimensionDocumentState): void;
}
```

The class contains no Vue refs. Every successful `apply`, `undo`, and `redo` appends the materialized command to the journal before notifying subscribers. `acceptSavedState` clears the journal only after the server-confirmed state is installed.

- [ ] **Step 3: Define local journal schema**

```ts
export type DimensionCommandJournalState = Readonly<{
  version: 1;
  documentId: string;
  baseVersion: number;
  commands: readonly DimensionCommand[];
  updatedAt: number;
}>;

export interface DimensionCommandJournal {
  load(documentId: string): DimensionCommandJournalState | null;
  append(documentId: string, baseVersion: number, command: DimensionCommand): void;
  replace(state: DimensionCommandJournalState): void;
  clear(documentId: string): void;
}
```

Implement `LocalStorageDimensionCommandJournal` with key `plant3d-web-dimension-journal-v1:<documentId>`. Deduplicate by `commandId` and cap at 500 commands; on overflow, refuse append with an explicit error rather than dropping history silently.

- [ ] **Step 4: Implement explicit replay preview**

```ts
export type ReplayPendingCommandsResult = Readonly<{
  state: DimensionDocumentState;
  applied: readonly DimensionCommand[];
  rejected: readonly Readonly<{ command: DimensionCommand; reason: string }>[];
}>;

export function replayPendingCommands(
  latest: DimensionDocumentState,
  commands: readonly DimensionCommand[],
): ReplayPendingCommandsResult;
```

This function does not mutate the active session. UI must ask the user before accepting the returned state.

- [ ] **Step 5: Run tests**

```powershell
npx vitest run src/dimension/services
```

Expected: PASS.

---

### Task 5: Extend Frontend Review Snapshot and API Types

**Files:**
- Create: `src/dimension/adapters/reviewSnapshotAdapter.ts`
- Create: `src/dimension/adapters/reviewSnapshotAdapter.test.ts`
- Create: `src/dimension/services/reviewDimensionRepository.ts`
- Create: `src/dimension/services/reviewDimensionRepository.test.ts`
- Modify: `src/api/reviewApi.ts`
- Modify: `src/review/domain/reviewSnapshot.ts`
- Modify: `src/review/adapters/reviewRecordAdapter.ts`
- Modify: `src/review/adapters/workflowSyncAdapter.ts`
- Modify: `src/review/adapters/importSnapshotAdapter.ts`
- Modify: corresponding tests

**Interfaces:**
- Consumes: `DimensionDocumentState`.
- Produces: `SnapshotDimensionDocument` inside every review ingress/egress path.

- [ ] **Step 1: Define snapshot/API shape**

```ts
export type SnapshotDimensionDocument = Readonly<{
  schemaVersion: 1;
  documentId: string;
  records: readonly UserDimensionRecord[];
}>;
```

Add to `ReviewSnapshot`:

```ts
dimensionDocument?: SnapshotDimensionDocument;
dimensionDocumentVersion?: number;
```

Add to `ConfirmedRecordData`, response records, and workflow record types:

```ts
dimensionDocument?: SnapshotDimensionDocument;
dimensionDocumentVersion?: number;
```

- [ ] **Step 2: Implement pure adapters**

```ts
export function dimensionDocumentToSnapshot(
  state: DimensionDocumentState,
): SnapshotDimensionDocument;

export function dimensionDocumentFromSnapshot(
  snapshot: SnapshotDimensionDocument,
  context: Readonly<{ taskId?: string; formId?: string; baseVersion: number }>,
): DimensionDocumentState;
```

`dimensionDocumentToSnapshot` intentionally omits runtime `baseVersion`; the outer review-record field is authoritative. Validate `schemaVersion === 1`, finite vectors, unique ids, and `context.baseVersion >= 0`.

- [ ] **Step 3: Extend all snapshot ingress adapters**

`reviewRecordAdapter`, `workflowSyncAdapter`, and `importSnapshotAdapter` copy the optional document without projecting it into legacy tool JSON. Remove any remaining `dimensions: []` compatibility field.

- [ ] **Step 4: Implement the review repository adapter**

```ts
export type ReviewDimensionApi = Readonly<{
  loadRecords(context: { taskId?: string; formId?: string }): Promise<readonly ConfirmedRecordData[]>;
  buildBaseRecord(): Promise<Omit<ConfirmedRecordData, 'dimensionDocument' | 'dimensionDocumentBaseVersion'>>;
  saveRecord(payload: ConfirmedRecordData & { dimensionDocumentBaseVersion: number }): Promise<ConfirmedRecordResponse>;
}>;

export class ReviewDimensionRepository implements DimensionDocumentRepository {
  constructor(private readonly api: ReviewDimensionApi) {}
  load(context: { taskId?: string; formId?: string }): Promise<DimensionDocumentState>;
  save(state: DimensionDocumentState): Promise<SaveDimensionDocumentResult>;
}
```

`load` selects the newest record carrying a document, then converts it through `dimensionDocumentFromSnapshot`. `save` awaits `buildBaseRecord()`, adds the dimension snapshot/base version, and sends one whole review-record transaction. It maps HTTP 409/latest record to `{ ok: false, reason: 'conflict', latest }`, and maps 403/network/validation failures without throwing expected workflow errors.

- [ ] **Step 5: Run frontend adapter tests**

```powershell
npx vitest run `
  src/dimension/adapters/reviewSnapshotAdapter.test.ts `
  src/dimension/services/reviewDimensionRepository.test.ts `
  src/review/domain/reviewSnapshot.test.ts `
  src/review/adapters/reviewRecordAdapter.test.ts `
  src/review/adapters/workflowSyncAdapter.test.ts `
  src/review/adapters/importSnapshotAdapter.test.ts
```

Expected: PASS.

---

### Task 6: Add Atomic Dimension Versioning to the Rust Review API

**Files (external repository):**
- Modify: `D:\work\plant-code\plant-model-gen\src\web_api\review_api.rs`
- Modify: `D:\work\plant-code\plant-model-gen\src\web_api\platform_api\types.rs`
- Modify: `D:\work\plant-code\plant-model-gen\src\web_api\platform_api\workflow_sync.rs`
- Modify: `D:\work\plant-code\plant-model-gen\src\web_api\platform_api\tests.rs`
- Modify: `D:\work\plant-code\plant-model-gen\src\web_api\review_db.rs`

**Interfaces:**
- Consumes: `dimensionDocument` and its `baseVersion`.
- Produces: atomically incremented `dimensionDocumentVersion` or HTTP 409 with latest record.

- [ ] **Step 1: Add Rust contract fields**

```rust
#[serde(default)]
pub dimension_document: Option<serde_json::Value>,
#[serde(default)]
pub dimension_document_base_version: u64,
```

Response/row/workflow types add:

```rust
pub dimension_document: Option<serde_json::Value>,
pub dimension_document_version: u64,
```

- [ ] **Step 2: Initialize legacy rows**

In review schema preparation, execute once:

```sql
UPDATE review_records
SET dimension_document_version = 0
WHERE dimension_document_version = NONE;
```

SurrealDB is schemaless; no destructive migration is required.

- [ ] **Step 3: Include dimensions in snapshot hash**

Extend `build_confirmed_record_snapshot_hash` to serialize `dimension_document` after measurements and before note. Two otherwise identical records with different dimensions must have different hashes.

- [ ] **Step 4: Implement compare-and-swap update**

Perform dimension version validation before the existing snapshot-hash no-op branch. When `dimension_document` is `None`, preserve the existing document/version and keep legacy clients working without CAS. When it is `Some`, require the supplied base version and execute the conditional update below.

For an existing stable record:

```sql
UPDATE type::record('review_records', $id)
SET
  dimension_document = $dimension_document,
  dimension_document_version = $next_version,
  snapshot_hash = $snapshot_hash,
  confirmed_at = time::now()
WHERE dimension_document_version = $base_version
RETURN AFTER;
```

Bind `next_version = base_version + 1`. If the returned row list is empty, reload the latest row and return:

```rust
(
    StatusCode::CONFLICT,
    Json(ConfirmedRecordResponse {
        success: false,
        record: latest.map(confirmed_record_with_meta_from_row),
        records: None,
        error_message: Some("尺寸文档版本冲突，请刷新后确认是否重放本地修改".to_string()),
    }),
)
```

For a missing record, accept only base version `0`, create version `1`, and return 409 for any other base version.

- [ ] **Step 5: Extend workflow SELECT projections**

Add `dimension_document, dimension_document_version` to both form-id and task-id record queries and map them into `WorkflowRecord`.

- [ ] **Step 6: Add backend tests**

Tests must prove:
- first save version 0 → 1.
- second save base 1 → 2.
- stale base 1 after version 2 returns 409 and latest version 2.
- workflow sync returns the document.
- legacy record with no dimension fields reads as `None` / version 0.

- [ ] **Step 7: Run backend checks**

Run in `D:\work\plant-code\plant-model-gen`:

```powershell
cargo fmt --check
cargo check --features web_server
cargo test --lib web_api::platform_api::tests
```

Expected: PASS.

---

### Task 7: Wire Review Confirm, Restore, and Workflow Flush

**Files:**
- Modify: `src/components/review/reviewPanelActions.ts`
- Modify: `src/components/review/reviewRecordReplay.ts`
- Modify: `src/components/review/confirmedRecordsRestore.ts`
- Modify: `src/composables/useReviewStore.ts`
- Modify: `src/components/review/ReviewConfirmation.vue`
- Modify: `src/components/review/ReviewPanel.vue`
- Modify: `src/components/review/DesignerCommentHandlingPanel.vue`
- Modify: required tests

**Interfaces:**
- Consumes: active `DimensionDocumentSession`.
- Produces: atomic review payload, restore hydration, dirty counts, conflict result.

- [ ] **Step 1: Extend confirm payload**

```ts
export type ReviewConfirmSnapshotPayload = {
  annotations: unknown[];
  cloudAnnotations: unknown[];
  rectAnnotations: unknown[];
  obbAnnotations: unknown[];
  measurements: ReviewSnapshotMeasurementPayload[];
  dimensionDocument?: SnapshotDimensionDocument;
};
```

`buildReviewConfirmSnapshotPayload` accepts the current dimension snapshot. Do not merge external dimensions.

- [ ] **Step 2: Include document in workflow flush**

Before `flushPendingConfirmForExternalAction` submits, read the active session state, include `dimensionDocument`, and pass `dimensionDocumentBaseVersion`.

- [ ] **Step 3: Handle conflict explicitly**

Map HTTP 409 to:

```ts
export type DimensionSaveConflict = Readonly<{
  latest: DimensionDocumentState;
  pending: readonly DimensionCommand[];
}>;
```

Do not auto-replay. Open a confirmation UI that shows applied/rejected preview from `replayPendingCommands`.

- [ ] **Step 4: Restore document independently of toolStore JSON**

`confirmedRecordsRestore` hydrates the `DimensionDocumentSession` directly from the latest applicable snapshot. `reviewRecordReplay` remains responsible only for legacy annotations/measurements and never recreates a `dimensions` array.

- [ ] **Step 5: Show pending state**

Review confirmation counts user dimensions and displays `session.dirty`. Leaving the review workspace with a non-empty journal triggers the existing unsaved-change confirmation pattern.

- [ ] **Step 6: Run the mandatory review suites**

```powershell
npx vitest run `
  src/components/review/reviewPanelActions.test.ts `
  src/components/review/reviewRecordReplay.test.ts `
  src/components/review/confirmedRecordsRestore.test.ts `
  src/components/review/ReviewConfirmation.test.ts `
  src/composables/useReviewStore.confirm.test.ts `
  src/components/review/ReviewPanel.test.ts `
  src/components/review/DesignerCommentHandlingPanel.test.ts `
  src/components/review/AnnotationTableView.test.ts `
  src/components/review/reviewerWorkbenchViewModeBus.test.ts
npm run type-check
```

Expected: targeted dimension/review assertions pass; record baseline versus after for unrelated known failures.

---

### Task 8: Close Gate 3

- [ ] **Step 1: Run all document tests**

```powershell
npx vitest run src/dimension/domain src/dimension/services src/dimension/adapters
```

Expected: PASS.

- [ ] **Step 2: Verify forbidden data**

Run:

```powershell
rg "textOverride|isReference|displayUnit|lengthDecimals|labelOffsetPx|worldPos" "src/dimension/domain"
```

Expected: no production matches except V5 migration diagnostics/tests.

- [ ] **Step 3: Verify round trip**

One integration test must execute:

```text
DimensionDocumentState
→ ReviewConfirmSnapshotPayload
→ frontend API JSON
→ Rust review_records
→ workflow sync JSON
→ ReviewSnapshot
→ DimensionDocumentState
```

Assert stable record ids, values, anchors, author fields, and incremented base version.

- [ ] **Step 4: Review checkpoint**

Gate 3 is complete only when reducer, journal, V5 migration, backend CAS, confirm, restore, and workflow sync all pass without any viewer or Canvas implementation.
