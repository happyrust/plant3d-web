<script setup lang="ts">
import { computed } from 'vue';

import {
  DIFF_KIND_CLASS,
  DIFF_KIND_LABEL,
  diffSourceText,
  membersText,
  STATUS_CLASS,
  STATUS_LABEL,
  type ChangedElementRow,
} from './nodeVersionPanelFormat';

import type { ModelNodeDiffScope, ModelNodeDiffStatus, ModelNodeDiffSummary } from '@/model-source';

import { emptyNetDiffText, type AttributeNetDiffView } from '@/utils/nodeVersionTimeline';

/**
 * 节点版本面板的「属性对比」tab（版本对比审核计划 P2-2 从 `ModelUnitVersionComparePanel` 拆出）：
 * `仅自身` 下是节点自己 A → B 的一格净差（表 + 去向 + 成员 / owner + 取数口径）；`所有子节点` 下是差异摘要里有变的构件清单，
 * 每行可展开看它的净差、行尾一颗「定位」。只画与发事件，取数在面板（`loadSelfDiff` / `toggleElementDiff`）；
 * `data-testid` 与拆出前逐字相同。
 */

const props = defineProps<{
  scope: ModelNodeDiffScope;
  pairReady: boolean;
  beforeSesno: number | null;
  afterSesno: number | null;
  /** `仅自身`：节点自己那一格净差 */
  loadingSelfDiff: boolean;
  selfDiffError: string | null;
  selfDiff: AttributeNetDiffView | null;
  /** `所有子节点`：差异摘要与有变的构件清单 */
  diffSummaryUnavailable: boolean;
  loadingSummary: boolean;
  diffSummaryError: string | null;
  diffSummary: ModelNodeDiffSummary | null;
  changedElementRows: ChangedElementRow[];
  expandedElement: string | null;
  /** 展开的构件 → 它的净差；还在算是 'loading'，失败是一句话 */
  elementDiffs: Map<string, AttributeNetDiffView | 'loading' | string>;
  /** 三维里装着 A / B 时，B 侧已删的构件也能「定位」 */
  compareActive: boolean;
}>();

/** 「含戳」：与模型对比 tab 的「包含未变化」是同一个开关（拆出前就共用 `includeUnchanged`） */
const includeUnchanged = defineModel<boolean>('includeUnchanged', { required: true });

const emit = defineEmits<{
  toggleElement: [refno: string];
  locate: [row: { refno: string; status: ModelNodeDiffStatus }];
}>();

/** 属性对比（仅自身）表里实际列出的行：戳（`CACHID` 一类）缺省不列，勾「含戳」才列 */
const selfDiffVisible = computed(() => (props.selfDiff?.changes ?? []).filter((change) => includeUnchanged.value || !change.stamp));
/** 「n 项变化」只数属性行（不含戳）；成员 / owner 另说一句 */
const selfDiffCount = computed(() => (props.selfDiff?.changes ?? []).filter((change) => !change.stamp).length);

/** 展开的构件那一格已经算出来的净差；还在算 / 失败（字串）时为 null */
function elementDiffView(refno: string): AttributeNetDiffView | null {
  const entry = props.elementDiffs.get(refno);
  return entry && typeof entry === 'object' ? entry : null;
}

function toggleElementDiff(refno: string): void {
  emit('toggleElement', refno);
}

/**
 * 每行的「定位」（设计稿 S3）：三维里装着 A / B 时飞到隔离图层里的它（幽灵也找得到），没装时回落到主图层里的同一 refno。
 * B 侧已删且三维里没装 A / B 时置灰：当前会话里已经没有它，环境模型里找不到。
 */
function canLocateElement(row: { status: ModelNodeDiffStatus }): boolean {
  return props.compareActive || row.status !== 'deleted';
}

function locateElementTitle(row: { status: ModelNodeDiffStatus }): string {
  if (!canLocateElement(row)) return 'B 版已删除，当前模型里没有它；先「在三维中对比」再定位';
  return props.compareActive ? '飞到三维里 A / B 那一版的它' : '飞到当前模型里的它（已加载时）';
}

function locateElement(row: { refno: string; status: ModelNodeDiffStatus }): void {
  if (!canLocateElement(row)) return;
  emit('locate', row);
}
</script>

<template>
  <section class="mt-2" data-testid="model-unit-compare-attributes">
    <p v-if="!pairReady" class="py-3 text-center text-xs text-muted-foreground">先在时间线上选好 A / B（A 早于 B）</p>
    <template v-else-if="scope === 'self'">
      <p v-if="loadingSelfDiff" class="py-3 text-center text-xs text-muted-foreground" data-testid="model-unit-compare-attr-loading">正在算属性净差…</p>
      <div v-else-if="selfDiffError" class="rounded-md border border-border bg-muted/20 p-2 text-[11px] text-muted-foreground" data-testid="model-unit-compare-attr-error">
        {{ selfDiffError }}。跑一次「在三维中对比」后，模型树差异模式底部仍有 A / B 两版的属性逐项对比。
      </div>
      <template v-else-if="selfDiff">
        <div class="flex items-center justify-between gap-2 text-[11px]">
          <span class="font-semibold text-foreground">
            A {{ beforeSesno }} → B {{ afterSesno }} · {{ selfDiffCount }} 项变化
            <span v-if="selfDiff.kind" class="ml-1 rounded px-1.5 py-0.5 text-[10px] font-normal" :class="DIFF_KIND_CLASS[selfDiff.kind]" data-testid="model-unit-compare-attr-kind">
              {{ DIFF_KIND_LABEL[selfDiff.kind] }}<template v-if="selfDiff.impact"> · {{ selfDiff.impact }}</template>
            </span>
          </span>
          <label class="flex items-center gap-1 text-muted-foreground">
            <input v-model="includeUnchanged" type="checkbox" />含戳
          </label>
        </div>
        <p v-if="selfDiff.kind === 'created' && selfDiff.source === 'server'" class="mt-1 text-[10px] text-amber-700">
          该节点在 A（sesno {{ beforeSesno }}）侧不存在：列的是 B 侧全部已设的属性，before 为空。
        </p>
        <p v-else-if="selfDiff.kind === 'deleted' && selfDiff.source === 'server'" class="mt-1 text-[10px] text-amber-700">
          该节点在 B（sesno {{ afterSesno }}）侧已删除：列的是 A 侧全部已设的属性，after 为空。
        </p>
        <p v-else-if="selfDiff.createdAt !== null || selfDiff.deletedAt !== null" class="mt-1 text-[10px] text-amber-700">
          <template v-if="selfDiff.createdAt !== null">该节点在 sesno {{ selfDiff.createdAt }} 被创建；</template>
          <template v-if="selfDiff.deletedAt !== null">在 sesno {{ selfDiff.deletedAt }} 被删除；</template>
          A 侧不存在的属性 before 为空。
        </p>
        <p v-if="selfDiff.members || selfDiff.owner" class="mt-1 text-[10px] text-muted-foreground" data-testid="model-unit-compare-attr-members">
          <template v-if="selfDiff.members">成员 {{ membersText(selfDiff.members) }}</template>
          <template v-if="selfDiff.members && selfDiff.owner">；</template>
          <template v-if="selfDiff.owner">owner {{ selfDiff.owner[0] }} → {{ selfDiff.owner[1] }}</template>
        </p>
        <p v-else-if="selfDiff.membersTouched || selfDiff.ownerTouched" class="mt-1 text-[10px] text-muted-foreground">
          这段区间里<template v-if="selfDiff.membersTouched">成员表动过</template><template v-if="selfDiff.membersTouched && selfDiff.ownerTouched">、</template><template v-if="selfDiff.ownerTouched">owner 改挂过</template>（折出来的净差看不出来，看时间线逐行）。
        </p>
        <p v-if="selfDiff.attributesUnavailable" class="mt-1 text-[10px] text-amber-700">属性行渲染不出来：{{ selfDiff.attributesUnavailable }}（去向与影响档仍成立）</p>
        <div class="mt-2 overflow-hidden rounded-md border border-border" data-testid="model-unit-compare-attr-table" :data-source="selfDiff.source">
          <div class="grid grid-cols-[76px_1fr_1fr] gap-2 bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground">
            <span>属性</span><span class="font-semibold text-blue-700">A · {{ beforeSesno }}</span><span class="font-semibold text-emerald-700">B · {{ afterSesno }}</span>
          </div>
          <div v-for="change in selfDiffVisible" :key="change.name"
            class="grid grid-cols-[76px_1fr_1fr] gap-2 border-t border-border px-2 py-1 text-[10px]"
            :class="change.stamp ? 'bg-slate-50 text-slate-500' : 'bg-amber-50/60'">
            <span class="font-mono font-semibold">{{ change.name }}<span v-if="change.stamp" class="ml-1 rounded bg-slate-200 px-1 text-[9px] font-normal">戳</span><span v-if="change.hops > 1" class="ml-1 text-[9px] font-normal text-muted-foreground">×{{ change.hops }}</span></span>
            <span class="break-all font-mono text-muted-foreground">{{ change.before ?? '—' }}</span>
            <span class="break-all font-mono font-semibold text-foreground">{{ change.after ?? '—' }}</span>
          </div>
          <p v-if="selfDiffVisible.length === 0" class="border-t border-border px-2 py-2 text-center text-[10px] text-muted-foreground">
            {{ emptyNetDiffText(selfDiff, 0) }}
          </p>
        </div>
        <p v-if="selfDiff.warnings.length" class="mt-1 text-[10px] text-muted-foreground">{{ selfDiff.warnings[0] }}</p>
        <p class="mt-1 text-[10px] text-muted-foreground" data-testid="model-unit-compare-attr-source">{{ diffSourceText(selfDiff) }}</p>
      </template>
    </template>
    <template v-else>
      <div v-if="diffSummaryUnavailable" class="rounded-md border border-border bg-muted/20 p-2 text-[11px] text-muted-foreground" data-testid="model-unit-compare-summary-missing">
        服务端还没有 <code>node/diff-summary</code>：「所有子节点」下有变的构件清单要新版服务端；先跑「在三维中对比」看几何差异。
      </div>
      <p v-else-if="loadingSummary" class="py-3 text-center text-xs text-muted-foreground">正在算差异摘要…</p>
      <p v-else-if="diffSummaryError" class="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">{{ diffSummaryError }}</p>
      <template v-else-if="diffSummary">
        <div class="text-[11px] font-semibold text-foreground">A {{ beforeSesno }} → B {{ afterSesno }} · 有变的构件 {{ changedElementRows.length }} 个</div>
        <ul class="mt-2 space-y-1" data-testid="model-unit-compare-changed-elements">
          <li v-for="row in changedElementRows" :key="row.refno" class="rounded-md border" :class="row.isNode ? 'border-primary bg-primary/5' : 'border-border'">
            <div class="flex items-stretch">
              <button type="button" class="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted/40"
                :data-testid="`model-unit-compare-element-${row.refno}`"
                @click="toggleElementDiff(row.refno)">
                <span class="text-[10px] text-muted-foreground">{{ expandedElement === row.refno ? '▾' : '▸' }}</span>
                <span class="font-mono font-semibold">{{ row.noun }} {{ row.refno }}</span>
                <span v-if="row.isNode" class="rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">本节点</span>
                <span v-if="row.unitRefno && row.unitRefno !== row.refno" class="truncate text-[10px] text-muted-foreground">{{ row.unitNoun }} {{ row.unitRefno }} 下</span>
                <span class="ml-auto rounded px-1.5 py-0.5 text-[10px]" :class="STATUS_CLASS[row.status]">{{ STATUS_LABEL[row.status] }} · {{ row.impact }}</span>
              </button>
              <button type="button" class="shrink-0 border-l border-border px-2 text-[10px] text-muted-foreground hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                :data-testid="`model-unit-compare-element-locate-${row.refno}`"
                :disabled="!canLocateElement(row)"
                :title="locateElementTitle(row)"
                @click.stop="locateElement(row)">
                定位
              </button>
            </div>
            <div v-if="expandedElement === row.refno" class="border-t border-border px-2 py-1.5 text-[10px]" :data-testid="`model-unit-compare-element-diff-${row.refno}`">
              <template v-if="elementDiffs.get(row.refno) === 'loading'">正在算它的属性净差…</template>
              <template v-else-if="typeof elementDiffs.get(row.refno) === 'string'">
                <span class="text-amber-700">{{ elementDiffs.get(row.refno) }}</span>
              </template>
              <template v-else-if="elementDiffView(row.refno)">
                <p v-if="elementDiffView(row.refno)!.kind === 'created' && elementDiffView(row.refno)!.source === 'server'" class="text-amber-700">A 侧不存在：列的是 B 侧全部已设的属性</p>
                <p v-else-if="elementDiffView(row.refno)!.kind === 'deleted' && elementDiffView(row.refno)!.source === 'server'" class="text-amber-700">B 侧已删除：列的是 A 侧全部已设的属性</p>
                <div v-for="change in elementDiffView(row.refno)!.changes" :key="change.name"
                  class="grid grid-cols-[76px_1fr_1fr] gap-2 py-0.5" :class="change.stamp ? 'text-slate-500' : ''">
                  <span class="font-mono font-semibold">{{ change.name }}<span v-if="change.stamp" class="ml-1 rounded bg-slate-200 px-1 text-[9px] font-normal">戳</span></span>
                  <span class="break-all font-mono text-muted-foreground">{{ change.before ?? '—' }}</span>
                  <span class="break-all font-mono font-semibold">{{ change.after ?? '—' }}</span>
                </div>
                <p v-if="elementDiffView(row.refno)!.changes.length === 0" class="text-muted-foreground">{{ emptyNetDiffText(elementDiffView(row.refno)!, 0) }}</p>
                <p v-if="elementDiffView(row.refno)!.members" class="text-muted-foreground">成员 {{ membersText(elementDiffView(row.refno)!.members!) }}</p>
                <p v-else-if="elementDiffView(row.refno)!.membersTouched" class="text-muted-foreground">成员表动过（增删或重排）</p>
                <p v-if="elementDiffView(row.refno)!.owner" class="text-muted-foreground">owner {{ elementDiffView(row.refno)!.owner![0] }} → {{ elementDiffView(row.refno)!.owner![1] }}</p>
                <p v-if="elementDiffView(row.refno)!.source === 'folded'" class="text-muted-foreground">服务端还没有 element/attribute-diff：这是把它的时间线在 (A, B] 里折出来的</p>
              </template>
            </div>
          </li>
          <li v-if="changedElementRows.length === 0" class="py-3 text-center text-xs text-muted-foreground">这段区间里子树内没有任何记录变过</li>
        </ul>
      </template>
    </template>
  </section>
</template>
