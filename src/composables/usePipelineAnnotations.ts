/**
 * 管道标注渲染器
 *
 * 使用 xeokit 原生功能渲染管道工程标注
 */

import { ref, type Ref, type ShallowRef, watch } from 'vue';
import type { Viewer } from '@xeokit/xeokit-sdk';
import { getPipelineAnnotations, type AnnotationCommand, type AnnotationData } from '../api/pipelineAnnotationApi';
import { PipelineAnnotationRenderer } from '../utils/PipelineAnnotationRenderer';

// 标注状态
export interface PipelineAnnotationState {
    loading: boolean;
    error: string | null;
    data: AnnotationData | null;
    visible: boolean;
}

// 标注组对象（用于批量清除）
interface AnnotationGroup {
    refno: string;
    entityIds: string[];
}

/**
 * 管道标注渲染 Composable
 */
export function usePipelineAnnotations(viewerRef: ShallowRef<Viewer | null>) {
    const state: Ref<PipelineAnnotationState> = ref({
        loading: false,
        error: null,
        data: null,
        visible: true,
    });

    const annotationGroups: Ref<AnnotationGroup[]> = ref([]);
    const renderer: Ref<PipelineAnnotationRenderer | null> = ref(null);

    // 监听 viewer 初始化并创建 renderer
    watch(viewerRef, (newViewer) => {
        if (newViewer) {
            renderer.value = new PipelineAnnotationRenderer(newViewer);
        } else {
            renderer.value = null;
        }
    }, { immediate: true });

    /**
     * 加载并渲染 BRAN 的标注
     */
    async function loadAnnotations(refno: string): Promise<void> {
        const viewer = viewerRef.value;
        if (!viewer || !renderer.value) {
            state.value.error = 'Viewer 未初始化';
            return;
        }

        state.value.loading = true;
        state.value.error = null;

        try {
            const response = await getPipelineAnnotations(refno);

            if (!response.success || !response.data) {
                throw new Error(response.error_message || '获取标注数据失败');
            }

            state.value.data = response.data;

            // 调用 Renderer 渲染
            const entityIds = renderer.value.render(refno, response.data.commands);

            // 记录到组中以便后续清除
            // 先尝试移除已存在的同 refno 组（防止重复）
            const existingIdx = annotationGroups.value.findIndex(g => g.refno === refno);
            if (existingIdx !== -1) {
                annotationGroups.value.splice(existingIdx, 1);
            }
            annotationGroups.value.push({ refno, entityIds });

            console.log(`✅ 已渲染 ${response.data.commands.length} 个标注`);
        } catch (err) {
            state.value.error = err instanceof Error ? err.message : String(err);
            console.error('标注加载失败:', err);
        } finally {
            state.value.loading = false;
        }
    }

    /**
     * 清除指定 BRAN 的标注
     */
    function clearAnnotations(refno: string): void {
        const groupIndex = annotationGroups.value.findIndex((g) => g.refno === refno);
        if (groupIndex === -1) return;

        if (renderer.value) {
            renderer.value.clear(refno);
        }

        annotationGroups.value.splice(groupIndex, 1);
        console.log(`🗑 已清除 ${refno} 的标注`);
    }

    /**
     * 清除所有标注
     */
    function clearAllAnnotations(): void {
        if (renderer.value) {
            renderer.value.clearAll();
        }
        annotationGroups.value = [];
        state.value.data = null;
        console.log('🗑 已清除所有标注');
    }

    /**
     * 切换标注可见性（简单通过清除/重绘，或者设置 visible 属性）
     * 目前 renderer 没有实现 setVisible，所以这里暂时只更新状态
     * 如果需要隐藏，可能需要拿到所有 entity 并设置 visible = false
     */
    function toggleVisibility(): void {
        state.value.visible = !state.value.visible;
        const viewer = viewerRef.value;
        if (!viewer) return;

        // 遍历所有已记录的 entityIds 设置可见性
        annotationGroups.value.forEach(group => {
            group.entityIds.forEach(id => {
                const entity = viewer.scene.objects[id];
                if (entity) {
                    entity.visible = state.value.visible;
                }
            });
        });

        console.log(`👁 标注可见性: ${state.value.visible}`);
    }

    return {
        state,
        loadAnnotations,
        clearAnnotations,
        clearAllAnnotations,
        toggleVisibility,
    };
}
