<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { Search, ChevronDown, ChevronRight, History } from 'lucide-vue-next';

import Badge from '@/components/ui/Badge.vue';
import Input from '@/components/ui/Input.vue';
import ScrollArea from '@/components/ui/ScrollArea.vue';
import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { useToolStore } from '@/composables/useToolStore';
import { cn } from '@/lib/utils';
import { requestModelVersionInspect } from '@/utils/modelUnitVersionCompare';

const sel = useSelectionStore();
const toolStore = useToolStore();

/**
 * 标题栏「历史」（ADR 0066 入口之三，与模型树右键「查看历史版本」同一条路）：把当前选中的节点交给「节点版本」面板，
 * 面板自己解它所属的最小交付单元、按类型定对比范围。已删除的幽灵行也能查——它的历史正是要看的东西。
 */
function inspectSelectedHistory(): void {
  const refno = sel.selectedRefno.value;
  if (!refno) return;
  requestModelVersionInspect(refno);
  ensurePanelAndActivate('modelVersionCompare');
}

// useQuery 会在 selectedRefno.value 变化时自动触发，
// 且具备缓存机制，因此无需手动 watch 调用 loadProperties。

const searchQuery = ref('');

// 折叠状态
const collapsedGroups = ref<Set<string>>(new Set());

type PropertyType = 'string' | 'number' | 'boolean' | 'object' | 'null';

type PropertyRow = {
  key: string;
  value: unknown;
  type: PropertyType;
  displayValue: string;
  /** 鼠标悬停展示的原始值（引用属性解析为 full_name 后，tooltip 仍保留参考号） */
  title?: string;
};

type PropertyGroup = {
  id: string;
  name: string;
  rows: PropertyRow[];
};

// 通用属性优先排序列表（按顺序）
const GENERAL_PRIORITY_ORDER = ['NAME', 'REFNO', 'TYPE', 'OWNER'];

// 通用属性键名列表（基础属性）
const GENERAL_KEYS = new Set([
  'NAME', 'TYPE', 'REFNO', 'OWNER', 'LOCK', 'BUILT', 'CREF',
  'DBREF', 'FLNN', 'DLEVEL', 'DESCRIPTION', 'PURPOSE', 'FUNCTION',
]);

// 通用属性排序函数
function sortGeneralProperties(rows: PropertyRow[]): PropertyRow[] {
  const priorityMap = new Map(GENERAL_PRIORITY_ORDER.map((key, idx) => [key, idx]));

  return [...rows].sort((a, b) => {
    const aKey = a.key.toUpperCase();
    const bKey = b.key.toUpperCase();
    const aPriority = priorityMap.get(aKey);
    const bPriority = priorityMap.get(bKey);

    // 优先级属性排在前面
    if (aPriority !== undefined && bPriority !== undefined) {
      return aPriority - bPriority;
    }
    if (aPriority !== undefined) return -1;
    if (bPriority !== undefined) return 1;

    // 其他属性按字母排序
    return aKey.localeCompare(bKey);
  });
}

// UDA 属性前缀
const UDA_PREFIXES = [':'];

function getPropertyType(v: unknown): PropertyType {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  return 'object';
}

function formatValue(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function formatRefnoDisplay(v: unknown): string {
  if (typeof v !== 'string') return formatValue(v);

  const raw = v.trim();
  if (!raw) return raw;

  const normalized = raw.replace(/^=/, '').trim();
  const match = normalized.match(/^(\d+)[_/:](\d+)$/) ?? normalized.match(/^(\d+)\/(\d+)$/);

  if (!match) return raw;
  return `=${match[1]}/${match[2]}`;
}

function classifyProperty(key: string): 'general' | 'component' | 'uda' {
  // UDA 属性通常以 : 开头
  if (UDA_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return 'uda';
  }
  // 通用属性
  if (GENERAL_KEYS.has(key.toUpperCase())) {
    return 'general';
  }
  // 其余为元件属性
  return 'component';
}

// 引用类属性（值形如 "pe:2013286704_661"，例如 OWNER/REFNO）的 full_name 由后端 ui-attr
// 响应直接给出（键为属性名），前端只读不再逐个回查。
const refFullNames = sel.refFullNames;

const groups = computed<PropertyGroup[]>(() => {
  const data = sel.propertiesData.value;
  if (!data) return [];

  const query = searchQuery.value.toLowerCase().trim();
  const displayMode = toolStore.attributeDisplayMode.value;

  const general: PropertyRow[] = [];
  const component: PropertyRow[] = [];
  const uda: PropertyRow[] = [];

  Object.keys(data)
    .sort((a, b) => a.localeCompare(b))
    .forEach((key) => {
      const isRefno = key.toUpperCase() === 'REFNO';
      const rawValue = data[key];
      const resolvedFullName = refFullNames.value?.[key];
      const baseDisplay = isRefno ? formatRefnoDisplay(rawValue) : formatValue(rawValue);
      const row: PropertyRow = {
        key,
        value: rawValue,
        type: getPropertyType(rawValue),
        displayValue: resolvedFullName ?? baseDisplay,
        title: resolvedFullName ? `${resolvedFullName}\n${formatValue(rawValue)}` : undefined,
      };

      // 搜索过滤
      if (query) {
        const matchKey = row.key.toLowerCase().includes(query);
        const matchValue = row.displayValue.toLowerCase().includes(query);
        if (!matchKey && !matchValue) return;
      }

      const category = classifyProperty(key);
      if (category === 'general') {
        general.push(row);
      } else if (category === 'uda') {
        uda.push(row);
      } else {
        component.push(row);
      }
    });

  const result: PropertyGroup[] = [];

  // 根据显示模式过滤
  if (displayMode === 'all' || displayMode === 'general') {
    if (general.length > 0) {
      result.push({ id: 'general', name: '通用属性', rows: sortGeneralProperties(general) });
    }
  }
  if (displayMode === 'all' || displayMode === 'component') {
    if (component.length > 0) {
      result.push({ id: 'component', name: '元件属性', rows: component });
    }
  }
  if (displayMode === 'all' || displayMode === 'uda') {
    if (uda.length > 0) {
      result.push({ id: 'uda', name: 'UDA属性', rows: uda });
    }
  }

  return result;
});

const stats = computed(() => {
  const data = sel.propertiesData.value;
  if (!data) return { total: 0, filtered: 0 };
  const total = Object.keys(data).length;
  const filtered = groups.value.reduce((sum, g) => sum + g.rows.length, 0);
  return { total, filtered };
});

/** gen-model-v1 直读源的诊断提示（旧后端没有这一格，返回 null 不渲染） */
const diagnosticsHint = computed<{ text: string; title: string } | null>(() => {
  const d = sel.propertiesDiagnostics.value;
  if (!d) return null;
  const undecoded = d.undecoded ?? [];
  const conflicts = d.shape_conflicts ?? [];
  if (undecoded.length === 0 && conflicts.length === 0 && d.complete !== false) return null;
  const parts: string[] = [];
  if (undecoded.length > 0) parts.push(`${undecoded.length} 个属性未解码`);
  if (conflicts.length > 0) parts.push(`${conflicts.length} 个属性形状与声明不符`);
  if (d.complete === false && parts.length === 0) parts.push('属性表不完整');
  const source = d.source ? `${d.source} 直读` : '直读';
  return {
    text: `${source}：${parts.join('，')}`,
    title: [
      undecoded.length > 0 ? `未解码：${undecoded.join(', ')}` : '',
      conflicts.length > 0 ? `形状冲突：${conflicts.join(', ')}` : '',
    ].filter(Boolean).join('\n'),
  };
});

function toggleGroup(groupId: string) {
  if (collapsedGroups.value.has(groupId)) {
    collapsedGroups.value.delete(groupId);
  } else {
    collapsedGroups.value.add(groupId);
  }
}

function isGroupCollapsed(groupId: string): boolean {
  return collapsedGroups.value.has(groupId);
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 头部 -->
    <div class="flex-shrink-0 border-b border-border px-3 py-2">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1.5">
          <span class="text-xs font-medium text-foreground">属性</span>
          <Badge variant="secondary" class="text-[10px]">只读</Badge>
        </div>
        <div v-if="sel.selectedRefno.value" class="flex min-w-0 max-w-[70%] items-center gap-1">
          <Badge variant="outline"
            class="min-w-0 truncate text-[10px]"
            :class="sel.fullName.value ? '' : 'font-mono'"
            :title="sel.fullName.value ? `${sel.fullName.value}\n${sel.selectedRefno.value}` : sel.selectedRefno.value">
            {{ sel.fullName.value || sel.selectedRefno.value }}
          </Badge>
          <button type="button"
            class="inline-flex shrink-0 items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-foreground hover:bg-muted/60"
            :title="`查看 ${sel.selectedRefno.value} 的版本历史（属性变化时间线 + 模型对比）`"
            data-testid="properties-history"
            @click="inspectSelectedHistory">
            <History class="h-3 w-3" />历史
          </button>
        </div>
        <span v-else class="text-[10px] text-muted-foreground">未选择</span>
      </div>
    </div>

    <!-- 版本钉住（版本对比里在三维点了 A / B 隔离图层的构件）：下面列的是那一版的属性，不是当前会话的 -->
    <div v-if="sel.selectedVersionPin.value"
      class="flex-shrink-0 border-b border-amber-200 bg-amber-50/80 px-3 py-1.5 text-[11px] text-amber-900"
      :data-sesno="sel.selectedVersionPin.value.sesno"
      data-testid="properties-version-pin-notice">
      属性来自版本 <span class="font-semibold">{{ sel.selectedVersionPin.value.label }} · sesno {{ sel.selectedVersionPin.value.sesno }}</span>
      （版本对比里点到的那一版，不是当前会话）
    </div>

    <!-- 搜索框 -->
    <div v-if="sel.propertiesData.value" class="flex-shrink-0 border-b border-border px-2 py-1.5">
      <div class="relative">
        <Search class="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="searchQuery"
          type="text"
          placeholder="筛选属性..."
          class="h-7 pl-7 text-xs" />
      </div>
      <div v-if="stats.total > 0" class="mt-1 text-[10px] text-muted-foreground">
        {{ stats.filtered }}/{{ stats.total }}
      </div>
    </div>

    <!-- 已删除构件（模型版本差异模式里的幽灵行）：当前会话里没有它，不拉属性，也不当错误 -->
    <div v-if="sel.selectedIsDeleted.value"
      class="flex flex-1 items-center justify-center p-3"
      data-testid="properties-deleted-notice">
      <div class="rounded bg-muted px-3 py-2 text-xs text-muted-foreground">
        该构件已删除，属性见底部属性历史对比
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-else-if="sel.propertiesLoading.value" class="flex flex-1 items-center justify-center">
      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <div class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span>加载中...</span>
      </div>
    </div>

    <!-- 错误状态 -->
    <div v-else-if="sel.propertiesError.value" class="flex flex-1 items-center justify-center p-3">
      <div class="rounded bg-destructive/10 px-3 py-2 text-xs text-destructive">
        {{ sel.propertiesError.value }}
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else-if="!sel.propertiesData.value || groups.length === 0" class="flex flex-1 items-center justify-center">
      <span class="text-xs text-muted-foreground">
        {{ !sel.selectedRefno.value ? '点击选择对象' : searchQuery ? '无匹配属性' : '无数据' }}
      </span>
    </div>

    <!-- 分组属性列表 -->
    <ScrollArea v-else class="min-h-0 flex-1">
      <div class="divide-y divide-border">
        <div v-for="group in groups" :key="group.id">
          <!-- 分组头部 -->
          <button class="flex w-full items-center gap-1.5 bg-muted/50 px-2 py-1.5 text-left transition-colors hover:bg-muted"
            @click="toggleGroup(group.id)">
            <component :is="isGroupCollapsed(group.id) ? ChevronRight : ChevronDown"
              class="h-3.5 w-3.5 text-muted-foreground" />
            <span class="text-xs font-medium text-foreground">{{ group.name }}</span>
            <Badge variant="secondary" class="ml-auto text-[10px]">
              {{ group.rows.length }}
            </Badge>
          </button>

          <!-- 分组内容 -->
          <table v-if="!isGroupCollapsed(group.id)" class="w-full">
            <tbody>
              <tr v-for="row in group.rows"
                :key="row.key"
                :class="cn(
                  'group border-b border-border/30 last:border-b-0',
                  'hover:bg-accent/50'
                )">
                <!-- 属性名 -->
                <td class="w-[45%] truncate border-r border-border/30 px-2 py-1 align-top text-xs text-muted-foreground"
                  :title="row.key">
                  {{ row.key }}
                </td>

                <!-- 属性值 -->
                <td class="px-2 py-1 align-top">
                  <div :class="cn(
                         'min-h-[20px] cursor-default truncate rounded px-1 text-xs leading-5',
                         row.type === 'null' && 'italic text-muted-foreground',
                         row.type === 'boolean' && (row.value ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'),
                         row.type === 'number' && 'text-blue-600 dark:text-blue-400',
                         row.type === 'string' && 'text-foreground',
                         row.type === 'object' && 'text-muted-foreground'
                       )"
                    :title="row.title ?? row.displayValue">
                    {{ row.displayValue }}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div v-if="diagnosticsHint"
        data-testid="properties-diagnostics-hint"
        class="border-t border-border/60 px-2 py-1 text-[10px] text-muted-foreground"
        :title="diagnosticsHint.title">
        {{ diagnosticsHint.text }}
      </div>
    </ScrollArea>
  </div>
</template>
