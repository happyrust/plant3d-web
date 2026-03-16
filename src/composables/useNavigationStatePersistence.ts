import { ref, watch, type Ref } from 'vue';

type Primitive = string | number | boolean | null;
type PersistedState = Record<string, Primitive>;

function readPersistedState(storageKey: string): PersistedState {
  if (typeof localStorage === 'undefined') return {};

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedState;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writePersistedState(storageKey: string, state: PersistedState) {
  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // ignore storage write failures
  }
}

export function useNavigationStatePersistence(storageKey: string) {
  const persisted = ref<PersistedState>(readPersistedState(storageKey));

  watch(
    persisted,
    (value) => {
      writePersistedState(storageKey, value);
    },
    { deep: true },
  );

  function bindRef<T extends Primitive>(key: string, target: Ref<T>, fallback: T) {
    const initial = (persisted.value[key] as T | undefined) ?? fallback;
    target.value = initial;

    watch(target, (value) => {
      persisted.value = {
        ...persisted.value,
        [key]: value,
      };
    });
  }

  function saveValue<T extends Primitive>(key: string, value: T) {
    persisted.value = {
      ...persisted.value,
      [key]: value,
    };
  }

  function getValue<T extends Primitive>(key: string, fallback: T): T {
    return (persisted.value[key] as T | undefined) ?? fallback;
  }

  return {
    bindRef,
    saveValue,
    getValue,
  };
}
