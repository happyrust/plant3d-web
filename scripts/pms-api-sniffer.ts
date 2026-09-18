/**
 * PMS / 嵌入站点 JSON 响应嗅探（供 pms-chrome-devtools-flow 使用）。
 * 通过 BrowserContext.on('response') 收集匹配 host 的 JSON 正文，供包名/BRAN 断言与列表候选提取。
 */
import type { BrowserContext, Response } from 'playwright';

export type PmsReviewEntryCandidate = {
  matchedNeedle: string;
  modelFormId?: string;
  formId?: string;
  id?: string;
  title?: string;
  regHumName?: string;
  regDate?: string;
  status?: string;
  path: string;
  sourceUrl: string;
};

export type PmsApiSniffer = {
  waitForAnyNeedleInBodies: (needles: string[], timeoutMs: number) => Promise<void>;
  findReviewEntryCandidates: (needles: string[], limit: number) => PmsReviewEntryCandidate[];
  findRecentReviewEntryCandidates: (limit: number) => PmsReviewEntryCandidate[];
  stop: () => void;
};

type SnifferOptions = {
  hostNeedles: string[];
  urlSubstring?: string | null;
};

type CapturedBody = { url: string; method: string; text: string };

function hostMatches(url: string, hostNeedle: string): boolean {
  const n = hostNeedle.trim();
  if (!n) return false;
  try {
    const h = new URL(url).hostname;
    return h.includes(n) || url.includes(n);
  } catch {
    return url.includes(n);
  }
}

function shouldCaptureUrl(url: string, opts: SnifferOptions): boolean {
  if (!opts.hostNeedles.some((h) => hostMatches(url, h))) return false;
  const sub = opts.urlSubstring?.trim();
  if (sub && !url.includes(sub)) return false;
  return true;
}

function isJsonContentType(response: Response): boolean {
  const ct = (response.headers()['content-type'] || '').toLowerCase();
  return ct.includes('json') || ct.includes('text/plain');
}

function shouldReadBody(url: string, response: Response): boolean {
  const u = url.toLowerCase();
  if (u.includes('getzy') || u.includes('zymodel') || u.includes('zymode')) return true;
  return isJsonContentType(response);
}

/** 三维校审相关 HD 接口：打印摘要便于人工对照抓包 */
function logZyCapture(method: string, url: string, text: string): void {
  const u = url.toLowerCase();
  if (!u.includes('getzy') && !u.includes('zymodel') && !u.includes('zymode')) return;
  const head = text.length > 4000 ? `${text.slice(0, 4000)}…(truncated)` : text;
  console.error(`[pms-sniffer] ${method} ${url}\n${head}\n---`);
}

function pickStr(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function collectObjects(root: unknown, out: { path: string; obj: Record<string, unknown> }[], basePath = ''): void {
  if (root === null || root === undefined) return;
  if (typeof root === 'object' && !Array.isArray(root)) {
    const o = root as Record<string, unknown>;
    out.push({ path: basePath || '/', obj: o });
    for (const [k, v] of Object.entries(o)) {
      const p = basePath ? `${basePath}.${k}` : k;
      collectObjects(v, out, p);
    }
    return;
  }
  if (Array.isArray(root)) {
    root.forEach((item, i) => collectObjects(item, out, `${basePath}[${i}]`));
  }
}

function candidateFromObject(
  matched: string,
  url: string,
  path: string,
  obj: Record<string, unknown>,
): PmsReviewEntryCandidate {
  return {
    matchedNeedle: matched,
    modelFormId: pickStr(obj, ['ModelFormId', 'modelFormId', 'model_form_id']),
    formId: pickStr(obj, ['formId', 'form_id', 'FormId', 'FORM_ID']),
    id: pickStr(obj, ['Id', 'id', 'ID', 'RowId', 'rowId']),
    title: pickStr(obj, ['Title', 'title', 'Name', 'name', 'DocTitle']),
    regHumName: pickStr(obj, ['RegHumName', 'regHumName', 'RegUser', 'CreatorName']),
    regDate: pickStr(obj, ['RegDate', 'regDate', 'CreateDate', 'createDate']),
    status: pickStr(obj, ['Status', 'status', 'State', 'state']),
    path,
    sourceUrl: url,
  };
}

function extractCandidatesFromJsonText(
  url: string,
  text: string,
  needles: string[],
  limit: number,
): PmsReviewEntryCandidate[] {
  const normalized = [...new Set(needles.map((n) => n.trim()).filter(Boolean))];
  if (!normalized.length) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    const flat: { path: string; obj: Record<string, unknown> }[] = [];
    collectObjects(parsed, flat);
    const out: PmsReviewEntryCandidate[] = [];
    for (const { path, obj } of flat) {
      if (out.length >= limit) break;
      const blob = JSON.stringify(obj);
      const matched = normalized.find((n) => blob.includes(n));
      if (!matched) continue;
      out.push(candidateFromObject(matched, url, path, obj));
    }
    return out;
  } catch {
    return [];
  }
}

function extractRecentCandidatesFromJsonText(
  url: string,
  text: string,
  limit: number,
): PmsReviewEntryCandidate[] {
  if (limit <= 0) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    const flat: { path: string; obj: Record<string, unknown> }[] = [];
    collectObjects(parsed, flat);
    const out: PmsReviewEntryCandidate[] = [];
    for (const { path, obj } of flat) {
      if (out.length >= limit) break;
      const candidate = candidateFromObject('recent', url, path, obj);
      if (candidate.modelFormId || candidate.formId || candidate.id || candidate.title) {
        out.push(candidate);
      }
    }
    return out;
  } catch {
    return [];
  }
}

function createSniffer(context: BrowserContext, opts: SnifferOptions): PmsApiSniffer {
  const bodies: CapturedBody[] = [];
  const seen = new WeakSet<Response>();
  console.error(`[pms-sniffer] 开始监听 JSON/GetZy 响应 host=${opts.hostNeedles.join('|')}${opts.urlSubstring ? ` url*${opts.urlSubstring}*` : ''}`);

  const handler = (response: Response): void => {
    const url = response.url();
    if (!shouldCaptureUrl(url, opts)) return;
    if (!shouldReadBody(url, response)) return;
    if (seen.has(response)) return;
    seen.add(response);
    const method = response.request().method();
    void (async () => {
      try {
        const text = await response.text();
        bodies.push({ url, method, text });
        logZyCapture(method, url, text);
      } catch {
        /* body 已读或连接中断 */
      }
    })();
  };

  context.on('response', handler);

  return {
    async waitForAnyNeedleInBodies(needles: string[], timeoutMs: number): Promise<void> {
      const normalized = [...new Set(needles.map((n) => n.trim()).filter(Boolean))];
      if (!normalized.length) throw new Error('waitForAnyNeedleInBodies: empty needles');
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        for (const { text } of bodies) {
          if (normalized.some((n) => text.includes(n))) return;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error(`PMS 嗅探超时（${timeoutMs}ms）：JSON 正文中未出现以下任一：${normalized.join(' | ')}`);
    },

    findReviewEntryCandidates(needles: string[], limit: number): PmsReviewEntryCandidate[] {
      const normalized = [...new Set(needles.map((n) => n.trim()).filter(Boolean))];
      if (!normalized.length || limit <= 0) return [];
      const merged: PmsReviewEntryCandidate[] = [];
      for (let i = bodies.length - 1; i >= 0 && merged.length < limit; i--) {
        const { url, text } = bodies[i]!;
        if (!normalized.some((n) => text.includes(n))) continue;
        merged.push(...extractCandidatesFromJsonText(url, text, normalized, limit - merged.length));
      }
      return merged.slice(0, limit);
    },

    findRecentReviewEntryCandidates(limit: number): PmsReviewEntryCandidate[] {
      if (limit <= 0) return [];
      const merged: PmsReviewEntryCandidate[] = [];
      for (let i = bodies.length - 1; i >= 0 && merged.length < limit; i--) {
        const { url, text } = bodies[i]!;
        merged.push(...extractRecentCandidatesFromJsonText(url, text, limit - merged.length));
      }
      return merged.slice(0, limit);
    },

    stop(): void {
      context.off('response', handler);
    },
  };
}

export function startPmsApiSniffer(
  context: BrowserContext,
  options: { hostNeedle: string; urlSubstring?: string | null },
): PmsApiSniffer {
  return createSniffer(context, {
    hostNeedles: [options.hostNeedle],
    urlSubstring: options.urlSubstring,
  });
}

export function startPmsApiSnifferV2(
  context: BrowserContext,
  options: { hostNeedles: string[]; urlSubstring?: string | null },
): PmsApiSniffer {
  return createSniffer(context, {
    hostNeedles: options.hostNeedles,
    urlSubstring: options.urlSubstring,
  });
}
