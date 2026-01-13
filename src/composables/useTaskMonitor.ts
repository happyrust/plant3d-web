// 任务监控 composable
// 基于后端 Rust/Axum 实现
// 注意：后端不支持 pause/resume 功能

import { ref, computed, watch, onMounted, onUnmounted, type ComputedRef, type Ref } from 'vue';
import type { Task, SystemMetrics, WebSocketMessage } from '@/types/task';
import {
  taskGetList,
  taskGetSystemMetrics,
  taskStart,
  taskStop,
  taskRestart,
  taskDelete,
  getTaskWebSocketUrl,
  normalizeTask,
} from '@/api/genModelTaskApi';
import { useWebSocket } from './useWebSocket';

export type UseTaskMonitorOptions = {
  /** 是否启用 WebSocket 实时更新 */
  enableWebSocket?: boolean;
  /** 轮询间隔（毫秒），0 表示不轮询 */
  pollingInterval?: number;
  /** 是否在挂载时自动开始 */
  autoStart?: boolean;
};

export type UseTaskMonitorReturn = {
  /** 任务列表 */
  tasks: Ref<Task[]>;
  /** 系统指标 */
  systemMetrics: Ref<SystemMetrics | null>;
  /** 是否正在加载 */
  loading: Ref<boolean>;
  /** 错误信息 */
  error: Ref<string | null>;
  /** WebSocket 连接状态 */
  isWsConnected: Ref<boolean>;
  /** 最后更新时间 */
  lastUpdateTime: Ref<string | null>;

  /** 按状态分组的任务 */
  tasksByStatus: ComputedRef<Record<Task['status'], Task[]>>;
  /** 运行中的任务数 */
  runningTaskCount: ComputedRef<number>;
  /** 等待中的任务数 */
  pendingTaskCount: ComputedRef<number>;

  /** 刷新数据 */
  refresh: () => Promise<void>;
  /** 启动 WebSocket 连接 */
  connectWebSocket: () => void;
  /** 断开 WebSocket 连接 */
  disconnectWebSocket: () => void;
  /** 开始轮询 */
  startPolling: () => void;
  /** 停止轮询 */
  stopPolling: () => void;

  /** 启动任务 */
  startTask: (taskId: string) => Promise<boolean>;
  /** 停止任务 */
  stopTask: (taskId: string) => Promise<boolean>;
  /** 重启任务（为失败的任务创建新实例） */
  restartTask: (taskId: string) => Promise<boolean>;
  /** 删除任务 */
  deleteTask: (taskId: string) => Promise<boolean>;
};

const DEFAULT_OPTIONS: Required<UseTaskMonitorOptions> = {
  enableWebSocket: true,
  pollingInterval: 5000,
  autoStart: true,
};

/**
 * 任务监控 composable
 */
export function useTaskMonitor(options: UseTaskMonitorOptions = {}): UseTaskMonitorReturn {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // 状态
  const tasks = ref<Task[]>([]);
  const systemMetrics = ref<SystemMetrics | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const lastUpdateTime = ref<string | null>(null);

  // 轮询定时器
  let pollingTimer: ReturnType<typeof setInterval> | null = null;

  // WebSocket
  const wsUrl = getTaskWebSocketUrl();
  const {
    isConnected: isWsConnected,
    lastMessage,
    error: wsError,
    connect: wsConnect,
    disconnect: wsDisconnect,
  } = useWebSocket(wsUrl, {
    autoReconnect: true,
    maxReconnectAttempts: 5,
    reconnectDelay: 3000,
    onConnected: () => {
      error.value = null;
      // WebSocket 连接成功后，停止轮询
      if (pollingTimer) {
        stopPolling();
      }
    },
    onDisconnected: () => {
      // WebSocket 断开后，启动轮询作为备选
      if (opts.pollingInterval > 0 && !pollingTimer) {
        startPolling();
      }
    },
  });

  // 监听 WebSocket 消息
  watch(lastMessage, (message) => {
    if (!message) return;
    handleWebSocketMessage(message as WebSocketMessage);
  });

  // 监听 WebSocket 错误
  watch(wsError, (err) => {
    if (err) {
      console.warn('[TaskMonitor] WebSocket error:', err);
    }
  });

  // ============ 计算属性 ============

  /** 按状态分组的任务 */
  const tasksByStatus = computed(() => {
    const groups: Record<Task['status'], Task[]> = {
      pending: [],
      running: [],
      completed: [],
      failed: [],
      cancelled: [],
    };
    for (const task of tasks.value) {
      if (groups[task.status]) {
        groups[task.status].push(task);
      }
    }
    return groups;
  });

  /** 运行中的任务数 */
  const runningTaskCount = computed(() => tasksByStatus.value.running.length);

  /** 等待中的任务数 */
  const pendingTaskCount = computed(() => tasksByStatus.value.pending.length);

  // ============ 数据获取 ============

  /**
   * 刷新数据
   */
  async function refresh(): Promise<void> {
    loading.value = true;
    error.value = null;

    try {
      // 并行获取任务列表和系统指标
      const [taskResponse, metricsResponse] = await Promise.all([
        taskGetList(),
        taskGetSystemMetrics(),
      ]);

      // 后端可能返回 {tasks:[], total:N} 或 {success:true, tasks:[]}
      // 检查是否有 tasks 数组
      if (taskResponse.tasks && Array.isArray(taskResponse.tasks)) {
        tasks.value = taskResponse.tasks.map((t) => normalizeTask(t as unknown as Record<string, unknown>));
      } else if (taskResponse.success === false) {
        throw new Error(taskResponse.error_message || '获取任务列表失败');
      } else {
        throw new Error('获取任务列表失败：响应格式错误');
      }

      if (metricsResponse.success && metricsResponse.metrics) {
        systemMetrics.value = metricsResponse.metrics;
      }

      lastUpdateTime.value = new Date().toISOString();
    } catch (e) {
      error.value = `获取数据失败: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 处理 WebSocket 消息
   */
  function handleWebSocketMessage(message: WebSocketMessage): void {
    lastUpdateTime.value = message.timestamp || new Date().toISOString();

    switch (message.type) {
      case 'task_update':
      case 'task_completed':
      case 'task_failed': {
        const updatedTask = normalizeTask(message.data as Record<string, unknown>);
        const index = tasks.value.findIndex((t) => t.id === updatedTask.id);
        if (index >= 0) {
          tasks.value[index] = updatedTask;
        } else {
          tasks.value.push(updatedTask);
        }
        break;
      }

      case 'task_progress': {
        const progressData = message.data as { taskId: string; progress: number };
        const task = tasks.value.find((t) => t.id === progressData.taskId);
        if (task) {
          task.progress = progressData.progress;
        }
        break;
      }

      case 'system_metrics': {
        systemMetrics.value = message.data as SystemMetrics;
        break;
      }
    }
  }

  // ============ WebSocket 控制 ============

  function connectWebSocket(): void {
    if (opts.enableWebSocket) {
      wsConnect();
    }
  }

  function disconnectWebSocket(): void {
    wsDisconnect();
  }

  // ============ 轮询控制 ============

  function startPolling(): void {
    if (opts.pollingInterval <= 0) return;
    if (pollingTimer) return;

    pollingTimer = setInterval(() => {
      refresh();
    }, opts.pollingInterval);
  }

  function stopPolling(): void {
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
  }

  // ============ 任务操作 ============

  async function startTask(taskId: string): Promise<boolean> {
    try {
      const response = await taskStart(taskId);
      if (response.success) {
        // 更新本地状态
        const task = tasks.value.find((t) => t.id === taskId);
        if (task) {
          task.status = 'running';
        }
        return true;
      }
      error.value = response.error_message || '启动任务失败';
      return false;
    } catch (e) {
      error.value = `启动任务失败: ${e instanceof Error ? e.message : String(e)}`;
      return false;
    }
  }

  async function stopTask(taskId: string): Promise<boolean> {
    try {
      const response = await taskStop(taskId);
      if (response.success) {
        const task = tasks.value.find((t) => t.id === taskId);
        if (task) {
          task.status = 'cancelled';
        }
        return true;
      }
      error.value = response.error_message || '停止任务失败';
      return false;
    } catch (e) {
      error.value = `停止任务失败: ${e instanceof Error ? e.message : String(e)}`;
      return false;
    }
  }

  async function restartTask(taskId: string): Promise<boolean> {
    try {
      const response = await taskRestart(taskId);
      if (response.success) {
        // 重启会创建新任务，需要刷新列表
        await refresh();
        return true;
      }
      error.value = response.error_message || '重启任务失败';
      return false;
    } catch (e) {
      error.value = `重启任务失败: ${e instanceof Error ? e.message : String(e)}`;
      return false;
    }
  }

  async function deleteTask(taskId: string): Promise<boolean> {
    try {
      const response = await taskDelete(taskId);
      if (response.success) {
        // 从本地列表移除
        const index = tasks.value.findIndex((t) => t.id === taskId);
        if (index >= 0) {
          tasks.value.splice(index, 1);
        }
        return true;
      }
      error.value = response.error_message || '删除任务失败';
      return false;
    } catch (e) {
      error.value = `删除任务失败: ${e instanceof Error ? e.message : String(e)}`;
      return false;
    }
  }

  // ============ 生命周期 ============

  onMounted(() => {
    if (opts.autoStart) {
      // 首次加载数据
      refresh();

      // 尝试 WebSocket 连接
      if (opts.enableWebSocket) {
        connectWebSocket();
      }

      // 如果 WebSocket 不可用，启动轮询
      if (!opts.enableWebSocket && opts.pollingInterval > 0) {
        startPolling();
      }
    }
  });

  onUnmounted(() => {
    stopPolling();
    disconnectWebSocket();
  });

  return {
    // 状态
    tasks,
    systemMetrics,
    loading,
    error,
    isWsConnected,
    lastUpdateTime,

    // 计算属性
    tasksByStatus,
    runningTaskCount,
    pendingTaskCount,

    // 方法
    refresh,
    connectWebSocket,
    disconnectWebSocket,
    startPolling,
    stopPolling,

    // 任务操作
    startTask,
    stopTask,
    restartTask,
    deleteTask,
  };
}
