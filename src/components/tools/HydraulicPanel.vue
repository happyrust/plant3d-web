<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { useSelectionStore } from '@/composables/useSelectionStore';
import { useViewerContext } from '@/composables/useViewerContext';

// ----------------------------------------------------------------------
// 1. 快速水力计算 (Rapid Calculation)
// ----------------------------------------------------------------------

// Inputs
const airSpeedDuct = ref(5.0);
const airSpeedDevice = ref(2.0);
const airSpeedOutlet = ref(1.0);

const ductLength = ref(10.0);
const bendCount = ref(3);
const teeCount = ref(2);
const valveCount = ref(1);
const suddenChangeCount = ref(0);

const filterResistance = ref(50.0);
const coolerResistance = ref(20.0);
const heaterResistance = ref(30.0);
const adsorberResistance = ref(10.0);
const outletResistance = ref(5.0);
const otherResistance = ref(15.0);

const calculationResult = ref<string | null>(null);

const ctx = useViewerContext();
const selection = useSelectionStore();
const viewerReady = computed(() => !!ctx.viewerRef.value && !!ctx.store.value);

function calculateRapid() {
  // Logic from reference python script
  // Note: This formula seems to be a placeholder example in the reference script.
  // total = sum(resistances) + (length * count * factor) ... ?
  // The python script had:
  // (duct_length * bend_count * 0.5) + (duct_length * tee_count * 0.25) ...
  // This implies resistance increases with length AND count?
  // Usually it is (Length * Friction) + (Count * LocalLoss).
  // But we stick to the provided python reference logic for now.

  const equipmentRes =
    filterResistance.value +
    coolerResistance.value +
    heaterResistance.value +
    adsorberResistance.value +
    outletResistance.value +
    otherResistance.value;

  const ductRes =
    ductLength.value * bendCount.value * 0.5 +
    ductLength.value * teeCount.value * 0.25 +
    ductLength.value * valveCount.value * 0.1 +
    ductLength.value * suddenChangeCount.value * 0.2;

  const total = equipmentRes + ductRes;

  calculationResult.value = `总阻力: ${total.toFixed(2)} Pa`;
}

// ----------------------------------------------------------------------
// Tabs
// ----------------------------------------------------------------------
const activeTab = ref<'rapid' | 'manual' | 'auto'>('rapid');

type ManualSegment = {
  id: string;
  flow_m3h: number | null;
  duct_size: string | null;
};

const manualPicking = ref(false);
const manualSelectedId = ref<string | null>(null);
const manualFlow = ref<number | null>(null);
const manualSize = ref('');
const manualSegments = ref<ManualSegment[]>([]);

function beginPickManualSegment() {
  manualPicking.value = true;
  ctx.store.value?.setToolMode('none');
}

watch(
  () => selection.selectedRefno.value,
  (id) => {
    if (!manualPicking.value) return;
    if (!id) return;
    manualSelectedId.value = id;
    manualPicking.value = false;
  }
);

function addManualSegment() {
  const id = manualSelectedId.value || selection.selectedRefno.value;
  if (!id) return;
  manualSegments.value = [
    ...manualSegments.value,
    {
      id,
      flow_m3h: manualFlow.value,
      duct_size: manualSize.value.trim() ? manualSize.value.trim() : null,
    },
  ];
}

function removeManualSegment(index: number) {
  manualSegments.value = manualSegments.value.filter((_, i) => i !== index);
}

function clearManualSegments() {
  manualSegments.value = [];
}
</script>

<template>
  <div class="flex flex-col h-full gap-4 p-2 overflow-auto">
    <!-- Tabs -->
    <div class="flex space-x-2 border-b border-border pb-2">
      <button type="button"
        class="px-3 py-1 text-sm rounded-md transition-colors"
        :class="activeTab === 'rapid' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'"
        @click="activeTab = 'rapid'">
        快速计算
      </button>
      <button type="button"
        class="px-3 py-1 text-sm rounded-md transition-colors"
        :class="activeTab === 'manual' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'"
        @click="activeTab = 'manual'">
        现有模型(手算)
      </button>
      <button type="button"
        class="px-3 py-1 text-sm rounded-md transition-colors"
        :class="activeTab === 'auto' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'"
        @click="activeTab = 'auto'">
        E3D自动计算
      </button>
    </div>

    <!-- Rapid Calculation Panel -->
    <div v-if="activeTab === 'rapid'" class="flex flex-col gap-4">
      <div class="text-xs text-muted-foreground">
        根据输入的风速、管件数量和设备阻力进行快速估算。
      </div>

      <!-- Section 1: Air Speeds -->
      <div class="rounded-md border border-border p-3 space-y-3">
        <div class="font-medium text-sm">风速参数 (m/s)</div>
        <div class="grid grid-cols-2 gap-2 text-sm">
          <label class="flex flex-col">
            <span class="text-muted-foreground text-xs mb-1">风管风速</span>
            <input v-model.number="airSpeedDuct" type="number" class="border border-input rounded px-2 py-1 bg-background" />
          </label>
          <label class="flex flex-col">
            <span class="text-muted-foreground text-xs mb-1">设备风速</span>
            <input v-model.number="airSpeedDevice" type="number" class="border border-input rounded px-2 py-1 bg-background" />
          </label>
          <label class="flex flex-col">
            <span class="text-muted-foreground text-xs mb-1">风口风速</span>
            <input v-model.number="airSpeedOutlet" type="number" class="border border-input rounded px-2 py-1 bg-background" />
          </label>
        </div>
      </div>

      <!-- Section 2: Duct Parameters -->
      <div class="rounded-md border border-border p-3 space-y-3">
        <div class="font-medium text-sm">管路参数</div>
        <div class="grid grid-cols-2 gap-2 text-sm">
          <label class="flex flex-col">
            <span class="text-muted-foreground text-xs mb-1">直管长度 (m)</span>
            <input v-model.number="ductLength" type="number" class="border border-input rounded px-2 py-1 bg-background" />
          </label>
          <label class="flex flex-col">
            <span class="text-muted-foreground text-xs mb-1">弯头数量</span>
            <input v-model.number="bendCount" type="number" class="border border-input rounded px-2 py-1 bg-background" />
          </label>
          <label class="flex flex-col">
            <span class="text-muted-foreground text-xs mb-1">三通数量</span>
            <input v-model.number="teeCount" type="number" class="border border-input rounded px-2 py-1 bg-background" />
          </label>
          <label class="flex flex-col">
            <span class="text-muted-foreground text-xs mb-1">风阀数量</span>
            <input v-model.number="valveCount" type="number" class="border border-input rounded px-2 py-1 bg-background" />
          </label>
          <label class="flex flex-col">
            <span class="text-muted-foreground text-xs mb-1">突变径数量</span>
            <input v-model.number="suddenChangeCount" type="number" class="border border-input rounded px-2 py-1 bg-background" />
          </label>
        </div>
      </div>

      <!-- Section 3: Resistances -->
      <div class="rounded-md border border-border p-3 space-y-3">
        <div class="font-medium text-sm">设备阻力 (Pa)</div>
        <div class="grid grid-cols-2 gap-2 text-sm">
          <label class="flex flex-col">
            <span class="text-muted-foreground text-xs mb-1">过滤器</span>
            <input v-model.number="filterResistance" type="number" class="border border-input rounded px-2 py-1 bg-background" />
          </label>
          <label class="flex flex-col">
            <span class="text-muted-foreground text-xs mb-1">冷却器</span>
            <input v-model.number="coolerResistance" type="number" class="border border-input rounded px-2 py-1 bg-background" />
          </label>
          <label class="flex flex-col">
            <span class="text-muted-foreground text-xs mb-1">加热器</span>
            <input v-model.number="heaterResistance" type="number" class="border border-input rounded px-2 py-1 bg-background" />
          </label>
          <label class="flex flex-col">
            <span class="text-muted-foreground text-xs mb-1">碘吸附器</span>
            <input v-model.number="adsorberResistance" type="number" class="border border-input rounded px-2 py-1 bg-background" />
          </label>
          <label class="flex flex-col">
            <span class="text-muted-foreground text-xs mb-1">末端风口</span>
            <input v-model.number="outletResistance" type="number" class="border border-input rounded px-2 py-1 bg-background" />
          </label>
          <label class="flex flex-col">
            <span class="text-muted-foreground text-xs mb-1">其他</span>
            <input v-model.number="otherResistance" type="number" class="border border-input rounded px-2 py-1 bg-background" />
          </label>
        </div>
      </div>

      <!-- Calculate Button -->
      <button type="button"
        class="w-full py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
        @click="calculateRapid">
        计算总阻力
      </button>

      <!-- Result -->
      <div v-if="calculationResult" class="p-4 bg-muted rounded-md text-center font-bold text-lg text-foreground border border-border">
        {{ calculationResult }}
      </div>
    </div>

    <!-- Placeholder: Manual Model Calc -->
    <div v-else-if="activeTab === 'manual'" class="flex flex-col gap-4 text-sm">
      <div class="p-3 bg-muted/50 rounded-md border border-border">
        <h3 class="font-medium mb-2">根据现有二维/三维模型计算</h3>
        <p class="text-muted-foreground mb-4">
          从新风进入房间开始计算，直到最末端管路结束。设计者需手动输入风量和风管尺寸。
        </p>

        <div v-if="!viewerReady" class="text-xs text-muted-foreground">
          Viewer 未初始化，暂无法从三维中选择管段。
        </div>

        <div class="flex flex-col gap-2">
          <label class="flex flex-col">
            <span class="mb-1 text-xs">选择管段</span>
            <button type="button"
              class="border border-input bg-background px-3 py-1.5 rounded text-left text-muted-foreground hover:bg-muted"
              :disabled="!viewerReady"
              @click="beginPickManualSegment">
              {{ manualSelectedId || selection.selectedRefno || (manualPicking ? '请在三维中点击选择…' : '点击选择三维模型中的管段') }}
            </button>
          </label>
          <label class="flex flex-col">
            <span class="mb-1 text-xs">风量 (m³/h)</span>
            <input v-model.number="manualFlow" type="number" class="border border-input bg-background px-2 py-1 rounded" placeholder="输入风量" />
          </label>
          <label class="flex flex-col">
            <span class="mb-1 text-xs">尺寸 (mm)</span>
            <input v-model="manualSize" type="text" class="border border-input bg-background px-2 py-1 rounded" placeholder="如 500x300" />
          </label>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="mt-2 bg-secondary text-secondary-foreground px-3 py-2 rounded hover:bg-secondary/90" @click="addManualSegment">
              添加节点
            </button>
            <button type="button" class="mt-2 border border-input bg-background px-3 py-2 rounded hover:bg-muted" @click="clearManualSegments">
              清空
            </button>
          </div>
        </div>
      </div>

      <div class="rounded-md border border-border bg-background p-3">
        <div class="flex items-center justify-between gap-2">
          <div class="text-sm font-semibold">管路节点</div>
          <div class="text-xs text-muted-foreground">共 {{ manualSegments.length }} 段</div>
        </div>

        <div v-if="manualSegments.length === 0" class="mt-2 text-sm text-muted-foreground">
          暂无管路节点，请先从三维中选取并添加。
        </div>

        <div v-else class="mt-2 flex flex-col gap-2">
          <div v-for="(seg, idx) in manualSegments" :key="`${seg.id}_${idx}`" class="rounded-md border border-border p-2">
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium">{{ seg.id }}</div>
                <div class="mt-0.5 truncate text-xs text-muted-foreground">
                  风量: {{ seg.flow_m3h ?? '-' }} m³/h；尺寸: {{ seg.duct_size ?? '-' }}
                </div>
              </div>

              <button type="button" class="h-8 rounded-md border border-input bg-background px-2 text-xs text-destructive hover:bg-muted" @click="removeManualSegment(idx)">
                删除
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Placeholder: Auto E3D Calc -->
    <div v-else-if="activeTab === 'auto'" class="flex flex-col gap-4 text-sm">
      <div class="p-3 bg-muted/50 rounded-md border border-border">
        <h3 class="font-medium mb-2">基于E3D模型的自动计算</h3>
        <p class="text-muted-foreground mb-4">
          自动识别E3D风管布置（三通、弯头等），自动提取管路尺寸。设计者仅需输入风量。
        </p>
        <button class="w-full bg-primary text-primary-foreground px-3 py-2 rounded hover:bg-primary/90 mb-3">
          扫描当前模型管路
        </button>
        <div class="text-xs text-muted-foreground text-center">
          暂未检测到选中的管路系统。
        </div>
      </div>
    </div>
  </div>
</template>
