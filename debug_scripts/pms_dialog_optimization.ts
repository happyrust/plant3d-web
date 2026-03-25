/**
 * 优化版 PMS 弹窗轮询调试脚本
 * 解决原版轮询过慢的问题
 */

import type { BrowserContext, Page } from 'playwright';

/**
 * 快速检测弹窗是否存在（不等待）
 */
async function quickCheckDialogExists(page: Page): Promise<boolean> {
  try {
    // 使用更精确的选择器，避免搜索过多元素
    const dialogSelectors = [
      '[role="dialog"]',
      '.el-dialog',
      '.x-window',
      '.modal-dialog'
    ];
    
    for (const selector of dialogSelectors) {
      const element = page.locator(selector).first();
      const isVisible = await element.isVisible({ timeout: 1000 }).catch(() => false);
      if (isVisible) {
        console.log(`[快速检测] 找到弹窗: ${selector}`);
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * 优化的弹窗填写逻辑
 */
async function optimizedTryFillDialog(page: Page): Promise<boolean> {
  if (!await quickCheckDialogExists(page)) {
    return false;
  }

  try {
    // 使用更精确的弹窗定位
    const dialog = page.locator('[role="dialog"], .el-dialog, .x-window, .modal-dialog').first();
    await dialog.waitFor({ state: 'visible', timeout: 3000 }); // 减少到3秒

    const code = process.env.PMS_MOCK_PROJECT_CODE || 'AvevaMarineSample';
    const name = process.env.PMS_MOCK_PROJECT_NAME || `E2E-${Date.now()}`;
    
    console.log(`[填写弹窗] 项目代码: ${code}, 项目名称: ${name}`);

    // 优化的填写逻辑
    const fillFields = async () => {
      const fields = [
        { label: /项目代码|项目编号/i, value: code },
        { label: /项目名称|单据名称|工程名称/i, value: name }
      ];

      for (const field of fields) {
        try {
          // 先尝试 byLabel
          const input = dialog.getByLabel(field.label).first();
          if (await input.count() > 0) {
            await input.fill(field.value);
            console.log(`[填写成功] ${field.label.source}: ${field.value}`);
            continue;
          }

          // 再尝试 byText
          const labelElement = dialog.locator('label, span, td').filter({ hasText: field.label }).first();
          if (await labelElement.count() > 0) {
            const input = labelElement.locator('xpath=ancestor::*[self::div or self::tr][1]').locator('input, textarea').first();
            await input.fill(field.value);
            console.log(`[填写成功] ${field.label.source}: ${field.value}`);
          }
        } catch (error) {
          console.log(`[填写失败] ${field.label.source}:`, error instanceof Error ? error.message : String(error));
        }
      }
    };

    await fillFields();

    // 点击提交按钮
    const submit = dialog.getByRole('button', { name: /保存|确定|提交|发起提资|下一步|确认/ }).first();
    if (await submit.count() > 0) {
      await submit.click({ timeout: 5000 });
      console.log('[点击提交] 成功');
      return true;
    }

    return false;
  } catch (error) {
    console.log('[弹窗处理错误]', error instanceof Error ? error.message : String(error));
    return false;
  }
}

/**
 * 优化的轮询函数
 */
export async function optimizedPollDialogs(
  context: BrowserContext,
  maxDurationMs = 15000, // 默认15秒
  checkIntervalMs = 2000  // 每2秒检查一次
): Promise<void> {
  console.log(`[优化轮询] 开始轮询，最长 ${maxDurationMs}ms，间隔 ${checkIntervalMs}ms`);
  
  const end = Date.now() + maxDurationMs;
  let foundAndProcessed = false;
  
  while (Date.now() < end && !foundAndProcessed) {
    const openPages = context.pages().filter(p => !p.isClosed());
    console.log(`[轮询检查] 活跃页面数: ${openPages.length}`);
    
    for (const page of openPages) {
      const result = await optimizedTryFillDialog(page);
      if (result) {
        foundAndProcessed = true;
        console.log('[轮询成功] 弹窗已处理完成');
        break;
      }
    }
    
    if (!foundAndProcessed) {
      await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
    }
  }
  
  if (!foundAndProcessed) {
    console.log('[轮询结束] 未找到或未处理弹窗');
  }
}

/**
 * 调试函数：分析页面结构
 */
export async function debugPageStructure(page: Page): Promise<void> {
  try {
    console.log(`[页面调试] URL: ${page.url()}`);
    
    // 检查可能的弹窗元素
    const potentialDialogs = await page.locator('[role="dialog"], .el-dialog, .x-window, .modal-dialog, .ant-modal, .x-panel').all();
    console.log(`[页面调试] 潜在弹窗元素数量: ${potentialDialogs.length}`);
    
    for (let i = 0; i < potentialDialogs.length; i++) {
      const dialog = potentialDialogs[i];
      const isVisible = await dialog.isVisible().catch(() => false);
      const tagName = await dialog.evaluate(el => el.tagName).catch(() => 'unknown');
      const className = await dialog.evaluate(el => el.className).catch(() => 'no-class');
      
      console.log(`[弹窗${i}] 标签: ${tagName}, 类名: ${className}, 可见: ${isVisible}`);
    }
    
    // 检查表单输入元素
    const inputs = await page.locator('input[type="text"], input[type="password"], textarea').all();
    console.log(`[页面调试] 输入元素数量: ${inputs.length}`);
    
  } catch (error) {
    console.log('[页面调试错误]', error instanceof Error ? error.message : String(error));
  }
}
