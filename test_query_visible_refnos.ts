/**
 * 测试 visible-insts API
 * 运行方式: npx tsx test_query_visible_refnos.ts
 */

const API_BASE = 'http://localhost:8080';

type VisibleInstsResponse = {
  success: boolean;
  refno: string;
  refnos: string[];
  error_message?: string | null;
}

async function queryVisibleInsts(refno: string): Promise<VisibleInstsResponse> {
  // 将 / 替换为 _ 因为后端使用 RefnoEnum 格式
  const normalizedRefno = refno.replace('/', '_');
  const url = `${API_BASE}/api/e3d/visible-insts/${encodeURIComponent(normalizedRefno)}`;

  console.log(`请求 URL: ${url}`);

  const resp = await fetch(url);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}\n${text}`);
  }

  return await resp.json();
}

async function testQueryVisibleInsts(refno: string) {
  console.log('\n========================================');
  console.log(`测试 refno: ${refno}`);
  console.log('========================================\n');

  const startTime = Date.now();

  try {
    const resp = await queryVisibleInsts(refno);
    const endTime = Date.now();
    const totalTime = endTime - startTime;

    console.log(`\n请求耗时: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`);
    console.log(`success: ${resp.success}`);
    console.log(`refno: ${resp.refno}`);
    console.log(`返回的 refnos 数量: ${resp.refnos?.length ?? 0}`);

    if (!resp.success) {
      console.error(`❌ API 调用失败: ${resp.error_message}`);
      return;
    }

    if (!resp.refnos || resp.refnos.length === 0) {
      console.log('⚠️ 没有返回可见实例');
      return;
    }

    // 统计去重
    const seen = new Set(resp.refnos);
    const duplicateCount = resp.refnos.length - seen.size;

    console.log('\n========================================');
    console.log('测试完成');
    console.log('========================================');
    console.log(`总耗时: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`);
    console.log(`返回记录数: ${resp.refnos.length}`);
    console.log(`去重后记录数: ${seen.size}`);
    console.log(`重复记录数: ${duplicateCount}`);

    // 打印前 20 个和后 20 个 refnos
    console.log('\n前 20 个 refnos:');
    console.log(resp.refnos.slice(0, 20).join('\n'));

    if (resp.refnos.length > 20) {
      console.log('\n后 20 个 refnos:');
      console.log(resp.refnos.slice(-20).join('\n'));
    }
  } catch (e) {
    console.error('\n❌ 请求出错:', e);
  }
}

// 测试指定的 refno
const testRefno = process.argv[2] || '17496/106028';
testQueryVisibleInsts(testRefno).catch(console.error);
