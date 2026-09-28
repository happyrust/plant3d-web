/**
 * 测试脚本：验证 scene_tree parquet 文件中的 name 字段
 *
 * 使用方法：
 * 1. 在浏览器中打开前端应用
 * 2. 打开开发者工具控制台
 * 3. 复制并运行此脚本
 */

async function testSceneTreeParquet() {
  console.log('=== 测试 Scene Tree Parquet name 字段 ===\n');

  // 1. 动态导入 duckdb
  const duckdb = await import('@duckdb/duckdb-wasm');

  // 2. 初始化 DuckDB
  console.log('1. 初始化 DuckDB-WASM...');
  const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

  const worker_url = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
  );

  const worker = new Worker(worker_url);
  const logger = new duckdb.ConsoleLogger();

  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

  const conn = await db.connect();
  console.log('   ✓ DuckDB 初始化成功\n');

  // 2. 加载 scene_tree parquet 文件
  const PARQUET_URL = 'http://localhost:8000/output/scene_tree/scene_tree_1112.parquet';
  console.log(`2. 加载 Parquet 文件: ${PARQUET_URL}`);

  try {
    const response = await fetch(PARQUET_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    await conn.insertArrayBuffer('scene_tree', buffer);
    console.log('   ✓ 文件加载成功\n');

    // 3. 查询所有列名
    console.log('3. 查询表结构...');
    const schemaResult = await conn.query('DESCRIBE scene_tree');
    const schemaRows = schemaResult.toArray();
    console.log('   列名:');
    schemaRows.forEach(row => {
      console.log(`     - ${row.column_name}: ${row.column_type}`);
    });
    console.log('');

    // 4. 查询所有数据
    console.log('4. 查询数据...');
    const dataResult = await conn.query('SELECT * FROM scene_tree LIMIT 10');
    const dataRows = dataResult.toArray();
    console.log(`   查询到 ${dataRows.length} 行数据:\n`);

    dataRows.forEach((row, idx) => {
      console.log(`   行 ${idx + 1}:`);
      console.log(`     id: ${row.id}`);
      console.log(`     parent: ${row.parent}`);
      console.log(`     has_geo: ${row.has_geo}`);
      console.log(`     is_leaf: ${row.is_leaf}`);
      console.log(`     generated: ${row.generated}`);
      console.log(`     dbno: ${row.dbno}`);
      console.log(`     geo_type: ${row.geo_type}`);
      console.log(`     name: "${row.name}"`);
      console.log('');
    });

    // 5. 验证 name 字段存在
    const hasNameColumn = schemaRows.some(row => row.column_name === 'name');
    if (hasNameColumn) {
      console.log('✅ 验证成功: name 字段存在于 parquet 文件中');
    } else {
      console.log('❌ 验证失败: name 字段不存在');
    }

    // 清理
    await conn.close();
    await db.terminate();
    worker.terminate();
    URL.revokeObjectURL(worker_url);

    console.log('\n=== 测试完成 ===');

  } catch (error) {
    console.error('❌ 错误:', error);
    console.log('\n提示:');
    console.log('1. 确保后端服务正在运行 (http://localhost:8000)');
    console.log('2. 确保 parquet 文件路径正确');
    console.log('3. 检查网络连接');
  }
}

// 运行测试
testSceneTreeParquet();
