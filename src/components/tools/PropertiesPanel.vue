<script setup lang="ts">
import { computed, ref, nextTick, watch } from 'vue';
import { Search, ChevronDown, ChevronRight } from 'lucide-vue-next';

import Badge from '@/components/ui/Badge.vue';
import Input from '@/components/ui/Input.vue';
import ScrollArea from '@/components/ui/ScrollArea.vue';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { useToolStore } from '@/composables/useToolStore';
import { cn } from '@/lib/utils';

const sel = useSelectionStore();
const toolStore = useToolStore();

// 当 selectedRefno 变化时，自动加载属性（如果还没加载过）
watch(
  () => sel.selectedRefno.value,
  (refno) => {
    if (refno && !sel.propertiesData.value && !sel.propertiesLoading.value) {
      void sel.loadProperties(refno);
    }
  },
  { immediate: true }
);

const searchQuery = ref('');
const editingKey = ref<string | null>(null);
const editValue = ref<string>('');
const editInputRef = ref<HTMLInputElement | null>(null);

// 折叠状态
const collapsedGroups = ref<Set<string>>(new Set());

type PropertyType = 'string' | 'number' | 'boolean' | 'object' | 'null';

type PropertyRow = {
  key: string;
  value: unknown;
  type: PropertyType;
  displayValue: string;
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
      const row: PropertyRow = {
        key,
        value: data[key],
        type: getPropertyType(data[key]),
        displayValue: isRefno ? formatRefnoDisplay(data[key]) : formatValue(data[key]),
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

async function startEditing(row: PropertyRow) {
  if (row.type === 'object') return;
  editingKey.value = row.key;
  editValue.value = row.displayValue;
  await nextTick();
  editInputRef.value?.focus();
  editInputRef.value?.select();
}

function cancelEditing() {
  editingKey.value = null;
  editValue.value = '';
}

function confirmEditing(row: PropertyRow) {
  // TODO: 调用 API 保存
  console.log('Property edit:', row.key, '=', editValue.value);
  editingKey.value = null;
  editValue.value = '';
}

function handleKeydown(e: KeyboardEvent, row: PropertyRow) {
  if (e.key === 'Enter') {
    confirmEditing(row);
  } else if (e.key === 'Escape') {
    cancelEditing();
  }
}

function handleBlur(row: PropertyRow) {
  confirmEditing(row);
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 头部 -->
    <div class="flex-shrink-0 border-b border-border px-3 py-2">
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium text-foreground">属性</span>
        <Badge v-if="sel.selectedRefno.value" variant="outline" class="font-mono text-[10px]">
          {{ sel.selectedRefno.value }}
        </Badge>
        <span v-else class="text-[10px] text-muted-foreground">未选择</span>
      </div>
    </div>

    <!-- 搜索框 -->
    <div v-if="sel.propertiesData.value" class="flex-shrink-0 border-b border-border px-2 py-1.5">
      <div class="relative">
        <Search class="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          v-model="searchQuery"
          type="text"
          placeholder="筛选属性..."
          class="h-7 pl-7 text-xs"
        />
      </div>
      <div v-if="stats.total > 0" class="mt-1 text-[10px] text-muted-foreground">
        {{ stats.filtered }}/{{ stats.total }}
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="sel.propertiesLoading.value" class="flex flex-1 items-center justify-center">
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
          <button
            class="flex w-full items-center gap-1.5 bg-muted/50 px-2 py-1.5 text-left transition-colors hover:bg-muted"
            @click="toggleGroup(group.id)"
          >
            <component
              :is="isGroupCollapsed(group.id) ? ChevronRight : ChevronDown"
              class="h-3.5 w-3.5 text-muted-foreground"
            />
            <span class="text-xs font-medium text-foreground">{{ group.name }}</span>
            <Badge variant="secondary" class="ml-auto text-[10px]">
              {{ group.rows.length }}
            </Badge>
          </button>

          <!-- 分组内容 -->
          <table v-if="!isGroupCollapsed(group.id)" class="w-full">
            <tbody>
              <tr
                v-for="row in group.rows"
                :key="row.key"
                :class="cn(
                  'group border-b border-border/30 last:border-b-0',
                  'hover:bg-accent/50',
                  editingKey === row.key && 'bg-accent'
                )"
              >
                <!-- 属性名 -->
                <td
                  class="w-[45%] truncate border-r border-border/30 px-2 py-1 align-top text-xs text-muted-foreground"
                  :title="row.key"
                >
                  {{ row.key }}
                </td>

                <!-- 属性值 -->
                <td class="px-2 py-1 align-top">
                  <!-- 编辑模式 -->
                  <input
                    v-if="editingKey === row.key"
                    ref="editInputRef"
                    v-model="editValue"
                    :type="row.type === 'number' ? 'number' : 'text'"
                    class="h-5 w-full rounded border border-ring bg-background px-1 text-xs focus:outline-none"
                    @keydown="(e) => handleKeydown(e, row)"
                    @blur="handleBlur(row)"
                  />

                  <!-- 显示模式 -->
                  <div
                    v-else
                    :class="cn(
                      'min-h-[20px] cursor-text truncate rounded px-1 text-xs leading-5',
                      'transition-colors',
                      row.type !== 'object' && 'hover:bg-muted',
                      row.type === 'null' && 'italic text-muted-foreground',
                      row.type === 'boolean' && (row.value ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'),
                      row.type === 'number' && 'text-blue-600 dark:text-blue-400',
                      row.type === 'string' && 'text-foreground',
                      row.type === 'object' && 'cursor-default text-muted-foreground'
                    )"
                    :title="row.displayValue"
                    @click="startEditing(row)"
                  >
                    {{ row.displayValue }}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>
