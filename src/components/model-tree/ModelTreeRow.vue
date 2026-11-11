<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';

import { Boxes, ChevronDown, ChevronRight, CircleMinus, Eye, EyeOff, Layers, LoaderCircle, Square } from 'lucide-vue-next';

import ModelTreeStatusIcon from './ModelTreeStatusIcon.vue';

import type { TreeDiffStatus } from '@/composables/useTreeVersionDiff';

import { rvmBadgeTitle, type IncrementalRoot } from '@/components/rvm-check/incrementalRvmTargets';
import { type RvmNodeStatus } from '@/components/rvm-check/rvmCheckFormat';
import { pendingGenerationFillView } from '@/composables/generationFillState';
import { modelLoadSessionView } from '@/composables/modelLoadSession';
import { type NodeModelStatusAction } from '@/composables/nodeModelStatus';
import { updateToLatestView } from '@/composables/updateToLatestState';
import { useGenModelV1DbnumStatus } from '@/composables/useGenModelV1DbnumStatus';
import { useLoadedNodeStatus } from '@/composables/useLoadedNodeStatus';
import { type CheckState, type FlatRow } from '@/composables/useModelTree';
import { getPdmsTypeIconUrl } from '@/lib/pdmsTypeIcon';
import { cn } from '@/lib/utils';

const props = defineProps<{
  row: FlatRow;
  index: number;
  expanded: boolean;
  selected: boolean;
  checkState: CheckState;
  loading?: boolean;
  /** 版本差异模式：该节点自身的变更类别 */
  diffStatus?: TreeDiffStatus;
  /** 版本差异模式：后代变更数量汇总（容器节点） */
  diffCount?: number;
  /** 版本差异模式：幽灵节点（当前树里没有它，仅展示） */
  ghost?: boolean;
  /** 幽灵节点因原父节点未知而挂载于根节点 */
  ghostUnplaced?: boolean;
  /**
   * 无名构件显示整条 E3D 默认全名（`ZONE 4 of SITE 2`）而不是短名（`ZONE 4`）。
   * 默认关：E3D 自己的模型树显示的就是短名；整条一直挂在行的 title 上。
   */
  fullNames?: boolean;
  /** 行的悬停全文（`FlatRow` 没有 title 位；房间页签的直段行把两端 refno / 距离 / 所属 BRAN 挂在这里） */
  rowTitle?: string;
  /** RVM 核对最新结论；没核对过不传 */
  rvmStatus?: RvmNodeStatus | null;
  /** 增量待校验 / 增量后过期时，对应的那一轮增量；不在增量里不传 */
  rvmIncremental?: IncrementalRoot | null;
}>();

const emit = defineEmits<{
  (e: 'toggle-expand', id: string): void;
  (e: 'toggle-visible', id: string, visible: boolean): void;
  (e: 'select', index: number, ev: MouseEvent): void;
  (e: 'context', id: string, ev: MouseEvent): void;
  (e: 'rvm-status', refno: string): void;
  /**
   * 已加载节点行上的动作：`update` = 库一级的更新到最新（落后时），`update-node` = 节点一级的更新（落后、而这个库
   * 没有库一级的更新可走时），`reload` = 重载（库里的模型比本页装的新时），`generate` = 补齐没有模型的单元
   */
  (e: 'node-action', id: string, action: NodeModelStatusAction): void;
  /** 加载中点了行尾的转圈：停掉这个节点的加载 */
  (e: 'stop-loading', id: string): void;
}>();

const INDENT_PX = 20;
const safeDepth = computed(() => {
  const d = Number(props.row.depth);
  if (!Number.isFinite(d) || d <= 0) return 0;
  return Math.floor(d);
});

const isVisible = computed(() => props.checkState !== 'unchecked');
const typeIconUrl = computed(() => getPdmsTypeIconUrl(props.row.type));
/** 分组节点没有 PDMS 类型图标：GPWL 用「图层」、GPSET 用「盒组」。 */
const groupIcon = computed(() => {
  const type = String(props.row.type || '').trim().toUpperCase();
  if (type === 'GPWL') return Layers;
  if (type === 'GPSET') return Boxes;
  return null;
});
const secondaryTitle = computed(() => (props.row.via
  ? `分组引用（经 GPITEM ${fallbackRefnoLabel(props.row.via)}），主位置不在这里；右键「定位到原位置」`
  : '分组引用，主位置不在这里；右键「定位到原位置」'));
/** 规则成员没有经由的 GPITEM，说明命中它的是一条分组规则（SCOSEL）。 */
const ruleTitle = computed(() => '分组规则命中，主位置在别处；右键「定位到原位置」');

function normalizePdmsName(value: string | undefined): string {
  return String(value || '').trim().replace(/^\/+/, '');
}

function fallbackRefnoLabel(id: string): string {
  // refno 格式：24381_145018 → 24381/145018
  return id && id.includes('_') ? id.replace('_', '/') : id || '';
}

/** 这一行拿哪个名字画：无名构件默认短名，开了「显示全称」或没有短名就是 `name`。 */
const nameSource = computed(() => {
  const short = props.row.shortName;
  if (props.fullNames || !short) return props.row.name;
  return short;
});
const rawDisplayName = computed(() => normalizePdmsName(nameSource.value));
/** 短名与整条不同（= 无名构件）时，整条挂在 title 上；幽灵行的 title 另有说法，让它优先。 */
const fullNameTitle = computed(() => {
  if (props.ghost) return undefined;
  const short = props.row.shortName;
  if (!short || short === props.row.name || props.fullNames) return undefined;
  return props.row.name;
});
const nameLooksLikeRefno = computed(() => {
  const id = props.row.id;
  const name = rawDisplayName.value;
  return !!id && !!name && (name === id || name === id.replace('_', '/'));
});

const diffBadge = computed(() => {
  if (!props.diffStatus) return null;
  if (props.diffStatus === 'added') return { label: '增', cls: 'bg-success-subtle text-success border-transparent' };
  if (props.diffStatus === 'deleted') return { label: '删', cls: 'bg-danger-subtle text-danger border-transparent' };
  return { label: '改', cls: 'bg-warning-subtle text-warning border-transparent' };
});

/**
 * 幽灵行有两种：B 版把它删了（徽章「删」），或它在 B 版还在、B 版之后又被删了（徽章仍是「增 / 改」）。
 * 后者行尾标「当前已不在」，别让用户以为这次对比把它删了。
 */
const ghostMissingOnly = computed(() => props.ghost === true && props.diffStatus !== 'deleted');
const ghostSuffix = computed(() => (ghostMissingOnly.value ? '(当前已不在)' : '(已删除)'));

const ghostTitle = computed(() => {
  if (!props.ghost) return undefined;
  const base = ghostMissingOnly.value
    ? '该构件在版本 B 里还在、当前模型里已不在（之后被删）：仅展示，不可定位 3D'
    : '已删除节点：仅展示，不可定位 3D';
  return props.ghostUnplaced ? `${base}；原父节点未知，挂载于根节点下` : base;
});

/** 显示名称：PDMS 节点显示为 "NOUN NAME"，为空时用 refno 兜底 */
const displayName = computed(() => {
  const name = rawDisplayName.value;
  const fallback = fallbackRefnoLabel(props.row.id);
  const type = String(props.row.type || '').trim();

  if (!name || nameLooksLikeRefno.value) return fallback;
  if (!type || type === 'WORL') return name;
  if (name.toUpperCase().startsWith(`${type.toUpperCase()} `)) return name;
  return `${type} ${name}`;
});
const isNameFallback = computed(() => !rawDisplayName.value || nameLooksLikeRefno.value);

// hover 状态管理
const isHovering = ref(false);
const showEyeIcon = ref(false);
let hoverTimer: number | null = null;

function onMouseEnter() {
  isHovering.value = true;
  // 清除之前的定时器
  if (hoverTimer !== null) {
    clearTimeout(hoverTimer);
  }
  // 设置 0.5 秒延迟显示 eye 图标
  hoverTimer = window.setTimeout(() => {
    if (isHovering.value) {
      showEyeIcon.value = true;
    }
  }, 500);
}

function onMouseLeave() {
  isHovering.value = false;
  showEyeIcon.value = false;
  // 清除定时器
  if (hoverTimer !== null) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
}

function onToggleExpand(ev: MouseEvent) {
  ev.stopPropagation();
  emit('toggle-expand', props.row.id);
}

/**
 * 加载中可以停（用户 2026-11-11 定）：这一行在转圈、而且转的是「显示这个节点」（有加载会话、此刻能停）时，
 * 行尾这颗按钮就是「停」。重新生成、别的处理占着这一行时不能停，照旧是禁用的转圈。
 */
const loadSession = computed(() => (props.loading ? modelLoadSessionView(props.row.id) : null));
const canStopLoading = computed(() => props.loading === true && loadSession.value?.stoppable === true);
const loadingTitle = computed(() => {
  if (!props.loading) return undefined;
  if (canStopLoading.value) return '加载中，点一下停：停掉剩下的批次，把这次画出来的收起来；已取到的数据留着，再点眼睛会更快';
  if (loadSession.value?.stopping) return '正在停…';
  return '正在处理，这一步不能停';
});

function onToggleVisible(ev: MouseEvent) {
  ev.stopPropagation();
  // 加载中：这颗按钮是「停」（不能停时按钮本来就是禁用的）
  if (props.loading) {
    if (canStopLoading.value) emit('stop-loading', props.row.id);
    return;
  }
  emit('toggle-visible', props.row.id, !isVisible.value);
}

function onSelect(ev: MouseEvent) {
  emit('select', props.index, ev);
}

function onContext(ev: MouseEvent) {
  ev.preventDefault();
  ev.stopPropagation();
  emit('context', props.row.id, ev);
}

// ---------------------------------------------------------------------------
// 行尾状态图标：生成状态只在库边界行（`row.dbBoundary`，通常是 SITE）或核对过的行上查；
// 虚拟滚动复用组件实例，dbnum 变了要把旧库的「在看」计数放掉再挂新库。
// ---------------------------------------------------------------------------
const dbStatusStore = useGenModelV1DbnumStatus();
// 节点一级（方案 C2）：这一行的节点装进过场景，就画它自己的新旧（已加载节点表），库一级的说法退到提示的后一行
const nodeStatusStore = useLoadedNodeStatus();
const nodeStatus = computed(() => (props.ghost ? null : nodeStatusStore.view(props.row.id)));
const statusDbnum = computed(() =>
  !props.ghost
  && (props.row.dbBoundary === true || !!props.rvmStatus || !!props.rvmIncremental || !!nodeStatus.value)
  && typeof props.row.dbnum === 'number'
    ? props.row.dbnum
    : null
);
let releaseDbStatus: (() => void) | null = null;
watch(statusDbnum, (dbnum) => {
  releaseDbStatus?.();
  releaseDbStatus = dbnum === null ? null : dbStatusStore.acquire(dbnum);
}, { immediate: true });
const dbStatus = computed(() => (statusDbnum.value === null ? null : dbStatusStore.view(statusDbnum.value)));
/** 图标按节点自己的结论画；节点说不出结论（没装过 / 核对中 / 未知 / 未跟踪）时沿用库一级的圆点 */
const generationKind = computed(() => nodeStatus.value?.iconKind ?? dbStatus.value?.kind ?? null);
const statusTitle = computed(() => {
  // 先写节点、再写库：各自可能分几行（结论 / 说明 / 三枚水位）
  const gen = [nodeStatus.value?.title, dbStatus.value?.title].filter(Boolean).join('\n');
  // 「点击重查」另起一行
  if (!props.rvmStatus && !props.rvmIncremental) return gen ? `${gen}\n点击重查` : undefined;
  const rvm = rvmBadgeTitle(props.rvmStatus, props.rvmIncremental).replace(/\n(点击查看结果|右键「核对 RVM」校验)$/, '');
  const action = props.rvmStatus ? '点击查看结果' : '右键「核对 RVM」校验';
  return [rvm, gen, action].filter(Boolean).join('\n');
});
/** 核对过就打开结果；没核对过就重查——装过的节点重问它自己（会连带重拉库状态），没装过的只重查库 */
function onStatusClick() {
  if (props.rvmStatus) emit('rvm-status', props.rvmStatus.refno);
  else if (nodeStatus.value) nodeStatusStore.recheck(props.row.id);
  else if (statusDbnum.value !== null) dbStatusStore.refresh(statusDbnum.value);
}
/** 这个节点下还有没有模型的部分（方案 B3：上次选了只显示已有的 / 后端没做完 / 中途停了）：行上给「生成」接着补齐 */
const pendingFill = computed(() => (props.ghost ? null : pendingGenerationFillView(props.row.id)));
/** 这个库的「更新到最新」走到哪了（方案 C3）：在排队 / 在跑时按钮写「更新中」并禁用，提示里是进度或上一次没成的原因 */
const updateState = computed(() => (
  nodeStatus.value?.action === 'update' && statusDbnum.value !== null ? updateToLatestView(statusDbnum.value) : null
));
/**
 * 节点状态给的动作按钮。「生成」和上面那颗「生成」（这一页里没补完留下的）是同一件事：那一颗在的时候这一颗不出。
 */
const nodeAction = computed(() => {
  const action = nodeStatus.value?.action ?? null;
  return action === 'generate' && pendingFill.value ? null : action;
});
/** 两种「更新」（库一级、节点一级）按钮上的字和颜色一样，做的事不同 */
const nodeActionIsUpdate = computed(() => nodeAction.value === 'update' || nodeAction.value === 'update-node');
const nodeActionLabel = computed(() => {
  if (nodeAction.value === 'update') return updateState.value?.label ?? '更新';
  // 节点一级的更新走显示流程：做的时候这一行在转圈
  if (nodeAction.value === 'update-node') return props.loading ? '更新中' : '更新';
  return nodeAction.value === 'generate' ? '生成' : '重载';
});
const nodeActionTitle = computed(() => {
  if (nodeAction.value === 'generate') {
    return '生成：把这个节点下没有模型的单元生成出来并显示（不重算已有的）；单元多时先问一声，做完一块显示一块';
  }
  if (nodeAction.value === 'update-node') {
    return '更新：让后端把这个节点下的单元按库文件最新会话重新生成（已是最新的跳过），做完自动换到屏幕上；'
      + '只动这个节点。单元多、或者有单元被删要先清后生成时，先说明再问';
  }
  if (nodeAction.value !== 'update') return '重载：按库里最新的模型记录替换场景里的这个节点（不重新生成）';
  const hint = '更新到最新：让后端把这个库的新会话入库并重新生成受影响的模型；做完会提示，点「重载」才换到场景里';
  return updateState.value ? `${updateState.value.title}\n${hint}` : hint;
});

// 组件卸载时清理定时器与库状态引用计数
onUnmounted(() => {
  if (hoverTimer !== null) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  releaseDbStatus?.();
  releaseDbStatus = null;
});
</script>

<template>
  <div :class="cn(
         'flex h-8 items-center rounded-sm pr-2 text-sm transition-colors',
         selected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'
       )"
    data-testid="model-tree-row"
    :data-node-type="row.type"
    :data-refno="row.refno || row.id"
    :data-selected="selected ? 'true' : 'false'"
    :data-diff-status="diffStatus || undefined"
    :data-ghost="ghost ? 'true' : undefined"
    :title="ghostTitle ?? rowTitle ?? fullNameTitle"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
    @mousedown.prevent="onSelect"
    @contextmenu="onContext">
    <!-- Indentation guides -->
    <div class="flex h-full shrink-0 select-none">
      <span v-for="n in safeDepth" :key="n" class="h-full border-r border-border/40" :style="{ width: `${INDENT_PX}px` }" />
    </div>

    <div class="flex min-w-0 flex-1 items-center gap-1.5 pl-1">
      <button v-if="row.hasChildren && !ghost" type="button" class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/70 hover:bg-muted hover:text-foreground" @mousedown.stop @click="onToggleExpand">
        <ChevronDown v-if="expanded" class="h-3.5 w-3.5" />
        <ChevronRight v-else class="h-3.5 w-3.5" />
      </button>
      <span v-else class="h-5 w-5 shrink-0" />

      <CircleMinus v-if="ghost" class="h-4 w-4 shrink-0 text-muted-foreground/60" />
      <component :is="groupIcon"
        v-else-if="groupIcon"
        class="h-4 w-4 shrink-0 text-muted-foreground"
        data-testid="model-tree-group-icon" />
      <img v-else-if="typeIconUrl" :src="typeIconUrl" class="h-4 w-4 shrink-0 opacity-80" :alt="row.type" />
      <span v-else class="h-4 w-4 shrink-0" />

      <div class="min-w-0 flex-1 leading-none">
        <div v-if="ghost" class="truncate text-xs text-muted-foreground/70">
          <span class="line-through">{{ displayName }}</span> {{ ghostSuffix }}
        </div>
        <div v-else class="truncate" :class="isNameFallback ? 'text-muted-foreground text-xs' : 'font-medium'">{{ displayName }}</div>
      </div>

      <!-- 规则成员行只画「规则」角标：它同样是二级成员（secondary），但没有经由的 GPITEM，两者不重复显示 -->
      <span v-if="row.rule && !ghost"
        class="inline-flex shrink-0 items-center rounded border border-amber-500/40 px-1 text-[10px] leading-4 text-amber-600 dark:text-amber-400"
        data-testid="model-tree-rule-badge"
        :title="ruleTitle">
        规则
      </span>

      <span v-if="row.secondary && !row.rule && !ghost"
        class="inline-flex shrink-0 items-center rounded border border-sky-500/40 px-1 text-[10px] leading-4 text-sky-600 dark:text-sky-400"
        data-testid="model-tree-secondary-badge"
        :title="secondaryTitle">
        引用
      </span>

      <span v-if="(row.unresolvedCount ?? 0) > 0"
        class="inline-flex shrink-0 items-center rounded border border-amber-500/40 px-1 text-[10px] leading-4 text-amber-600 dark:text-amber-400"
        data-testid="model-tree-unresolved-badge"
        :title="`${row.unresolvedCount} 个成员的 GPREF 解析不到（引用丢失 / 所在库不在本 MDB / 目标已删除），不在树里显示`">
        {{ row.unresolvedCount }} 个成员不可解析
      </span>

      <span v-if="row.groupViewUnsupported"
        class="inline-flex shrink-0 items-center rounded border border-amber-500/40 px-1 text-[10px] leading-4 text-amber-600 dark:text-amber-400"
        data-testid="model-tree-group-view-unsupported-badge"
        title="当前 gen-model 不支持分组解析视图（resolved=1）：下面列的是 GPITEM 槽本身，不是它引用的元素；升级 gen-model 后显示成员">
        后端未支持分组解析
      </span>

      <span v-if="diffBadge"
        class="inline-flex shrink-0 items-center rounded border px-1 text-[10px] leading-4"
        :class="diffBadge.cls"
        data-testid="model-tree-diff-badge">
        {{ diffBadge.label }}
      </span>

      <span v-if="!diffStatus && (diffCount ?? 0) > 0"
        class="inline-flex shrink-0 items-center rounded-full bg-muted px-1.5 text-[10px] leading-4 text-muted-foreground"
        :title="`后代包含 ${diffCount} 处变更`"
        data-testid="model-tree-diff-count">
        {{ diffCount }}
      </span>

      <button v-if="!ghost && pendingFill" type="button"
        class="inline-flex h-5 shrink-0 items-center rounded border border-emerald-600/50 px-1 text-[10px] leading-4 text-emerald-700 hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-70"
        :title="pendingFill.title"
        :disabled="pendingFill.busy"
        data-testid="model-tree-node-fill"
        :data-busy="pendingFill.busy ? 'true' : undefined"
        @mousedown.stop
        @click.stop="emit('node-action', row.id, 'generate')">
        {{ pendingFill.label }}
      </button>
      <button v-if="!ghost && nodeAction" type="button"
        class="inline-flex h-5 shrink-0 items-center rounded border px-1 text-[10px] leading-4 disabled:cursor-wait disabled:opacity-70"
        :class="nodeActionIsUpdate
          ? 'border-amber-500/50 text-amber-700 hover:bg-amber-50'
          : nodeAction === 'generate'
            ? 'border-emerald-600/50 text-emerald-700 hover:bg-emerald-50'
            : 'border-sky-500/50 text-sky-700 hover:bg-sky-50'"
        :title="nodeActionTitle"
        :disabled="updateState?.busy === true || nodeStatus?.checking === true || props.loading"
        data-testid="model-tree-node-action"
        :data-action="nodeAction"
        :data-busy="updateState?.busy || (nodeAction === 'update-node' && props.loading) ? 'true' : undefined"
        @mousedown.stop
        @click.stop="emit('node-action', row.id, nodeAction)">
        {{ nodeActionLabel }}
      </button>
      <button v-if="!ghost && (rvmStatus || rvmIncremental || dbStatus || nodeStatus)" type="button"
        class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm hover:bg-muted"
        :title="statusTitle"
        data-testid="model-tree-status"
        :data-rvm-status="rvmStatus?.verdict"
        :data-db-status="dbStatus?.kind"
        :data-node-status="nodeStatus ? (nodeStatus.verdict ?? 'checking') : undefined"
        :data-rvm-outdated="rvmIncremental ? 'true' : undefined"
        @mousedown.stop
        @click.stop="onStatusClick">
        <ModelTreeStatusIcon :verdict="rvmStatus?.verdict ?? null" :generation="generationKind" :outdated="!!rvmIncremental" />
      </button>
      <!-- 眼睛；加载中是转圈。这个节点的加载能停时转圈中间有个小方块，点一下 = 停（2026-11-11）。它保持是这一行最后一个按钮 -->
      <button v-if="!ghost" type="button" class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus:opacity-100 transition-opacity disabled:cursor-wait disabled:opacity-100"
        :class="!isVisible ? 'opacity-100 text-destructive/70' : showEyeIcon || props.loading ? 'opacity-100' : 'opacity-0'"
        :disabled="props.loading && !canStopLoading"
        :title="loadingTitle"
        data-testid="model-tree-eye"
        :data-loading="props.loading ? 'true' : undefined"
        :data-stoppable="canStopLoading ? 'true' : undefined"
        @mousedown.stop
        @click="onToggleVisible">
        <span v-if="props.loading" class="relative inline-flex h-3.5 w-3.5 items-center justify-center">
          <LoaderCircle class="h-3.5 w-3.5 animate-spin" />
          <Square v-if="canStopLoading" class="absolute h-1.5 w-1.5 fill-current" data-testid="model-tree-stop-icon" />
        </span>
        <Eye v-if="isVisible" class="h-3.5 w-3.5" />
        <EyeOff v-else-if="!props.loading" class="h-3.5 w-3.5" />
      </button>
    </div>
  </div>
</template>
