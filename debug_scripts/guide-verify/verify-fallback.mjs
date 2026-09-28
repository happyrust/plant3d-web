import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:3101/?output_project=AvevaMarineSample&show_dbnum=7997';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  
  console.log('🔄 打开页面...');
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  // 等待应用渲染完成
  await page.waitForSelector('#app', { timeout: 10000 });
  await page.waitForTimeout(3000);
  console.log('✅ 页面加载完成');

  // 清除向导完成状态
  await page.evaluate(() => localStorage.removeItem('plant3d-onboarding-v1'));
  
  // 打开向导中心
  const guideBtn = page.locator('button[title="三维校审导航"]');
  if (await guideBtn.count() > 0) {
    await guideBtn.click();
  } else {
    await page.click('button:has-text("三维校审导航")');
  }
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  console.log('✅ 向导中心已打开');
  
  // 获取角色卡片信息
  const roleInfo = await page.evaluate(() => {
    const btns = document.querySelectorAll('aside button');
    return Array.from(btns).map(b => b.textContent?.trim()?.substring(0, 50));
  });
  console.log(`📋 角色卡片: ${roleInfo.length}个`);
  roleInfo.forEach((r, i) => console.log(`   [${i}] ${r}`));
  
  // 点击播放教程 - 使用精确的文本匹配
  const playBtn = page.locator('text=播放当前角色教程');
  await playBtn.waitFor({ state: 'visible', timeout: 5000 });
  await playBtn.click();
  await page.waitForTimeout(1000);
  console.log('✅ 已点击播放当前角色教程');
  
  // 逐步走完所有步骤
  const results = [];
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(500);
    
    const info = await page.evaluate(() => {
      const match = document.body.innerText.match(/(\d+) \/ (\d+)/);
      if (!match) return null;
      
      // 找 actionHint (amber 提示框)
      const hintEl = document.querySelector('.border-amber-200 span') 
        || document.querySelector('.bg-slate-50');
      const hint = hintEl?.textContent?.trim()?.substring(0, 60) || '';
      
      // 找 fallback 提示
      const isFallback = !!document.querySelector('.border-amber-200') 
        || !!document.querySelector('.bg-slate-50:not(.rounded-full)');
      
      return { 
        step: `${match[1]}/${match[2]}`, 
        isFallback,
        hint
      };
    });
    
    if (!info) { console.log('⚠️ 未找到步骤信息'); break; }
    
    results.push(info);
    console.log(`  步骤 ${info.step} | fallback=${info.isFallback} | hint="${info.hint}"`);
    
    const finishBtn = page.locator('button:has-text("完成")');
    if (await finishBtn.count() > 0) {
      await finishBtn.click();
      console.log('✅ 向导完成');
      break;
    }
    
    const nextBtn = page.locator('button:has-text("下一步")');
    if (await nextBtn.count() > 0) {
      await nextBtn.click();
    } else {
      console.log('⚠️ 找不到下一步按钮');
      break;
    }
  }
  
  console.log(`\n📊 总步骤: ${results.length}`);
  console.log(`📊 fallback 步骤: ${results.filter(r => r.isFallback).length}`);
  console.log(`📊 有 actionHint 的 fallback: ${results.filter(r => r.isFallback && r.hint).length}`);
  
  // 验证持久化
  const state = await page.evaluate(() => 
    JSON.parse(localStorage.getItem('plant3d-onboarding-v1') || '{}')
  );
  console.log('📊 持久化状态:', JSON.stringify(state));
  
  await browser.close();
  console.log('\n✅ 验证完成');
})().catch(err => {
  console.error('❌ 错误:', err.message);
  process.exit(1);
});
