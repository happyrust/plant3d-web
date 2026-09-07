import { getBaseUrl } from '@/api/genModelTaskApi';

export type BatchGenerateSseUpdate = {
  stage: 'generating' | 'exportInstances' | 'finished'
  message?: string
  currentRefno?: string
  completedCount: number
  totalCount: number
  percent: number
  failedRefnos?: string[]
}

export type BatchGenerateItemDone = {
  refno: string
  ok: boolean
  completedCount: number
  totalCount: number
  percent: number
}

export type BatchGenerateBatchDone = {
  generatedRefnos: string[]
  skippedRefnos: string[]
  readyRefnos: string[]
  completedCount: number
  totalCount: number
  percent: number
  currentRefno?: string
}

function normalizeRefnoKeyForBatch(refno: string): string {
  return String(refno || '').trim().replace('/', '_');
}

function uniqRefnos(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const key = normalizeRefnoKeyForBatch(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * 单次批量 SSE 生成（POST /api/model/stream-generate）
 * - expandChildren=false：只处理请求集
 * - 批次事件会返回 generated_refnos / skipped_refnos，便于前端“边生成边加载”
 */
export async function triggerBatchGenerateSse(
  refnos: string[],
  options?: {
    onUpdate?: (u: BatchGenerateSseUpdate) => void
    onBatchDone?: (u: BatchGenerateBatchDone) => void | Promise<void>
    onItemDone?: (u: BatchGenerateItemDone) => void | Promise<void>
    timeoutMs?: number
    batchSize?: number
    skipOnError?: boolean
    exportInstances?: boolean
    mergeInstances?: boolean
  }
): Promise<{ successRefnos: string[]; failedRefnos: string[] }> {
  const normalizedRefnos = uniqRefnos(refnos);
  const total = normalizedRefnos.length;
  if (total === 0) {
    return { successRefnos: [], failedRefnos: [] };
  }

  const timeoutMs = options?.timeoutMs ?? 10 * 60 * 1000;
  const skipOnError = options?.skipOnError ?? true;
  const batchSize = Math.max(1, options?.batchSize ?? 50);
  const exportInstances = options?.exportInstances ?? true;
  const mergeInstances = options?.mergeInstances ?? true;

  const apiBase = getBaseUrl().replace(/\/$/, '');
  const url = `${apiBase}/api/model/stream-generate`;

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const decoder = new TextDecoder();

  const successSet = new Set<string>();

  options?.onUpdate?.({
    stage: 'generating',
    message: `开始批量生成 ${total} 个 refno...`,
    completedCount: 0,
    totalCount: total,
    percent: 0,
  });

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        refnos: normalizedRefnos,
        expandChildren: false,
        forceRegenerate: false,
        batchSize,
        maxDepth: 0,
        applyBoolean: false,
        exportInstances,
        mergeInstances,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`SSE 请求失败: HTTP ${resp.status} ${resp.statusText}: ${text}`);
    }
    if (!resp.body) {
      throw new Error('SSE 响应体为空');
    }

    const reader = resp.body.getReader();
    let buffer = '';

    const handleEvent = async (rawBlock: string): Promise<void> => {
      const block = rawBlock.replace(/\r/g, '');
      if (!block.trim()) return;

      const lines = block.split('\n');
      const dataLines = lines
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart());
      if (dataLines.length === 0) return;

      let data: any;
      try {
        data = JSON.parse(dataLines.join('\n'));
      } catch {
        return;
      }

      const type = String(data?.type || '');
      if (!type) return;

      if (type === 'started') {
        options?.onUpdate?.({
          stage: 'generating',
          message: String(data?.message || `开始处理 ${total} 个 refno`),
          completedCount: 0,
          totalCount: total,
          percent: 0,
        });
        return;
      }

      if (type === 'expandComplete') {
        const expanded = Number(data?.expandedCount ?? total);
        options?.onUpdate?.({
          stage: 'generating',
          message: `请求集确认: ${expanded} 个`,
          completedCount: 0,
          totalCount: expanded > 0 ? expanded : total,
          percent: 0,
        });
        return;
      }

      if (type === 'batchComplete') {
        const generatedRefnos = uniqRefnos(Array.isArray(data?.generatedRefnos) ? data.generatedRefnos : []);
        const skippedRefnos = uniqRefnos(Array.isArray(data?.skippedRefnos) ? data.skippedRefnos : []);
        const readyRefnos = uniqRefnos([...generatedRefnos, ...skippedRefnos]);

        for (const refno of readyRefnos) {
          successSet.add(refno);
        }

        const completedCount = Number(data?.completedCount ?? successSet.size);
        const totalCount = Number(data?.totalCount ?? total);
        const percent = Number(data?.progress ?? (totalCount > 0 ? (completedCount / totalCount) * 100 : 100));
        const currentRefno = data?.currentRefno ? normalizeRefnoKeyForBatch(String(data.currentRefno)) : undefined;

        options?.onUpdate?.({
          stage: 'generating',
          message: data?.warning ? String(data.warning) : `批次完成，已处理 ${completedCount}/${totalCount}`,
          currentRefno,
          completedCount,
          totalCount,
          percent,
        });

        await options?.onBatchDone?.({
          generatedRefnos,
          skippedRefnos,
          readyRefnos,
          completedCount,
          totalCount,
          percent,
          currentRefno,
        });

        if (options?.onItemDone) {
          for (const refno of readyRefnos) {
            await options.onItemDone({
              refno,
              ok: true,
              completedCount,
              totalCount,
              percent,
            });
          }
        }
        return;
      }

      if (type === 'batchFailed') {
        const skippedRefnos = uniqRefnos(Array.isArray(data?.skippedRefnos) ? data.skippedRefnos : []);
        for (const refno of skippedRefnos) {
          successSet.add(refno);
        }

        const completedCount = Number(data?.completedCount ?? successSet.size);
        const totalCount = Number(data?.totalCount ?? total);
        const percent = Number(data?.progress ?? (totalCount > 0 ? (completedCount / totalCount) * 100 : 100));

        if (skippedRefnos.length > 0) {
          await options?.onBatchDone?.({
            generatedRefnos: [],
            skippedRefnos,
            readyRefnos: skippedRefnos,
            completedCount,
            totalCount,
            percent,
          });
        }

        if (options?.onItemDone) {
          for (const refno of skippedRefnos) {
            await options.onItemDone({
              refno,
              ok: true,
              completedCount,
              totalCount,
              percent,
            });
          }
        }

        const errMsg = String(data?.error || 'SSE 批次失败');
        if (!skipOnError) {
          throw new Error(errMsg);
        }

        options?.onUpdate?.({
          stage: 'generating',
          message: `批次失败，已跳过：${errMsg}`,
          completedCount,
          totalCount,
          percent,
        });
        return;
      }

      if (type === 'exportInstancesStarted') {
        options?.onUpdate?.({
          stage: 'exportInstances',
          message: String(data?.message || '开始导出 instances'),
          completedCount: successSet.size,
          totalCount: total,
          percent: Math.min(99, Math.max(0, (successSet.size / Math.max(total, 1)) * 100)),
        });
        return;
      }

      if (type === 'finished') {
        options?.onUpdate?.({
          stage: 'finished',
          message: `生成阶段完成：generated=${Number(data?.totalGenerated ?? 0)} skipped=${Number(data?.totalSkipped ?? 0)}`,
          completedCount: total,
          totalCount: total,
          percent: 100,
        });
        return;
      }

      if (type === 'exportInstancesFinished') {
        options?.onUpdate?.({
          stage: 'finished',
          message: 'instances 导出完成',
          completedCount: total,
          totalCount: total,
          percent: 100,
        });
        return;
      }

      if (type === 'error') {
        throw new Error(String(data?.message || 'SSE error'));
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');

      while (true) {
        const sep = buffer.indexOf('\n\n');
        if (sep < 0) break;
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        await handleEvent(block);
      }
    }

    if (buffer.trim()) {
      await handleEvent(buffer);
    }

    const successRefnos = Array.from(successSet);
    const failedRefnos = normalizedRefnos.filter((r) => !successSet.has(r));

    if (options?.onItemDone) {
      for (const refno of failedRefnos) {
        await options.onItemDone({
          refno,
          ok: false,
          completedCount: total,
          totalCount: total,
          percent: 100,
        });
      }
    }

    options?.onUpdate?.({
      stage: 'finished',
      message: `生成完成：可用 ${successRefnos.length}，失败 ${failedRefnos.length}`,
      completedCount: total,
      totalCount: total,
      percent: 100,
      failedRefnos,
    });

    return { successRefnos, failedRefnos };
  } catch (e) {
    if (controller.signal.aborted) {
      throw new Error(`SSE 超时: ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    window.clearTimeout(timer);
  }
}
