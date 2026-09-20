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
                <button v-if="spatialCapabilities.branCenterline"
                  type="button"
                  class="rounded px-2 py-0.5 font-medium transition-colors"
                  :class="draft.distanceCenterSource === 'bran_centerline' ? 'bg-brand-subtle text-brand' : 'text-gray-500 hover:text-gray-700'"
                  data-testid="distance-source-bran-centerline"
                  title="以 BRAN 各段真实中心线为源量距，而不是它的包围盒中心"
                  @click="draft.distanceCenterSource = 'bran_centerline'">
                  沿 BRAN 中心线
                </button>
                <button type="button"
                  class="rounded px-2 py-0.5 font-medium transition-colors"
                  :class="draft.distanceCenterSource === 'coordinates' ? 'bg-brand-subtle text-brand' : 'text-gray-500 hover:text-gray-700'"
                  @click="draft.distanceCenterSource = 'coordinates'">
                  通过坐标
                </button>
              </div>
            </div>
            <div v-if="isRefnoDistanceSource" class="mt-3 space-y-2">
              <label class="block text-xs text-gray-500">{{ isBranCenterlineSource ? '拾取起始 BRAN' : '拾取起始物项' }}</label>
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
                  :placeholder="isBranCenterlineSource ? '例如：24381_145018（BRAN）' : '例如：24381_100818'"
                  class="h-7 w-full rounded-md border border-gray-200 bg-white px-2.5 font-mono text-[11px] text-gray-900 outline-none focus:border-brand" />
              </div>
              <p v-if="isBranCenterlineSource" class="text-[11px] leading-relaxed text-gray-400">
                沿该 BRAN 各段中心线量到候选包围盒的最近距离；半径即走廊外扩距离。
              </p>
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
              <p v-if="showNameSortApproxHint" class="mt-1 text-[10px] text-gray-400" data-testid="spatial-sort-name-hint">
                当前源不按名称排整个命中集合：服务端按 Noun / Refno 近似排、只为本页补名字，跨页顺序不是名称序。
              </p>
            </section>
            <label class="text-xs text-gray-500">
              <span class="mb-1 block">每页数量</span>
              <input v-model.number="draft.limit"
                type="number"
                min="1"
                step="1"
                data-testid="spatial-page-limit"
                class="h-8 w-full rounded-md border bg-white px-2.5 font-mono text-xs text-gray-900 outline-none focus:border-brand"
                :class="pageLimitValid ? 'border-gray-200' : 'border-danger/60'" />
              <span v-if="!pageLimitValid" class="mt-1 block text-[10px] text-danger" data-testid="spatial-page-limit-hint">
                请填 ≥ 1 的整数，否则无法执行查询
              </span>
            </label>
            <label class="text-xs text-gray-500">
              <span class="mb-1 block">Noun 类型（逗号分隔）</span>
              <input v-model="draft.nounText"
                type="text"
                placeholder="例如：PIPE,EQUI,BRAN"
                class="h-8 w-full rounded-md border border-gray-200 bg-white px-2.5 font-mono text-xs text-gray-900 outline-none focus:border-brand" />
            </label>
            <div v-if="hasRoomDimension" class="text-xs text-gray-500" data-testid="room-filter">
              <div class="mb-1 flex items-center justify-between">
                <span>房间过滤</span>
                <div v-if="roomsReady" class="flex items-center gap-2 text-[11px]">
                  <button type="button"
                    class="text-gray-500 transition-colors hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="roomActionBusy"
                    data-testid="room-use-selected"
                    title="把查看器 / 模型树里当前选中构件所在的房间加进过滤"
                    @click="useSelectedRefnoRooms">
                    当前选中所在房间
                  </button>
                  <span class="text-gray-300">·</span>
                  <button type="button"
                    class="text-gray-500 transition-colors hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="draft.rooms.length === 0"
                    data-testid="room-clear"
                    @click="clearRooms">
                    清空
                  </button>
                </div>
              </div>
              <div v-if="roomsLoading" class="text-[11px] text-gray-400" data-testid="room-filter-loading">
                正在读取在册房间清单…
              </div>
              <div v-else-if="!roomsReady" class="flex items-start justify-between gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] text-gray-400" data-testid="room-filter-unavailable">
                <span>{{ roomsUnavailableText }}</span>
                <button v-if="roomsStatus.status === 'error'"
                  type="button"
                  class="shrink-0 text-gray-500 hover:text-brand"
                  data-testid="room-filter-retry"
                  @click="retryLoadRooms">
                  重试
                </button>
              </div>
              <template v-else>
                <div v-if="draft.rooms.length > 0" class="mb-1.5 flex flex-wrap gap-1.5" data-testid="room-selected">
                  <span v-for="room in draft.rooms"
                    :key="room.refno"
                    class="inline-flex items-center gap-1 rounded-full border border-brand bg-brand-subtle px-2 py-0.5 text-[11px] text-brand"
                    :title="room.refno"
                    data-testid="room-chip"
                    :data-room-refno="room.refno">
                    {{ roomChipLabel(room) }}
                    <button type="button" class="rounded-full hover:bg-white/60" :aria-label="`移除房间 ${roomChipLabel(room)}`" @click="removeRoom(room.refno)">
                      <X class="h-3 w-3" />
                    </button>
                  </span>
                </div>
                <div class="relative">
                  <input v-model="roomSearchText"
                    type="text"
                    :placeholder="roomOptions.length > 0 ? `搜索房间号 / 名称（在册 ${roomOptions.length} 间），回车按房间号精确加入` : '在册房间清单为空'"
                    :disabled="roomOptions.length === 0 || roomActionBusy"
                    data-testid="room-search-input"
                    class="h-8 w-full rounded-md border border-gray-200 bg-white px-2.5 text-xs text-gray-900 outline-none focus:border-brand disabled:cursor-not-allowed disabled:opacity-50"
                    @focus="roomSearchFocused = true"
                    @blur="roomSearchFocused = false"
                    @keydown.enter.prevent="submitRoomSearch" />
                  <ul v-if="showRoomDropdown"
                    class="absolute z-20 mt-1 max-h-44 w-full overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg"
                    data-testid="room-options">
                    <li v-for="option in filteredRoomOptions" :key="option.refno">
                      <button type="button"
                        class="flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left text-[11px] text-gray-700 hover:bg-gray-50"
                        data-testid="room-option"
                        :data-room-refno="option.refno"
                        @mousedown.prevent="pickRoomOption(option)">
                        <span class="truncate">
                          <span class="font-mono font-medium text-gray-900">{{ option.roomNum }}</span>
                          <span v-if="option.name && option.name !== option.roomNum" class="ml-1 text-gray-500">{{ option.name }}</span>
                        </span>
                        <span class="shrink-0 font-mono text-[10px] text-gray-400">{{ option.refno }}</span>
                      </button>
                    </li>
                  </ul>
                </div>
                <p class="mt-1 text-[10px] text-gray-400">
                  未选 = 不按房间过滤；已选多间 = 只保留房间归属含任一所选房间的构件（横跨两间房的两边都算）。
                  <span v-if="roomsStatus.status === 'degraded' && roomsStatus.reason">房间模型有缺口：{{ roomsStatus.reason }}</span>
                </p>
              </template>
            </div>
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
              <span class="mb-1 block" data-testid="spatial-keyword-label">{{ keywordLabel }}</span>
              <input v-model="draft.keyword"
                type="text"
                :placeholder="keywordPlaceholder"
                data-testid="spatial-keyword-input"
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
                class="rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5"
                data-testid="spatial-room-row">
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
            <div v-if="resultSet.localOnly" data-testid="spatial-local-only-hint">
              本地扫描（仅已加载构件）· 共 {{ resultSet.total }} 项 · 不分页
            </div>
            <div v-else>
              每页 {{ resultSet.perPage }} 项 · 当前 {{ resultPageStart }}-{{ resultPageEnd }} / {{ resultSet.total }}
            </div>
            <div v-if="!resultSet.localOnly && resultTotalPages > 1" class="flex items-center gap-1.5">
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

          <div v-if="resultsExpanded && resultSet && resultSet.items.length > 0 && canToggleGroupDimension"
            class="flex items-center justify-between border-b border-gray-100 px-3 py-1.5 text-[11px] text-gray-500"
            data-testid="spatial-group-dimension">
            <span>结果分组</span>
            <div class="inline-flex rounded-md border border-gray-200 bg-white p-0.5">
              <button v-for="option in GROUP_DIMENSION_OPTIONS"
                :key="option.value"
                type="button"
                class="rounded px-2 py-0.5 text-[11px] transition-colors"
                :class="groupDimension === option.value ? 'bg-brand-subtle text-brand' : 'text-gray-500 hover:bg-gray-50'"
                :data-testid="`spatial-group-dimension-${option.value}`"
                :aria-pressed="groupDimension === option.value"
                @click="setGroupDimension(option.value)">
                {{ option.label }}
              </button>
            </div>
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

import type {
  SpatialQueryGroupDimension,
  SpatialQueryMode,
  SpatialQueryResultItem,
  SpatialQueryRoomOption,
  SpatialQuerySortBy,
} from '@/types/spatialQuery';

import { formatClearanceToast } from '@/clearance/composables/useComponentToWallClearance';
import { useClearanceStore } from '@/clearance/stores/useClearanceStore';
import { useConfirmDialogStore } from '@/composables/useConfirmDialogStore';
import { findNounByRefnoAcrossAllDbnos } from '@/composables/useDbnoInstancesDtxLoader';
import { useRoomInfoPanel } from '@/composables/useRoomInfoPanel';
import { useSpatialQuery } from '@/composables/useSpatialQuery';
import { emitToast } from '@/ribbon/toastBus';
import {
  SITE_SPEC_OPTIONS_WITH_UNKNOWN,
  getSpecBadgeStyle,
  getSpecValueShortName,
} from '@/types/spec';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

const spatialQuery = useSpatialQuery();
const roomInfoPanel = useRoomInfoPanel();
const clearanceStore = useClearanceStore();
const {
  draft,
  status,
  error,
  resultSet,
  activeResultRefno,
  selectedCenterRefno,
  canSubmit,
  hasValidPageLimit,
  spatialCapabilities,
  roomOptions,
  roomsStatus,
  groupDimension,
  setGroupDimension,
  loadRoomOptions,
  addRooms,
  removeRoom,
  clearRooms,
  addRoomsByNumber,
  applySelectedRefnoRooms,
  roomsOf,
  roomAttributes,
  setMode: setSpatialQueryMode,
  applyCurrentSelection,
  startPickCenter,
  submitQuery,
  requeryResults,
  clearResults,
  activateResult,
  countLoadTargets,
  loadResults,
  showOnlySpecGroup,
  showOnlyDbnumGroup,
  toggleResultVisible,
  setAllResultsVisible,
  isolateResults,
  restoreScene,
} = spatialQuery;
const confirmDialog = useConfirmDialogStore();

/**
 * 当前源有没有专业维度：legacy 一直有，gen-model-v1 自 2026-09-20 起也有（服务端按 SITE 名派生，ADR 0067）；
 * 没有就收起专业过滤 / 「按专业」排序，结果只能按库（dbnum）分组。
 */
const hasSpecDimension = computed(() => spatialCapabilities.value.specValues);
/** 两维都在才画「按专业 | 按库」切换（Q11 (b)）：专业维度 + 服务端给了 `dbnumGroups`（gen-model-v1）；只剩一维就按那一维。 */
const canToggleGroupDimension = computed(() => hasSpecDimension.value && (resultSet.value?.dbnumGroups?.length ?? 0) > 0);
const groupByDbnum = computed(() => groupDimension.value === 'dbnum' || !hasSpecDimension.value);
const groupDimensionLabel = computed(() => (groupByDbnum.value ? '按库' : '按专业'));
const groupUnitLabel = computed(() => (groupByDbnum.value ? '库' : '专业'));
const GROUP_DIMENSION_OPTIONS: { value: SpatialQueryGroupDimension; label: string }[] = [
  { value: 'spec', label: '按专业' },
  { value: 'dbnum', label: '按库' },
];

// ---- 房间过滤（ADR 0067，Q4 / Q5 / Q12）----

/** 源认房间过滤才画这一块（legacy 不画）；服务端此刻能不能看 `roomsStatus`。 */
const hasRoomDimension = computed(() => spatialCapabilities.value.rooms);
const roomsReady = computed(() => roomsStatus.value.status === 'ready' || roomsStatus.value.status === 'degraded');
const roomsLoading = computed(() => roomsStatus.value.status === 'loading' || roomsStatus.value.status === 'idle');
/** 房间体制不可用时写给人看的一句（`disabled` / `initializing` / `unsupported` / `failed` / `error`）。 */
const roomsUnavailableText = computed(() => {
  const { status: roomsState, reason } = roomsStatus.value;
  const head = (() => {
    switch (roomsState) {
      case 'disabled':
        return '服务端未开启房间归属计算，房间过滤不可用';
      case 'initializing':
        return '服务端房间模型正在装载，稍后再试';
      case 'unsupported':
        return '当前服务端不支持房间过滤';
      case 'failed':
        return '服务端房间模型不可用';
      case 'error':
        return '房间清单取不到';
      default:
        return '房间过滤此刻不可用';
    }
  })();
  return reason ? `${head}（${reason}）` : head;
});
const roomSearchText = ref('');
const roomSearchFocused = ref(false);
const roomActionBusy = ref(false);
const ROOM_OPTION_LIMIT = 50;
const selectedRoomRefnos = computed(() => new Set(draft.rooms.map((room) => room.refno)));
/** 下拉候选：按房间号 / 名称 / refno 包含匹配（大小写不敏感），已选的不再列，最多 50 条。 */
const filteredRoomOptions = computed<SpatialQueryRoomOption[]>(() => {
  const needle = roomSearchText.value.trim().toLowerCase();
  const out: SpatialQueryRoomOption[] = [];
  for (const option of roomOptions.value) {
    if (selectedRoomRefnos.value.has(option.refno)) continue;
    if (needle) {
      const haystack = `${option.roomNum} ${option.name ?? ''} ${option.refno}`.toLowerCase();
      if (!haystack.includes(needle)) continue;
    }
    out.push(option);
    if (out.length >= ROOM_OPTION_LIMIT) break;
  }
  return out;
});
const showRoomDropdown = computed(() => roomSearchFocused.value && roomsReady.value && filteredRoomOptions.value.length > 0);

function roomChipLabel(room: { refno: string; roomNum: string; name: string | null }): string {
  if (room.roomNum) return room.name && room.name !== room.roomNum ? `${room.roomNum} · ${room.name}` : room.roomNum;
  return room.name || room.refno;
}

function pickRoomOption(option: SpatialQueryRoomOption): void {
  addRooms([{ refno: option.refno, roomNum: option.roomNum, name: option.name }]);
  roomSearchText.value = '';
}

/** 回车：先精确匹配房间号（同号多间全选并提示）；没匹配到而下拉里只剩一条就取它。 */
async function submitRoomSearch(): Promise<void> {
  const text = roomSearchText.value.trim();
  if (!text) return;
  roomActionBusy.value = true;
  try {
    const result = await addRoomsByNumber(text);
    if (result.added.length > 0) {
      roomSearchText.value = '';
      if (result.duplicated.length > 0) {
        emitToast({
          level: 'info',
          message: `房间号 ${result.duplicated.join('、')} 对应多间房，已全部选上（可在已选里删掉不要的）`,
        });
      }
      return;
    }
    if (filteredRoomOptions.value.length === 1) {
      pickRoomOption(filteredRoomOptions.value[0]!);
      return;
    }
    if (result.missing.length > 0) {
      emitToast({ level: 'warning', message: `在册房间里没有房间号 ${result.missing.join('、')}` });
    }
  } finally {
    roomActionBusy.value = false;
  }
}

async function useSelectedRefnoRooms(): Promise<void> {
  roomActionBusy.value = true;
  try {
    const result = await applySelectedRefnoRooms();
    if (result.error) {
      emitToast({ level: 'warning', message: result.error });
      return;
    }
    if (result.added.length === 0) {
      emitToast({ level: 'info', message: `${result.refno} 所在房间已经在已选里` });
    }
  } finally {
    roomActionBusy.value = false;
  }
}

function retryLoadRooms(): void {
  void loadRoomOptions({ force: true });
}

// 抽屉打开 / 源切到认房间的，拉一次在册清单（已 ready 不重拉）。
watch(
  () => [props.open, hasRoomDimension.value] as const,
  ([open, supported]) => {
    if (open && supported) void loadRoomOptions();
  },
  { immediate: true },
);
/** 关键字文案随源切：legacy 服务端按 Refno / Noun / 名称匹配，gen-model-v1 只按 Refno / Noun（名称只对本页补，全集不匹配）。 */
const keywordLabel = computed(() => (spatialCapabilities.value.keywordMatchesName ? '关键字（Refno / Noun / 名称）' : '关键字（Refno / Noun）'));
const keywordPlaceholder = computed(() => (
  spatialCapabilities.value.keywordMatchesName ? '支持 Refno、Noun 或名称关键字' : '支持 Refno 或 Noun 关键字（当前源不按名称匹配）'
));
/** 「每页数量」是否可用：清空 / 非正整数时输入框标红、提交按钮灰掉（store 的 canSubmit 同一口径）。 */
const pageLimitValid = hasValidPageLimit;

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
  const parts = !groupByDbnum.value
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

/** 距离查询里以 refno 为源的两档（按包围盒 / 沿 BRAN 中心线）共用同一块「起始物项」输入。 */
const isRefnoDistanceSource = computed(() =>
  draft.mode === 'distance' && (draft.distanceCenterSource === 'refno' || draft.distanceCenterSource === 'bran_centerline'),
);
const isBranCenterlineSource = computed(() => draft.mode === 'distance' && draft.distanceCenterSource === 'bran_centerline');

// 数据源切到没有这一档的（gen-model-v1）时按钮消失，残留的选择退回「通过 Refno」，免得提交被服务端拒绝
watch(
  () => [spatialCapabilities.value.branCenterline, draft.distanceCenterSource] as const,
  ([supported, source]) => {
    if (!supported && source === 'bran_centerline') {
      draft.distanceCenterSource = 'refno';
    }
  },
  { immediate: true },
);

/**
 * 坐标格清空时 `v-model.number` 会把 `''` 原样写进草稿（Vue 的 `looseToNumber` 转不动就回原字符串），
 * 直接 `toFixed` 会让整段摘要渲染抛错；非有限数一律显示「—」，`canSubmit` 另有 `Number.isFinite` 守着不会发坏请求。
 */
function formatCenterCoordinate(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(0) : '—';
}

const centerSummary = computed(() => {
  // 选中的 PIPE / ZONE 这类没加载几何的 owner：查看器解不出盒，查询时发 refno 由服务端按其整体盒解中心
  if (draft.mode === 'range' && draft.rangeCenterSource === 'selected' && selectedCenterRefno.value) {
    return `${selectedCenterRefno.value} · 未加载几何，查询时由服务端解中心`;
  }
  return `${formatCenterCoordinate(draft.center.x)}, ${formatCenterCoordinate(draft.center.y)}, ${formatCenterCoordinate(draft.center.z)}`;
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

/** 结果区的一组：按专业（`key` = spec_value）或按库（`key` = dbnum），由 `groupDimension` 决定（Q11）。 */
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
  const byDbnum = groupByDbnum.value;
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

/** 房间解析的并发上限：每个条目至少一发 `room-tree/ancestors`，不限并发时一页 100 项就是 100 个并发请求。 */
const ROOM_RESOLVE_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * 当前页条目所在的房间。两步：先只解归属（每项一发 `roomsOf`，不取属性）按房间去重，再每个房间取一次属性——
 * 改前每项各打一发 ancestors + 一发 `pdmsGetUiAttr`、不去重、不限并发，一页 N 项就是 2×N 个并发请求。
 * 归属与属性都经当前数据源（legacy 走旧后端 room-tree / 属性接口，gen-model-v1 走 `e3d.room.lookup` / `element/attributes`，ADR 0067 Q7）；
 * 一个构件横跨几间房就在几间房里各计一次。在册清单里有的房间先拿清单的房间号 / 名字。
 */
async function refreshRoomList() {
  roomListSeq += 1;
  const seq = roomListSeq;
  const items = resultSet.value?.items ?? [];
  roomListRows.value = [];
  roomListError.value = null;
  if (items.length === 0) return;

  roomListLoading.value = true;
  try {
    const grouped = new Map<string, SpatialRoomListRow>();
    const resolved = await mapWithConcurrency(items, ROOM_RESOLVE_CONCURRENCY, async (item) => {
      try {
        return {
          item,
          rooms: await roomsOf(item.refno),
        };
      } catch {
        return {
          item,
          rooms: [] as string[],
        };
      }
    });
    if (seq !== roomListSeq) return;

    for (const { item, rooms: itemRooms } of resolved) {
      for (const roomRefno of itemRooms) {
        const existing = grouped.get(roomRefno);
        if (existing) {
          existing.count += 1;
          existing.sourceRefnos.push(item.refno);
        } else {
          const option = roomOptions.value.find((candidate) => candidate.refno === roomRefno);
          grouped.set(roomRefno, {
            roomRefno,
            name: option?.name || option?.roomNum || roomRefno,
            roomType: 'ROOM',
            desc: '',
            count: 1,
            sourceRefnos: [item.refno],
          });
        }
      }
    }

    const rooms = Array.from(grouped.values());
    await mapWithConcurrency(rooms, ROOM_RESOLVE_CONCURRENCY, async (room) => {
      try {
        const attrResp = await roomAttributes(room.roomRefno);
        if (!attrResp.success) return;
        const attrs = attrResp.attrs ?? {};
        room.roomType = attrText(attrs, 'TYPE') || 'ROOM';
        room.desc = attrText(attrs, 'DESC') || attrText(attrs, 'DESCRIPTION');
        room.name = attrResp.full_name || attrText(attrs, 'NAME') || room.name;
      } catch {
        // 属性取不到就只显示清单里的名字 / 房间 refno
      }
    });
    if (seq !== roomListSeq) return;

    roomListRows.value = rooms.sort((a, b) => a.name.localeCompare(b.name));
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

const roomListKey = computed(() => (resultSet.value?.items ?? []).map((item) => item.refno).join('|'));
/** 已经为哪一份结果解析过房间；结果一变就作废 */
let roomListResolvedKey: string | null = null;

// 结果区默认收起，展开时才解析房间——改前结果一变就解析，收起着也每页打 2×N 个请求（v1 源缺省下这两条路走旧后端，
// 那台没起就是每页 N 个失败请求）。结果换了，旧列表与在途的解析一起作废。
watch(
  () => [roomListKey.value, resultsExpanded.value] as const,
  ([key, expanded]) => {
    if (key !== roomListResolvedKey) {
      roomListSeq += 1;
      roomListRows.value = [];
      roomListError.value = null;
      roomListLoading.value = false;
      roomListResolvedKey = null;
    }
    if (!expanded || !key || roomListResolvedKey === key) return;
    roomListResolvedKey = key;
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

// 翻页沿用上一次结果的请求（已解出的中心 / refno / 过滤条件），不按此刻的选中重解中心，失败也不清掉已有页
function setResultPage(page: number) {
  if (!Number.isFinite(page)) return;
  const nextPage = Math.min(Math.max(Math.floor(page), 1), resultTotalPages.value);
  if (nextPage === currentResultPage.value || isQueryBusy.value) return;
  void requeryResults({ page: nextPage });
}

const ALL_SORT_OPTIONS: { value: SpatialQuerySortBy; label: string; hint: string }[] = [
  { value: 'distanceAsc', label: '按距离', hint: '由近及远' },
  { value: 'specThenDistance', label: '按专业', hint: '先按专业分组，组内由近及远' },
  { value: 'nameAsc', label: '按名称', hint: '按构件名称升序' },
];
const NAME_SORT_APPROX_HINT = '按构件名称升序（当前源只为本页补名字，全集按 Noun / Refno 近似排）';

/**
 * 没有专业维度的源不给「按专业」这一档；「按名称」在 gen-model-v1 不按名称排全集（spec §4.13：服务端按 noun / refno
 * 近似排、只为本页补名字），tooltip 与按钮下方的提示据 `nameSortExact` 切。
 */
const sortOptions = computed(() => {
  const options = hasSpecDimension.value ? ALL_SORT_OPTIONS : ALL_SORT_OPTIONS.filter((option) => option.value !== 'specThenDistance');
  if (spatialCapabilities.value.nameSortExact) return options;
  return options.map((option) => (option.value === 'nameAsc' ? { ...option, hint: NAME_SORT_APPROX_HINT } : option));
});
const showNameSortApproxHint = computed(() => draft.sortBy === 'nameAsc' && !spatialCapabilities.value.nameSortExact);

function setSortBy(sortBy: SpatialQuerySortBy) {
  if (draft.sortBy === sortBy) return;
  draft.sortBy = sortBy;
  // 排序在服务端于分页前完成，改了就必须回到第一页重查，否则页码对应的是旧顺序；
  // 沿用上一次结果的请求只换排序，不按此刻的选中重解中心。
  if (resultSet.value && !isQueryBusy.value) {
    void requeryResults({ sortBy });
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

function canAnnotatePipeDistance(item: SpatialQueryResultItem): boolean {
  // 净距由 gen-model `surface-clearance` 用两侧真实网格精算（任意 noun 都收，`target_kind=any`），
  // 所以这里不限制 noun，只要源 / 目标都是 refno 且不同。
  if (!isRefnoDistanceSource.value) return false;
  const sourceRefno = normalizePipeDistanceRefno(draft.refno);
  const targetRefno = normalizePipeDistanceRefno(item.refno);
  return !!sourceRefno && !!targetRefno && sourceRefno !== targetRefno;
}

/**
 * 「净距标注」：源 refno × 这一行的目标 → `useClearanceStore.compute`（外表面到外表面精算，
 * 计划 `docs/plans/2026-09-17-component-to-wall-surface-clearance-plan.md` §6.3 Q8 (c)）。
 * 结果由外部尺寸源 `clearance` 画出，不再进 `usePipeDistanceStore`（那条打的 legacy
 * `/api/space/nearest-points` 已经不在跑）。
 */
async function annotatePipeDistance(item: SpatialQueryResultItem) {
  const sourceRefno = normalizePipeDistanceRefno(draft.refno);
  const targetRefno = normalizePipeDistanceRefno(item.refno);
  if (!sourceRefno || !targetRefno || sourceRefno === targetRefno) return;
  clearanceStore.showAnnotations.value = true;
  const record = await clearanceStore.compute({ sourceRefno, targetRefno, targetKind: 'any' });
  if (!record) {
    emitToast({ message: `净距计算失败：${clearanceStore.lastError.value ?? '未知错误'}`, level: 'error' });
    return;
  }
  emitToast({ message: formatClearanceToast(record), level: record.snapshot ? 'success' : 'warning' });
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

/** 跨页的批量加载超过这个数先弹确认并显示数量（用户 2026-09-14 拍板：> 200 项）；1387 项那次点下去 3 分钟没回来。 */
const LARGE_BATCH_LOAD_CONFIRM_THRESHOLD = 200;

/**
 * 数量不大就直接跑；超过阈值先经全局确认框，用户点「加载 N 个」才跑。
 * 小数量走同步路径（不多绕一次微任务），既有的点击 → `loadResults` 时序不变。
 */
function runAfterLargeBatchConfirm(count: number, what: string, run: () => void): void {
  if (!(count > LARGE_BATCH_LOAD_CONFIRM_THRESHOLD)) {
    run();
    return;
  }
  void confirmDialog.open({
    title: '加载数量较多',
    message: `${what}将加载 ${count} 个模型（超过 ${LARGE_BATCH_LOAD_CONFIRM_THRESHOLD} 个），可能需要几分钟，期间查看器会持续加载。是否继续？`,
    confirmText: `加载 ${count} 个`,
  }).then((confirmed) => {
    if (confirmed) run();
  });
}

function loadUnloadedResults() {
  const options = { onlyUnloaded: true, flyTo: true };
  runAfterLargeBatchConfirm(countLoadTargets(options), '「只加载未加载」', () => {
    void loadResults(options);
  });
}

function loadDisplayGroup(group: DisplayGroup) {
  if (group.kind === 'dbnum' && group.key === UNKNOWN_DBNUM_KEY) return;
  const options = group.kind === 'dbnum' ? { dbnum: group.key, flyTo: true } : { specValue: group.key, flyTo: true };
  runAfterLargeBatchConfirm(countLoadTargets(options), `「加载本${groupUnitLabel.value}」（${group.label}）`, () => {
    void loadResults(options);
  });
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
