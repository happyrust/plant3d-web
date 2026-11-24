<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';

import { useQueryClient } from '@tanstack/vue-query';
import { ArrowLeft, ArrowRight } from 'lucide-vue-next';

import type { PdmsUiAttrResponse } from '@/api/genModelPdmsAttrApi';
import type { SelectionNavEntry } from '@/utils/selectionHistory';

import { useModelProjects } from '@/composables/useModelProjects';
import { useSelectionHistory, type SelectionCameraPose } from '@/composables/useSelectionHistory';

type Entry = SelectionNavEntry<SelectionCameraPose>;

/** 右键列表最多露出几条：围着当前项取，靠边时向另一侧补齐。 */
const MENU_ROWS = 15;

const { snapshot, navigate, clear } = useSelectionHistory();
const queryClient = useQueryClient();
const { currentProject } = useModelProjects();

const backTarget = computed<Entry | null>(() => {
  const { entries, cursor } = snapshot.value;
  return cursor !== null && cursor > 0 ? entries[cursor - 1] ?? null : null;
});
const forwardTarget = computed<Entry | null>(() => {
  const { entries, cursor } = snapshot.value;
  return cursor !== null ? entries[cursor + 1] ?? null : null;
});

/**
 * 选中过的构件的显示名：属性查询（`['pdms','ui-attr',refno,'current']`）一落地就记下。查询缓存本身不是响应式的，
 * 点得比属性回来快时，历史条目要等这里补上名字才不停在 refno 上。
 */
const names = reactive(new Map<string, string>());

function rememberName(key: readonly unknown[], data: unknown) {
  if (key[0] !== 'pdms' || key[1] !== 'ui-attr' || key[3] !== 'current' || typeof key[2] !== 'string') return;
  const res = data as PdmsUiAttrResponse | undefined;
  if (res?.success && res.full_name) names.set(key[2], String(res.full_name));
}

for (const query of queryClient.getQueryCache().findAll({ queryKey: ['pdms', 'ui-attr'] })) {
  rememberName(query.queryKey, query.state.data);
}
const offQueryCache = queryClient.getQueryCache().subscribe((event) => {
  if (event.type === 'updated') rememberName(event.query.queryKey, event.query.state.data);
});

function nameOf(refno: string): string {
  return names.get(refno) ?? refno;
}

function labelOf(entry: Entry): string {
  const rest = entry.refnos.length - 1;
  return rest > 0 ? `${nameOf(entry.active)} +${rest}` : nameOf(entry.active);
}

function hint(verb: '后退' | '前进', target: Entry | null): string {
  const key = verb === '后退' ? 'Alt+←' : 'Alt+→';
  return target ? `${verb}到 ${labelOf(target)} (${key})\n右键：最近位置` : `没有可${verb}的位置`;
}

// ---------------------------------------------------------------- 右键最近位置列表

const menuOpen = ref(false);
const menuPos = ref({ x: 0, y: 0 });
const menuRef = ref<HTMLElement | null>(null);

const menuRows = computed(() => {
  const { entries, cursor } = snapshot.value;
  if (cursor === null) return [];
  const len = entries.length;
  const start = len <= MENU_ROWS ? 0 : Math.min(Math.max(0, cursor - Math.floor(MENU_ROWS / 2)), len - MENU_ROWS);
  const end = Math.min(len, start + MENU_ROWS);
  const rows: { index: number; entry: Entry; current: boolean; forward: boolean }[] = [];
  for (let i = end - 1; i >= start; i--) {
    rows.push({ index: i, entry: entries[i]!, current: i === cursor, forward: i > cursor });
  }
  return rows;
});

function openMenu(event: MouseEvent) {
  if (snapshot.value.entries.length === 0) return;
  menuPos.value = { x: event.clientX, y: event.clientY + 4 };
  menuOpen.value = true;
}

function jump(index: number) {
  menuOpen.value = false;
  navigate({ jump: index });
}

function onDocPointerDown(event: PointerEvent) {
  if (!menuOpen.value) return;
  if (menuRef.value?.contains(event.target as Node)) return;
  menuOpen.value = false;
}

// ---------------------------------------------------------------- 快捷键与鼠标侧键

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && menuOpen.value) {
    menuOpen.value = false;
    return;
  }
  if (event.defaultPrevented || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  if (isEditableTarget(event.target)) return;
  // 到头了也要吞掉：否则连按后退走到底的下一下就是浏览器后退，整页离开
  event.preventDefault();
  navigate(event.key === 'ArrowLeft' ? 'back' : 'forward');
}

/** 鼠标侧键：3 = 后退，4 = 前进。mousedown / mouseup 都拦掉，浏览器才不会自己翻页。 */
function onSideButton(event: MouseEvent) {
  if (event.button !== 3 && event.button !== 4) return;
  event.preventDefault();
  if (event.type === 'mouseup') navigate(event.button === 3 ? 'back' : 'forward');
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('mousedown', onSideButton);
  window.addEventListener('mouseup', onSideButton);
  document.addEventListener('pointerdown', onDocPointerDown, { capture: true });
});

onUnmounted(() => {
  offQueryCache();
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('mousedown', onSideButton);
  window.removeEventListener('mouseup', onSideButton);
  document.removeEventListener('pointerdown', onDocPointerDown, { capture: true });
});

// 换了工程，旧工程的构件在新工程里没有意义
watch(
  () => currentProject.value?.id ?? null,
  (next, prev) => {
    if (next !== prev) {
      menuOpen.value = false;
      clear();
    }
  },
);
</script>

<template>
  <div class="selection-history-group" data-testid="selection-history">
    <button type="button"
      class="selection-history-btn"
      data-testid="selection-history-back"
      :disabled="!backTarget"
      :title="hint('后退', backTarget)"
      @click="navigate('back')"
      @contextmenu.prevent="openMenu">
      <ArrowLeft class="selection-history-icon" />
    </button>
    <button type="button"
      class="selection-history-btn"
      data-testid="selection-history-forward"
      :disabled="!forwardTarget"
      :title="hint('前进', forwardTarget)"
      @click="navigate('forward')"
      @contextmenu.prevent="openMenu">
      <ArrowRight class="selection-history-icon" />
    </button>

    <Teleport to="body">
      <div v-if="menuOpen"
        ref="menuRef"
        class="selection-history-menu"
        data-testid="selection-history-menu"
        :style="{ left: `${menuPos.x}px`, top: `${menuPos.y}px` }"
        @contextmenu.prevent>
        <div class="selection-history-menu__title">最近位置</div>
        <button v-for="row in menuRows"
          :key="row.index"
          type="button"
          class="selection-history-menu__row"
          :class="{ 'selection-history-menu__row--current': row.current }"
          :title="row.entry.active"
          @click="jump(row.index)">
          <span class="selection-history-menu__label">{{ labelOf(row.entry) }}</span>
          <span class="selection-history-menu__hint">{{ row.current ? '当前' : row.forward ? '前进' : '' }}</span>
        </button>
        <div class="selection-history-menu__footer">Alt+← / Alt+→ · 鼠标侧键</div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.selection-history-group {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  flex-shrink: 0;
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  overflow: hidden;
  background: hsl(var(--background));
}

.selection-history-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 22px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  color: hsl(var(--foreground));
  transition: background-color 0.15s ease, color 0.15s ease;
}

.selection-history-btn + .selection-history-btn {
  border-left: 1px solid hsl(var(--border));
}

.selection-history-btn:hover:not(:disabled) {
  background-color: hsl(var(--muted));
}

.selection-history-btn:active:not(:disabled) {
  background-color: hsl(var(--accent));
}

.selection-history-btn:disabled {
  color: hsl(var(--muted-foreground));
  opacity: 0.5;
  cursor: default;
}

.selection-history-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.selection-history-menu {
  position: fixed;
  z-index: 3000;
  display: flex;
  flex-direction: column;
  min-width: 260px;
  max-width: 420px;
  padding: 6px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--background));
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.16);
}

.selection-history-menu__title,
.selection-history-menu__footer {
  padding: 4px 8px;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}

.selection-history-menu__footer {
  margin-top: 4px;
  border-top: 1px solid hsl(var(--border));
}

.selection-history-menu__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: hsl(var(--foreground));
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.selection-history-menu__row:hover {
  background-color: hsl(var(--muted));
}

.selection-history-menu__row--current {
  background-color: hsl(var(--accent));
  font-weight: 600;
}

.selection-history-menu__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selection-history-menu__hint {
  flex-shrink: 0;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
</style>
