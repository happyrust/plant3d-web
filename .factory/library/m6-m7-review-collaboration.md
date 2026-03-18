# M6+M7 Reviewer Annotation And Collaboration Notes

Mission notes for reviewer workbench direct-launch, canonical annotations, replayable measurements, and dual-scope collaboration.

## Core Semantics

- Reviewer-visible annotation types are `text`, `cloud`, and `rectangle`.
- Reviewer-visible legacy `OBB` semantics must disappear from the new reviewer path.
- Measurements are temporary tool-session artifacts until confirmation.
- Confirmed measurements become replayable records, not comment-bearing collaboration objects.
- Collaboration has two scopes only:
  - `task-thread` for whole-task discussion
  - `annotation-thread` for per-annotation discussion

## Workbench Principles

- `ReviewPanel` is the orchestration surface for reviewer task context and direct-launch entry points.
- Direct-launch should start annotation and measurement from the reviewer workbench without requiring a detour into a separate tool panel first.
- The workbench may orchestrate tool sessions, but it should not absorb all low-level tool implementation detail.

## Collaboration Principles

- Task-thread and annotation-thread must remain visually and contractually separate.
- Full collaboration includes replies, edit/delete, resolve/unresolve, unread/read, mentions, and attachments.
- Quasi-real-time is sufficient: targeted refresh, event-triggered refresh, or polling can be used if it keeps active collaboration surfaces current without full-page reload.

## Demo Data Principles

- User-surface validation should rely on scripted demo data, not opportunistic business data.
- Demo tasks should cover:
  - text annotation
  - cloud annotation
  - rectangle annotation
  - measurement confirm + replay
  - task-thread collaboration
  - annotation-thread collaboration
  - reviewer return -> designer resubmit -> reviewer reopen
