/**
 * 房间计算 API
 * 用于调用后端房间关系构建和计算功能
 */

function getBaseUrl(): string {
    const envBase = (import.meta.env as unknown as { VITE_GEN_MODEL_API_BASE_URL?: string })
        .VITE_GEN_MODEL_API_BASE_URL;
    return (envBase && envBase.trim()) || '';
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
    const base = getBaseUrl().replace(/\/$/, '');
    const url = `${base}${path.startsWith('/') ? '' : '/'}${path}`;

    const resp = await fetch(url, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...(init?.headers || {}),
        },
    });

    if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${text}`);
    }

    return (await resp.json()) as T;
}

// ============ 类型定义 ============

/** 任务提交请求 */
export type RoomComputeRequest = {
    force_rebuild?: boolean;
    room_keywords?: string[];
    db_nums?: number[];
};

/** 任务响应 */
export type RoomComputeResponse = {
    success: boolean;
    task_id: string;
    message?: string;
};

/** Worker 状态 */
export type RoomWorkerStatus = {
    active_tasks: number;
    queue_len: number;
    is_busy: boolean;
};

/** 任务状态枚举 */
export type RoomTaskStatus = 'Queued' | 'Running' | 'Completed' | 'Failed' | 'Cancelled';

/** 查询任务状态响应 */
export type RoomTaskStatusResponse = {
    id: string;
    status: RoomTaskStatus;
    progress?: number;
    stage?: string;
    message?: string;
};

// ============ API 函数 ============

/**
 * 提交房间计算任务（重建所有关系）
 */
export async function submitRoomCompute(request: RoomComputeRequest): Promise<RoomComputeResponse> {
    return await fetchJson<RoomComputeResponse>('/api/room/rebuild-relations', {
        method: 'POST',
        body: JSON.stringify(request),
    });
}

/**
 * 获取 RoomWorker 状态
 */
export async function getRoomWorkerStatus(): Promise<RoomWorkerStatus> {
    return await fetchJson<RoomWorkerStatus>('/api/room/worker/status');
}

/**
 * 取消房间计算任务
 */
export async function cancelRoomTask(taskId: string): Promise<boolean> {
    const resp = await fetchJson<boolean>(`/api/room/tasks/${encodeURIComponent(taskId)}/cancel`, {
        method: 'POST',
    });
    return resp;
}

/**
 * 获取系统状态
 */
export async function getRoomSystemStatus(): Promise<{
    system_health: string;
    active_tasks: number;
    cache_status: {
        geometry_cache_size: number;
        query_cache_size: number;
        hit_rate: number;
    };
}> {
    return await fetchJson('/api/room/status');
}
