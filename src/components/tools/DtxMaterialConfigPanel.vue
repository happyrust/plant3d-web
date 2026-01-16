<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { applyMaterialConfigToLoadedDtx, getDtxNounCounts } from '@/composables/useDbnoInstancesDtxLoader'
import { useViewerContext } from '@/composables/useViewerContext'
import {
  buildExportConfig,
  loadModelDisplayConfig,
  normalizeColorString,
  saveLocalMaterialConfig,
  type MaterialConfigEntry,
  type ModelDisplayConfig,
} from '@/utils/three/dtx/materialConfig'

const ctx = useViewerContext()

const baseConfig = ref<ModelDisplayConfig | null>(null)
const defaultMaterial = ref<MaterialConfigEntry>({})
const materialConfigs = ref<Record<string, MaterialConfigEntry>>({})
const instanceConfigs = ref<Record<string, MaterialConfigEntry>>({})

const selectedNoun = ref('')
const currentMaterial = ref<MaterialConfigEntry>({})
const statusMessage = ref('')
const filterText = ref('')
const newNoun = ref('')

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
  }
}

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

async function applyToScene() {
  commitCurrent()
  const viewer = ctx.viewerRef.value as any
  const dbno = viewer?.__dtxLastLoadedDbno
  const dtxLayer = viewer?.__dtxLayer
  if (!dbno || !dtxLayer) {
    saveLocalMaterialConfig({ nounConfigs: materialConfigs.value, instanceConfigs: instanceConfigs.value })
    setStatus('saved (no active scene)')
    return
  }
  const config = buildWorkingConfig()
  saveLocalMaterialConfig({ nounConfigs: materialConfigs.value, instanceConfigs: instanceConfigs.value })
  const result = applyMaterialConfigToLoadedDtx(dtxLayer, dbno, config)
  setStatus(`applied (${result.updatedObjects})`)
}

function saveLocal() {
  commitCurrent()
  saveLocalMaterialConfig({ nounConfigs: materialConfigs.value, instanceConfigs: instanceConfigs.value })
  setStatus('saved')
}

async function exportConfig() {
  commitCurrent()
  const exportConfig = buildExportConfig(buildWorkingConfig())
  const json = JSON.stringify(exportConfig, null, 2)
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
  const first = Object.keys(materialConfigs.value)[0]
  if (first) {
    selectedNoun.value = first
    syncCurrentFromSelection(first)
  }
})

watch(selectedNoun, (value) => {
  if (!value) return
  syncCurrentFromSelection(value)
})
</script>

<template>
  <div class="flex h-full">
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
          <button type="button" class="rounded border border-border px-2 py-1 text-xs" @click="saveLocal">
            Save
          </button>
          <button type="button" class="rounded border border-border px-2 py-1 text-xs" @click="applyToScene">
            Apply
          </button>
          <button type="button" class="rounded border border-border px-2 py-1 text-xs" @click="exportConfig">
            Export
          </button>
        </div>
      </div>

      <div v-if="statusMessage" class="mt-2 text-xs text-muted-foreground">
        {{ statusMessage }}
      </div>

      <div v-if="!selectedNoun" class="mt-6 text-xs text-muted-foreground">
        Select a material type.
      </div>
      <div v-else class="mt-4 space-y-4">
        <div>
          <div class="text-xs font-medium text-foreground">Type</div>
          <div class="mt-1 text-xs text-muted-foreground">{{ selectedNoun }}</div>
        </div>

        <div>
          <div class="text-xs font-medium text-foreground">Base Color</div>
          <div class="mt-2 flex items-center gap-2">
            <input
              v-model="currentMaterial.color"
              type="color"
              class="h-8 w-12 cursor-pointer rounded border border-border bg-transparent p-0"
            />
            <input
              v-model="currentMaterial.color"
              class="w-32 rounded border border-input bg-transparent px-2 py-1 text-xs"
            />
          </div>
        </div>

        <div>
          <div class="text-xs font-medium text-foreground">Metalness</div>
          <div class="mt-2 flex items-center gap-2">
            <input
              v-model.number="currentMaterial.metalness"
              type="range"
              min="0"
              max="1"
              step="0.01"
              class="w-48"
            />
            <input
              v-model.number="currentMaterial.metalness"
              type="number"
              min="0"
              max="1"
              step="0.01"
              class="w-20 rounded border border-input bg-transparent px-2 py-1 text-xs"
            />
          </div>
        </div>

        <div>
          <div class="text-xs font-medium text-foreground">Roughness</div>
          <div class="mt-2 flex items-center gap-2">
            <input
              v-model.number="currentMaterial.roughness"
              type="range"
              min="0"
              max="1"
              step="0.01"
              class="w-48"
            />
            <input
              v-model.number="currentMaterial.roughness"
              type="number"
              min="0"
              max="1"
              step="0.01"
              class="w-20 rounded border border-input bg-transparent px-2 py-1 text-xs"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
