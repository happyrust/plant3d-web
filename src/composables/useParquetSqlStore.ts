/**
 * Parquet SQL Store
 * 
 * 使用 DuckDB-WASM 在浏览器端执行 SQL 查询 Parquet 文件。
 */

import { ref, shallowRef } from 'vue';

import * as duckdb from '@duckdb/duckdb-wasm';

// DuckDB 实例（单例）
let db: duckdb.AsyncDuckDB | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;
let initPromise: Promise<void> | null = null;

/** 查询日志类型 */
export type LogType = 'input' | 'output' | 'error' | 'info'

/** 查询日志条目 */
export type LogEntry = {
    id: number
    type: LogType
    content: string
    timestamp: Date
}

/** 查询结果 */
export type QueryResult = {
    columns: string[]
    rows: Record<string, unknown>[]
    rowCount: number
    executionTime: number
}

/** Parquet 文件信息 */
export type ParquetFileInfo = {
    filename: string
    url: string
    tableName: string
}

// 全局状态
const logs = ref<LogEntry[]>([]);
const loadedFiles = ref<ParquetFileInfo[]>([]);
const availableFiles = ref<string[]>([]);
const selectedFile = ref<string | null>(null);
const isLoading = ref(false);
const currentDbno = ref<number | null>(null);
const queryHistory = ref<string[]>([]);
const historyIndex = ref(-1);
const lastResult = shallowRef<QueryResult | null>(null);

let logIdCounter = 0;

/**
 * 初始化 DuckDB-WASM
 */
async function initDuckDB(): Promise<void> {
  if (db) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      // 使用 CDN 加载 DuckDB bundles
      const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();

      // 选择最佳 bundle
      const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

      const worker_url = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
      );

      const worker = new Worker(worker_url);
      const logger = new duckdb.ConsoleLogger();

      db = new duckdb.AsyncDuckDB(logger, worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

      URL.revokeObjectURL(worker_url);

      conn = await db.connect();

      addLog('info', 'DuckDB-WASM 初始化成功');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog('error', `DuckDB 初始化失败: ${msg}`);
      throw e;
    }
  })();

  return initPromise;
}

/**
 * 添加日志
 */
function addLog(type: LogType, content: string): void {
  logs.value.push({
    id: logIdCounter++,
    type,
    content,
    timestamp: new Date(),
  });
}

/**
 * 清空日志
 */
function clearLogs(): void {
  logs.value = [];
  lastResult.value = null;
}

/**
 * 获取可用的 Parquet 文件列表
 */
async function listAvailableFiles(dbno: number): Promise<string[]> {
  try {
    isLoading.value = true;
    const response = await fetch(`/api/model/${dbno}/files`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const files: string[] = await response.json();
    availableFiles.value = files;
    currentDbno.value = dbno;
    addLog('info', `找到 ${files.length} 个 Parquet 文件`);
    return files;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    addLog('error', `获取文件列表失败: ${msg}`);
    return [];
  } finally {
    isLoading.value = false;
  }
}

/**
 * 加载 Parquet 文件到 DuckDB (支持双表模式)
 */
async function loadParquetFile(filename: string): Promise<boolean> {
  try {
    await initDuckDB();
    if (!conn || !db) {
      addLog('error', 'DuckDB 连接不可用');
      return false;
    }

    isLoading.value = true;

    // 1. 解析文件名: instances_{dbno}_{ts}.parquet
    const match = filename.match(/^(instances|transforms)_(\d+)(?:_(.+))?\.parquet$/);
    if (!match) {
      addLog('error', `文件名格式不识别 (需以 instances_ 或 transforms_ 开头): ${filename}`);
      return false;
    }

    const [, _prefix, dbno, timestamp] = match;
    const tsSuffix = timestamp ? `_${timestamp}` : '';

    // 构造两个文件名
    const instFilename = `instances_${dbno}${tsSuffix}.parquet`;
    const transFilename = `transforms_${dbno}${tsSuffix}.parquet`;

    // 视图名称 t_{dbno} (如果是增量文件，加后缀? 暂不支持增量视图，统一 t_{dbno})
    // 为了支持查看不同时间的增量，如果是增量文件，视图名带上时间戳
    let baseTableName = `t_${dbno}`;
    if (timestamp) {
      baseTableName += `_${timestamp.replace(/[^a-zA-Z0-9]/g, '')}`;
    }

    const instTableName = `${baseTableName}_inst`;
    const transTableName = `${baseTableName}_trans`;

    // 检查是否已加载
    const existing = loadedFiles.value.find(f => f.tableName === baseTableName);
    if (existing) {
      addLog('info', `视图已加载: ${existing.tableName}`);
      selectedFile.value = existing.tableName;
      return true;
    }

    // 2. 下载两个文件
    const loadFile = async (fname: string, tname: string) => {
      const url = `/files/output/database_models/${fname}`;
      addLog('info', `⬇️ 下载: ${fname}...`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`下载 ${fname} 失败: ${res.status}`);
      const buf = await res.arrayBuffer();
      await db!.registerFileBuffer(fname, new Uint8Array(buf));
      await conn!.query(`CREATE OR REPLACE TABLE ${tname} AS SELECT * FROM parquet_scan('${fname}')`);
      return res.headers.get('content-length');
    };

    try {
      await Promise.all([
        loadFile(instFilename, instTableName),
        loadFile(transFilename, transTableName)
      ]);
    } catch (e: any) {
      addLog('error', e.message);
      return false;
    }

    // 3. 创建关联视图
    addLog('info', `🔗 创建视图 ${baseTableName}...`);

    // 后端 Rust 写入的是 List<Struct> 格式:
    // - instances 表: refno, noun, geo_items(List<Struct{geo_hash, geo_trans_id}>) 等
    // - transforms 表: trans_id, t0-t15
    // 需要使用 UNNEST 展开 List 列

    const viewSql = `
            CREATE OR REPLACE VIEW ${baseTableName} AS
            WITH flattened AS (
                SELECT 
                    * EXCLUDE (geo_items),
                    UNNEST(geo_items) AS item(geo_hash, trans_id_fk)
                FROM ${instTableName}
            )
            SELECT 
                f.*, 
                t.* EXCLUDE (trans_id)
            FROM flattened f
            LEFT JOIN ${transTableName} t ON f.trans_id_fk = t.trans_id
        `;

    await conn.query(viewSql);

    // 4. 获取统计
    const countResult = await conn.query(`SELECT COUNT(*) as cnt FROM ${baseTableName}`);
    const count = countResult.toArray()[0]?.cnt ?? 0;

    loadedFiles.value.push({
      filename: instFilename, // 记录主文件
      url: `/files/output/database_models/${instFilename}`,
      tableName: baseTableName
    });
    selectedFile.value = baseTableName;

    addLog('info', `✓ 视图 "${baseTableName}" 就绪，共 ${count} 行 (包含几何展开)`);
    return true;

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    addLog('error', `加载失败: ${msg}`);
    return false;
  } finally {
    isLoading.value = false;
  }
}

/**
 * 执行 SQL 查询
 */
async function executeQuery(sql: string): Promise<QueryResult | null> {
  const trimmedSql = sql.trim();
  if (!trimmedSql) return null;

  // 记录输入
  addLog('input', trimmedSql);

  // 添加到历史
  if (queryHistory.value[queryHistory.value.length - 1] !== trimmedSql) {
    queryHistory.value.push(trimmedSql);
    // 限制历史长度
    if (queryHistory.value.length > 100) {
      queryHistory.value.shift();
    }
  }
  historyIndex.value = queryHistory.value.length;

  // 处理快捷命令
  const lowerSql = trimmedSql.toLowerCase();

  if (lowerSql === 'help') {
    addLog('info', `可用命令：
  help          - 显示此帮助
  tables        - 列出已加载的表
  schema        - 显示当前表的 Schema
  clear         - 清空输出
  
SQL 示例：
  SELECT * FROM <table> LIMIT 10
  SELECT refno, noun FROM <table> WHERE noun = 'TUBI'
  SELECT geo_hash, COUNT(*) FROM <table> GROUP BY geo_hash`);
    return null;
  }

  if (lowerSql === 'tables') {
    if (loadedFiles.value.length === 0) {
      addLog('info', '没有已加载的表');
    } else {
      const tableList = loadedFiles.value.map(f => `  ${f.tableName} (${f.filename})`).join('\n');
      addLog('info', `已加载的表：\n${tableList}`);
    }
    return null;
  }

  if (lowerSql === 'schema') {
    if (!selectedFile.value) {
      addLog('error', '请先选择一个表');
      return null;
    }
    // 改用 DESCRIBE 查询
    return executeRealQuery(`DESCRIBE ${selectedFile.value}`);
  }

  if (lowerSql === 'clear') {
    clearLogs();
    return null;
  }

  return executeRealQuery(trimmedSql);
}

/**
 * 执行真实的 SQL 查询
 */
async function executeRealQuery(sql: string): Promise<QueryResult | null> {
  try {
    await initDuckDB();
    if (!conn) {
      addLog('error', 'DuckDB 连接不可用');
      return null;
    }

    const startTime = performance.now();
    const result = await conn.query(sql);
    const executionTime = performance.now() - startTime;

    // 转换结果
    const columns = result.schema.fields.map(f => f.name);
    const rows = result.toArray().map(row => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col, i) => {
        obj[col] = row[col] ?? row[i];
      });
      return obj;
    });

    const queryResult: QueryResult = {
      columns,
      rows,
      rowCount: rows.length,
      executionTime,
    };

    lastResult.value = queryResult;

    // 格式化输出
    if (rows.length === 0) {
      addLog('info', `查询完成，无结果 (${executionTime.toFixed(1)}ms)`);
    } else {
      addLog('info', `返回 ${rows.length} 行 (${executionTime.toFixed(1)}ms)`);
    }

    return queryResult;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    addLog('error', `查询错误: ${msg}`);
    return null;
  }
}

/**
 * 获取历史记录中的上一条
 */
function getHistoryPrevious(): string | null {
  if (queryHistory.value.length === 0) return null;
  if (historyIndex.value > 0) {
    historyIndex.value--;
  }
  return queryHistory.value[historyIndex.value] ?? null;
}

/**
 * 获取历史记录中的下一条
 */
function getHistoryNext(): string | null {
  if (queryHistory.value.length === 0) return null;
  if (historyIndex.value < queryHistory.value.length - 1) {
    historyIndex.value++;
    return queryHistory.value[historyIndex.value] ?? null;
  }
  historyIndex.value = queryHistory.value.length;
  return null;
}

/**
 * Parquet SQL Store
 */
export function useParquetSqlStore() {
  return {
    // 状态
    logs,
    loadedFiles,
    availableFiles,
    selectedFile,
    isLoading,
    currentDbno,
    lastResult,

    // 方法
    initDuckDB,
    addLog,
    clearLogs,
    listAvailableFiles,
    loadParquetFile,
    executeQuery,
    getHistoryPrevious,
    getHistoryNext,
  };
}
