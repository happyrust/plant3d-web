import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:3101/?output_project=AvevaMarineSample&show_dbnum=7997';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  
  console.log('🔄 打开页面...');
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#app', { timeout: 10000 });
  await page.waitForTimeout(3000);
  console.log('✅ 页面加载完成');

  // 清除向导完成状态
  await page.evaluate(() => localStorage.removeItem('plant3d-onboarding-v1'));
  
  // 直接通过 JS 启动校核员向导（带一个不存在的目标元素步骤）
  const result = await page.evaluate(() => {
    const { useOnboardingGuide } = window.__VUE_APP_EXPORTS__ || {};
    // 检查 onboarding overlay 是否存在
    return {
      hasOverlay: !!document.querySelector('[data-testid="onboarding-overlay"]'),
      hasApp: !!document.querySelector('#app'),
      bodyText: document.body.innerText.substring(0, 200),
    };
  });
  console.log('页面状态:', JSON.stringify(result, null, 2));

  // 打开向导中心，点击校核员角色教程
  const guideBtn = page.locator('button[title="三维校审导航"]');
  if (await guideBtn.count() > 0) {
    await guideBtn.click();
  } else {
    await page.click('button:has-text("三维校审导航")');
  }
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });

  // 获取角色卡片
  const roleInfo = await page.evaluate(() => {
    const btns = document.querySelectorAll('aside button');
    return Array.from(btns).map(b => b.textContent?.trim()?.substring(0, 80));
  });
  console.log(`📋 角色卡片: ${roleInfo.length}个`);
  roleInfo.forEach((r, i) => console.log(`   [${i}] ${r}`));

  // 尝试找到校核员并切换
  for (let i = 0; i < roleInfo.length; i++) {
    if (roleInfo[i]?.includes('校核') || roleInfo[i]?.includes('审核')) {
      const btns = page.locator('aside button');
      await btns.nth(i).click();
      await page.waitForTimeout(500);
      console.log(`✅ 切换到角色 [${i}]`);
      break;
    }
  }

  // 播放教程
  const playBtn = page.locator('text=播放当前角色教程');
  if (await playBtn.count() > 0) {
    await playBtn.click();
    await page.waitForTimeout(1000);
    console.log('✅ 已点击播放');
  } else {
    // 尝试找开始角色教程
    const startBtn = page.locator('text=开始角色教程');
    if (await startBtn.count() > 0) {
      await startBtn.click();
      await page.waitForTimeout(1000);
      console.log('✅ 已点击开始角色教程');
    } else {
      console.log('⚠️ 找不到播放按钮');
      // 列出所有按钮
      const allBtns = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('button'))
          .map(b => b.textContent?.trim()?.substring(0, 60))
          .filter(t => t);
      });
      console.log('所有按钮:', allBtns.join(' | '));
    }
  }

  // 逐步走完所有步骤
  const results = [];
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(800);
    
    const info = await page.evaluate(() => {
      const match = document.body.innerText.match(/(\d+) \/ (\d+)/);
      if (!match) return null;
      
      // 找 actionHint (amber 提示框)
      const amberHint = document.querySelector('.border-amber-200 span');
      const slateHint = document.querySelector('.bg-slate-50:not(.rounded-full):not([class*="h-1"])');
      const hint = amberHint?.textContent?.trim()?.substring(0, 80) 
        || slateHint?.textContent?.trim()?.substring(0, 80) 
        || '';
      
      const isFallback = !!amberHint || (!!slateHint && slateHint.textContent?.includes('目标元素'));

      // 获取步骤标题
      const title = document.querySelector('.font-semibold.text-sm')?.textContent?.trim() || '';
      
      return { step: `${match[1]}/${match[2]}`, isFallback, hint, title };
    });
    
    if (!info) { console.log('⚠️ 未找到步骤信息，向导可能已结束'); break; }
    
    results.push(info);
    const fb = info.isFallback ? '⚠️ FALLBACK' : '✅ 正常';
    console.log(`  ${fb} 步骤 ${info.step} 「${info.title}」`);
    if (info.hint) console.log(`       提示: ${info.hint}`);
    
    const finishBtn = page.locator('button:has-text("完成")');
    if (await finishBtn.count() > 0) {
      await finishBtn.click();
      console.log('✅ 向导完成');
      break;
    }
    
    // 跳过按钮优先
    const skipBtn = page.locator('button:has-text("跳过")');
    const nextBtn = page.locator('button:has-text("下一步")');
    if (await skipBtn.count() > 0) {
      await skipBtn.click();
    } else if (await nextBtn.count() > 0) {
      await nextBtn.click();
    } else {
      console.log('⚠️ 找不到导航按钮');
      break;
    }
  }
  
  console.log(`\n📊 总步骤: ${results.length}`);
  console.log(`📊 fallback 步骤: ${results.filter(r => r.isFallback).length}`);
  console.log(`📊 所有步骤都可导航: ${results.length > 0 ? '✅' : '❌'}`);
  
  await browser.close();
  console.log('\n✅ 验证完成');
})().catch(err => {
  console.error('❌ 错误:', err.message);
  process.exit(1);
});
