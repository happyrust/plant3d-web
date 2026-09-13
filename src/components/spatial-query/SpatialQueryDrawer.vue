<template>
  <div v-if="open"
    class="pointer-events-auto absolute right-14 top-24 z-[950] flex max-h-[82vh] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl transition-[width]"
    :class="isMiniMode ? 'w-[260px]' : 'w-[336px]'"
    @pointerdown.stop
    @wheel.stop>
    <div class="flex items-center justify-between border-b border-gray-100 px-3 py-2">
      <div class="min-w-0">
        <div class="font-ui text-sm font-semibold text-gray-900">空间查询</div>
        <div v-if="!isMiniMode" class="mt-0.5 text-[11px] text-gray-500">范围查询与距离查询</div>
      </div>
      <div class="flex items-center gap-1">
        <button type="button"
          class="rounded-md px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          :title="isMiniMode ? '展开面板' : '迷你模式'"
          data-testid="spatial-query-mini-toggle"
          @click="toggleMiniMode">
          {{ isMiniMode ? '展开' : '迷你' }}
        </button>
        <button type="button" class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900" title="关闭" @click="closePanel">
          <X class="h-4 w-4" />
        </button>
      </div>
    </div>

    <div v-if="isMiniMode" class="px-3 py-2.5">
      <div class="rounded-lg border border-gray-100 bg-gray-50/70 p-2.5">
        <div class="flex items-center justify-between gap-2">
          <div class="font-ui text-sm font-semibold text-gray-900">空间查询</div>
          <span class="rounded-full bg-white px-2 py-0.5 text-[11px] text-gray-600">{{ modeLabel }}</span>
        </div>
        <div class="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
          <div class="rounded-md bg-white px-2 py-1">
            <div class="text-gray-400">半径</div>
            <div class="font-mono font-semibold text-brand">{{ radiusMetersText }} m</div>
          </div>
          <div class="rounded-md bg-white px-2 py-1">
            <div class="text-gray-400">结果</div>
            <div class="font-mono font-semibold text-gray-700">{{ miniResultText }}</div>
          </div>
        </div>
        <div v-if="resultSet" class="mt-2 truncate text-[11px] text-gray-500">{{ resultBreakdown }}</div>
        <button type="button"
          class="mt-2 w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
          data-testid="spatial-query-mini-expand"
          @click="expandFromMiniMode">
          展开面板
        </button>
      </div>
    </div>

    <div v-else class="flex flex-1 flex-col overflow-y-auto px-3 py-3">
      <div class="flex flex-col gap-3">
        <div class="flex rounded-md bg-gray-100 p-1">
          <button type="button"
            class="flex-1 rounded py-1.5 text-xs font-medium transition-colors"
            :class="draft.mode === 'range' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'"
            @click="setMode('range')">
            范围查询
          </button>
          <button type="button"
            class="flex-1 rounded py-1.5 text-xs font-medium transition-colors"
            :class="draft.mode === 'distance' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'"
            @click="setMode('distance')">
            距离查询
          </button>
        </div>

        <template v-if="draft.mode === 'range'">
          <section class="rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
            <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">中心来源</div>
            <div class="mt-2 grid grid-cols-3 gap-1.5">
              <button type="button"
                class="rounded-md border px-2 py-1.5 text-xs transition-colors"
                :class="draft.rangeCenterSource === 'selected' ? 'border-brand bg-brand-subtle text-brand' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'"
                @click="draft.rangeCenterSource = 'selected'">
                当前选中
              </button>
              <button type="button"
                class="rounded-md border px-2 py-1.5 text-xs transition-colors"
                :class="draft.rangeCenterSource === 'pick' ? 'border-brand bg-brand-subtle text-brand' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'"
                @click="startPick">
                拾取中心
              </button>
              <button type="button"
                class="rounded-md border px-2 py-1.5 text-xs transition-colors"
                :class="draft.rangeCenterSource === 'coordinates' ? 'border-brand bg-brand-subtle text-brand' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'"
                @click="draft.rangeCenterSource = 'coordinates'">
                手输坐标
              </button>
            </div>
            <div class="mt-2 flex gap-1.5">
              <button type="button"
                class="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                @click="useSelection">
                <MousePointerClick class="h-3.5 w-3.5" />
                使用当前选中
              </button>
              <div class="flex min-w-0 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-500">
                <MapPinned class="h-3.5 w-3.5 text-brand" />
                <span>{{ centerSummary }}</span>
              </div>
            </div>
          </section>
        </template>

        <template v-else>
          <section class="rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
            <div class="flex items-center justify-between">
              <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">起始位置</div>
              <div class="flex rounded-md bg-white p-0.5 text-[11px]">
                <button type="button"
                  class="rounded px-2 py-0.5 font-medium transition-colors"
                  :class="draft.distanceCenterSource === 'refno' ? 'bg-brand-subtle text-brand' : 'text-gray-500 hover:text-gray-700'"
                  @click="draft.distanceCenterSource = 'refno'">
                  通过 Refno
                </button>
                <button type="button"
                  class="rounded px-2 py-0.5 font-medium transition-colors"
                  :class="draft.distanceCenterSource === 'coordinates' ? 'bg-brand-subtle text-brand' : 'text-gray-500 hover:text-gray-700'"
                  @click="draft.distanceCenterSource = 'coordinates'">
                  通过坐标
                </button>
              </div>
            </div>
            <div v-if="draft.distanceCenterSource === 'refno'" class="mt-3 space-y-2">
              <label class="block text-xs text-gray-500">拾取起始物项</label>
              <div class="flex gap-1.5">
                <button type="button"
                  class="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  data-testid="pick-from-selection"
                  @click="pickRefnoFromSelection">
                  <MousePointerClick class="h-3.5 w-3.5" />
                  拾取物项
                </button>
                <div class="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs">
                  <span class="h-2 w-2 shrink-0 rounded-full"
                    :class="draft.refno.trim() ? 'bg-success' : 'bg-gray-300'"
                    aria-hidden="true" />
                  <span v-if="draft.refno.trim()" class="truncate font-mono text-gray-900">{{ draft.refno.trim() }}</span>
                  <span v-else class="text-gray-400">尚未选中物项</span>
                </div>
              </div>
              <div class="flex items-center gap-1.5">
                <label class="text-[11px] text-gray-400">或手填 Refno</label>
                <input v-model="draft.refno"
                  type="text"
                  placeholder="例如：24381_100818"
                  class="h-7 w-full rounded-md border border-gray-200 bg-white px-2.5 font-mono text-[11px] text-gray-900 outline-none focus:border-brand" />
              </div>
            </div>
          </section>
        </template>

        <section v-if="showCoordinateInputs" class="rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
          <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">中心坐标</div>
          <div class="mt-2 grid grid-cols-3 gap-1.5">
            <label class="text-xs text-gray-500">
              <span class="mb-1 block">X</span>
              <input v-model.number="draft.center.x"
                type="number"
                class="h-8 w-full rounded-md border border-gray-200 bg-white px-2 font-mono text-xs text-gray-900 outline-none focus:border-brand" />
            </label>
            <label class="text-xs text-gray-500">
              <span class="mb-1 block">Y</span>
              <input v-model.number="draft.center.y"
                type="number"
                class="h-8 w-full rounded-md border border-gray-200 bg-white px-2 font-mono text-xs text-gray-900 outline-none focus:border-brand" />
            </label>
            <label class="text-xs text-gray-500">
              <span class="mb-1 block">Z</span>
              <input v-model.number="draft.center.z"
                type="number"
                class="h-8 w-full rounded-md border border-gray-200 bg-white px-2 font-mono text-xs text-gray-900 outline-none focus:border-brand" />
            </label>
          </div>
        </section>

        <section class="rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
          <div class="flex items-center justify-between gap-3">
            <label class="min-w-0 flex-1 text-xs text-gray-500">
              <span class="mb-1 block">查询半径 (m)</span>
              <input :value="radiusMetersValue"
                type="number"
                :min="DISTANCE_RADIUS_MIN_M"
                :max="DISTANCE_RADIUS_MAX_M"
                :step="DISTANCE_RADIUS_STEP_M"
                class="h-8 w-full rounded-md border border-gray-200 bg-white px-2.5 font-mono text-xs text-gray-900 outline-none focus:border-brand"
                @input="onRadiusMetersNumberInput" />
            </label>
            <div class="shrink-0 text-right">
              <div class="text-[11px] text-gray-400">当前值</div>
              <div class="font-mono text-lg font-semibold text-brand">
                {{ radiusMetersText }} <span class="text-xs text-brand/70">m</span>
              </div>
            </div>
          </div>
          <input :value="radiusMetersValue"
            type="range"
            :min="DISTANCE_RADIUS_MIN_M"
            :max="DISTANCE_RADIUS_MAX_M"
            :step="DISTANCE_RADIUS_STEP_M"
            data-testid="radius-slider"
            class="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-gray-200 accent-brand"
            @input="onRadiusSliderInput" />
          <div class="mt-2 grid grid-cols-4 gap-1.5">
            <button v-for="preset in DISTANCE_RADIUS_PRESETS"
              :key="preset"
              type="button"
              class="rounded-full border px-2 py-1 text-[11px] transition-colors"
              :class="radiusMetersValue === preset ? 'border-brand bg-brand-subtle text-brand' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'"
              data-testid="radius-preset"
              @click="setRadiusMeters(preset)">
              {{ preset }} m
            </button>
          </div>
        </section>

        <section class="rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
          <button type="button"
            class="flex w-full items-center justify-between text-left"
            data-testid="spatial-advanced-toggle"
            :aria-expanded="advancedFiltersExpanded"
            @click="advancedFiltersExpanded = !advancedFiltersExpanded">
            <span class="text-xs font-semibold uppercase tracking-wide text-gray-500">更多条件</span>
            <span class="text-[11px] text-gray-500">{{ advancedFiltersExpanded ? '收起' : '展开' }}</span>
          </button>
          <div v-if="advancedFiltersExpanded" class="mt-2 flex flex-col gap-2.5">
            <section>
              <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">查询形状</div>
              <div class="mt-2 grid grid-cols-2 gap-1.5">
                <button type="button"
                  class="rounded-md border px-2.5 py-1.5 text-xs transition-colors"
                  :class="draft.shape === 'sphere' ? 'border-brand bg-brand-subtle text-brand' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'"
                  @click="draft.shape = 'sphere'">
                  球形
                </button>
                <button type="button"
                  class="rounded-md border px-2.5 py-1.5 text-xs transition-colors"
                  :class="draft.shape === 'cube' ? 'border-brand bg-brand-subtle text-brand' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'"
                  @click="draft.shape = 'cube'">
                  立方体
                </button>
              </div>
            </section>
            <section>
              <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">结果排序</div>
              <div class="mt-2 grid grid-cols-3 gap-1.5">
                <button v-for="option in sortOptions"
                  :key="option.value"
                  type="button"
                  class="rounded-md border px-2 py-1.5 text-[11px] transition-colors"
                  :class="draft.sortBy === option.value ? 'border-brand bg-brand-subtle text-brand' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'"
                  :title="option.hint"
                  :data-testid="`spatial-sort-${option.value}`"
                  @click="setSortBy(option.value)">
                  {{ option.label }}
                </button>
              </div>
            </section>
            <label class="text-xs text-gray-500">
              <span class="mb-1 block">每页数量</span>
              <input v-model.number="draft.limit"
                type="number"
                min="1"
                class="h-8 w-full rounded-md border border-gray-200 bg-white px-2.5 font-mono text-xs text-gray-900 outline-none focus:border-brand" />
            </label>
            <label class="text-xs text-gray-500">
              <span class="mb-1 block">Noun 类型（逗号分隔）</span>
              <input v-model="draft.nounText"
                type="text"
                placeholder="例如：PIPE,EQUI,BRAN"
                class="h-8 w-full rounded-md border border-gray-200 bg-white px-2.5 font-mono text-xs text-gray-900 outline-none focus:border-brand" />
            </label>
            <div v-if="hasSpecDimension" class="text-xs text-gray-500" data-testid="spec-filter">
              <div class="mb-1 flex items-center justify-between">
                <span>专业过滤</span>
                <div class="flex items-center gap-2 text-[11px]">
                  <button type="button"
                    class="text-gray-500 transition-colors hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="allSpecSelected"
                    data-testid="spec-select-all"
                    @click="selectAllSpecs">
                    全选
                  </button>
                  <span class="text-gray-300">·</span>
                  <button type="button"
                    class="text-gray-500 transition-colors hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="draft.specValues.length === 0"
                    data-testid="spec-clear"
                    @click="clearSpecs">
                    清空
                  </button>
                </div>
              </div>
              <div class="flex flex-wrap gap-1.5">
                <button v-for="spec in specOptions"
                  :key="spec.value"
                  type="button"
                  class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors"
                  :class="selectedSpecValues.has(spec.value)
                    ? 'border-brand bg-brand-subtle text-brand'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'"
                  :title="spec.fullLabel"
                  data-testid="spec-chip"
                  :data-spec-value="spec.value"
                  @click="toggleSpecValue(spec.value)">
                  <span class="inline-block h-2 w-2 rounded-full"
                    :style="{ backgroundColor: getSpecBadgeStyle(spec.value).fg }"
                    aria-hidden="true" />
                  {{ spec.label }}
                </button>
              </div>
              <p class="mt-1 text-[10px] text-gray-400">
                未选 = 不过滤，显示全部专业；已选多项 = 仅显示选中的专业。
              </p>
            </div>
            <label class="text-xs text-gray-500">
              <span class="mb-1 block">关键字（Refno / 名称）</span>
              <input v-model="draft.keyword"
                type="text"
                placeholder="支持 Refno 或名称关键字"
                class="h-8 w-full rounded-md border border-gray-200 bg-white px-2.5 text-xs text-gray-900 outline-none focus:border-brand" />
            </label>
            <div class="flex flex-wrap gap-1.5">
              <label class="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-600">
                <input v-model="draft.onlyLoaded" type="checkbox" />
                <span>仅看已加载</span>
              </label>
              <label class="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-600">
                <input v-model="draft.onlyVisible" type="checkbox" />
                <span>仅看当前可见</span>
              </label>
              <label class="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-600">
                <input v-model="draft.includeNegative" type="checkbox" data-testid="include-negative-checkbox" />
                <span>显示负实体</span>
              </label>
            </div>
          </div>
        </section>

        <button type="button"
          :disabled="!canSubmit || isQueryBusy"
          class="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          @click="runQuery">
          <Loader2 v-if="isQueryBusy" class="h-4 w-4 animate-spin" />
          <Search v-else class="h-4 w-4" />
          <span>{{ isQueryBusy ? statusLabel : '执行空间查询' }}</span>
        </button>

        <div v-if="error" class="rounded-lg border border-danger/30 bg-danger-subtle px-2.5 py-1.5 text-xs text-danger">
          {{ error }}
        </div>

        <section class="rounded-lg border border-gray-100 bg-white">
          <div class="border-b border-gray-100 px-3 py-2">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="text-sm font-semibold text-gray-900">查询结果</div>
                <div class="mt-0.5 text-[11px] text-gray-500">
                  {{ summaryText }}
                </div>
                <div v-if="resultSet" class="mt-0.5 truncate text-[11px] text-gray-400">
                  {{ resultBreakdown }}
                </div>
              </div>
              <button v-if="resultSet"
                type="button"
                class="shrink-0 rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
                data-testid="spatial-results-toggle"
                @click="resultsExpanded = !resultsExpanded">
                {{ resultsExpanded ? '收起结果' : '查看结果' }}
              </button>
            </div>
            <div v-if="resultSet" class="mt-2 grid grid-cols-3 gap-1.5">
              <button type="button"
                class="rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="isQueryBusy"
                @click="loadCurrentResults">
                加载当前页
              </button>
              <button type="button"
                class="rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="isQueryBusy"
                @click="loadUnloadedResults">
                只加载未加载
              </button>
              <button type="button"
                class="rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                @click="clearResults">
                清空
              </button>
            </div>
          </div>

          <div v-if="resultSet && resultsExpanded" class="border-b border-gray-100 px-3 py-2">
            <div class="grid grid-cols-2 gap-1.5">
              <button type="button" class="rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50" @click="showAll">
                全部显示
              </button>
              <button type="button" class="rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50" @click="hideAll">
                全部隐藏
              </button>
              <button type="button" class="rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50" @click="isolateAll">
                隔离结果
              </button>
              <button type="button" class="rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50" @click="restoreAll">
                恢复场景
              </button>
              <button type="button"
                class="rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="pagedResultItems.length === 0"
                data-testid="copy-current-page-refnos"
                @click="copyCurrentPageRefnos">
                复制当前页 Refno
              </button>
              <button type="button"
                class="rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="allReturnedRefnos.length === 0"
                data-testid="copy-all-returned-refnos"
                @click="copyAllReturnedRefnos">
                复制已返回 Refno
              </button>
            </div>
            <div v-if="copyStatus" class="mt-1.5 text-[11px] text-success">
              {{ copyStatus }}
            </div>
          </div>

          <div v-if="resultsExpanded && resultCenterText" class="border-b border-gray-100 px-3 py-2 text-[11px] text-gray-500" data-testid="spatial-result-center">
            {{ resultCenterText }}
          </div>

          <div v-if="resultsExpanded && resultSet?.warnings.length" class="space-y-1.5 border-b border-gray-100 px-3 py-2">
            <div v-for="warning in resultSet.warnings"
              :key="warning"
              class="rounded-md border border-warning/30 bg-warning-subtle px-2 py-1 text-xs text-warning">
              {{ warning }}
            </div>
          </div>

          <div v-if="resultsExpanded && resultSet && resultSet.items.length > 0" class="border-b border-gray-100 px-3 py-2">
            <div class="mb-2 flex items-center justify-between gap-2">
              <div>
                <div class="text-xs font-semibold text-gray-900">房间列表</div>
                <div class="mt-0.5 text-[11px] text-gray-500">
                  <span v-if="roomListLoading">正在解析所在房间...</span>
                  <span v-else-if="roomListRows.length > 0">当前页涉及 {{ roomListRows.length }} 个房间</span>
                  <span v-else>当前页暂未解析到房间</span>
                </div>
              </div>
              <button type="button"
                class="rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="roomListLoading"
                @click="refreshRoomList">
                刷新
              </button>
            </div>
            <div v-if="roomListError" class="mb-2 rounded-md border border-warning/30 bg-warning-subtle px-2 py-1 text-xs text-warning">
              {{ roomListError }}
            </div>
            <div v-if="roomListRows.length > 0" class="max-h-40 space-y-1.5 overflow-y-auto">
              <div v-for="room in roomListRows"
                :key="room.roomRefno"
                class="rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5">
                <div class="flex items-start justify-between gap-2">
                  <button type="button"
                    class="min-w-0 text-left"
                    @click="openRoomInfo(room)">
                    <div class="truncate text-xs font-medium text-gray-900">{{ room.name }}</div>
                    <div class="mt-0.5 flex flex-wrap gap-1">
                      <span class="rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-gray-500">{{ room.roomRefno }}</span>
                      <span class="rounded-full bg-white px-2 py-0.5 text-[11px] text-gray-500">{{ room.roomType }}</span>
                      <span class="rounded-full bg-brand-subtle px-2 py-0.5 text-[11px] text-brand">{{ room.count }} 项</span>
                    </div>
                    <div v-if="room.desc" class="mt-1 truncate text-[11px] text-gray-500">{{ room.desc }}</div>
                  </button>
                  <div class="flex shrink-0 gap-1">
                    <button type="button"
                      class="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
                      @click="openRoomInfo(room)">
                      信息
                    </button>
                    <button type="button"
                      class="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
                      @click="showRoomModel(room)">
                      显示
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="!resultSet && !isQueryBusy" class="px-3 py-6 text-center text-xs text-gray-400">
            暂无结果，执行一次空间查询后会在这里{{ groupDimensionLabel }}分组显示。
          </div>

          <div v-else-if="resultsExpanded && resultSet && resultSet.items.length === 0 && !isQueryBusy" class="px-3 py-6 text-center text-xs text-gray-400">
            当前条件下没有匹配结果。
          </div>

          <div v-if="resultsExpanded && resultSet && resultSet.items.length > 0" class="flex items-center justify-between border-b border-gray-100 px-3 py-2 text-[11px] text-gray-500">
            <div>
              每页 {{ resultSet.perPage }} 项 · 当前 {{ resultPageStart }}-{{ resultPageEnd }} / {{ resultSet.total }}
            </div>
            <div v-if="resultTotalPages > 1" class="flex items-center gap-1.5">
              <button type="button"
                class="rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="isQueryBusy || currentResultPage <= 1"
                data-testid="spatial-result-page-prev"
                @click="setResultPage(currentResultPage - 1)">
                上一页
              </button>
              <span class="font-mono text-gray-600">第 {{ currentResultPage }} / {{ resultTotalPages }} 页</span>
              <button type="button"
                class="rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="isQueryBusy || !resultSet.hasMore"
                data-testid="spatial-result-page-next"
                @click="setResultPage(currentResultPage + 1)">
                下一页
              </button>
            </div>
          </div>

          <div v-if="resultsExpanded && resultSet && resultSet.coverage === 'global-tree'"
            class="border-b border-gray-100 bg-gray-50 px-3 py-2 text-[11px] text-gray-500"
            data-testid="spatial-coverage-hint">
            结果仅含已生成过模型的构件（空间索引只收已生成的包围盒）；从未显示过的构件不在其中，先显示它们再查会被纳入。
          </div>

          <div v-if="resultsExpanded && resultSet && resultSet.items.length > 0" class="max-h-[280px] overflow-y-auto px-3 py-2.5">
            <div v-for="group in displayGroups" :key="`${group.kind}:${group.key}`" class="mb-3 last:mb-0" data-testid="spatial-result-group">
              <div class="mb-1.5 flex items-center justify-between">
                <div>
                  <div class="text-xs font-semibold uppercase tracking-wide text-gray-500" data-testid="spatial-result-group-title">
                    {{ group.label }}
                  </div>
                  <div class="mt-0.5 text-[11px] text-gray-400">{{ group.count }} 项</div>
                </div>
                <div class="flex items-center gap-1.5">
                  <button type="button"
                    class="rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="isQueryBusy"
                    data-testid="spatial-result-group-load"
                    @click="loadDisplayGroup(group)">
                    加载本{{ groupUnitLabel }}
                  </button>
                  <button type="button"
                    class="rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-white"
                    data-testid="spatial-result-group-show-only"
                    @click="showOnlyDisplayGroup(group)">
                    仅显示本{{ groupUnitLabel }}
                  </button>
                </div>
              </div>

              <div class="space-y-1.5">
                <button v-for="item in group.items"
                  :key="item.refno"
                  type="button"
                  class="w-full rounded-lg border px-2.5 py-1.5 text-left transition-colors"
                  :class="activeResultRefno === item.refno ? 'border-brand bg-brand-subtle' : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'"
                  @click="focusItem(item)">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <div class="truncate text-xs font-medium text-gray-900">{{ item.name || item.refno }}</div>
                      <div class="mt-0.5 truncate font-mono text-[11px] text-gray-500">{{ item.refno }}</div>
                      <div class="mt-1 flex flex-wrap gap-1">
                        <span class="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">{{ item.noun || 'UNKNOWN' }}</span>
                        <span class="rounded-full px-2 py-0.5 text-[11px]" :class="item.loaded ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning'">
                          {{ item.loaded ? '已加载' : '未加载' }}
                        </span>
                        <span v-if="item.distance !== null" class="rounded-full bg-brand-subtle px-2 py-0.5 text-[11px] text-brand">
                          {{ formatDistance(item.distance) }}
                        </span>
                      </div>
                    </div>

                    <div class="flex shrink-0 items-center gap-1">
                      <button type="button"
                        class="rounded-md p-1 text-gray-500 hover:bg-white hover:text-gray-800"
                        :title="item.visible ? '隐藏' : '显示'"
                        @click.stop="toggleVisibility(item)">
                        <Eye v-if="item.visible" class="h-4 w-4" />
                        <EyeOff v-else class="h-4 w-4" />
                      </button>
                      <button type="button"
                        class="rounded-md p-1 text-gray-500 hover:bg-white hover:text-gray-800"
                        title="飞行定位"
                        data-testid="locate-spatial-result"
                        :data-refno="item.refno"
                        @click.stop="focusItem(item)">
                        <ArrowUpRight class="h-4 w-4" />
                      </button>
                      <button v-if="canAnnotatePipeDistance(item)"
                        type="button"
                        class="rounded-md p-1 text-gray-500 hover:bg-white hover:text-gray-800"
                        title="按管径净距标注"
                        @click.stop="annotatePipeDistance(item)">
                        <Ruler class="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { ArrowUpRight, Eye, EyeOff, Loader2, MapPinned, MousePointerClick, Ruler, Search, X } from 'lucide-vue-next';
import { Vector3, type Matrix4 } from 'three';

import type { SpatialQueryMode, SpatialQueryResultItem, SpatialQuerySortBy } from '@/types/spatialQuery';
import type { Vec3 } from '@/types/vec3';

import { findNounByRefnoAcrossAllDbnos } from '@/composables/useDbnoInstancesDtxLoader';
import { usePipeDistanceStore } from '@/composables/usePipeDistanceStore';
import { resolveContainingRoomInfo, useRoomInfoPanel } from '@/composables/useRoomInfoPanel';
import { useSpatialQuery } from '@/composables/useSpatialQuery';
import { useViewerContext } from '@/composables/useViewerContext';
import { emitCommand } from '@/ribbon/commandBus';
import {
  SITE_SPEC_OPTIONS_WITH_UNKNOWN,
  getSpecBadgeStyle,
  getSpecValueShortName,
} from '@/types/spec';

defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

type ViewerWithDtxLayerMatrix = {
  __dtxLayer?: {
    getGlobalModelMatrix?: () => Matrix4 | null;
  };
};

const spatialQuery = useSpatialQuery();
const roomInfoPanel = useRoomInfoPanel();
const pipeDistanceStore = usePipeDistanceStore();
const viewerContext = useViewerContext();
const {
  draft,
  status,
  error,
  resultSet,
  activeResultRefno,
  canSubmit,
  spatialCapabilities,
  setMode: setSpatialQueryMode,
  applyCurrentSelection,
  startPickCenter,
  submitQuery,
  clearResults,
  activateResult,
  loadResults,
  showOnlySpecGroup,
  showOnlyDbnumGroup,
  toggleResultVisible,
  setAllResultsVisible,
  isolateResults,
  restoreScene,
} = spatialQuery;

/**
 * 当前源有没有专业维度（legacy 有，gen-model-v1 没有——plan 2026-09-13 空间范围查询 §5-1 按 (a)）：
 * 没有就收起专业过滤 / 「按专业」排序，结果改按库（dbnum）分组。
 */
const hasSpecDimension = computed(() => spatialCapabilities.value.specValues);
const groupDimensionLabel = computed(() => (hasSpecDimension.value ? '按专业' : '按库'));
const groupUnitLabel = computed(() => (hasSpecDimension.value ? '专业' : '库'));

const METERS_TO_MM = 1000;
const DISTANCE_RADIUS_MIN_M = 0.1;
const DISTANCE_RADIUS_MAX_M = 100;
const DISTANCE_RADIUS_STEP_M = 0.1;
const DISTANCE_RADIUS_PRESETS = [1, 5, 10, 50] as const;

const isQueryBusy = computed(() => ['resolving-center', 'querying-local', 'querying-server', 'merging-results', 'loading-model-for-result', 'loading-results-batch', 'flying-to-result'].includes(status.value));
const specOptions = computed(() => {
  const resultSpecOptions = resultSet.value?.filterOptions?.specValues ?? [];
  if (resultSpecOptions.length === 0) return SITE_SPEC_OPTIONS_WITH_UNKNOWN;
  return resultSpecOptions.map((option) => {
    const fallback = SITE_SPEC_OPTIONS_WITH_UNKNOWN.find((item) => item.value === option.value);
    return {
      value: option.value,
      label: `${fallback?.label ?? getSpecValueShortName(option.value)}(${option.count})`,
      fullLabel: `${fallback?.fullLabel ?? option.label}，${option.count} 项`,
    };
  });
});
const selectedSpecValues = computed(() => new Set(draft.specValues));
const copyStatus = ref<string | null>(null);
const isMiniMode = ref(false);
const advancedFiltersExpanded = ref(false);
const resultsExpanded = ref(false);
const roomListLoading = ref(false);
const roomListError = ref<string | null>(null);
const roomListRows = ref<SpatialRoomListRow[]>([]);
let roomListSeq = 0;

type SpatialRoomListRow = {
  roomRefno: string;
  name: string;
  roomType: string;
  desc: string;
  count: number;
  sourceRefnos: string[];
};

const allSpecSelected = computed(() => draft.specValues.length === specOptions.value.length);
const radiusMetersValue = computed(() => Number((draft.radius / METERS_TO_MM).toFixed(3)));
const radiusMetersText = computed(() => formatMeters(radiusMetersValue.value));
const modeLabel = computed(() => (draft.mode === 'range' ? '范围查询' : '距离查询'));
const miniResultText = computed(() => {
  if (!resultSet.value) return '暂无';
  return `${resultSet.value.total} 项`;
});

function formatMeters(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value - Math.round(value)) < 0.0001) return String(Math.round(value));
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function setRadiusMeters(value: number): void {
  if (!Number.isFinite(value) || value <= 0) return;
  // 服务端半径硬上限 100 m（sqlite_spatial_api MAX_CLEARANCE_RADIUS_MM），
  // 提交前 clamp，避免手输大值后整次查询被服务端拒绝。
  const clamped = Math.min(value, DISTANCE_RADIUS_MAX_M);
  draft.radius = Math.round(clamped * METERS_TO_MM);
}

function selectAllSpecs(): void {
  draft.specValues = specOptions.value.map((option) => option.value);
}

function clearSpecs(): void {
  draft.specValues = [];
}

const resultBreakdown = computed<string>(() => {
  if (!resultSet.value) return '';
  const parts = hasSpecDimension.value
    ? resultSet.value.groups
      .filter((group) => group.count > 0)
      .map((group) => `${group.count} ${getSpecValueShortName(group.specValue)}`)
    : (resultSet.value.dbnumGroups ?? [])
      .filter((group) => group.count > 0)
      .map((group) => `${group.count} 库${group.dbnum}`);
  if (parts.length === 0) {
    return `共 ${resultSet.value.total} 项`;
  }
  return `共 ${resultSet.value.total} 项 · ${parts.join(' · ')}`;
});

const showCoordinateInputs = computed(() => {
  return (draft.mode === 'range' && (draft.rangeCenterSource === 'coordinates' || draft.rangeCenterSource === 'pick'))
    || (draft.mode === 'distance' && draft.distanceCenterSource === 'coordinates');
});

const centerSummary = computed(() => {
  return `${draft.center.x.toFixed(0)}, ${draft.center.y.toFixed(0)}, ${draft.center.z.toFixed(0)}`;
});

const resultCenterText = computed(() => {
  const center = resultSet.value?.center;
  if (!center) return '';
  const refno = center.refno ? ` · ${center.refno}` : '';
  return `中心 ${center.x.toFixed(0)}, ${center.y.toFixed(0)}, ${center.z.toFixed(0)} · ${center.source}${refno}`;
});

const statusLabel = computed(() => {
  switch (status.value) {
    case 'resolving-center':
      return '解析中心点...';
    case 'querying-local':
      return '扫描已加载模型...';
    case 'querying-server':
      return '查询空间索引...';
    case 'merging-results':
      return '合并结果...';
    case 'loading-model-for-result':
      return '加载模型...';
    case 'loading-results-batch':
      return '批量加载模型...';
    case 'flying-to-result':
      return '定位结果...';
    default:
      return '处理中...';
  }
});

const summaryText = computed(() => {
  if (!resultSet.value) {
    return `支持范围查询与距离查询，结果会${groupDimensionLabel.value}分组。`;
  }
  return `共 ${resultSet.value.total} 项，当前页 ${resultSet.value.returnedCount} 项，已加载 ${resultSet.value.loadedCount} 项，未加载 ${resultSet.value.unloadedCount} 项`;
});

const resultTotalPages = computed(() => {
  return resultSet.value?.totalPages ?? 1;
});

const currentResultPage = computed(() => {
  return resultSet.value?.page ?? 1;
});

const pagedResultItems = computed(() => {
  return resultSet.value?.items ?? [];
});

const allReturnedRefnos = computed(() => {
  return uniqueRefnosInOrder(resultSet.value?.items ?? []);
});

/** 结果区的一组：legacy 按专业（`key` = spec_value），gen-model-v1 按库（`key` = dbnum）。 */
type DisplayGroup = {
  kind: 'spec' | 'dbnum';
  key: number;
  label: string;
  count: number;
  items: SpatialQueryResultItem[];
};

/** 没有库号的条目（legacy 结果、占位项）归到这一组，避免按库分组时把它们丢掉。 */
const UNKNOWN_DBNUM_KEY = -1;

const displayGroups = computed<DisplayGroup[]>(() => {
  const byDbnum = !hasSpecDimension.value;
  const keyOf = (item: SpatialQueryResultItem): number =>
    byDbnum ? (typeof item.dbnum === 'number' ? item.dbnum : UNKNOWN_DBNUM_KEY) : item.specValue;

  const grouped = new Map<number, SpatialQueryResultItem[]>();
  for (const item of pagedResultItems.value) {
    const key = keyOf(item);
    const list = grouped.get(key) ?? [];
    list.push(item);
    grouped.set(key, list);
  }

  // 分组小计取服务端的全量计数，条目仍只列当前页，否则小计和「共 N 项」对不上。
  const globalCounts = new Map<number, number>(
    byDbnum
      ? (resultSet.value?.dbnumGroups ?? []).map((group) => [group.dbnum, group.count])
      : (resultSet.value?.groups ?? []).map((group) => [group.specValue, group.count]),
  );

  // 全量命中里存在、但当前页没有条目的组也要露出组头（含小计与批量按钮），
  // 否则翻页时整组"消失"，用户会以为该专业 / 该库没有命中。
  for (const key of globalCounts.keys()) {
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
  }

  return Array.from(grouped.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([key, items]) => ({
      kind: byDbnum ? 'dbnum' as const : 'spec' as const,
      key,
      label: byDbnum
        ? (key === UNKNOWN_DBNUM_KEY ? '库未知' : `库 ${key}`)
        : (items[0]?.specName ?? getSpecValueShortName(key)),
      count: globalCounts.get(key) ?? items.length,
      items,
    }));
});

const resultPageStart = computed(() => {
  const result = resultSet.value;
  if (!result || result.items.length === 0) return 0;
  return (result.page - 1) * result.perPage + 1;
});

const resultPageEnd = computed(() => {
  const result = resultSet.value;
  if (!result || result.items.length === 0) return 0;
  return resultPageStart.value + result.items.length - 1;
});

function attrText(attrs: Record<string, unknown>, key: string): string {
  const value = attrs[key] ?? attrs[key.toUpperCase()] ?? attrs[key.toLowerCase()];
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

async function refreshRoomList() {
  const seq = ++roomListSeq;
  const items = resultSet.value?.items ?? [];
  roomListRows.value = [];
  roomListError.value = null;
  if (items.length === 0) return;

  roomListLoading.value = true;
  try {
    const grouped = new Map<string, SpatialRoomListRow>();
    const resolved = await Promise.all(items.map(async (item) => {
      try {
        return {
          item,
          info: await resolveContainingRoomInfo(item.refno),
        };
      } catch {
        return {
          item,
          info: null,
        };
      }
    }));
    if (seq !== roomListSeq) return;

    for (const { item, info } of resolved) {
      if (!info) continue;
      const roomType = attrText(info.attrs, 'TYPE') || 'ROOM';
      const desc = attrText(info.attrs, 'DESC') || attrText(info.attrs, 'DESCRIPTION');
      const name = info.fullName || attrText(info.attrs, 'NAME') || info.roomRefno;
      const existing = grouped.get(info.roomRefno);
      if (existing) {
        existing.count += 1;
        existing.sourceRefnos.push(item.refno);
      } else {
        grouped.set(info.roomRefno, {
          roomRefno: info.roomRefno,
          name,
          roomType,
          desc,
          count: 1,
          sourceRefnos: [item.refno],
        });
      }
    }

    roomListRows.value = Array.from(grouped.values()).sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    if (seq !== roomListSeq) return;
    roomListError.value = e instanceof Error ? e.message : String(e);
    roomListRows.value = [];
  } finally {
    if (seq === roomListSeq) {
      roomListLoading.value = false;
    }
  }
}

watch(
  () => (resultSet.value?.items ?? []).map((item) => item.refno).join('|'),
  () => {
    void refreshRoomList();
  },
  { immediate: true },
);

function openRoomInfo(room: SpatialRoomListRow) {
  void roomInfoPanel.openForRefno(room.roomRefno);
}

function showRoomModel(room: SpatialRoomListRow) {
  void (async () => {
    await roomInfoPanel.openForRefno(room.roomRefno);
    await roomInfoPanel.showRoomModel(room.roomRefno);
  })();
}

function closePanel() {
  emit('update:open', false);
}

function toggleMiniMode() {
  isMiniMode.value = !isMiniMode.value;
}

function expandFromMiniMode() {
  isMiniMode.value = false;
}

function setResultPage(page: number) {
  if (!Number.isFinite(page)) return;
  const nextPage = Math.min(Math.max(Math.floor(page), 1), resultTotalPages.value);
  if (nextPage === currentResultPage.value || isQueryBusy.value) return;
  void submitQuery(nextPage);
}

const ALL_SORT_OPTIONS: { value: SpatialQuerySortBy; label: string; hint: string }[] = [
  { value: 'distanceAsc', label: '按距离', hint: '由近及远' },
  { value: 'specThenDistance', label: '按专业', hint: '先按专业分组，组内由近及远' },
  { value: 'nameAsc', label: '按名称', hint: '按构件名称升序' },
];

/** 没有专业维度的源不给「按专业」这一档。 */
const sortOptions = computed(() =>
  hasSpecDimension.value ? ALL_SORT_OPTIONS : ALL_SORT_OPTIONS.filter((option) => option.value !== 'specThenDistance'),
);

function setSortBy(sortBy: SpatialQuerySortBy) {
  if (draft.sortBy === sortBy) return;
  draft.sortBy = sortBy;
  // 排序在服务端于分页前完成，改了就必须回到第一页重查，否则页码对应的是旧顺序。
  if (resultSet.value && !isQueryBusy.value) {
    void submitQuery();
  }
}

function runQuery() {
  resultsExpanded.value = false;
  void submitQuery();
}

function useSelection() {
  applyCurrentSelection();
}

function startPick() {
  draft.rangeCenterSource = 'pick';
  startPickCenter();
}

/**
 * Distance 模式下从 viewer 当前选中拾取 Refno。
 * 复用 applyCurrentSelection 获取 refno，但保持 distanceCenterSource='refno' 不变。
 * applyCurrentSelection 会把 rangeCenterSource 改为 'selected'，在 distance 模式下无副作用（UI 走 distanceCenterSource）。
 */
function pickRefnoFromSelection() {
  applyCurrentSelection();
}

function onRadiusSliderInput(event: Event) {
  const target = event.target as HTMLInputElement;
  const value = Number(target.value);
  if (Number.isFinite(value)) {
    setRadiusMeters(value);
  }
}

function onRadiusMetersNumberInput(event: Event) {
  const target = event.target as HTMLInputElement;
  const value = Number(target.value);
  setRadiusMeters(value);
}

function toggleSpecValue(specValue: number) {
  const next = new Set(draft.specValues);
  if (next.has(specValue)) {
    next.delete(specValue);
  } else {
    next.add(specValue);
  }
  draft.specValues = Array.from(next).sort((a, b) => a - b);
}

function focusItem(item: SpatialQueryResultItem) {
  void activateResult(item);
}

function toggleVisibility(item: SpatialQueryResultItem) {
  toggleResultVisible(item);
}

function normalizePipeDistanceRefno(refno: string): string {
  return String(refno || '').trim().replace(/\//g, '_');
}

function createPipeDistanceSceneTransformPoint(): ((point: Vec3) => Vec3) | undefined {
  const matrix = (viewerContext.viewerRef.value as ViewerWithDtxLayerMatrix | null)?.__dtxLayer?.getGlobalModelMatrix?.();
  if (!matrix) return undefined;
  return (point: Vec3): Vec3 => {
    const p = new Vector3(point[0], point[1], point[2]).applyMatrix4(matrix);
    return [p.x, p.y, p.z];
  };
}

function canAnnotatePipeDistance(item: SpatialQueryResultItem): boolean {
  // 净距由服务端 nearest-points 计算：源是 BRAN 会自动用真实中心线，
  // 其余构件退回包围盒口径，所以这里不再限制 noun。
  if (draft.mode !== 'distance' || draft.distanceCenterSource !== 'refno') return false;
  const sourceRefno = normalizePipeDistanceRefno(draft.refno);
  const targetRefno = normalizePipeDistanceRefno(item.refno);
  return !!sourceRefno && !!targetRefno && sourceRefno !== targetRefno;
}

async function annotatePipeDistance(item: SpatialQueryResultItem) {
  const sourceRefno = normalizePipeDistanceRefno(draft.refno);
  const targetRefno = normalizePipeDistanceRefno(item.refno);
  if (!sourceRefno || !targetRefno || sourceRefno === targetRefno) return;
  pipeDistanceStore.showAnnotations.value = true;
  await pipeDistanceStore.autoDetectBrans([sourceRefno, targetRefno], {
    transformPoint: createPipeDistanceSceneTransformPoint(),
  });
  emitCommand('panel.pipeDistance.open');
}

function showAll() {
  setAllResultsVisible(true);
}

function hideAll() {
  setAllResultsVisible(false);
}

function isolateAll() {
  isolateResults();
}

function restoreAll() {
  restoreScene();
}

// 「加载当前页」只动这一页；「只加载未加载」把整个命中集合里没加载的都补上（跨页，用户 2026-09-14 拍板保持全集语义）。
function loadCurrentResults() {
  void loadResults({ pages: 'current', flyTo: true });
}

function loadUnloadedResults() {
  void loadResults({ onlyUnloaded: true, flyTo: true });
}

function loadDisplayGroup(group: DisplayGroup) {
  if (group.kind === 'dbnum') {
    if (group.key === UNKNOWN_DBNUM_KEY) return;
    void loadResults({ dbnum: group.key, flyTo: true });
    return;
  }
  void loadResults({ specValue: group.key, flyTo: true });
}

function showOnlyDisplayGroup(group: DisplayGroup) {
  if (group.kind === 'dbnum') {
    if (group.key === UNKNOWN_DBNUM_KEY) return;
    showOnlyDbnumGroup(group.key);
    return;
  }
  showOnlySpecGroup(group.key);
}

function formatDistance(distance: number) {
  return `${formatMeters(distance / METERS_TO_MM)} m`;
}

function uniqueRefnosInOrder(items: SpatialQueryResultItem[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const refno = String(item.refno || '').trim();
    if (!refno || seen.has(refno)) continue;
    seen.add(refno);
    out.push(refno);
  }
  return out;
}

async function copyRefnos(refnos: string[], label: string) {
  const text = refnos.join('\n');
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    copyStatus.value = `已复制 ${refnos.length} 个${label} Refno`;
  } catch (err) {
    copyStatus.value = null;
    error.value = err instanceof Error ? `复制失败：${err.message}` : '复制失败';
  }
}

function copyCurrentPageRefnos() {
  void copyRefnos(uniqueRefnosInOrder(pagedResultItems.value), '当前页');
}

function copyAllReturnedRefnos() {
  void copyRefnos(allReturnedRefnos.value, '已返回');
}

function setModeAndKeepDraft(mode: SpatialQueryMode) {
  setSpatialQueryMode(mode);
}

function setMode(mode: SpatialQueryMode) {
  setModeAndKeepDraft(mode);
}
</script>

<style scoped>
.font-ui {
  font-family: 'Noto Sans SC', system-ui, sans-serif;
}
</style>
