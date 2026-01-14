import { shallowRef } from 'vue';
import type { usePdmsOwnerTree } from './usePdmsOwnerTree';

// Global reference to the tree instance
const treeInstance = shallowRef<ReturnType<typeof usePdmsOwnerTree> | null>(null);

export function setModelTreeInstance(instance: ReturnType<typeof usePdmsOwnerTree> | null) {
    treeInstance.value = instance;
}

export function getModelTreeInstance() {
    return treeInstance.value;
}
