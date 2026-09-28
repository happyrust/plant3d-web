/**
 * 性能分析：模拟隐藏操作，找出卡死原因
 */

type PerformanceStep = {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  data?: any;
}

class PerformanceAnalyzer {
  private steps: PerformanceStep[] = [];
  private currentStep: PerformanceStep | null = null;

  start(name: string, data?: any) {
    if (this.currentStep) {
      this.end();
    }
    this.currentStep = {
      name,
      startTime: performance.now(),
      data,
    };
    console.log(`[性能] 开始: ${name}`, data || '');
  }

  end() {
    if (!this.currentStep) return;
    const endTime = performance.now();
    const duration = endTime - this.currentStep.startTime;
    this.currentStep.endTime = endTime;
    this.currentStep.duration = duration;
    this.steps.push(this.currentStep);
    console.log(`[性能] 结束: ${this.currentStep.name} (耗时: ${duration.toFixed(2)}ms)`);
    this.currentStep = null;
  }

  log(message: string, data?: any) {
    console.log(`[性能] ${message}`, data || '');
  }

  report() {
    console.log('\n========================================');
    console.log('性能分析报告');
    console.log('========================================\n');
    
    let totalTime = 0;
    for (const step of this.steps) {
      const duration = step.duration || 0;
      totalTime += duration;
      const percentage = totalTime > 0 ? ((duration / totalTime) * 100).toFixed(1) : '0';
      console.log(`${step.name.padEnd(40)} ${duration.toFixed(2).padStart(10)}ms (${percentage}%)`);
      if (step.data) {
        console.log('  └─ 数据:', step.data);
      }
    }
    
    console.log(`\n总耗时: ${totalTime.toFixed(2)}ms (${(totalTime / 1000).toFixed(2)}s)`);
    
    // 找出最慢的步骤
    const sorted = [...this.steps].sort((a, b) => (b.duration || 0) - (a.duration || 0));
    if (sorted.length > 0) {
      console.log('\n最慢的步骤:');
      sorted.slice(0, 5).forEach((step, i) => {
        console.log(`  ${i + 1}. ${step.name}: ${step.duration?.toFixed(2)}ms`);
      });
    }
  }
}

// 模拟 setCheckStateDeep 的性能
function simulateSetCheckStateDeep(nodeCount: number): number {
  const start = performance.now();
  
  // 模拟递归遍历所有节点
  const stack: string[] = [];
  const visited = new Set<string>();
  
  // 假设根节点是 'root'
  stack.push('root');
  
  while (stack.length > 0 && visited.size < nodeCount) {
    const cur = stack.pop();
    if (!cur || visited.has(cur)) continue;
    visited.add(cur);
    
    // 模拟子节点（每个节点平均 3 个子节点）
    for (let i = 0; i < 3 && visited.size + stack.length < nodeCount; i++) {
      const child = `${cur}_${i}`;
      if (!visited.has(child)) {
        stack.push(child);
      }
    }
  }
  
  return performance.now() - start;
}

// 模拟 setVisibleBatch 的性能
function simulateSetVisibleBatch(refnoCount: number, batchSize: number): number {
  const start = performance.now();
  
  // 模拟分批处理
  const batches = Math.ceil(refnoCount / batchSize);
  
  for (let i = 0; i < batches; i++) {
    const batchStart = i * batchSize;
    const batchEnd = Math.min(batchStart + batchSize, refnoCount);
    const batchSize_actual = batchEnd - batchStart;
    
    // 模拟 ensureRefnos 和 setVisible 操作
    // 假设每个 refno 需要 0.1ms 处理
    const batchTime = batchSize_actual * 0.1;
    
    // 模拟同步操作（这里会阻塞）
    const startBatch = performance.now();
    while (performance.now() - startBatch < batchTime) {
      // 模拟 CPU 密集型操作
    }
  }
  
  return performance.now() - start;
}

// 模拟完整的隐藏操作
async function simulateHideOperation(refno: string, refnoCount: number) {
  const analyzer = new PerformanceAnalyzer();
  
  console.log('\n========================================');
  console.log(`模拟隐藏操作: ${refno}`);
  console.log(`预计处理 ${refnoCount} 个 refnos`);
  console.log('========================================\n');
  
  // 1. 查询子树 refnos
  analyzer.start('1. 查询子树 refnos (API 调用)', { refno });
  await new Promise(resolve => setTimeout(resolve, 50)); // 模拟 API 调用
  analyzer.end();
  
  // 2. setVisibleBatch - 分批处理
  analyzer.start('2. setVisibleBatch (分批设置可见性)', { 
    refnoCount, 
    batchSize: 500 
  });
  const batchTime = simulateSetVisibleBatch(refnoCount, 500);
  analyzer.end();
  analyzer.log(`实际批处理耗时: ${batchTime.toFixed(2)}ms`);
  
  // 3. setCheckStateDeep - 递归设置状态
  analyzer.start('3. setCheckStateDeep (递归设置状态)', { 
    nodeCount: refnoCount 
  });
  const deepTime = simulateSetCheckStateDeep(refnoCount);
  analyzer.end();
  analyzer.log(`实际递归耗时: ${deepTime.toFixed(2)}ms`);
  
  // 4. recomputeParents - 重新计算父节点状态
  analyzer.start('4. recomputeParents (重新计算父节点)', { 
    estimatedDepth: Math.ceil(Math.log2(refnoCount)) 
  });
  await new Promise(resolve => setTimeout(resolve, 10)); // 模拟计算
  analyzer.end();
  
  analyzer.report();
  
  return {
    totalTime: batchTime + deepTime + 60, // 加上 API 和 recompute 的时间
    batchTime,
    deepTime,
  };
}

// 测试不同规模的节点
async function runTests() {
  const testCases = [
    { refno: '17496/106028', count: 7 },      // 小规模（测试结果）
    { refno: 'STWALL 1', count: 1000 },       // 中等规模
    { refno: 'STWALL 1', count: 10000 },      // 大规模
    { refno: 'STWALL 1', count: 50000 },      // 超大规模（可能导致卡死）
  ];
  
  for (const testCase of testCases) {
    await simulateHideOperation(testCase.refno, testCase.count);
    console.log('\n');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

// 运行测试
const refno = process.argv[2] || '17496/106028';
const count = parseInt(process.argv[3] || '1000', 10);

if (refno === 'all') {
  runTests().catch(console.error);
} else {
  simulateHideOperation(refno, count).catch(console.error);
}
