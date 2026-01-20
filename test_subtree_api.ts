/**
 * 测试 subtree-refnos API
 */

const API_BASE = 'http://localhost:8080';

interface SubtreeRefnosResponse {
  success: boolean;
  refnos: string[];
  truncated: boolean;
  error_message?: string | null;
}

async function querySubtreeRefnos(refno: string, limit?: number): Promise<SubtreeRefnosResponse> {
  const normalizedRefno = refno.replace('/', '_');
  const url = new URL(`${API_BASE}/api/e3d/subtree-refnos/${encodeURIComponent(normalizedRefno)}`);
  if (limit) {
    url.searchParams.set('limit', String(limit));
  }

  console.log(`请求 URL: ${url.toString()}`);

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}\n${text}`);
  }

  return await resp.json();
}

async function test(refno: string) {
  console.log(`\n========================================`);
  console.log(`测试 refno: ${refno}`);
  console.log(`========================================\n`);

  try {
    const startTime = Date.now();
    const resp = await querySubtreeRefnos(refno);
    const endTime = Date.now();

    console.log(`请求耗时: ${endTime - startTime}ms`);
    console.log(`success: ${resp.success}`);
    console.log(`truncated: ${resp.truncated}`);
    console.log(`返回的 refnos 数量: ${resp.refnos?.length ?? 0}`);

    if (!resp.success) {
      console.error(`❌ API 调用失败: ${resp.error_message}`);
      return;
    }

    console.log(`\n前 20 个 refnos:`);
    console.log(resp.refnos.slice(0, 20).join('\n'));

    if (resp.refnos.length > 20) {
      console.log(`\n后 20 个 refnos:`);
      console.log(resp.refnos.slice(-20).join('\n'));
    }
  } catch (e) {
    console.error(`\n❌ 请求出错:`, e);
  }
}

const testRefno = process.argv[2] || '17496/106028';
test(testRefno).catch(console.error);
