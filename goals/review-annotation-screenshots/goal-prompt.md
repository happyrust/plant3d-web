# Codex Goal Prompt: 校审批注截图关联

After every critical document in this folder is approved with Plannotator, paste or set this goal:

```text
/goal 为三维校审中的每条批注提供当前三维视图截图、确认保存并持久关联到该批注的完整闭环

Use `goals/review-annotation-screenshots/` as the durable source of truth:
- Read `brief.md` for the mission, context, constraints, non-goals, and ask-before rules.
- Follow `plan.md` for the solution overview, implementation slices, risks, and acceptance criteria.
- Run the checks in `verification.md` and record evidence.
- Append concrete progress and proof to `progress.jsonl`.
- Pause and ask the user for anything listed in `blockers.md` or any similarly risky unresolved decision.

Build this as a focused review-annotation screenshot feature:
- Review the GPT Image 2 effect images before implementation:
  - `goals/review-annotation-screenshots/assets/review-annotation-screenshot-capture-flow.png`
  - `goals/review-annotation-screenshots/assets/review-annotation-screenshot-timeline-detail.png`
  Use them to align the interaction states, not as pixel-perfect designs.
- Reconcile `src/composables/useScreenshot.ts` with `src/composables/useScreenshot.test.ts` by exporting a stable `CaptureOptions` and correctly forwarding annotation screenshot metadata to `reviewAttachmentUploadWithProgress`.
- Add a shared capture/preview/confirm/save flow for text/cloud/rect/obb annotations, reusing `useToolStore.setAnnotationScreenshot` and preserving replacement cleanup behavior.
- Ensure `AnnotationPanel`, `AnnotationWorkspace`, and `ReviewCommentsTimeline` expose and display the associated screenshot for every supported annotation type.
- Preserve screenshot payloads through confirmed records, workflow sync, replay, and refresh. If already-confirmed annotations require a backend patch that does not exist, stop and ask with a concrete API proposal.
- Do not change unrelated review workflow, comment, measurement, auth, or PMS embed behavior.

Proof of done:
- All acceptance criteria in `plan.md` have real evidence.
- All commands and manual checks in `verification.md` are run or explicitly documented as blocked with exact reasons.
- `progress.jsonl` contains command results, manual evidence paths, and any remaining risk.

Do not mark the goal complete until every acceptance item is backed by real evidence and the required verification has passed or the remaining blocker is explicitly documented for the user.
```
