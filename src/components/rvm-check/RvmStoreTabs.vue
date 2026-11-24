<script setup lang="ts" generic="T extends string">
/**
 * 一排页签，字号字重与核对面板左栏的「队列 / 增量待校验」一致。
 * 选中的那一个底下画一道线：用内阴影画，不用 `border-b-2`——本项目关了 Tailwind 的 preflight，
 * 按钮的 border-style 是 none，只给宽度画不出线。
 */
defineProps<{
  tabs: { id: T; label: string; count?: number | null }[];
  modelValue: T;
  /** 给读屏用的名字 */
  label: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [id: T] }>();
</script>

<template>
  <div class="flex items-center gap-3 text-xs" role="tablist" :aria-label="label">
    <button v-for="tab in tabs"
      :key="tab.id"
      type="button"
      role="tab"
      class="whitespace-nowrap px-0.5 py-1.5"
      :class="modelValue === tab.id ? 'font-semibold text-foreground shadow-[inset_0_-2px_0_hsl(var(--foreground))]' : 'text-muted-foreground hover:text-foreground'"
      :aria-selected="modelValue === tab.id"
      :data-tab="tab.id"
      data-testid="rvm-store-tab"
      @click="emit('update:modelValue', tab.id)">
      {{ tab.label }}<template v-if="tab.count != null"> ({{ tab.count.toLocaleString('zh-CN') }})</template>
    </button>
  </div>
</template>
