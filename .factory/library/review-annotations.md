# Review Annotations

Reviewer annotation mission notes and code seams.

**What belongs here:** reviewer annotation entry points, data model seams, and migration notes for rectangle/cloud semantics.

---

## Current Code Seams

- Creation/render loop: `src/composables/useDtxTools.ts`
- Reviewer-facing panel and helper copy: `src/components/tools/AnnotationPanel.vue`
- Review task/confirm UI: `src/components/review/ReviewPanel.vue`
- Annotation data records: `src/composables/useToolStore.ts`
- Confirm/load/reload path: `src/composables/useReviewStore.ts`

## Mission Semantics

- `矩形` is the reviewer-facing replacement for the old OBB mode.
- `云线` is marquee-created, screen-space, and anchored by the marquee-center nearest visible mesh hit.
- Legacy reviewer `OBB框选` affordances must disappear from reviewer-visible UI and counts.

## Persistence Reminder

- Confirmed review data must keep text/cloud/rectangle payloads distinct.
- Rectangle persistence must be able to reconstruct the new OBB-targeted rectangle semantics after reload.
- Cloud persistence must keep the data required to restore anchor and text semantics after reload.
