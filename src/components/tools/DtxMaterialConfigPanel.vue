<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { applyMaterialConfigToLoadedDtx, getDtxNounCounts } from '@/composables/useDbnoInstancesDtxLoader'
import { useDisplayThemeStore } from '@/composables/useDisplayThemeStore'
import { useViewerContext } from '@/composables/useViewerContext'
import {
  buildExportConfig,
  loadModelDisplayConfig,
  normalizeColorString,
  saveLocalMaterialConfig,
  type MaterialConfigEntry,
  type ModelDisplayConfig,
  type ThemeConfig,
} from '@/utils/three/dtx/materialConfig'

const ctx = useViewerContext()

type PanelTab = 'materials' | 'themes'
const activeTab = ref<PanelTab>('materials')

const baseConfig = ref<ModelDisplayConfig | null>(null)
const defaultMaterial = ref<MaterialConfigEntry>({})
const materialConfigs = ref<Record<string, MaterialConfigEntry>>({})
const instanceConfigs = ref<Record<string, MaterialConfigEntry>>({})
const themeConfigs = ref<Record<string, ThemeConfig>>({})

const selectedNoun = ref('')
const currentMaterial = ref<MaterialConfigEntry>({})
const statusMessage = ref('')
const filterText = ref('')
const newNoun = ref('')

// --- Theme editing state ---
const selectedThemeKey = ref('')
const selectedOwnerKey = ref('')
const currentThemeMaterial = ref<MaterialConfigEntry>({})
const newOwnerKey = ref('')

const themeKeys = computed(() => Object.keys(themeConfigs.value).sort())

const ownerKeys = computed(() => {
  const tc = themeConfigs.value[selectedThemeKey.value]
  if (!tc?.ownerOverrides) return []
  return Object.keys(tc.ownerOverrides).sort()
})

const nounCounts = computed(() => {
  const viewer = ctx.viewerRef.value as any
  const dbno = viewer?.__dtxLastLoadedDbno
  if (!dbno) return new Map<string, number>()
  return new Map(getDtxNounCounts(dbno).map((item) => [item.noun, item.count]))
})

const nounList = computed(() => {
  const items = Object.keys(materialConfigs.value || {}).sort()
  const filter = filterText.value.trim().toUpperCase()
  if (!filter) return items
  return items.filter((noun) => noun.includes(filter))
})

function setStatus(message: string) {
  statusMessage.value = message
  if (!message) return
  setTimeout(() => {
    if (statusMessage.value === message) {
      statusMessage.value = ''
    }
  }, 3000)
}

function buildWorkingConfig(): ModelDisplayConfig {
  return {
    ...(baseConfig.value || {}),
    defaultMaterial: { ...defaultMaterial.value },
    materialConfigs: { ...materialConfigs.value },
    instanceConfigs: { ...instanceConfigs.value },
    themes: { ...themeConfigs.value },
  }
}

// --- Material editing ---

function syncCurrentFromSelection(noun: string) {
  const base = defaultMaterial.value || {}
  const entry = materialConfigs.value[noun] || {}
  currentMaterial.value = {
    color: normalizeColorString(entry.color ?? base.color),
    metalness: typeof entry.metalness === 'number' ? entry.metalness : base.metalness ?? 0.1,
    roughness: typeof entry.roughness === 'number' ? entry.roughness : base.roughness ?? 0.5,
  }
}

function commitCurrent() {
  const noun = selectedNoun.value
  if (!noun) return
  const color = normalizeColorString(currentMaterial.value.color)
  materialConfigs.value[noun] = {
    ...materialConfigs.value[noun],
    color,
    metalness: typeof currentMaterial.value.metalness === 'number' ? currentMaterial.value.metalness : undefined,
    roughness: typeof currentMaterial.value.roughness === 'number' ? currentMaterial.value.roughness : undefined,
  }
}

function addNoun() {
  const noun = newNoun.value.trim().toUpperCase()
  if (!noun) return
  if (!materialConfigs.value[noun]) {
    materialConfigs.value[noun] = {
      color: normalizeColorString(defaultMaterial.value.color),
      metalness: defaultMaterial.value.metalness ?? 0.1,
      roughness: defaultMaterial.value.roughness ?? 0.5,
    }
  }
  selectedNoun.value = noun
  newNoun.value = ''
  syncCurrentFromSelection(noun)
}

// --- Theme editing ---

function syncThemeOverrideFromSelection() {
  const tc = themeConfigs.value[selectedThemeKey.value]
  const entry = tc?.ownerOverrides?.[selectedOwnerKey.value]
  if (entry) {
    currentThemeMaterial.value = {
      color: normalizeColorString(entry.color ?? '#4CAF50'),
      metalness: typeof entry.metalness === 'number' ? entry.metalness : 0.25,
      roughness: typeof entry.roughness === 'number' ? entry.roughness : 0.35,
      opacity: typeof entry.opacity === 'number' ? entry.opacity : 1,
    }
  } else {
    currentThemeMaterial.value = { color: '#4CAF50', metalness: 0.25, roughness: 0.35, opacity: 1 }
  }
}

function commitThemeOverride() {
  const theme = selectedThemeKey.value
  const owner = selectedOwnerKey.value
  if (!theme || !owner) return
  if (!themeConfigs.value[theme]) {
    themeConfigs.value[theme] = { name: theme, ownerOverrides: {} }
  }
  if (!themeConfigs.value[theme].ownerOverrides) {
    themeConfigs.value[theme].ownerOverrides = {}
  }
  const color = normalizeColorString(currentThemeMaterial.value.color)
  themeConfigs.value[theme].ownerOverrides![owner] = {
    ...themeConfigs.value[theme].ownerOverrides![owner],
    color,
    metalness: typeof currentThemeMaterial.value.metalness === 'number' ? currentThemeMaterial.value.metalness : undefined,
    roughness: typeof currentThemeMaterial.value.roughness === 'number' ? currentThemeMaterial.value.roughness : undefined,
    opacity: typeof currentThemeMaterial.value.opacity === 'number' ? currentThemeMaterial.value.opacity : undefined,
  }
}

function addOwnerOverride() {
  const owner = newOwnerKey.value.trim().toUpperCase()
  if (!owner) return
  const theme = selectedThemeKey.value
  if (!theme) return
  if (!themeConfigs.value[theme]) {
    themeConfigs.value[theme] = { name: theme, ownerOverrides: {} }
  }
  if (!themeConfigs.value[theme].ownerOverrides) {
    themeConfigs.value[theme].ownerOverrides = {}
  }
  if (!themeConfigs.value[theme].ownerOverrides![owner]) {
    themeConfigs.value[theme].ownerOverrides![owner] = {
      color: '#4CAF50',
      metalness: 0.25,
      roughness: 0.35,
      opacity: 1,
    }
  }
  selectedOwnerKey.value = owner
  newOwnerKey.value = ''
  syncThemeOverrideFromSelection()
}

function removeOwnerOverride() {
  const theme = selectedThemeKey.value
  const owner = selectedOwnerKey.value
  if (!theme || !owner) return
  const overrides = themeConfigs.value[theme]?.ownerOverrides
  if (overrides && overrides[owner]) {
    delete overrides[owner]
    selectedOwnerKey.value = ''
    currentThemeMaterial.value = {}
  }
}

// --- Actions ---

function doCommitAll() {
  if (activeTab.value === 'materials') {
    commitCurrent()
  } else {
    commitThemeOverride()
  }
}

async function applyToScene() {
  doCommitAll()
  const viewer = ctx.viewerRef.value as any
  const dbno = viewer?.__dtxLastLoadedDbno
  const dtxLayer = viewer?.__dtxLayer
  if (!dbno || !dtxLayer) {
    saveLocalMaterialConfig({ nounConfigs: materialConfigs.value, instanceConfigs: instanceConfigs.value, themes: themeConfigs.value })
    setStatus('saved (no active scene)')
    return
  }
  const config = buildWorkingConfig()
  saveLocalMaterialConfig({ nounConfigs: materialConfigs.value, instanceConfigs: instanceConfigs.value, themes: themeConfigs.value })
  const { currentTheme } = useDisplayThemeStore()
  const result = applyMaterialConfigToLoadedDtx(dtxLayer, dbno, config, currentTheme.value)
  setStatus(`applied (${result.updatedObjects})`)
}

function saveLocal() {
  doCommitAll()
  saveLocalMaterialConfig({ nounConfigs: materialConfigs.value, instanceConfigs: instanceConfigs.value, themes: themeConfigs.value })
  setStatus('saved')
}

async function exportConfig() {
  doCommitAll()
  const exp = buildExportConfig(buildWorkingConfig())
  const json = JSON.stringify(exp, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'model-display.config.json'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  setStatus('exported')
}

onMounted(async () => {
  const config = await loadModelDisplayConfig()
  baseConfig.value = config
  defaultMaterial.value = config.defaultMaterial || {}
  materialConfigs.value = { ...(config.materialConfigs || {}) }
  instanceConfigs.value = { ...(config.instanceConfigs || {}) }
  themeConfigs.value = JSON.parse(JSON.stringify(config.themes || {}))
  const first = Object.keys(materialConfigs.value)[0]
  if (first) {
    selectedNoun.value = first
    syncCurrentFromSelection(first)
  }
  const firstTheme = Object.keys(themeConfigs.value)[0]
  if (firstTheme) {
    selectedThemeKey.value = firstTheme
    const firstOwner = Object.keys(themeConfigs.value[firstTheme]?.ownerOverrides || {})[0]
    if (firstOwner) {
      selectedOwnerKey.value = firstOwner
      syncThemeOverrideFromSelection()
    }
  }
})

watch(selectedNoun, (value) => {
  if (!value) return
  syncCurrentFromSelection(value)
})

watch(selectedThemeKey, () => {
  const first = ownerKeys.value[0] || ''
  selectedOwnerKey.value = first
  if (first) syncThemeOverrideFromSelection()
})

watch(selectedOwnerKey, () => {
  if (selectedOwnerKey.value) syncThemeOverrideFromSelection()
})
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Tab bar -->
    <div class="flex shrink-0 border-b border-border">
      <button
        type="button"
        class="px-3 py-1.5 text-xs transition-colors"
        :class="activeTab === 'materials' ? 'border-b-2 border-primary font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'"
        @click="activeTab = 'materials'"
      >
        构件材质
      </button>
      <button
        type="button"
        class="px-3 py-1.5 text-xs transition-colors"
        :class="activeTab === 'themes' ? 'border-b-2 border-primary font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'"
        @click="activeTab = 'themes'"
      >
        主题覆盖
      </button>
    </div>

    <div class="flex min-h-0 flex-1">
      <!-- ========== Materials tab ========== -->
      <template v-if="activeTab === 'materials'">
        <div class="w-56 border-r border-border p-2">
          <div class="text-xs font-medium text-foreground">Material Types</div>
          <input
            v-model="filterText"
            class="mt-2 w-full rounded border border-input bg-transparent px-2 py-1 text-xs"
            placeholder="Filter..."
          />
          <div class="mt-2 max-h-[calc(100%-120px)] overflow-auto">
            <button
              v-for="noun in nounList"
              :key="noun"
              type="button"
              class="mb-1 flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs transition-colors"
              :class="selectedNoun === noun ? 'bg-primary/10 text-primary' : 'hover:bg-muted'"
              @click="selectedNoun = noun"
            >
              <span class="truncate">{{ noun }}</span>
              <span v-if="nounCounts.has(noun)" class="text-[10px] text-muted-foreground">
                {{ nounCounts.get(noun) }}
              </span>
            </button>
          </div>
          <div class="mt-2 flex items-center gap-1">
            <input
              v-model="newNoun"
              class="w-full rounded border border-input bg-transparent px-2 py-1 text-xs"
              placeholder="NEW NOUN"
            />
            <button type="button" class="rounded border border-border px-2 py-1 text-xs" @click="addNoun">
              +
            </button>
          </div>
        </div>

        <div class="flex-1 p-3">
          <div class="flex items-center justify-between">
            <div class="text-sm font-medium text-foreground">Material Config</div>
            <div class="flex items-center gap-2">
              <button type="button" class="rounded border border-border px-2 py-1 text-xs" @click="saveLocal">Save</button>
              <button type="button" class="rounded border border-border px-2 py-1 text-xs" @click="applyToScene">Apply</button>
              <button type="button" class="rounded border border-border px-2 py-1 text-xs" @click="exportConfig">Export</button>
            </div>
          </div>

          <div v-if="statusMessage" class="mt-2 text-xs text-muted-foreground">{{ statusMessage }}</div>

          <div v-if="!selectedNoun" class="mt-6 text-xs text-muted-foreground">Select a material type.</div>
          <div v-else class="mt-4 space-y-4">
            <div>
              <div class="text-xs font-medium text-foreground">Type</div>
              <div class="mt-1 text-xs text-muted-foreground">{{ selectedNoun }}</div>
            </div>

            <div>
              <div class="text-xs font-medium text-foreground">Base Color</div>
              <div class="mt-2 flex items-center gap-2">
                <input v-model="currentMaterial.color" type="color" class="h-8 w-12 cursor-pointer rounded border border-border bg-transparent p-0" />
                <input v-model="currentMaterial.color" class="w-32 rounded border border-input bg-transparent px-2 py-1 text-xs" />
              </div>
            </div>

            <div>
              <div class="text-xs font-medium text-foreground">Metalness</div>
              <div class="mt-2 flex items-center gap-2">
                <input v-model.number="currentMaterial.metalness" type="range" min="0" max="1" step="0.01" class="w-48" />
                <input v-model.number="currentMaterial.metalness" type="number" min="0" max="1" step="0.01" class="w-20 rounded border border-input bg-transparent px-2 py-1 text-xs" />
              </div>
            </div>

            <div>
              <div class="text-xs font-medium text-foreground">Roughness</div>
              <div class="mt-2 flex items-center gap-2">
                <input v-model.number="currentMaterial.roughness" type="range" min="0" max="1" step="0.01" class="w-48" />
                <input v-model.number="currentMaterial.roughness" type="number" min="0" max="1" step="0.01" class="w-20 rounded border border-input bg-transparent px-2 py-1 text-xs" />
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- ========== Themes tab ========== -->
      <template v-if="activeTab === 'themes'">
        <div class="w-56 border-r border-border p-2">
          <div class="text-xs font-medium text-foreground">主题</div>
          <div class="mt-2 space-y-1">
            <button
              v-for="tk in themeKeys"
              :key="tk"
              type="button"
              class="w-full rounded px-2 py-1 text-left text-xs transition-colors"
              :class="selectedThemeKey === tk ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'"
              @click="selectedThemeKey = tk"
            >
              {{ themeConfigs[tk]?.name || tk }}
            </button>
          </div>

          <div v-if="selectedThemeKey" class="mt-4">
            <div class="text-xs font-medium text-foreground">Owner 覆盖列表</div>
            <div class="mt-2 max-h-48 overflow-auto space-y-0.5">
              <button
                v-for="ok in ownerKeys"
                :key="ok"
                type="button"
                class="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition-colors"
                :class="selectedOwnerKey === ok ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'"
                @click="selectedOwnerKey = ok"
              >
                <span
                  class="inline-block h-3 w-3 shrink-0 rounded-sm border border-border"
                  :style="{ background: normalizeColorString(themeConfigs[selectedThemeKey]?.ownerOverrides?.[ok]?.color) }"
                />
                <span>{{ ok }}</span>
              </button>
            </div>
            <div class="mt-2 flex items-center gap-1">
              <input
                v-model="newOwnerKey"
                class="w-full rounded border border-input bg-transparent px-2 py-1 text-xs"
                placeholder="NEW OWNER (如 BRAN)"
              />
              <button type="button" class="rounded border border-border px-2 py-1 text-xs" @click="addOwnerOverride">+</button>
            </div>
          </div>
        </div>

        <div class="flex-1 p-3">
          <div class="flex items-center justify-between">
            <div class="text-sm font-medium text-foreground">Theme Override Config</div>
            <div class="flex items-center gap-2">
              <button type="button" class="rounded border border-border px-2 py-1 text-xs" @click="saveLocal">Save</button>
              <button type="button" class="rounded border border-border px-2 py-1 text-xs" @click="applyToScene">Apply</button>
              <button type="button" class="rounded border border-border px-2 py-1 text-xs" @click="exportConfig">Export</button>
            </div>
          </div>

          <div v-if="statusMessage" class="mt-2 text-xs text-muted-foreground">{{ statusMessage }}</div>

          <div v-if="!selectedThemeKey" class="mt-6 text-xs text-muted-foreground">无主题配置。</div>
          <div v-else-if="!selectedOwnerKey" class="mt-6 text-xs text-muted-foreground">
            选择或添加一个 Owner 类型以编辑覆盖配色。
          </div>
          <div v-else class="mt-4 space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-xs font-medium text-foreground">{{ selectedThemeKey }} / {{ selectedOwnerKey }}</div>
                <div class="mt-0.5 text-[10px] text-muted-foreground">
                  当 owner_noun = {{ selectedOwnerKey }} 时，覆盖为以下配色
                </div>
              </div>
              <button
                type="button"
                class="rounded border border-destructive/50 px-2 py-1 text-[10px] text-destructive hover:bg-destructive/10"
                @click="removeOwnerOverride"
              >
                删除
              </button>
            </div>

            <div>
              <div class="text-xs font-medium text-foreground">Color</div>
              <div class="mt-2 flex items-center gap-2">
                <input v-model="currentThemeMaterial.color" type="color" class="h-8 w-12 cursor-pointer rounded border border-border bg-transparent p-0" />
                <input v-model="currentThemeMaterial.color" class="w-32 rounded border border-input bg-transparent px-2 py-1 text-xs" />
              </div>
            </div>

            <div>
              <div class="text-xs font-medium text-foreground">Metalness</div>
              <div class="mt-2 flex items-center gap-2">
                <input v-model.number="currentThemeMaterial.metalness" type="range" min="0" max="1" step="0.01" class="w-48" />
                <input v-model.number="currentThemeMaterial.metalness" type="number" min="0" max="1" step="0.01" class="w-20 rounded border border-input bg-transparent px-2 py-1 text-xs" />
              </div>
            </div>

            <div>
              <div class="text-xs font-medium text-foreground">Roughness</div>
              <div class="mt-2 flex items-center gap-2">
                <input v-model.number="currentThemeMaterial.roughness" type="range" min="0" max="1" step="0.01" class="w-48" />
                <input v-model.number="currentThemeMaterial.roughness" type="number" min="0" max="1" step="0.01" class="w-20 rounded border border-input bg-transparent px-2 py-1 text-xs" />
              </div>
            </div>

            <div>
              <div class="text-xs font-medium text-foreground">Opacity</div>
              <div class="mt-2 flex items-center gap-2">
                <input v-model.number="currentThemeMaterial.opacity" type="range" min="0" max="1" step="0.01" class="w-48" />
                <input v-model.number="currentThemeMaterial.opacity" type="number" min="0" max="1" step="0.01" class="w-20 rounded border border-input bg-transparent px-2 py-1 text-xs" />
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
