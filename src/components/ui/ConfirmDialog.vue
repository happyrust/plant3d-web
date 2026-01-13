<script setup lang="ts">
import { useConfirmDialogStore } from '@/composables/useConfirmDialogStore'

const dialog = useConfirmDialogStore()
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
        <v-btn variant="text" @click="dialog.close(false)">
          {{ dialog.cancelText.value }}
        </v-btn>
        <v-btn color="primary" variant="flat" @click="dialog.close(true)">
          {{ dialog.confirmText.value }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

