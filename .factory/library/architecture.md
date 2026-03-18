# M6+M7 Reviewer Annotation And Collaboration Architecture

## Mission Scope

This mission delivers:
- M6 reviewer annotation canonicalization and direct-launch tooling in the reviewer workbench
- M7 dual-scope collaboration across reviewer and designer surfaces
- scripted demo data for deterministic reviewer/designer validation

Primary scope:
- reviewer workbench direct-launch for annotation and measurement
- canonical reviewer annotation semantics: text / cloud / rectangle
- confirmed measurement replay
- explicit task-thread and annotation-thread collaboration
- reviewer/designer closed-loop continuity through return / resubmit / reopen
- seeded demo scenarios for repeatable browser validation

This mission does **not** make measurements first-class comment-bearing objects, and it does **not** depend on a websocket-first architecture rewrite.

## Source-of-Truth Rules

- Workbench orchestration lives in `src/components/review/ReviewPanel.vue`
- Reviewer annotation/tool session seams live in `src/components/tools/AnnotationPanel.vue`, `src/composables/useDtxTools.ts`, and `src/composables/useToolStore.ts`
- Collaboration contracts and refresh behavior live in `src/components/review/ReviewCommentsPanel.vue`, `src/composables/useReviewStore.ts`, and `src/api/reviewApi.ts`
- Designer closed-loop continuity lives in `src/components/review/DesignerTaskList.vue`, `src/components/review/ResubmissionTaskList.vue`, `src/components/review/TaskReviewDetail.vue`, and `src/composables/useUserStore.ts`
- Demo-data bootstrap must be script-driven and reproducible

## Expected Data Flow

### M6 reviewer action path
1. Reviewer opens a seeded task in the workbench.
2. Reviewer launches annotation or measurement directly from the workbench.
3. Tool sessions produce canonical annotation candidates or temporary measurement results.
4. Reviewer confirms a candidate batch.
5. Confirmed records reload and replay from stable task/form lineage.

### M7 collaboration path
1. Reviewer opens task-thread or annotation-thread.
2. Messages, replies, edits, resolves, mentions, and attachments persist through the collaboration contract.
3. Designer opens the same task later and sees the same thread continuity.
4. Return / resubmit / reopen preserve task-thread and annotation-thread lineage.

## Highest-Risk Seams

- Reviewer-visible legacy OBB semantics leaking into canonical rectangle flows
- Annotation identity instability across confirm / reload / resubmit
- Measurement replay diverging between reviewer and designer surfaces
- Task-thread vs annotation-thread ambiguity in UI or payloads
- Attachment / mention data becoming conflated with existing task attachment semantics
- Demo data failing to create deterministic reviewer/designer validation paths
