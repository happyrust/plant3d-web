import { chromium } from 'playwright';

async function validateDirectAccess() {
  console.log('🚀 Starting direct access validation...');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Try project selection page first
    console.log('\n=== Testing Project Selection Page ===');
    console.log('📱 Navigating to http://127.0.0.1:3101/');
    await page.goto('http://127.0.0.1:3101/', { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });
    
    await page.waitForTimeout(3000);
    
    const homeContent = await page.evaluate(() => {
      return {
        title: document.title,
        bodyText: document.body.textContent?.slice(0, 200),
        projectCards: document.querySelectorAll('.project-card, [class*="project"]').length,
        buttons: document.querySelectorAll('button').length,
        hasApp: !!document.querySelector('#app')
      };
    });
    
    console.log('Home page content:', JSON.stringify(homeContent, null, 2));
    await page.screenshot({ path: '/tmp/app-home.png', fullPage: true });
    
    // Try accessing viewer directly with query params (common pattern from e2e tests)
    console.log('\n=== Testing Direct Viewer Access ===');
    console.log('📱 Trying http://127.0.0.1:3101/?project_id=ams');
    
    await page.goto('http://127.0.0.1:3101/?project_id=ams', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    await page.waitForTimeout(5000);
    
    const viewerContent = await page.evaluate(() => {
      return {
        url: window.location.href,
        title: document.title,
        hasCanvas: !!document.querySelector('canvas'),
        canvasCount: document.querySelectorAll('canvas').length,
        hasViewer: !!document.querySelector('#viewer, .viewer, [class*="viewer"]'),
        hasToolbar: !!document.querySelector('[role="toolbar"], header, nav, .toolbar'),
        buttonCount: document.querySelectorAll('button, [role="button"]').length,
        panelCount: document.querySelectorAll('[class*="panel"], [class*="dock"]').length,
        mainClasses: document.querySelector('#app')?.className,
        bodyClasses: document.body.className
      };
    });
    
    console.log('Viewer page content:', JSON.stringify(viewerContent, null, 2));
    await page.screenshot({ path: '/tmp/app-viewer-direct.png', fullPage: true });
    
    // Check localStorage/sessionStorage for project info
    const storageInfo = await page.evaluate(() => {
      return {
        localStorage: Object.keys(localStorage).slice(0, 10),
        sessionStorage: Object.keys(sessionStorage).slice(0, 10)
      };
    });
    console.log('Storage info:', JSON.stringify(storageInfo, null, 2));
    
    // Try another common pattern
    console.log('\n=== Testing Alternative URL Pattern ===');
    console.log('📱 Trying http://127.0.0.1:3101/?dtx_demo=true');
    
    await page.goto('http://127.0.0.1:3101/?dtx_demo=true', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    await page.waitForTimeout(5000);
    
    const demoContent = await page.evaluate(() => {
      return {
        hasCanvas: !!document.querySelector('canvas'),
        canvasCount: document.querySelectorAll('canvas').length,
        hasViewer: !!document.querySelector('#viewer, .viewer'),
        hasToolbar: document.querySelectorAll('[role="toolbar"], button').length > 5,
        errorMessages: Array.from(document.querySelectorAll('[class*="error"], [class*="alert"]'))
          .map(el => el.textContent?.slice(0, 100))
      };
    });
    
    console.log('Demo mode content:', JSON.stringify(demoContent, null, 2));
    await page.screenshot({ path: '/tmp/app-demo-mode.png', fullPage: true });
    
    console.log('\n✅ Direct access validation complete!');
    console.log('\n📝 Summary:');
    console.log('   Screenshots saved:');
    console.log('   - /tmp/app-home.png');
    console.log('   - /tmp/app-viewer-direct.png');
    console.log('   - /tmp/app-demo-mode.png');
    
  } catch (error) {
    console.error('❌ Error during validation:', error.message);
    await page.screenshot({ path: '/tmp/app-error-final.png', fullPage: true });
    throw error;
  } finally {
    await browser.close();
  }
}

validateDirectAccess().catch(err => {
  console.error('❌ Validation failed:', err);
  process.exit(1);
});
