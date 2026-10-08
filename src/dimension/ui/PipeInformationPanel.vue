<script setup lang="ts">
import { ref, watch } from 'vue';

import type { PipeBendArc } from '@/dimension';

import { usePipeInformationStore } from '@/composables/usePipeInformationStore';

const store = usePipeInformationStore();
const refno = ref(store.suggestedRefno.value);
watch(store.suggestedRefno, value => { refno.value = value; });
const mm = (value: number | null) => value === null ? '—' : `${Number(value.toFixed(2))} mm`;
const bendText = (bend: PipeBendArc) => bend.arcMm === null
  ? `角度 ${bend.angleDeg ?? '缺失'}° · 端口弦长 ${mm(bend.chordMm)} · 不能计算弧长`
  : `角度 ${bend.angleDeg}° · 端口弦长 ${mm(bend.chordMm)} · 弧长 ${mm(bend.arcMm)} · 推算半径 ${mm(bend.radiusMm)}`;
</script>

<template>
  <details class="m-2 rounded border border-slate-200 p-2 text-xs" data-testid="pipe-information-panel">
    <summary class="cursor-pointer font-medium">管道信息标注（{{ store.records.value.length }}）</summary>
    <div class="mt-2 flex gap-2">
      <input v-model="refno" aria-label="管道 BRAN 参考号" placeholder="24381/145018"
        class="min-w-0 flex-1 rounded border px-2 py-1" />
      <button type="button" :disabled="store.loading.value" class="rounded border px-2 py-1 disabled:opacity-50"
        @click="store.refresh(refno)">
        {{ store.loading.value ? '读取中…' : '读取并标注' }}
      </button>
    </div>
    <label class="mt-2 flex gap-2"><input v-model="store.showAnnotations.value" type="checkbox" />显示管道信息卡片</label>
    <p class="mt-1 text-slate-500">通径、材质与保温来自业务属性。外径参考、模型盒及业务包络需专业核对；结构净距和管间净距使用已有量距标注。</p>
    <p v-if="store.error.value" role="alert" class="mt-2 text-red-700">{{ store.error.value }}</p>
    <p class="mt-1 text-slate-500">{{ store.persistenceLabel.value }}</p>
    <p v-if="store.persistenceError.value" role="alert" class="text-amber-700">{{ store.persistenceError.value }}</p>
    <article v-for="record in store.records.value" :key="record.refno" class="mt-2 rounded border p-2">
      <div class="flex items-center justify-between gap-2">
        <span class="break-all font-medium">{{ record.name }} <span v-if="record.stale" class="text-amber-700">（过期，请更新）</span></span>
        <button type="button" class="shrink-0 rounded border px-2 py-1" @click="store.remove(record.refno)">移除</button>
      </div>
      <div class="mt-1 flex items-center gap-2 text-slate-500">
        <span>{{ record.refno }} · 属性会话 {{ record.sesno }}</span>
        <label><input type="checkbox" :checked="!store.hiddenRefnos.value.includes(record.refno)"
          @change="store.setHidden(record.refno, !($event.target as HTMLInputElement).checked)" />显示</label>
      </div>
      <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <template v-for="field in record.fields" :key="field.key">
          <dt>{{ field.label }}</dt><dd :title="field.source" class="break-all" :class="field.status === 'missing' || field.status === 'unconfirmed' ? 'text-amber-700' : ''">{{ field.text }}</dd>
        </template>
      </dl>
      <details v-if="record.memberDiameters?.length" class="mt-2">
        <summary class="cursor-pointer">逐段外径及来源（{{ record.memberDiameters.length }}）</summary>
        <ul class="mt-1 space-y-1">
          <li v-for="member in record.memberDiameters" :key="`${member.order}:${member.refno}`" class="rounded bg-slate-50 p-1"
            :class="member.source !== 'catalogue' ? 'text-amber-700' : ''">
            <span class="break-all">{{ member.order + 1 }} · {{ member.refno }} · {{ member.implicit ? '隐式直管' : member.noun }}</span>
            <p>{{ member.outsideDiameterMm === null ? '外径缺失' : `${Number(member.outsideDiameterMm.toFixed(2))} mm` }} · {{ member.sourceText }}</p>
          </li>
        </ul>
      </details>
      <details v-if="record.memberMaterials?.length" class="mt-2">
        <summary class="cursor-pointer">成员材质及来源（{{ record.memberMaterials.length }}）</summary>
        <ul class="mt-1 space-y-1">
          <li v-for="member in record.memberMaterials" :key="member.refno" class="rounded bg-slate-50 p-1"
            :class="member.status !== 'read' ? 'text-amber-700' : ''">
            <span class="break-all">{{ member.refno }} · {{ member.implicit ? '隐式直管' : member.noun }} · {{ member.text }}</span>
            <p class="break-all">{{ member.source }}</p>
          </li>
        </ul>
      </details>
      <details v-if="record.bendArcs?.length" class="mt-2">
        <summary class="cursor-pointer">弯头弧长及来源（{{ record.bendArcs.length }}）</summary>
        <ul class="mt-1 space-y-1">
          <li v-for="bend in record.bendArcs" :key="bend.refno" class="rounded bg-slate-50 p-1"
            :class="bend.arcMm === null ? 'text-amber-700' : ''">
            <span class="break-all">{{ bend.refno }} · {{ bend.noun }}</span>
            <p>{{ bendText(bend) }}</p>
            <p class="break-all">{{ bend.source }}</p>
          </li>
        </ul>
      </details>
      <ul v-if="record.warnings.length" class="mt-2 list-disc pl-4 text-amber-700"><li v-for="warning in record.warnings" :key="warning">{{ warning }}</li></ul>
    </article>
  </details>
</template>
