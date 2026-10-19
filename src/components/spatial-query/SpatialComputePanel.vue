<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden bg-background">
    <!-- Header -->
    <div class="flex items-start justify-between border-b border-border px-5 py-4">
      <div>
        <div class="text-lg font-bold text-foreground">管道与结构净距</div>
        <div class="mt-0.5 text-[11px] text-muted-foreground">查询周边候选并精算实体外表面距离。</div>
      </div>
    </div>

    <div v-if="spatialCompute.hasPersistenceContext.value" class="border-b border-border px-5 py-2 text-xs text-muted-foreground" role="status">
      {{ spatialCompute.persistenceLabel.value }}
      <div v-if="spatialCompute.persistenceError.value" class="mt-1 text-destructive">
        {{ spatialCompute.persistenceError.value }}
        <button type="button" class="ml-2 underline" @click="spatialCompute.persistRecords()">重试保存</button>
      </div>
    </div>

    <!-- Tabs: 属性 / 计算 -->
    <div class="px-5 pt-4">
      <div class="flex rounded-[10px] border border-gray-200 bg-gray-50 p-[3px]">
        <button type="button"
          class="flex-1 rounded-lg py-2 text-center text-xs font-medium transition-all"
          :class="panelMode === 'query'
            ? 'bg-white text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'"
          @click="setPanelMode('query')">
          属性
        </button>
        <button type="button"
          class="flex-1 rounded-lg py-2 text-center text-xs font-medium transition-all"
          :class="panelMode === 'compute'
            ? 'bg-white text-brand shadow-sm font-semibold'
            : 'text-muted-foreground hover:text-foreground'"
          @click="setPanelMode('compute')">
          计算
        </button>
      </div>
    </div>

    <div v-if="panelMode === 'compute'" class="flex-1 overflow-y-auto px-5 py-4">
      <div class="flex flex-col gap-4">
        <!-- Banner -->
        <div class="rounded-xl border border-brand/25 bg-brand-subtle px-3 py-2">
          <div class="text-xs font-bold text-brand">两种输入方式</div>
          <div class="text-[11px] leading-relaxed text-brand">读取当前选中构件，或输入编号后计算。</div>
        </div>

        <!-- Scenario Accordion -->
        <div class="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-[13px] font-bold text-foreground">场景选择</div>
              <div class="text-[11px] font-medium text-muted-foreground">折叠后仅显示当前场景，减少 Dock 纵向占用</div>
            </div>
            <div class="flex items-center gap-1.5">
              <span v-if="!scenarioExpanded" class="rounded-full bg-brand-subtle px-2 py-0.5 text-[11px] font-semibold text-brand">已折叠</span>
              <button type="button"
                class="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-white"
                @click="toggleScenarioExpanded">
                {{ scenarioExpanded ? '收起' : `展开 ${scenarioList.length} 个场景` }}
                <ChevronDown class="h-3.5 w-3.5 text-muted-foreground transition-transform" :class="scenarioExpanded && 'rotate-180'" />
              </button>
            </div>
          </div>

          <!-- Expanded: all scenarios -->
          <div v-if="scenarioExpanded" class="mt-3 grid grid-cols-2 gap-2">
            <button v-for="scenario in scenarioList"
              :key="scenario.key"
              type="button"
              class="rounded-lg border p-2.5 text-left transition-colors"
              :class="activeScenario === scenario.key
                ? 'border-brand bg-brand-subtle'
                : 'border-gray-200 bg-white hover:border-gray-300'"
              @click="setActiveScenario(scenario.key); scenarioExpanded = false">
              <div class="text-xs font-semibold text-foreground">{{ scenario.title }}</div>
              <div class="mt-0.5 text-[11px] text-muted-foreground">{{ scenario.endpoint }}</div>
            </button>
          </div>

          <!-- Collapsed: active scenario card -->
          <div v-else class="mt-2 rounded-[10px] border border-gray-200 bg-white p-2.5">
            <div class="flex items-center justify-between">
              <div class="text-xs font-bold text-foreground">{{ currentScenarioMeta.title }}</div>
              <span class="rounded-full bg-brand-subtle px-2 py-0.5 text-[11px] font-semibold text-brand">当前场景</span>
            </div>
            <div class="mt-1 text-[11px] font-medium text-muted-foreground">{{ currentScenarioMeta.description }}</div>
            <div class="mt-1 text-[11px] text-gray-400">其余 {{ scenarioList.length - 1 }} 个场景已折叠，点击"展开"查看。</div>
          </div>
        </div>

        <!-- Detail Card -->
        <div class="rounded-2xl border border-gray-200 bg-white p-4">
          <div>
            <div class="flex flex-wrap items-center justify-between gap-1.5">
              <div class="text-[15px] font-bold text-foreground">{{ currentScenarioMeta.title }}</div>
              <span class="rounded-full bg-brand-subtle px-2 py-0.5 font-mono text-[11px] font-semibold text-brand">
                默认样例：{{ currentScenarioMeta.exampleRefno }}
              </span>
            </div>
            <div class="mt-1 text-xs leading-relaxed text-muted-foreground">{{ currentScenarioMeta.description }}</div>
          </div>

          <!-- Form -->
          <div class="mt-3 space-y-2.5">
            <label class="block">
              <span class="mb-1 block text-xs font-semibold text-muted-foreground">目标结构类别</span>
              <select v-model="computeState.structureCategory" data-testid="structure-category" class="h-10 w-full rounded-[10px] border border-gray-200 bg-white px-3 text-[13px]">
                <option value="all">全部构件类型</option>
                <option value="wall">墙</option>
                <option value="column">柱</option>
                <option value="beam">梁</option>
                <option value="slab">板</option>
              </select>
            </label>
            <label v-if="computeState.structureCategory === 'column' || computeState.structureCategory === 'beam'" class="block">
              <span class="mb-1 block text-xs font-semibold text-muted-foreground">梁柱分类角度容差（度）</span>
              <input v-model="computeState.structuralAngleDeg" data-testid="structural-angle" type="number" min="0" max="45" class="h-10 w-full rounded-[10px] border border-gray-200 px-3" />
              <span class="text-[11px] text-muted-foreground">按世界轴线与水平/垂直方向分类，默认 5° 待专业确认；斜向、弯曲和缺少轴线的构件不归入梁柱。</span>
            </label>
            <label class="block">
              <span class="mb-1 block text-xs font-semibold text-muted-foreground">{{ currentScenarioMeta.sourceLabel }}</span>
              <input v-model="computeState.suppoRefno"
                type="text"
                :placeholder="`${currentScenarioMeta.exampleRefno}`"
                class="h-10 w-full rounded-[10px] border bg-brand-subtle px-3 font-mono text-[13px] font-medium text-foreground outline-none transition-colors focus:border-brand"
                :class="computeState.suppoRefno ? 'border-brand' : 'border-gray-200'" />
              <span class="mt-0.5 block text-[11px] font-medium text-gray-400">{{ currentScenarioMeta.sourceHelp }}</span>
            </label>

            <label v-if="hasField('tolerance')" class="block">
              <span class="mb-1 block text-xs font-semibold text-muted-foreground">容差 tolerance（可选，mm）</span>
              <input v-model="computeState.tolerance"
                type="number"
                placeholder="可空"
                class="h-10 w-full rounded-[10px] border border-gray-200 bg-white px-3 font-mono text-[13px] font-medium text-foreground outline-none focus:border-brand" />
            </label>

            <div v-if="hasField('suppoType') || hasField('searchRadius')" class="grid grid-cols-2 gap-2.5">
              <label v-if="hasField('suppoType')" class="block">
                <span class="mb-1 block text-xs font-semibold text-muted-foreground">suppo_type</span>
                <input v-model="computeState.suppoType"
                  type="text"
                  placeholder="S1 / S2，可空"
                  class="h-10 w-full rounded-[10px] border border-gray-200 bg-white px-3 text-[13px] text-foreground outline-none focus:border-brand" />
              </label>
              <label v-if="hasField('searchRadius')" class="block">
                <span class="mb-1 block text-xs font-semibold text-muted-foreground">search_radius (mm)</span>
                <input v-model="computeState.searchRadius"
                  type="number"
                  placeholder="可空"
                  class="h-10 w-full rounded-[10px] border border-gray-200 bg-white px-3 font-mono text-[13px] text-foreground outline-none focus:border-brand" />
              </label>
            </div>

            <label v-if="hasField('targetNouns')" class="block">
              <span class="mb-1 block text-xs font-semibold text-muted-foreground">target_nouns</span>
              <input v-model="computeState.targetNouns"
                type="text"
                placeholder="WALL,COLUMN,FIXING"
                class="h-10 w-full rounded-[10px] border border-gray-200 bg-white px-3 text-[13px] text-foreground outline-none focus:border-brand" />
            </label>

            <label v-if="hasField('excludeNouns')" class="block">
              <span class="mb-1 block text-xs font-semibold text-muted-foreground">exclude_nouns（可空，先剔掉的噪声类型）</span>
              <input v-model="computeState.excludeNouns"
                type="text"
                data-testid="bran-exclude-nouns"
                placeholder="WELD,ATTA"
                class="h-10 w-full rounded-[10px] border border-gray-200 bg-white px-3 font-mono text-[13px] text-foreground outline-none focus:border-brand" />
              <span class="mt-0.5 block text-[11px] font-medium text-gray-400">目标类型不用先选：计算后按半径内出现的类型逐个勾选。</span>
            </label>

            <label v-if="hasField('neighborWindow')" class="block">
              <span class="mb-1 block text-xs font-semibold text-muted-foreground">neighbor_window (mm)</span>
              <input v-model="computeState.neighborWindow"
                type="number"
                placeholder="可空"
                class="h-10 w-full rounded-[10px] border border-gray-200 bg-white px-3 font-mono text-[13px] text-foreground outline-none focus:border-brand" />
            </label>
          </div>

          <!-- 自动模式：开着时选中 BRAN / 其管件即自动提交本场景；关掉回到手动「从场景读取 + 执行计算」 -->
          <label v-if="isBranScenario"
            class="mt-3 flex cursor-pointer items-start gap-2.5 rounded-[10px] border px-3 py-2 transition-colors"
            :class="autoFollowSelection ? 'border-brand bg-brand-subtle' : 'border-gray-200 bg-white'"
            data-testid="bran-auto-follow">
            <input type="checkbox"
              :checked="autoFollowSelection"
              class="mt-0.5 h-3.5 w-3.5 shrink-0 accent-brand"
              @change="onAutoFollowChange" />
            <div class="min-w-0 flex-1">
              <div class="text-xs font-semibold leading-snug" :class="autoFollowSelection ? 'text-brand' : 'text-foreground'">选中 BRAN / 管件自动计算</div>
              <div class="mt-0.5 text-[11px] leading-snug text-muted-foreground">半径内每类默认标注最近 1 条（管表面到包围盒估算）</div>
            </div>
          </label>

          <!-- 查看方式：算出候选后可用——只留源 BRAN 与最近目标可看，其余 X 光半透明或隐藏；随标注集自动重放 -->
          <div v-if="isBranScenario" class="mt-2 flex items-center gap-2" data-testid="bran-inspect-block">
            <span class="shrink-0 text-xs font-semibold text-muted-foreground">查看方式</span>
            <button type="button"
              :disabled="computeState.annotationCandidates.length === 0 && !branInspectMode"
              data-testid="bran-xray-toggle"
              :aria-pressed="branInspectMode === 'xray'"
              class="flex-1 rounded-[10px] border px-2 py-1.5 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              :class="branInspectMode === 'xray'
                ? 'border-brand bg-brand-subtle text-brand'
                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'"
              title="源 BRAN 与每类最近目标保持实体，其余构件全部半透明；再点一次退出"
              @click="toggleBranInspect('xray')">
              {{ branInspectMode === 'xray' ? '退出 X 光' : 'X 光查看' }}
            </button>
            <button type="button"
              :disabled="computeState.annotationCandidates.length === 0 && !branInspectMode"
              data-testid="bran-only-toggle"
              :aria-pressed="branInspectMode === 'only'"
              class="flex-1 rounded-[10px] border px-2 py-1.5 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              :class="branInspectMode === 'only'
                ? 'border-brand bg-brand-subtle text-brand'
                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'"
              title="只显示源 BRAN 与每类最近目标，其余构件全部隐藏；再点一次退出"
              @click="toggleBranInspect('only')">
              {{ branInspectMode === 'only' ? '退出仅显示' : '仅显示' }}
            </button>
          </div>

          <!-- 范围显示：沿当前 BRAN 中心线按半径圈周边构件 → 加载未加载的 → 命中实体、其余半透明（空间查询抽屉同一管线） -->
          <div v-if="isBranScenario" class="mt-3" data-testid="bran-range-block">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="shrink-0 text-xs font-semibold text-muted-foreground">范围显示</span>
              <div class="flex h-9 w-24 shrink-0 items-center rounded-[10px] border border-gray-200 bg-white px-2">
                <input v-model="rangeDistance"
                  type="number"
                  min="1"
                  max="100000"
                  data-testid="bran-range-distance"
                  class="w-full bg-transparent font-mono text-[12px] outline-none" />
                <span class="text-[11px] text-muted-foreground">mm</span>
              </div>
              <button type="button"
                :disabled="rangeBusy"
                class="h-9 min-w-[116px] flex-1 whitespace-nowrap rounded-[10px] bg-primary px-2.5 text-[12px] font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="bran-range-show"
                @click="showBranRange">
                <Loader2 v-if="rangeBusy" class="mr-1 inline h-3.5 w-3.5 animate-spin" />
                {{ rangeBusy ? '查询并加载…' : '显示范围内模型' }}
              </button>
              <button type="button"
                class="h-9 shrink-0 whitespace-nowrap rounded-[10px] border border-gray-200 px-2.5 text-[12px] font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                title="清掉隔离的半透明效果，恢复被显隐动过的构件"
                data-testid="bran-range-restore"
                @click="restoreBranRange">
                恢复
              </button>
            </div>
            <p class="mt-1 text-[11px] leading-relaxed text-gray-400">
              沿当前 BRAN 中心线按半径圈出全部构件：未加载的自动加载，命中实体显示、其余半透明；源 BRAN 保持实体。结果同时进空间查询抽屉，可继续按库/专业操作。
            </p>
            <p v-if="rangeError" class="mt-1 text-[11px] font-medium text-danger" data-testid="bran-range-error">{{ rangeError }}</p>
          </div>

          <!-- Action Row -->
          <div class="mt-3 flex gap-2">
            <button type="button"
              class="flex-1 rounded-[10px] border border-gray-200 bg-white py-2.5 text-center text-[13px] font-semibold text-gray-700 transition-colors hover:bg-gray-50"
              @click="applyComputeSelection">
              从场景读取 Refno
            </button>
            <button type="button"
              :disabled="computeState.loading || isComputeBusy"
              class="flex-1 rounded-[10px] bg-primary py-2.5 text-center text-[13px] font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              @click="runComputeScenario()">
              <Loader2 v-if="computeState.loading" class="mr-1 inline h-3.5 w-3.5 animate-spin" />
              {{ computeState.loading ? '计算中...' : '执行计算并定位' }}
            </button>
          </div>

          <!-- BRAN 净距：由 noun_counts 驱动的类型 facet（计算后才出现；勾选只在前端过滤，不重新请求） -->
          <div v-if="isBranScenario && computeState.nounFacets.length > 0" class="mt-3" data-testid="bran-noun-facet">
            <div class="flex flex-wrap items-center justify-between gap-y-1 pb-1.5">
              <div class="text-xs font-semibold text-muted-foreground">
                目标类型 · {{ computeState.structureCategory === 'all' ? '半径内' : '返回' }} {{ computeState.nounFacets.length }} 类 / {{ branFacetTotal }} 个候选
              </div>
              <div class="flex items-center gap-2 text-[11px] font-semibold">
                <button type="button" class="text-brand hover:underline" data-testid="bran-noun-facet-all" @click="setAllBranNounFacets(true)">全选</button>
                <button type="button" class="text-muted-foreground hover:underline" data-testid="bran-noun-facet-none" @click="setAllBranNounFacets(false)">清空</button>
                <template v-if="refiningAll">
                  <span class="tabular-nums text-brand" data-testid="bran-refine-all-progress">精算中 {{ refineAllProgress.done }}/{{ refineAllProgress.total }}</span>
                  <button type="button" class="text-muted-foreground hover:underline" data-testid="bran-refine-all-cancel" @click="cancelRefineAllDrawn">停止</button>
                </template>
                <button v-else
                  type="button"
                  :disabled="refinableDrawnCount === 0 || computeState.loading"
                  class="text-brand hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
                  title="把当前画出标注的候选全部升级为网格外表面精算（surface-clearance），并发 3、可停止"
                  data-testid="bran-refine-all"
                  @click="refineAllDrawnCandidates()">
                  全部精算 ({{ refinableDrawnCount }})
                </button>
              </div>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="facet in computeState.nounFacets"
                :key="facet.noun"
                type="button"
                :data-testid="`bran-noun-chip-${facet.noun}`"
                :aria-pressed="facet.selected"
                class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors"
                :class="facet.selected
                  ? 'border-brand bg-brand-subtle text-brand'
                  : 'border-gray-200 bg-white text-muted-foreground hover:border-gray-300'"
                @click="toggleBranNounFacet(facet.noun)">
                <Check v-if="facet.selected" class="h-3 w-3" />
                <span class="font-mono">{{ facet.noun }}</span>
                <span class="rounded-full px-1.5 text-[10px] tabular-nums" :class="facet.selected ? 'bg-brand/15' : 'bg-gray-100'">{{ facet.count }}</span>
              </button>
            </div>
            <div class="mt-1.5 text-[11px] leading-relaxed text-gray-400">
              每类最多返回 3 条，默认只标注最近 1 条；其余候选可逐条开关「标注」。已排除自身成员 {{ computeState.excludedSelfMembers }} 个。
            </div>
          </div>

          <!-- Result Table -->
          <div v-if="computeState.warnings.length" data-testid="clearance-warnings" class="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <p v-for="warning in computeState.warnings" :key="warning">{{ warning }}</p>
          </div>
          <div v-if="computeState.resultRows.length > 0 || computeState.error || computeState.responseText" class="mt-3">
            <div class="flex items-center justify-between pb-2">
              <div class="text-[13px] font-bold text-foreground">查询结果表</div>
              <div class="flex items-center gap-2">
                <div class="text-xs font-bold text-brand">{{ isBranScenario ? '高亮行已画进三维尺寸' : '可点击行自动选中并跳转' }}</div>
              </div>
            </div>

            <div v-if="computeState.error" class="rounded-[10px] border border-danger/25 bg-danger-subtle px-3 py-2 text-sm text-danger">
              {{ computeState.error }}
            </div>

            <div v-if="computeState.resultRows.length > 0" class="overflow-hidden rounded-[10px] border border-gray-200">
              <!-- Table Header -->
              <div class="flex h-8 items-center justify-between bg-gray-50 px-2.5 text-[11px] font-semibold text-muted-foreground">
                <div>构件 Refno · 类型 · 距离</div>
                <div>操作</div>
              </div>
              <!-- Rows: 双行紧凑卡片布局（D3a），窄 Dock 下完整展示 Refno、距离与操作按钮 -->
              <div v-for="(row, idx) in computeState.resultRows" :key="row.candidateKey ?? idx"
                class="border-t px-2 py-1.5 text-xs"
                :data-testid="isBranScenario ? 'bran-result-row' : undefined"
                :data-drawn="isBranScenario ? String(Boolean(row.drawn)) : undefined"
                :class="isRowEmphasized(row, idx) ? 'border-brand/25 bg-brand-subtle' : 'border-gray-200'"
                @mouseenter="hoverBranRowDimension(row, true)"
                @mouseleave="hoverBranRowDimension(row, false)">
                <div class="flex items-center justify-between gap-1">
                  <div class="flex min-w-0 items-center gap-1.5">
                    <div class="font-mono text-[11px] font-semibold text-foreground">{{ row.refno }}</div>
                    <div class="shrink-0 rounded bg-gray-100 px-1 py-0.5 text-[10px] font-semibold text-gray-700">{{ row.noun }}</div>
                    <div v-if="!isBranScenario" class="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                      {{ formatDistanceMm(row.distanceMm) }}
                    </div>
                  </div>
                  <div class="ml-auto flex shrink-0 items-center gap-1">
                    <button v-if="row.candidateKey" type="button" :data-testid="`bran-refine-${row.candidateKey}`"
                      :disabled="computeState.refiningKeys.includes(row.candidateKey) || computeState.loading"
                      class="whitespace-nowrap rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] disabled:opacity-50"
                      @click="refineBranCandidate(row.candidateKey)">
                      {{ computeState.refiningKeys.includes(row.candidateKey) ? '精算中' : '精算' }}
                    </button>
                    <button v-if="isBranScenario && row.candidateKey"
                      type="button"
                      :data-testid="`bran-draw-toggle-${row.candidateKey}`"
                      :aria-pressed="Boolean(row.drawn)"
                      class="inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold transition-colors"
                      :class="row.drawn
                        ? 'bg-brand-subtle text-brand hover:bg-brand/15'
                        : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'"
                      @click="toggleBranCandidateDrawn(row.candidateKey)">
                      {{ row.drawn ? '已标注' : '标注' }}
                    </button>
                    <button type="button"
                      class="inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold transition-colors"
                      :class="isRowEmphasized(row, idx)
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                        : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'"
                      @click="jumpToRow(row); $emit('select-refno', row.refno)">
                      {{ isBranScenario ? '跳转' : '选中并跳转' }}
                    </button>
                  </div>
                </div>
                <div v-if="isBranScenario" :title="row.label" class="mt-1 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
                  <span class="shrink-0 font-mono text-[11px] tabular-nums"
                    :title="row.intersects ? '包围盒估算相交——盒比实体大可能是假相交，点「精算」拿真实净距' : undefined"
                    :class="row.intersects
                      ? 'font-semibold text-amber-600'
                      : isRowEmphasized(row, idx) ? 'font-semibold text-brand' : 'font-semibold text-foreground'">
                    {{ formatDistanceMm(row.distanceMm) }}
                  </span>
                  <span v-if="row.intersects" class="inline-flex shrink-0 rounded bg-amber-100 px-1 py-0.5 align-middle text-[10px] font-bold text-amber-700">相交?</span>
                  <span class="truncate">{{ row.label || '-' }}</span>
                </div>
              </div>
            </div>

            <div v-else-if="!computeState.error" class="rounded-[10px] border border-gray-200 bg-gray-50 px-3 py-4 text-center text-sm text-muted-foreground">
              {{ isBranScenario && computeState.nounFacets.length > 0 ? '所有类型都已取消勾选，勾回任意类型即可显示候选。' : '未找到符合条件的结果。' }}
            </div>
          </div>

          <!-- Empty state -->
          <div v-else-if="!computeState.loading && !computeState.responseText" class="mt-3 rounded-[10px] border border-gray-200 bg-white px-3 py-8 text-center text-sm text-muted-foreground">
            结果将在执行计算后显示。
          </div>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
          <span>点击结果表任意行，场景将选中并飞到目标位置。</span>
          <span>已选场景：{{ currentScenarioMeta.endpoint.split('/').pop() }}</span>
        </div>
      </div>
    </div>

    <!-- 属性 tab placeholder -->
    <div v-else class="flex flex-1 items-center justify-center px-5 text-sm text-muted-foreground">
      属性面板暂未启用，请切换到"计算"标签。
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { Check, ChevronDown, Loader2 } from 'lucide-vue-next';

import type { SpatialComputeResultRow, SpatialComputeScenarioField } from '@/composables/useSpatialCompute';

import { useSelectionStore } from '@/composables/useSelectionStore';
import { branCandidateKey, findBranCandidateByKey, normalizeBranComputeRefno, useSpatialCompute } from '@/composables/useSpatialCompute';
import { resolveSceneWorldTransform, useSpatialQuery } from '@/composables/useSpatialQuery';
import { useViewerContext } from '@/composables/useViewerContext';
import { branClearanceDimensionId } from '@/dimension';

defineEmits<{
  'select-refno': [refno: string];
}>();

const spatialCompute = useSpatialCompute();
const {
  panelMode,
  activeScenario,
  scenarioList,
  scenarioExpanded,
  currentScenarioMeta,
  currentScenarioState,
  isBusy: isComputeBusy,
  setPanelMode,
  setActiveScenario,
  applyCurrentSelection: applyComputeSelection,
  autoFollowSelection,
  setAutoFollowSelection,
  suppressAutoFollowOnce,
  runWithPreservedResults,
  branRangeDistance,
  submitScenario,
  refineBranCandidate,
  refiningAll,
  refineAllProgress,
  refineAllDrawnCandidates,
  cancelRefineAllDrawn,
  toggleScenarioExpanded,
  toggleBranNounFacet,
  setAllBranNounFacets,
  toggleBranCandidateDrawn,
} = spatialCompute;

// useSpatialQuery 是单例 store，但其工厂内部会建 selection/viewer 依赖（首建需 setup 注入上下文）——
// 与 useSelectionStore 同理必须在 setup 期取一次复用，事件处理器里再 import+调会在单例未建时抛注入错。
const spatialQuery = useSpatialQuery();

const computeState = currentScenarioState;
const isBranScenario = computed(() => activeScenario.value === 'branNearestClearance');
/** facet 上的候选总数（`noun_counts` 之和，截断前口径）。 */
const branFacetTotal = computed(() => computeState.value.nounFacets.reduce((sum, facet) => sum + facet.count, 0));
/** 「全部精算」按钮上的条数：当前画出标注、还不是网格精算的非平行候选（provenance 缺省 = 服务端估算）。 */
const refinableDrawnCount = computed(() => isBranScenario.value
  ? computeState.value.annotationCandidates.filter(item =>
    !item.candidate.parallel && (item.provenance?.method ?? 'centerline-to-aabb') !== 'surface-to-surface').length
  : 0);

function runComputeScenario() {
  void submitScenario();
}

function onAutoFollowChange(event: Event) {
  setAutoFollowSelection((event.target as HTMLInputElement).checked);
}

const rangeDistance = branRangeDistance;
const rangeBusy = ref(false);
const rangeError = ref('');

/**
 * 「范围显示」：把这条 BRAN 交给空间查询同一套管线（距离查询 · 沿 BRAN 中心线 + 半径）查出全部周边构件，
 * 只加载未加载的并飞到结果包围盒，再隔离成「命中实体、其余半透明」。源 BRAN 经 keepRefnos 留在实体侧
 * （`include_self=false`，它不是命中）。结果同时落在空间查询抽屉的结果区，可继续分组操作或在那里恢复场景。
 */
async function showBranRange() {
  if (rangeBusy.value) return;
  rangeError.value = '';
  const state = spatialCompute.currentScenarioState.value;
  const bran = normalizeBranComputeRefno(state.queriedSourceRefno || state.suppoRefno);
  if (!bran) {
    rangeError.value = '先选中一个 BRAN（或开上面的「自动计算」）再显示范围';
    return;
  }
  const radius = Number(rangeDistance.value);
  if (!Number.isFinite(radius) || radius <= 0 || radius > 100000) {
    rangeError.value = '范围距离需是 1–100000 mm 的数字';
    return;
  }
  rangeBusy.value = true;
  try {
    spatialQuery.setMode('distance');
    spatialQuery.draft.distanceCenterSource = 'bran_centerline';
    spatialQuery.draft.refno = bran;
    spatialQuery.draft.radius = radius;
    // draft 与空间查询抽屉共享——上次在抽屉里设的过滤不能漏进这次「范围内全部构件」
    spatialQuery.draft.nounText = '';
    spatialQuery.draft.keyword = '';
    spatialQuery.draft.rooms = [];
    spatialQuery.draft.specValues = [];
    spatialQuery.draft.includeNegative = false;
    spatialQuery.draft.onlyLoaded = false;
    spatialQuery.draft.onlyVisible = false;
    await spatialQuery.submitQuery();
    if (spatialQuery.error.value || (spatialQuery.resultSet.value?.items.length ?? 0) === 0) {
      rangeError.value = spatialQuery.error.value || '范围内没有构件';
      return;
    }
    await runWithPreservedResults(() => spatialQuery.loadResults({ onlyUnloaded: true, flyTo: true }));
    spatialQuery.isolateResults([bran]);
    // 范围显示按它自己的命中集隔离了——「X 光 / 仅显示」的保实体集已失效，按钮归位
    branInspectMode.value = '';
    if (spatialQuery.error.value) {
      rangeError.value = spatialQuery.error.value;
    }
  } catch (err) {
    rangeError.value = err instanceof Error ? err.message : String(err);
  } finally {
    rangeBusy.value = false;
  }
}

function restoreBranRange() {
  try {
    spatialQuery.restoreScene();
  } catch (err) {
    console.warn('[bran-range] restoreScene failed', err);
  }
  branInspectMode.value = '';
}

/**
 * 「X 光查看」/「仅显示」：源 BRAN + 当前画出标注的每类最近目标保持实体，其余构件分别半透明 /
 * 全部隐藏（与空间查询抽屉同一套显隐快照，「恢复」也能退）。查看开着时标注集合变了（重算 / facet
 * 勾选 / 逐条标注开关 / 精算换 provenance）就按当前模式与新集合重放；集合清空了直接恢复场景。
 */
type BranInspectMode = 'xray' | 'only';
const branInspectMode = ref<BranInspectMode | ''>('');
/** 查看模式应用的序号：补装几何是异步的，期间用户退出/切模式/集合变化就作废本次应用。 */
let branInspectSeq = 0;

function branInspectKeepRefnos(): string[] {
  const state = currentScenarioState.value;
  const bran = normalizeBranComputeRefno(state.queriedSourceRefno || state.suppoRefno);
  const targets = state.annotationCandidates.map(item => item.candidate.refno);
  return bran ? [bran, ...targets] : targets;
}

async function applyBranInspect(mode: BranInspectMode, keep: string[]) {
  const seq = ++branInspectSeq;
  // 目标 refno 光有「可见」标记但几何没装是画不出来的（柱子/墙/楼板常见这种情况）——先补装再隔离，且补装期间保留当前净距结果
  await runWithPreservedResults(() => spatialQuery.ensureRefnosLoaded(keep)).catch(() => null);
  if (seq !== branInspectSeq || branInspectMode.value !== mode) return;
  if (mode === 'xray') {
    spatialQuery.isolateRefnos(keep);
  } else {
    spatialQuery.showOnlySceneObjects(keep);
  }
}

async function toggleBranInspect(mode: BranInspectMode) {
  // 先还原再判定：从另一种查看模式切过来时，残留状态（隐藏或半透明）不能带进新模式
  if (branInspectMode.value) {
    spatialQuery.restoreScene();
  }
  if (branInspectMode.value === mode) {
    branInspectSeq += 1;
    branInspectMode.value = '';
    return;
  }
  const keep = branInspectKeepRefnos();
  if (keep.length === 0) {
    branInspectMode.value = '';
    return;
  }
  branInspectMode.value = mode;
  await applyBranInspect(mode, keep);
}

watch(() => currentScenarioState.value.annotationCandidates, candidates => {
  const mode = branInspectMode.value;
  if (!mode) return;
  const keep = candidates.length > 0 ? branInspectKeepRefnos() : [];
  // 集合暂时为空（补装几何触发的自动重查会先清再回填）：只恢复场景、保留模式，
  // 候选回填后下一次触发会按当前模式自动重放；用户想退出随时点按钮即可（模式开着时按钮不禁用）。
  if (keep.length === 0) {
    // 作废在途应用——本次空集恢复必须盖过异步补装中的上一帧应用
    branInspectSeq += 1;
    spatialQuery.restoreScene();
  } else {
    void applyBranInspect(mode, keep);
  }
});

const viewerContext = useViewerContext();
// vue-query hooks живут только в setup-контексте — store берём здесь, не внутри хендлеров
const selectionStore = useSelectionStore();

/** 结果行 ↔ 三维标注联动：行对应的那条净距尺寸的 external 记录 id（只有画出去的候选才有）。 */
function branRowDimensionId(row: SpatialComputeResultRow): string | null {
  if (!isBranScenario.value || !row.candidateKey || !row.drawn) return null;
  const match = computeState.value.annotationCandidates.find(
    item => branCandidateKey(item.targetGroup, item.candidate) === row.candidateKey,
  );
  return match ? branClearanceDimensionId(match.targetGroup, match.candidate.refno, match.index) : null;
}

/** 悬停结果行 → 三维里那条净距尺寸进 hovered 样式（viewport.setHover 对外部记录同样生效）。 */
function hoverBranRowDimension(row: SpatialComputeResultRow, on: boolean) {
  const viewport = viewerContext.dimensionSystem?.value?.viewport;
  viewport?.setHover(on ? branRowDimensionId(row) : null);
}

/** 行「跳转」：选中目标并飞过去——BRAN 净距行框住整条净距段（管表面点 + 目标点，周围留 500mm），其余行退回构件包围盒。 */
async function jumpToRow(row: SpatialComputeResultRow) {
  const viewer = viewerContext.viewerRef.value;
  if (!viewer?.scene) return;
  suppressAutoFollowOnce(row.refno);
  selectionStore.setSelectedRefno(row.refno);
  await runWithPreservedResults(() => spatialQuery.ensureRefnosLoaded([row.refno])).catch(() => null);
  viewer.scene.ensureRefnos([row.refno]);
  viewer.scene.setObjectsVisible([row.refno], true);
  viewer.scene.setObjectsSelected([row.refno], true);
  let aabb: number[] | null = null;
  const candidate = isBranScenario.value && row.candidateKey
    ? (computeState.value.annotationCandidates.find(item => branCandidateKey(item.targetGroup, item.candidate) === row.candidateKey)?.candidate
      ?? findBranCandidateByKey(computeState.value.branGroups, row.candidateKey)?.item)
    : undefined;
  const start = candidate?.annotation?.start_point;
  const end = candidate?.annotation?.end_point;
  const nums = [start?.x, start?.y, start?.z, end?.x, end?.y, end?.z].map(Number);
  if (nums.every(Number.isFinite)) {
    const m = 500;
    aabb = resolveSceneWorldTransform(viewer).aabbToScene([
      Math.min(nums[0]!, nums[3]!) - m, Math.min(nums[1]!, nums[4]!) - m, Math.min(nums[2]!, nums[5]!) - m,
      Math.max(nums[0]!, nums[3]!) + m, Math.max(nums[1]!, nums[4]!) + m, Math.max(nums[2]!, nums[5]!) + m,
    ]);
  }
  aabb ??= viewer.scene.getAABB([row.refno]) ?? null;
  if (aabb) viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
}

function hasField(field: SpatialComputeScenarioField) {
  return currentScenarioMeta.value.fields.includes(field);
}

/** BRAN 净距按「画进三维了没」高亮；其余场景沿用「首行 = 最近 / 主结果」。 */
function isRowEmphasized(row: SpatialComputeResultRow, idx: number): boolean {
  return isBranScenario.value ? Boolean(row.drawn) : idx === 0;
}

function formatDistanceMm(mm: number | null): string {
  if (mm == null) return '-';
  if (isBranScenario.value) return `${Math.round(mm)}mm`;
  if (mm >= 1000) return `${(mm / 1000).toFixed(1)}m`;
  return `${mm.toFixed(0)}mm`;
}
</script>
