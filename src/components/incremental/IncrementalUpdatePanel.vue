<template>
  <div class="incremental-panel h-full min-h-0 bg-slate-50 text-slate-900">
    <header class="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3">
      <div class="flex min-w-0 items-center gap-2">
        <v-icon size="18" color="primary">mdi-radar</v-icon>
        <div class="truncate text-sm font-semibold">增量监控</div>
        <v-chip size="x-small" :color="source === 'backend' ? 'success' : 'warning'" variant="tonal">
          {{ source === 'backend' ? '后端' : '1112 Demo' }}
        </v-chip>
        <v-chip v-if="snapshot" size="x-small" color="primary" variant="tonal">
          {{ snapshot.changed_db_count }} 个 DB 变化
        </v-chip>
        <v-chip v-if="selectedRecord?.generation_success !== undefined && selectedRecord?.generation_success !== null"
          size="x-small"
          :color="selectedRecord.generation_success ? 'success' : 'grey'"
          variant="tonal">
          模型 {{ selectedRecord.generation_success ? '已生成' : '未生成' }}
        </v-chip>
      </div>
      <div class="flex items-center gap-1">
        <v-btn icon size="small" variant="text" :loading="monitorLoading" title="刷新监控" @click="loadMonitor">
          <v-icon size="18">mdi-refresh</v-icon>
        </v-btn>
      </div>
    </header>

    <section class="incremental-controls shrink-0 border-b border-slate-200 bg-white p-3">
      <v-text-field v-model="project"
        class="min-w-44 flex-1"
        label="Project"
        density="compact"
        hide-details
        variant="outlined" />
      <v-switch v-model="generateModel"
        class="incremental-switch"
        color="primary"
        density="compact"
        hide-details
        label="生成模型" />
      <v-switch v-model="autoRefresh"
        class="incremental-switch"
        color="primary"
        density="compact"
        hide-details
        label="自动刷新" />
      <div class="flex flex-wrap items-center gap-1">
        <v-btn size="small" color="primary" variant="tonal" :loading="monitorLoading" @click="loadMonitor">
          <v-icon start size="16">mdi-database-search-outline</v-icon>
          刷新
        </v-btn>
        <v-btn size="small" color="primary" :loading="watching" @click="runGlobalWatch">
          <v-icon start size="16">mdi-radar</v-icon>
          全局扫描
        </v-btn>
        <v-btn size="small"
          variant="tonal"
          :disabled="!selectedRecord"
          :loading="running"
          @click="runUpdateForSelected">
          <v-icon start size="16">mdi-play-circle-outline</v-icon>
          更新选中
        </v-btn>
      </div>
    </section>

    <v-alert v-if="error"
      type="error"
      variant="tonal"
      density="compact"
      closable
      class="mx-3 mt-3"
      @click:close="error = null">
      {{ error }}
    </v-alert>

    <div v-if="sourceMessage"
      class="mx-3 mt-2 flex shrink-0 items-center gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <v-icon size="16" color="warning">mdi-alert-circle-outline</v-icon>
      <span class="min-w-0 flex-1">{{ sourceMessage }}</span>
      <v-btn icon size="x-small" variant="text" @click="sourceMessage = null">
        <v-icon size="14">mdi-close</v-icon>
      </v-btn>
    </div>

    <section class="incremental-summary-grid shrink-0 p-3">
      <div v-for="item in monitorTiles"
        :key="item.label"
        class="rounded border border-slate-200 bg-white px-3 py-2">
        <div class="text-[11px] text-slate-500">{{ item.label }}</div>
        <div class="mt-1 truncate text-lg font-semibold text-slate-900">{{ item.value }}</div>
      </div>
    </section>

    <main ref="monitorShell" class="incremental-monitor-shell min-h-0 flex-1 px-3 pb-3">
      <section class="monitor-list-section flex min-h-0 flex-col rounded border border-slate-200 bg-white">
        <div class="flex h-11 shrink-0 items-center justify-between border-b border-slate-200 px-3">
          <div>
            <div class="text-sm font-semibold">变化 DBNUM</div>
            <div class="text-[11px] text-slate-500">{{ filteredMonitorRecords.length }} / {{ monitorRecords.length }}</div>
          </div>
          <v-chip size="x-small" color="primary" variant="tonal">
            {{ autoRefresh ? '监控中' : '手动' }}
          </v-chip>
        </div>
        <div class="border-b border-slate-100 p-2">
          <v-text-field v-model="monitorSearch"
            density="compact"
            hide-details
            placeholder="DBNUM / 文件 / Project"
            variant="outlined" />
        </div>
        <div class="min-h-0 flex-1 overflow-auto">
          <button v-for="record in filteredMonitorRecords"
            :key="record.id || monitorRecordKey(record)"
            type="button"
            class="monitor-record w-full border-b border-slate-100 px-3 py-3 text-left hover:bg-blue-50"
            :class="{ 'bg-blue-50': selectedRecordId === (record.id || monitorRecordKey(record)) }"
            @click="selectMonitorRecord(record)">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="flex min-w-0 items-center gap-2">
                  <span class="font-mono text-sm font-semibold text-slate-900">{{ record.dbnum }}</span>
                  <v-chip size="x-small" :color="recordStatusColor(record.status)" variant="tonal">
                    {{ recordStatusLabel(record.status) }}
                  </v-chip>
                </div>
                <div class="mt-1 truncate text-xs text-slate-600">{{ record.db_name || shortPath(record.file_path) }}</div>
              </div>
              <div class="shrink-0 text-right text-[11px] text-slate-500">
                {{ formatDate(record.updated_at || record.detected_at) }}
              </div>
            </div>
            <div class="mt-2 grid grid-cols-3 gap-2 text-xs">
              <div>
                <div class="text-slate-500">Sesno</div>
                <div class="font-semibold">{{ record.from_sesno }} → {{ record.to_sesno }}</div>
              </div>
              <div>
                <div class="text-slate-500">元素</div>
                <div class="font-semibold">{{ record.element_count }}</div>
              </div>
              <div>
                <div class="text-slate-500">模型</div>
                <div class="font-semibold">{{ record.model_change_count }}</div>
              </div>
            </div>
            <div class="mt-2 flex flex-wrap gap-1 text-[11px] text-slate-600">
              <span class="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">+{{ record.add_count }}</span>
              <span class="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">~{{ record.modify_count }}</span>
              <span class="rounded bg-rose-50 px-1.5 py-0.5 text-rose-700">-{{ record.delete_count }}</span>
            </div>
          </button>
          <div v-if="filteredMonitorRecords.length === 0" class="px-3 py-10 text-center text-sm text-slate-500">
            无变化 DBNUM
          </div>
        </div>
      </section>

      <section ref="detailSection" class="monitor-detail-section min-h-0 overflow-auto rounded border border-slate-200 bg-white">
        <template v-if="selectedRecord">
          <div class="selected-record-header border-b border-slate-200 px-3 py-3">
            <div class="min-w-0">
              <div class="flex min-w-0 items-center gap-2">
                <span class="font-mono text-sm font-semibold">DB {{ selectedRecord.dbnum }}</span>
                <span class="truncate text-xs text-slate-500">{{ selectedRecord.project }}</span>
              </div>
              <div class="mt-1 truncate font-mono text-[11px] text-slate-500">
                {{ selectedRecord.file_path || '-' }}
              </div>
            </div>
            <div class="flex shrink-0 flex-wrap items-center justify-end gap-1">
              <v-btn size="small"
                variant="text"
                :disabled="!selectedRecord"
                :loading="detailLoading"
                @click="loadSelectedRecordDetail">
                <v-icon start size="16">mdi-file-chart-outline</v-icon>
                详情
              </v-btn>
              <v-btn size="small" color="primary" variant="tonal" :loading="modelLoading" @click="loadAllChangedModels">
                <v-icon start size="16">mdi-cube-scan</v-icon>
                加载变化模型
              </v-btn>
            </div>
          </div>

          <section class="incremental-summary-grid p-3">
            <div v-for="item in selectedTiles"
              :key="item.label"
              class="rounded border border-slate-200 bg-slate-50 px-3 py-2">
              <div class="text-[11px] text-slate-500">{{ item.label }}</div>
              <div class="mt-1 truncate text-base font-semibold text-slate-900">{{ item.value }}</div>
            </div>
          </section>

          <div class="incremental-content min-h-0 px-3 pb-3">
            <section class="flex min-h-[360px] flex-col rounded border border-slate-200 bg-white">
              <div class="flex h-11 shrink-0 items-center justify-between border-b border-slate-200 px-3">
                <div class="text-sm font-semibold">变化详情</div>
                <div class="text-xs text-slate-500">{{ filteredChanges.length }} / {{ changes.length }}</div>
              </div>
              <div class="change-filters shrink-0 gap-2 border-b border-slate-100 p-2">
                <v-text-field v-model="search"
                  density="compact"
                  hide-details
                  placeholder="RefNo / Noun"
                  variant="outlined" />
                <v-select v-model="operationFilter"
                  :items="operationFilterItems"
                  density="compact"
                  hide-details
                  variant="outlined" />
                <v-select v-model="categoryFilter"
                  :items="categoryFilterItems"
                  density="compact"
                  hide-details
                  variant="outlined" />
              </div>
              <div class="min-h-0 flex-1 overflow-auto">
                <table class="w-full border-collapse text-xs">
                  <thead class="sticky top-0 z-10 bg-slate-100 text-slate-600">
                    <tr>
                      <th class="w-16 px-2 py-2 text-left font-medium">Op</th>
                      <th class="px-2 py-2 text-left font-medium">RefNo</th>
                      <th class="w-20 px-2 py-2 text-left font-medium">Noun</th>
                      <th class="w-28 px-2 py-2 text-left font-medium">模型</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="change in filteredChanges"
                      :key="`${change.refno}-${change.sesno}-${change.operation}`"
                      class="cursor-pointer border-b border-slate-100 hover:bg-blue-50"
                      :class="{ 'bg-blue-50': selectedChange?.refno === change.refno }"
                      @click="selectChange(change)">
                      <td class="px-2 py-2">
                        <v-chip size="x-small" :color="operationColor(change.operation)" variant="tonal">
                          {{ operationLabel(change.operation) }}
                        </v-chip>
                      </td>
                      <td class="px-2 py-2 font-mono">{{ change.refno }}</td>
                      <td class="px-2 py-2">{{ change.noun || '-' }}</td>
                      <td class="px-2 py-2">
                        <span class="font-mono text-[11px] text-slate-700">{{ change.model_refno || '-' }}</span>
                        <div class="text-[10px] text-slate-500">{{ categoryLabel(change.model_category) }}</div>
                      </td>
                    </tr>
                    <tr v-if="filteredChanges.length === 0">
                      <td colspan="4" class="px-3 py-10 text-center text-sm text-slate-500">无匹配变化</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section class="flex min-h-[360px] flex-col rounded border border-slate-200 bg-white">
              <div class="flex h-11 shrink-0 items-center justify-between border-b border-slate-200 px-3">
                <div class="min-w-0">
                  <div class="text-sm font-semibold">属性差异</div>
                  <div class="truncate font-mono text-[11px] text-slate-500">{{ selectedChange?.refno || '未选择' }}</div>
                </div>
                <v-btn icon
                  size="small"
                  variant="text"
                  :disabled="!selectedChange"
                  :loading="attrLoading"
                  title="刷新属性差异"
                  @click="reloadAttrDiff">
                  <v-icon size="18">mdi-refresh</v-icon>
                </v-btn>
              </div>
              <div v-if="selectedChange" class="grid shrink-0 grid-cols-3 gap-2 border-b border-slate-100 p-3 text-xs">
                <div>
                  <div class="text-slate-500">版本</div>
                  <div class="font-semibold">{{ activeFromSesno }} → {{ activeToSesno }}</div>
                </div>
                <div>
                  <div class="text-slate-500">Owner</div>
                  <div class="truncate font-mono">{{ selectedChange.owner_refno || '-' }}</div>
                </div>
                <div>
                  <div class="text-slate-500">分类</div>
                  <div>{{ categoryLabel(selectedChange.model_category) }}</div>
                </div>
              </div>
              <div class="min-h-0 flex-1 overflow-auto">
                <table class="w-full border-collapse text-xs">
                  <thead class="sticky top-0 z-10 bg-slate-100 text-slate-600">
                    <tr>
                      <th class="w-32 px-2 py-2 text-left font-medium">属性</th>
                      <th class="px-2 py-2 text-left font-medium">旧版</th>
                      <th class="px-2 py-2 text-left font-medium">新版</th>
                      <th class="w-20 px-2 py-2 text-left font-medium">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in attrRows"
                      :key="row.name"
                      class="border-b border-slate-100"
                      :class="attrRowClass(row.status)">
                      <td class="px-2 py-2 font-mono">{{ row.name }}</td>
                      <td class="px-2 py-2 font-mono">{{ displayValue(row.before) }}</td>
                      <td class="px-2 py-2 font-mono">{{ displayValue(row.after) }}</td>
                      <td class="px-2 py-2">{{ attrStatusLabel(row.status) }}</td>
                    </tr>
                    <tr v-if="attrRows.length === 0">
                      <td colspan="4" class="px-3 py-10 text-center text-sm text-slate-500">选择一条变化查看属性</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section ref="modelCompareSection" class="model-compare-section flex min-h-[520px] flex-col rounded border border-slate-200 bg-white">
              <div class="flex h-11 shrink-0 items-center justify-between border-b border-slate-200 px-3">
                <div>
                  <div class="text-sm font-semibold">模型对比</div>
                  <div class="text-[11px] text-slate-500">
                    DB {{ selectedRecord.dbnum }} · {{ activeFromSesno }} / {{ activeToSesno }} · {{ modelRows.length }} 个影响模型
                  </div>
                </div>
                <v-btn size="small" color="primary" variant="tonal" :loading="modelLoading" @click="compareAllChangedModels">
                  <v-icon start size="16">mdi-compare-horizontal</v-icon>
                  对比
                </v-btn>
              </div>

              <div class="border-b border-slate-100 p-3">
                <div class="model-compare-overview gap-2">
                  <div class="version-summary before">
                    <div class="text-[11px] text-slate-500">旧版 {{ activeFromSesno }}</div>
                    <div class="mt-1 text-lg font-semibold">{{ compareStats.beforePresent }}</div>
                    <div class="text-[11px] text-slate-500">模型存在</div>
                  </div>
                  <div class="change-summary">
                    <div class="flex flex-wrap justify-center gap-1 text-[11px]">
                      <span class="rounded bg-emerald-50 px-2 py-1 text-emerald-700">新增 {{ compareStats.added }}</span>
                      <span class="rounded bg-amber-50 px-2 py-1 text-amber-700">修改 {{ compareStats.modified }}</span>
                      <span class="rounded bg-rose-50 px-2 py-1 text-rose-700">删除 {{ compareStats.deleted }}</span>
                    </div>
                    <div class="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div class="h-full rounded-full bg-blue-500" :style="{ width: compareProgressWidth }" />
                    </div>
                  </div>
                  <div class="version-summary after">
                    <div class="text-[11px] text-slate-500">新版 {{ activeToSesno }}</div>
                    <div class="mt-1 text-lg font-semibold">{{ compareStats.afterPresent }}</div>
                    <div class="text-[11px] text-slate-500">模型存在</div>
                  </div>
                </div>

                <div v-if="selectedCompareRow" class="selected-model-compare mt-3 gap-2">
                  <div class="version-state" :class="versionStateClass(selectedCompareRow.beforeState)">
                    <div class="text-[11px] text-slate-500">旧版模型</div>
                    <div class="mt-1 font-mono text-xs">{{ selectedCompareRow.refno }}</div>
                    <div class="mt-2 text-sm font-semibold">{{ versionStateLabel(selectedCompareRow.beforeState) }}</div>
                  </div>
                  <div class="delta-state" :class="compareStatusClass(selectedCompareRow.status)">
                    <div class="text-[11px]">变化</div>
                    <div class="mt-1 text-sm font-semibold">{{ compareStatusLabel(selectedCompareRow.status) }}</div>
                    <div class="mt-1 text-[11px] opacity-80">
                      {{ selectedCompareRow.sourceChangeCount }} 个来源元素 · {{ selectedCompareRow.sourceNouns || '-' }}
                    </div>
                  </div>
                  <div class="version-state" :class="versionStateClass(selectedCompareRow.afterState)">
                    <div class="text-[11px] text-slate-500">新版模型</div>
                    <div class="mt-1 font-mono text-xs">{{ selectedCompareRow.refno }}</div>
                    <div class="mt-2 text-sm font-semibold">{{ versionStateLabel(selectedCompareRow.afterState) }}</div>
                  </div>
                </div>

                <div class="version-mode-grid gap-2">
                  <button v-for="mode in versionModes"
                    :key="mode.id"
                    class="rounded border px-2 py-2 text-left text-xs"
                    :class="activeVersionMode === mode.id ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-700'"
                    @click="activeVersionMode = mode.id">
                    <div class="font-semibold">{{ mode.label }}</div>
                    <div class="mt-0.5 text-[11px] opacity-80">{{ mode.value }}</div>
                  </button>
                </div>
                <div class="mt-2 flex flex-wrap gap-2">
                  <v-btn size="small" variant="tonal" :disabled="!selectedModelRefno" :loading="modelLoading" @click="loadSelectedModel">
                    <v-icon start size="16">mdi-crosshairs-gps</v-icon>
                    加载选中
                  </v-btn>
                  <v-btn size="small" variant="tonal" :disabled="!selectedModelRefno" :loading="modelLoading" @click="compareSelectedModel">
                    <v-icon start size="16">mdi-compare-horizontal</v-icon>
                    对比选中
                  </v-btn>
                  <v-btn size="small" variant="text" :disabled="!selectedChange" @click="focusSelectedChange">
                    <v-icon start size="16">mdi-target</v-icon>
                    定位
                  </v-btn>
                </div>
                <div class="model-compare-filters mt-2 gap-2">
                  <v-text-field v-model="modelSearch"
                    density="compact"
                    hide-details
                    placeholder="模型 RefNo / Noun / 分类"
                    variant="outlined" />
                  <v-select v-model="compareStatusFilter"
                    :items="compareStatusFilterItems"
                    density="compact"
                    hide-details
                    variant="outlined" />
                </div>
              </div>

              <div class="min-h-0 flex-1 overflow-auto">
                <table class="w-full border-collapse text-xs">
                  <thead class="sticky top-0 z-10 bg-slate-100 text-slate-600">
                    <tr>
                      <th class="px-2 py-2 text-left font-medium">RefNo</th>
                      <th class="w-16 px-2 py-2 text-left font-medium">旧版</th>
                      <th class="w-16 px-2 py-2 text-left font-medium">变化</th>
                      <th class="w-16 px-2 py-2 text-left font-medium">新版</th>
                      <th class="w-24 px-2 py-2 text-left font-medium">分类</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in filteredCompareRows"
                      :key="row.refno"
                      class="cursor-pointer border-b border-slate-100 hover:bg-blue-50"
                      :class="{ 'bg-blue-50': selectedModelRefno === row.refno }"
                      @click="selectModel(row.refno)">
                      <td class="px-2 py-2">
                        <div class="font-mono">{{ row.refno }}</div>
                        <div class="text-[10px] text-slate-500">
                          {{ row.sourceChangeCount }} 个来源 · {{ row.sourceNouns || '-' }}
                        </div>
                      </td>
                      <td class="px-2 py-2">
                        <v-chip size="x-small" :color="versionStateColor(row.beforeState)" variant="tonal">
                          {{ versionStateLabel(row.beforeState) }}
                        </v-chip>
                      </td>
                      <td class="px-2 py-2">
                        <v-chip size="x-small" :color="compareStatusColor(row.status)" variant="tonal">
                          {{ compareStatusLabel(row.status) }}
                        </v-chip>
                      </td>
                      <td class="px-2 py-2">
                        <v-chip size="x-small" :color="versionStateColor(row.afterState)" variant="tonal">
                          {{ versionStateLabel(row.afterState) }}
                        </v-chip>
                      </td>
                      <td class="px-2 py-2">{{ categoryLabel(row.category) }}</td>
                    </tr>
                    <tr v-if="filteredCompareRows.length === 0">
                      <td colspan="5" class="px-3 py-10 text-center text-sm text-slate-500">无匹配模型变化</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="border-t border-slate-100 p-3">
                <div class="mb-2 text-xs font-semibold text-slate-700">选中模型来源元素</div>
                <div class="max-h-28 overflow-auto rounded border border-slate-100 bg-slate-50">
                  <table class="w-full border-collapse text-[11px]">
                    <tbody>
                      <tr v-for="change in selectedModelSourceChanges"
                        :key="`${change.refno}-${change.operation}`"
                        class="border-b border-slate-100">
                        <td class="w-14 px-2 py-1">
                          <span :class="operationTextClass(change.operation)">{{ operationLabel(change.operation) }}</span>
                        </td>
                        <td class="px-2 py-1 font-mono">{{ change.refno }}</td>
                        <td class="w-16 px-2 py-1">{{ change.noun || '-' }}</td>
                      </tr>
                      <tr v-if="selectedModelSourceChanges.length === 0">
                        <td class="px-2 py-6 text-center text-slate-500">无来源元素</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </div>
        </template>
        <div v-else class="flex h-full min-h-[320px] items-center justify-center text-sm text-slate-500">
          暂无变化记录
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import {
  loadIncrementalAttrDiff,
  loadIncrementalModelChanges,
  loadIncrementalMonitor,
  loadIncrementalReport,
  runGlobalIncrementalWatchOnce,
  runIncrementalUpdate,
  type IncrementalAttrDiffRow,
  type IncrementalElementChange,
  type IncrementalModelChange,
  type IncrementalMonitorRecord,
  type IncrementalMonitorSnapshot,
  type IncrementalRunRequest,
  type IncrementalSummary,
} from '@/api/incrementalUpdateApi';
import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { setGlobalSelectedRefno } from '@/composables/useSelectionStore';
import { showModelByRefnosWithAck } from '@/composables/useViewerContext';

type SourceKind = 'backend' | 'demo';
type VersionMode = 'before' | 'after' | 'changed' | 'compare';
type CompareStatus = 'added' | 'modified' | 'deleted' | 'mixed' | 'unchanged';
type VersionState = 'present' | 'missing' | 'changed';

type ModelCompareRow = {
  refno: string;
  category: string;
  status: CompareStatus;
  beforeState: VersionState;
  afterState: VersionState;
  sourceChangeCount: number;
  sourceNouns: string;
  sourceChanges: IncrementalElementChange[];
  model: IncrementalModelChange;
};

const project = ref('AvevaMarineSample');
const generateModel = ref(true);
const autoRefresh = ref(false);
const monitorLoading = ref(false);
const detailLoading = ref(false);
const running = ref(false);
const watching = ref(false);
const modelLoading = ref(false);
const attrLoading = ref(false);
const error = ref<string | null>(null);
const sourceMessage = ref<string | null>(null);
const source = ref<SourceKind>('demo');
const snapshot = ref<IncrementalMonitorSnapshot | null>(null);
const monitorRecords = ref<IncrementalMonitorRecord[]>([]);
const selectedRecordId = ref<string | null>(null);
const monitorShell = ref<HTMLElement | null>(null);
const detailSection = ref<HTMLElement | null>(null);
const modelCompareSection = ref<HTMLElement | null>(null);
const summary = ref<IncrementalSummary | null>(null);
const modelRows = ref<IncrementalModelChange[]>([]);
const selectedChange = ref<IncrementalElementChange | null>(null);
const selectedModelRefno = ref<string | null>(null);
const attrRows = ref<IncrementalAttrDiffRow[]>([]);
const monitorSearch = ref('');
const search = ref('');
const modelSearch = ref('');
const operationFilter = ref('all');
const categoryFilter = ref('all');
const compareStatusFilter = ref('all');
const activeVersionMode = ref<VersionMode>('changed');
let refreshTimer: number | undefined;

const operationFilterItems = [
  { title: '全部操作', value: 'all' },
  { title: '新增', value: 'add' },
  { title: '修改', value: 'modify' },
  { title: '删除', value: 'delete' },
];

const categoryFilterItems = [
  { title: '全部模型', value: 'all' },
  { title: '基本体', value: 'prim' },
  { title: 'Loop Owner', value: 'loop_owner' },
  { title: '元件库', value: 'basic_cata' },
  { title: 'BRAN/HANG', value: 'bran_hanger' },
  { title: '删除', value: 'delete' },
  { title: '未分类', value: 'unclassified' },
];

const compareStatusFilterItems = [
  { title: '全部变化', value: 'all' },
  { title: '新增模型', value: 'added' },
  { title: '修改模型', value: 'modified' },
  { title: '删除模型', value: 'deleted' },
  { title: '混合变化', value: 'mixed' },
];

const selectedRecord = computed(() => {
  if (!selectedRecordId.value) return null;
  return monitorRecords.value.find((record) => (record.id || monitorRecordKey(record)) === selectedRecordId.value) ?? null;
});

const activeFromSesno = computed(() => summary.value?.from_sesno ?? selectedRecord.value?.from_sesno ?? '-');
const activeToSesno = computed(() => summary.value?.to_sesno ?? selectedRecord.value?.to_sesno ?? '-');

const filteredMonitorRecords = computed(() => {
  const q = monitorSearch.value.trim().toLowerCase();
  if (!q) return monitorRecords.value;
  return monitorRecords.value.filter((record) => [
    record.project,
    record.dbnum,
    record.db_name,
    record.file_path,
    record.status,
  ].some((value) => String(value ?? '').toLowerCase().includes(q)));
});

const monitorTiles = computed(() => [
  { label: '监控源', value: snapshot.value?.source_count ?? '-' },
  { label: '变化 DB', value: snapshot.value?.changed_db_count ?? '-' },
  { label: '元素变化', value: snapshot.value?.total_element_count ?? '-' },
  { label: '影响模型', value: snapshot.value?.total_model_change_count ?? '-' },
  { label: '更新时间', value: formatDate(snapshot.value?.watched_at) },
]);

const selectedTiles = computed(() => [
  { label: '版本', value: selectedRecord.value ? `${selectedRecord.value.from_sesno} → ${selectedRecord.value.to_sesno}` : '-' },
  { label: 'Session', value: selectedRecord.value?.session_count ?? '-' },
  { label: '新增', value: selectedRecord.value?.add_count ?? '-' },
  { label: '修改', value: selectedRecord.value?.modify_count ?? '-' },
  { label: '删除', value: selectedRecord.value?.delete_count ?? '-' },
  { label: 'PE 入库', value: summary.value?.data_persist.pe_rows ?? '-' },
]);

const versionModes = computed(() => [
  { id: 'before' as const, label: '旧版', value: String(activeFromSesno.value) },
  { id: 'after' as const, label: '新版', value: String(activeToSesno.value) },
  { id: 'changed' as const, label: '变化集', value: `${modelRows.value.length}` },
  { id: 'compare' as const, label: '对比', value: `${activeFromSesno.value} / ${activeToSesno.value}` },
]);

const changes = computed(() => summary.value?.element_changes ?? []);

const compareRows = computed<ModelCompareRow[]>(() => {
  return modelRows.value.map((model) => {
    const sourceChanges = changes.value.filter((change) => {
      return change.model_refno === model.model_refno || change.refno === model.model_refno;
    });
    const operations = parseOperations(model.source_operations || sourceChanges.map((change) => change.operation).join(','));
    const status = modelCompareStatus(operations);
    return {
      refno: model.model_refno,
      category: model.model_category,
      status,
      beforeState: beforeStateForStatus(status),
      afterState: afterStateForStatus(status),
      sourceChangeCount: model.source_change_count || sourceChanges.length,
      sourceNouns: model.source_nouns || Array.from(new Set(sourceChanges.map((change) => change.noun).filter(Boolean))).join(','),
      sourceChanges,
      model,
    };
  });
});

const filteredCompareRows = computed(() => {
  const q = modelSearch.value.trim().toLowerCase();
  return compareRows.value.filter((row) => {
    if (compareStatusFilter.value !== 'all' && row.status !== compareStatusFilter.value) return false;
    if (!q) return true;
    return [
      row.refno,
      row.category,
      row.sourceNouns,
      row.model.pe_noun,
      row.model.source_operations,
    ].some((value) => String(value ?? '').toLowerCase().includes(q));
  });
});

const compareStats = computed(() => {
  const stats = {
    total: compareRows.value.length,
    added: 0,
    modified: 0,
    deleted: 0,
    mixed: 0,
    beforePresent: 0,
    afterPresent: 0,
  };
  for (const row of compareRows.value) {
    if (row.status === 'added') stats.added += 1;
    if (row.status === 'modified') stats.modified += 1;
    if (row.status === 'deleted') stats.deleted += 1;
    if (row.status === 'mixed') stats.mixed += 1;
    if (row.beforeState !== 'missing') stats.beforePresent += 1;
    if (row.afterState !== 'missing') stats.afterPresent += 1;
  }
  return stats;
});

const compareProgressWidth = computed(() => {
  const total = Math.max(compareStats.value.total, 1);
  return `${Math.round((compareStats.value.afterPresent / total) * 100)}%`;
});

const selectedCompareRow = computed(() => {
  return compareRows.value.find((row) => row.refno === selectedModelRefno.value) ?? compareRows.value[0] ?? null;
});

const selectedModelSourceChanges = computed(() => selectedCompareRow.value?.sourceChanges ?? []);

const filteredChanges = computed(() => {
  const q = search.value.trim().toLowerCase();
  return changes.value.filter((item) => {
    if (operationFilter.value !== 'all' && item.operation !== operationFilter.value) return false;
    if (categoryFilter.value === 'unclassified') {
      if (item.classified) return false;
    } else if (categoryFilter.value !== 'all' && item.model_category !== categoryFilter.value) {
      return false;
    }
    if (!q) return true;
    return [
      item.refno,
      item.noun,
      item.owner_refno,
      item.model_refno,
      item.model_category,
    ].some((value) => String(value ?? '').toLowerCase().includes(q));
  });
});

function monitorRecordKey(record: IncrementalMonitorRecord): string {
  return `${record.project}:${record.dbnum}:${record.from_sesno}:${record.to_sesno}`;
}

function paramsForRecord(record: IncrementalMonitorRecord): IncrementalRunRequest {
  return {
    project: record.project || project.value.trim() || undefined,
    dbnum: Number(record.dbnum),
    from_sesno: Number(record.from_sesno),
    to_sesno: Number(record.to_sesno),
    generate_model: generateModel.value,
  };
}

function applyMonitorSnapshot(next: IncrementalMonitorSnapshot, nextSource: SourceKind, message?: string) {
  const records = [...next.records].sort((a, b) => {
    const bTime = Date.parse(b.updated_at || b.detected_at || next.watched_at || '');
    const aTime = Date.parse(a.updated_at || a.detected_at || next.watched_at || '');
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  });
  snapshot.value = { ...next, records };
  monitorRecords.value = records;
  source.value = nextSource;
  sourceMessage.value = nextSource === 'demo' && message
    ? '后端全局增量监控接口暂不可用，已加载 1112 演示监控数据。'
    : null;

  const hasSelected = records.some((record) => (record.id || monitorRecordKey(record)) === selectedRecordId.value);
  if (!hasSelected) {
    selectedRecordId.value = records[0] ? (records[0].id || monitorRecordKey(records[0])) : null;
  }
}

function applyReport(next: IncrementalSummary, nextSource: SourceKind, message?: string) {
  const previousRefno = selectedChange.value?.refno;
  summary.value = next;
  source.value = nextSource;
  if (nextSource === 'demo' && message) {
    sourceMessage.value = '后端增量详情接口暂不可用，已加载 1112 演示详情。';
  }
  selectedChange.value = next.element_changes.find((change) => change.refno === previousRefno) ?? next.element_changes[0] ?? null;
  selectedModelRefno.value = selectedChange.value?.model_refno || selectedChange.value?.refno || null;
}

async function loadMonitor(options: { silent?: boolean } = {}) {
  if (!options.silent) monitorLoading.value = true;
  error.value = null;
  try {
    const result = await loadIncrementalMonitor({ project: project.value.trim() || undefined });
    applyMonitorSnapshot(result.data, result.source, result.message);
    if (selectedRecord.value) {
      await loadSelectedRecordDetail(selectedRecord.value);
    } else {
      clearDetail();
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    if (!options.silent) monitorLoading.value = false;
  }
}

async function runGlobalWatch() {
  watching.value = true;
  error.value = null;
  try {
    const result = await runGlobalIncrementalWatchOnce({
      project: project.value.trim() || undefined,
      generate_model: generateModel.value,
    });
    applyMonitorSnapshot(result.data, result.source, result.message);
    if (selectedRecord.value) {
      await loadSelectedRecordDetail(selectedRecord.value);
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    watching.value = false;
  }
}

async function runUpdateForSelected() {
  if (!selectedRecord.value) return;
  running.value = true;
  error.value = null;
  try {
    const result = await runIncrementalUpdate(paramsForRecord(selectedRecord.value));
    applyReport(result.data, result.source, result.message);
    await loadModelRows(selectedRecord.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    running.value = false;
  }
}

function selectMonitorRecord(record: IncrementalMonitorRecord) {
  selectedRecordId.value = record.id || monitorRecordKey(record);
  void loadSelectedRecordDetail(record).then(async () => {
    await nextTick();
    scrollDetailIntoView();
    scrollModelCompareIntoView();
  });
}

function scrollDetailIntoView() {
  const shell = monitorShell.value;
  const detail = detailSection.value;
  if (!shell || !detail) {
    detail?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const shellRect = shell.getBoundingClientRect();
  const detailRect = detail.getBoundingClientRect();
  shell.scrollTo({
    top: shell.scrollTop + detailRect.top - shellRect.top,
    behavior: 'smooth',
  });
}

function scrollModelCompareIntoView() {
  const detail = detailSection.value;
  const compare = modelCompareSection.value;
  if (!detail || !compare) return;
  const detailRect = detail.getBoundingClientRect();
  const compareRect = compare.getBoundingClientRect();
  detail.scrollTo({
    top: detail.scrollTop + compareRect.top - detailRect.top,
    behavior: 'auto',
  });
}

async function loadSelectedRecordDetail(record = selectedRecord.value) {
  if (!record) return;
  detailLoading.value = true;
  error.value = null;
  try {
    const result = await loadIncrementalReport(paramsForRecord(record));
    applyReport(result.data, result.source, result.message);
    await loadModelRows(record);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    clearDetail();
  } finally {
    detailLoading.value = false;
  }
}

function clearDetail() {
  summary.value = null;
  modelRows.value = [];
  selectedChange.value = null;
  selectedModelRefno.value = null;
  attrRows.value = [];
}

async function loadModelRows(record = selectedRecord.value) {
  if (!record) {
    modelRows.value = [];
    return;
  }
  try {
    const result = await loadIncrementalModelChanges(paramsForRecord(record));
    modelRows.value = result.data;
  } catch {
    modelRows.value = buildModelRowsFromSummary(summary.value, record);
  }
}

function buildModelRowsFromSummary(
  data: IncrementalSummary | null,
  record: IncrementalMonitorRecord,
): IncrementalModelChange[] {
  if (!data) return [];
  const byRef = new Map<string, IncrementalElementChange[]>();
  for (const change of data.element_changes) {
    if (!change.model_refno) continue;
    const list = byRef.get(change.model_refno) ?? [];
    list.push(change);
    byRef.set(change.model_refno, list);
  }
  return Array.from(byRef.entries()).map(([refno, rows]) => ({
    dbnum: record.dbnum,
    model_refno: refno,
    model_category: rows[0]?.model_category || '',
    source_change_count: rows.length,
    source_operations: Array.from(new Set(rows.map((row) => row.operation))).join(','),
    source_nouns: Array.from(new Set(rows.map((row) => row.noun).filter(Boolean))).join(','),
    pe_exists: true,
    pe_noun: rows[0]?.noun || '',
    inst_relate_count: 0,
    geo_relate_count: 0,
  }));
}

function selectChange(change: IncrementalElementChange) {
  selectedChange.value = change;
  selectedModelRefno.value = change.model_refno || change.refno;
}

function selectModel(refno: string) {
  selectedModelRefno.value = refno;
  const change = changes.value.find((item) => item.model_refno === refno || item.refno === refno);
  if (change) selectedChange.value = change;
}

async function reloadAttrDiff() {
  if (!selectedChange.value || !selectedRecord.value) {
    attrRows.value = [];
    return;
  }
  attrLoading.value = true;
  try {
    const change = selectedChange.value;
    const resp = await loadIncrementalAttrDiff({
      dbnum: selectedRecord.value.dbnum,
      refno: change.refno,
      from_sesno: selectedRecord.value.from_sesno,
      to_sesno: selectedRecord.value.to_sesno,
    }, change);
    attrRows.value = resp.rows;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    attrLoading.value = false;
  }
}

watch(selectedChange, () => {
  void reloadAttrDiff();
});

watch(autoRefresh, (enabled) => {
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
  if (enabled) {
    refreshTimer = window.setInterval(() => {
      void loadMonitor({ silent: true });
    }, 30000);
  }
});

function toSlashRefno(refno: string): string {
  return refno.includes('_') ? refno.replace(/_/g, '/') : refno;
}

async function loadModelRefnos(refnos: string[], forcedMode?: VersionMode) {
  const record = selectedRecord.value;
  if (!record) return;
  const mode = forcedMode ?? activeVersionMode.value;
  const unique = Array.from(new Set(refnos.filter(Boolean))).slice(0, 300);
  if (unique.length === 0) return;
  modelLoading.value = true;
  error.value = null;
  try {
    ensurePanelAndActivate('modelTree');
    ensurePanelAndActivate('viewer');
    await nextTick();
    const compareModelRows = compareRows.value
      .filter((row) => unique.includes(row.refno))
      .map((row) => ({
        refno: row.refno,
        category: row.category,
        status: row.status,
        beforeState: row.beforeState,
        afterState: row.afterState,
        sourceChangeCount: row.sourceChangeCount,
        sourceNouns: row.sourceNouns,
        // 删除节点的原父节点：树内差异模式用于幽灵节点回插定位
        ownerRefno: row.sourceChanges.find((change) => change.refno === row.refno)?.owner_refno
          ?? row.sourceChanges[0]?.owner_refno
          ?? undefined,
      }));
    const compareDetail = {
      project: record.project,
      dbnum: record.dbnum,
      fromSesno: record.from_sesno,
      toSesno: record.to_sesno,
      mode,
      compare: mode === 'compare',
      refnos: unique,
      models: compareModelRows,
      stats: compareStats.value,
    };
    const dispatchCompareDetail = () => {
      window.dispatchEvent(new CustomEvent('plant3d:incremental-version-compare', {
        detail: compareDetail,
      }));
    };
    dispatchCompareDetail();
    if (mode === 'compare') {
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      dispatchCompareDetail();
      return;
    }
    const result = await showModelByRefnosWithAck({
      refnos: unique.map(toSlashRefno),
      flyTo: true,
      readyTimeoutMs: 6000,
      timeoutMs: 30000,
    });
    if (result.error && result.ok.length === 0) {
      error.value = result.error;
    }
    dispatchCompareDetail();
  } finally {
    modelLoading.value = false;
  }
}

async function loadSelectedModel() {
  const refno = selectedModelRefno.value || selectedChange.value?.model_refno || selectedChange.value?.refno;
  if (!refno) return;
  await loadModelRefnos([refno]);
}

async function compareSelectedModel() {
  const refno = selectedModelRefno.value || selectedChange.value?.model_refno || selectedChange.value?.refno;
  if (!refno) return;
  activeVersionMode.value = 'compare';
  await loadModelRefnos([refno], 'compare');
}

async function loadAllChangedModels() {
  const refnos = activeVersionMode.value === 'changed' || activeVersionMode.value === 'compare'
    ? modelRows.value.map((row) => row.model_refno)
    : changes.value.map((row) => row.model_refno || row.refno);
  await loadModelRefnos(refnos);
}

async function compareAllChangedModels() {
  activeVersionMode.value = 'compare';
  await loadModelRefnos(modelRows.value.map((row) => row.model_refno), 'compare');
}

function focusSelectedChange() {
  const refno = selectedChange.value?.model_refno || selectedChange.value?.refno;
  if (!refno) return;
  setGlobalSelectedRefno(refno);
  window.dispatchEvent(new CustomEvent('autoLocateRefno', {
    detail: { refno: toSlashRefno(refno) },
  }));
}

function operationColor(operation: string): string {
  if (operation === 'add') return 'success';
  if (operation === 'modify') return 'warning';
  if (operation === 'delete') return 'error';
  return 'grey';
}

function operationLabel(operation: string): string {
  if (operation === 'add') return '新增';
  if (operation === 'modify') return '修改';
  if (operation === 'delete') return '删除';
  return operation || '-';
}

function recordStatusColor(status?: string): string {
  if (status === 'generated') return 'success';
  if (status === 'running') return 'info';
  if (status === 'failed') return 'error';
  if (status === 'changed') return 'warning';
  return 'grey';
}

function recordStatusLabel(status?: string): string {
  if (status === 'generated') return '已生成';
  if (status === 'running') return '运行中';
  if (status === 'failed') return '失败';
  if (status === 'changed') return '有变化';
  if (status === 'unchanged') return '无变化';
  return status || '未知';
}

function categoryLabel(category?: string | null): string {
  if (category === 'prim') return '基本体';
  if (category === 'loop_owner') return 'Loop';
  if (category === 'basic_cata') return '元件库';
  if (category === 'bran_hanger') return 'BRAN/HANG';
  if (category === 'delete') return '删除';
  return category || '-';
}

function parseOperations(value: string): string[] {
  return Array.from(new Set(value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)));
}

function modelCompareStatus(operations: string[]): CompareStatus {
  if (operations.length === 0) return 'unchanged';
  if (operations.length > 1) return 'mixed';
  if (operations[0] === 'add') return 'added';
  if (operations[0] === 'modify') return 'modified';
  if (operations[0] === 'delete') return 'deleted';
  return 'mixed';
}

function beforeStateForStatus(status: CompareStatus): VersionState {
  if (status === 'added') return 'missing';
  if (status === 'modified' || status === 'mixed') return 'changed';
  return 'present';
}

function afterStateForStatus(status: CompareStatus): VersionState {
  if (status === 'deleted') return 'missing';
  if (status === 'modified' || status === 'mixed') return 'changed';
  return 'present';
}

function compareStatusLabel(status: CompareStatus | string): string {
  if (status === 'added') return '新增';
  if (status === 'modified') return '修改';
  if (status === 'deleted') return '删除';
  if (status === 'mixed') return '混合';
  return '无变化';
}

function compareStatusColor(status: CompareStatus | string): string {
  if (status === 'added') return 'success';
  if (status === 'modified') return 'warning';
  if (status === 'deleted') return 'error';
  if (status === 'mixed') return 'info';
  return 'grey';
}

function compareStatusClass(status: CompareStatus): string {
  if (status === 'added') return 'delta-added';
  if (status === 'modified') return 'delta-modified';
  if (status === 'deleted') return 'delta-deleted';
  if (status === 'mixed') return 'delta-mixed';
  return 'delta-unchanged';
}

function versionStateLabel(state: VersionState): string {
  if (state === 'missing') return '不存在';
  if (state === 'changed') return '存在/变化';
  return '存在';
}

function versionStateColor(state: VersionState): string {
  if (state === 'missing') return 'grey';
  if (state === 'changed') return 'warning';
  return 'success';
}

function versionStateClass(state: VersionState): string {
  if (state === 'missing') return 'state-missing';
  if (state === 'changed') return 'state-changed';
  return 'state-present';
}

function operationTextClass(operation: string): string {
  if (operation === 'add') return 'text-emerald-700';
  if (operation === 'modify') return 'text-amber-700';
  if (operation === 'delete') return 'text-rose-700';
  return 'text-slate-600';
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

function attrStatusLabel(status: string): string {
  if (status === 'added') return '新增';
  if (status === 'removed') return '删除';
  if (status === 'changed') return '变化';
  return '相同';
}

function attrRowClass(status: string): string {
  if (status === 'added') return 'bg-emerald-50';
  if (status === 'removed') return 'bg-rose-50';
  if (status === 'changed') return 'bg-amber-50';
  return '';
}

function shortPath(path?: string | null): string {
  if (!path) return '-';
  return path.split(/[\\/]/).filter(Boolean).slice(-2).join('/');
}

function formatDate(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

onMounted(() => {
  void loadMonitor();
});

onUnmounted(() => {
  if (refreshTimer) window.clearInterval(refreshTimer);
});
</script>

<style scoped>
.incremental-panel {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
}

.incremental-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.incremental-switch {
  flex: 0 0 auto;
  min-width: 104px;
}

.incremental-summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(104px, 1fr));
  gap: 8px;
}

.incremental-monitor-shell {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: auto;
}

.monitor-list-section {
  flex: 0 0 220px;
  max-height: 260px;
  min-height: 220px;
  overflow: hidden;
}

.monitor-detail-section {
  flex: 0 0 620px;
  height: 620px;
  min-height: 620px;
}

.selected-record-header {
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  justify-content: space-between;
  gap: 12px;
}

.incremental-content {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
  gap: 12px;
}

.change-filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}

.version-mode-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.model-compare-overview {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(96px, 0.8fr) minmax(0, 1fr);
}

.model-compare-section {
  order: -1;
}

.version-summary,
.change-summary,
.version-state,
.delta-state {
  border: 1px solid rgb(226 232 240);
  border-radius: 6px;
  min-width: 0;
  padding: 8px 10px;
}

.version-summary.before,
.state-missing {
  background: rgb(248 250 252);
}

.version-summary.after,
.state-present {
  background: rgb(240 253 244);
  border-color: rgb(187 247 208);
}

.change-summary {
  align-content: center;
  background: white;
}

.selected-model-compare {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}

.state-changed {
  background: rgb(255 251 235);
  border-color: rgb(253 230 138);
}

.delta-state {
  text-align: center;
}

.delta-added {
  background: rgb(236 253 245);
  border-color: rgb(167 243 208);
  color: rgb(4 120 87);
}

.delta-modified {
  background: rgb(255 251 235);
  border-color: rgb(253 230 138);
  color: rgb(180 83 9);
}

.delta-deleted {
  background: rgb(255 241 242);
  border-color: rgb(254 205 211);
  color: rgb(190 18 60);
}

.delta-mixed {
  background: rgb(239 246 255);
  border-color: rgb(191 219 254);
  color: rgb(29 78 216);
}

.delta-unchanged {
  background: rgb(248 250 252);
  color: rgb(71 85 105);
}

.model-compare-filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}

.monitor-record {
  transition: background-color 120ms ease, box-shadow 120ms ease;
}

@container (min-width: 760px) {
  .incremental-monitor-shell {
    display: grid;
    grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
    overflow: hidden;
  }

  .monitor-list-section {
    flex: initial;
    max-height: none;
    min-height: 0;
    overflow: visible;
  }

  .monitor-detail-section {
    flex: initial;
    height: auto;
    min-height: 0;
  }

  .selected-record-header {
    align-items: center;
    flex-direction: row;
  }

  .change-filters {
    grid-template-columns: minmax(0, 1fr) 116px 116px;
  }

  .version-mode-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .model-compare-overview,
  .selected-model-compare {
    grid-template-columns: minmax(0, 1fr) minmax(120px, 0.8fr) minmax(0, 1fr);
  }

  .model-compare-filters {
    grid-template-columns: minmax(0, 1fr) 132px;
  }
}
</style>
