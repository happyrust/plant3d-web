<template>
  <div class="nearby-query-panel">
    <!-- 查询模式切换 -->
    <div class="mode-switch">
      <v-btn-toggle v-model="queryMode" mandatory density="compact" class="w-100">
        <v-btn value="refno" size="small">通过 Refno</v-btn>
        <v-btn value="position" size="small">通过坐标</v-btn>
      </v-btn-toggle>
    </div>

    <!-- 输入参数区域 -->
    <v-card flat class="input-section">
      <!-- Refno 模式 -->
      <div v-if="queryMode === 'refno'" class="pa-3">
        <v-text-field v-model="refnoInput"
          label="参考编号 (Refno)"
          placeholder="例如：17496_123456"
          density="compact"
          variant="outlined"
          hide-details />
        <v-text-field v-model.number="radiusInput"
          label="查询半径 (mm)"
          type="number"
          density="compact"
          variant="outlined"
          suffix="mm"
          class="mt-3"
          hide-details />
      </div>

      <!-- Position 模式 -->
      <div v-else class="pa-3">
        <div class="text-caption text-grey mb-2">坐标位置 (mm)</div>
        <div class="d-flex gap-2 mb-3">
          <v-text-field v-model.number="xInput"
            placeholder="X"
            type="number"
            density="compact"
            variant="outlined"
            hide-details />
          <v-text-field v-model.number="yInput"
            placeholder="Y"
            type="number"
            density="compact"
            variant="outlined"
            hide-details />
          <v-text-field v-model.number="zInput"
            placeholder="Z"
            type="number"
            density="compact"
            variant="outlined"
            hide-details />
        </div>
        <v-text-field v-model.number="radiusInput"
          label="查询半径 (mm)"
          type="number"
          density="compact"
          variant="outlined"
          suffix="mm"
          hide-details />
      </div>
    </v-card>

    <!-- 过滤选项 -->
    <v-card flat class="filter-section pa-3">
      <div class="text-caption text-grey mb-2">过滤条件</div>
      <div class="noun-filters mb-3">
        <v-chip-group v-model="selectedNouns" multiple column>
          <v-chip v-for="noun in availableNouns"
            :key="noun.value"
            :value="noun.value"
            size="small"
            filter>
            {{ noun.label }}
          </v-chip>
        </v-chip-group>
      </div>
      <v-text-field v-model.number="maxResults"
        label="最大结果数"
        type="number"
        density="compact"
        variant="outlined"
        hide-details />
    </v-card>

    <!-- 查询按钮 -->
    <div class="pa-3">
      <v-btn color="primary"
        block
        :loading="loading"
        :disabled="!canQuery"
        @click="handleQuery">
        查询周边物项
      </v-btn>
    </div>

    <!-- 结果统计 -->
    <v-card v-if="totalCount > 0" flat class="result-stats pa-2">
      <div class="d-flex align-center justify-space-between">
        <span class="text-body-2">找到 {{ totalCount }} 个物项</span>
        <v-chip v-if="truncated" color="warning" size="x-small">已截断</v-chip>
      </div>
    </v-card>

    <!-- 错误提示 -->
    <v-alert v-if="error" type="error" density="compact" class="ma-3">
      {{ error }}
    </v-alert>

    <!-- 结果列表（按专业分组） -->
    <div v-if="specGroups.length > 0" class="result-list">
      <v-expansion-panels multiple>
        <v-expansion-panel v-for="group in specGroups"
          :key="group.spec_value">
          <v-expansion-panel-title>
            <div class="d-flex align-center justify-space-between w-100">
              <span class="font-weight-medium">{{ group.spec_name }}</span>
              <v-chip size="x-small" class="mr-2">{{ group.count }}</v-chip>
            </div>
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <v-list density="compact">
              <v-list-item v-for="item in group.items"
                :key="item.refno"
                class="item-row"
                @click="handleItemClick(item)">
                <template #prepend>
                  <v-icon :color="getNounColor(item.noun)" size="small">
                    mdi-circle
                  </v-icon>
                </template>
                <v-list-item-title class="d-flex align-center justify-space-between">
                  <span class="text-body-2 font-weight-medium">{{ item.noun }}</span>
                  <span class="text-caption text-primary">{{ formatDistance(item.distance) }}</span>
                </v-list-item-title>
                <v-list-item-subtitle class="text-caption font-mono">
                  {{ item.refno }}
                </v-list-item-subtitle>
              </v-list-item>
            </v-list>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </div>

    <!-- 空状态 -->
    <div v-else-if="!loading && totalCount === 0 && !error" class="empty-state">
      <v-icon size="64" color="grey-lighten-1">mdi-magnify</v-icon>
      <div class="text-h6 text-grey mt-2">暂无结果</div>
      <div class="text-caption text-grey-lighten-1">调整查询条件后重试</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

import type { SpatialQueryResultItem } from '@/api/genModelSpatialApi';

import { useNearbyQuery } from '@/composables/useNearbyQuery';

const { loading, error, specGroups, totalCount, truncated, query } = useNearbyQuery();

const queryMode = ref<'refno' | 'position'>('refno');
const refnoInput = ref('');
const xInput = ref<number>();
const yInput = ref<number>();
const zInput = ref<number>();
const radiusInput = ref(5000);
const maxResults = ref(100);
const selectedNouns = ref<string[]>([]);

const availableNouns = [
  { label: 'PIPE', value: 'PIPE' },
  { label: 'EQUI', value: 'EQUI' },
  { label: 'TUBI', value: 'TUBI' },
  { label: 'VALV', value: 'VALV' },
  { label: 'ELBO', value: 'ELBO' },
  { label: 'STRU', value: 'STRU' },
];

const canQuery = computed(() => {
  if (queryMode.value === 'refno') {
    return refnoInput.value.trim() !== '' && radiusInput.value > 0;
  } else {
    return xInput.value !== undefined && yInput.value !== undefined && zInput.value !== undefined && radiusInput.value > 0;
  }
});

async function handleQuery() {
  await query({
    mode: queryMode.value,
    refno: queryMode.value === 'refno' ? refnoInput.value : undefined,
    x: queryMode.value === 'position' ? xInput.value : undefined,
    y: queryMode.value === 'position' ? yInput.value : undefined,
    z: queryMode.value === 'position' ? zInput.value : undefined,
    radius: radiusInput.value,
    nouns: selectedNouns.value.length > 0 ? selectedNouns.value : undefined,
    maxResults: maxResults.value,
  });
}

function handleItemClick(item: SpatialQueryResultItem) {
  console.log('Item clicked:', item);
  // TODO: 集成 3D 视图定位功能
}

function getNounColor(noun: string): string {
  const colorMap: Record<string, string> = {
    PIPE: 'blue',
    EQUI: 'green',
    TUBI: 'orange',
    VALV: 'red',
    ELBO: 'purple',
    STRU: 'brown',
  };
  return colorMap[noun] || 'grey';
}

function formatDistance(distance?: number): string {
  if (distance === undefined) return '-';
  return `${Math.round(distance)}mm`;
}
</script>

<style scoped>
.nearby-query-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.mode-switch {
  padding: 12px;
  border-bottom: 1px solid #e0e0e0;
}

.input-section,
.filter-section {
  border-bottom: 1px solid #e0e0e0;
}

.filter-section {
  background-color: #fafafa;
}

.noun-filters {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.result-stats {
  background-color: #e3f2fd;
  border-bottom: 1px solid #e0e0e0;
}

.result-list {
  flex: 1;
  overflow-y: auto;
}

.item-row {
  cursor: pointer;
  transition: background-color 0.2s;
}

.item-row:hover {
  background-color: #f5f5f5;
}

.font-mono {
  font-family: 'Courier New', monospace;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
}

.gap-2 {
  gap: 8px;
}
</style>
