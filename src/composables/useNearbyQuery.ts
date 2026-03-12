import { ref, computed } from 'vue';

import { querySpatialIndex, queryNearbyByPosition, type SpatialQueryResultItem } from '@/api/genModelSpatialApi';

// 专业映射（spec_value -> 专业名称）
const SPEC_MAP: Record<number, string> = {
  1: '工艺管道 (P)',
  2: '电气 (E)',
  3: '仪表 (I)',
  4: '结构 (S)',
  5: '暖通 (H)',
  6: '给排水 (W)',
};

export interface NearbyQueryParams {
  mode: 'refno' | 'position';
  refno?: string;
  x?: number;
  y?: number;
  z?: number;
  radius: number;
  nouns?: string[];
  maxResults?: number;
}

export interface SpecGroup {
  spec_value: number;
  spec_name: string;
  count: number;
  items: SpatialQueryResultItem[];
}

export function useNearbyQuery() {
  const loading = ref(false);
  const error = ref<string | null>(null);
  const results = ref<SpatialQueryResultItem[]>([]);
  const truncated = ref(false);

  const specGroups = computed<SpecGroup[]>(() => {
    const grouped = new Map<number, SpatialQueryResultItem[]>();
    
    results.value.forEach(item => {
      const spec = item.spec_value || 0;
      if (!grouped.has(spec)) {
        grouped.set(spec, []);
      }
      grouped.get(spec)!.push(item);
    });
    
    return Array.from(grouped.entries())
      .map(([spec, items]) => ({
        spec_value: spec,
        spec_name: SPEC_MAP[spec] || `未知专业 (${spec})`,
        count: items.length,
        items: items.sort((a, b) => (a.distance || 0) - (b.distance || 0))
      }))
      .sort((a, b) => a.spec_value - b.spec_value);
  });

  const totalCount = computed(() => results.value.length);

  async function query(params: NearbyQueryParams) {
    loading.value = true;
    error.value = null;
    results.value = [];
    truncated.value = false;

    try {
      const nounsStr = params.nouns?.join(',');
      
      let result;
      if (params.mode === 'position' && params.x !== undefined && params.y !== undefined && params.z !== undefined) {
        result = await queryNearbyByPosition(
          params.x,
          params.y,
          params.z,
          params.radius,
          { nouns: nounsStr, max_results: params.maxResults }
        );
      } else if (params.mode === 'refno' && params.refno) {
        result = await querySpatialIndex({
          mode: 'refno',
          refno: params.refno,
          distance: params.radius,
          nouns: nounsStr,
          max_results: params.maxResults,
          include_self: false
        });
      } else {
        throw new Error('Invalid query parameters');
      }

      if (!result.success) {
        throw new Error(result.error || 'Query failed');
      }

      results.value = result.results || [];
      truncated.value = result.truncated || false;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  function clear() {
    results.value = [];
    error.value = null;
    truncated.value = false;
  }

  return {
    loading,
    error,
    results,
    truncated,
    specGroups,
    totalCount,
    query,
    clear
  };
}
