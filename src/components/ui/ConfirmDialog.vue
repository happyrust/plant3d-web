<script setup lang="ts">
import { useConfirmDialogStore } from '@/composables/useConfirmDialogStore';

const dialog = useConfirmDialogStore();
</script>

<template>
  <v-dialog v-model="dialog.visible.value" width="520">
    <v-card>
      <v-card-title class="text-subtitle-1">
        {{ dialog.title.value }}
      </v-card-title>
      <v-card-text class="text-body-2">
        {{ dialog.message.value }}
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <template v-if="dialog.mode.value === 'confirm'">
          <v-btn variant="text" @click="dialog.closeConfirm(false)">
            {{ dialog.cancelText.value }}
          </v-btn>
          <v-btn color="primary" variant="flat" @click="dialog.closeConfirm(true)">
            {{ dialog.confirmText.value }}
          </v-btn>
        </template>
        <template v-else>
          <v-btn variant="text" @click="dialog.cancelChoice()">
            {{ dialog.cancelText.value }}
          </v-btn>
          <v-btn v-for="c in dialog.choices.value"
            :key="c.id"
            :color="c.color || 'primary'"
            :variant="c.variant || 'flat'"
            @click="dialog.choose(c.id)">
            {{ c.text }}
          </v-btn>
        </template>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
