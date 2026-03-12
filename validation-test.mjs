import { chromium } from 'playwright';

async function validateApp() {
  console.log('🚀 Starting browser automation validation...');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Navigate to the app
    console.log('📱 Navigating to http://127.0.0.1:3101/');
    await page.goto('http://127.0.0.1:3101/', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    // Wait a bit for Vue to render
    await page.waitForTimeout(2000);
    
    // Check if page loaded
    const title = await page.title();
    console.log(`✅ Page loaded: ${title}`);
    
    // Take screenshot of initial state
    await page.screenshot({ path: '/tmp/app-initial.png', fullPage: true });
    console.log('📸 Screenshot saved: /tmp/app-initial.png');
    
    // Check for toolbar area
    const toolbarSelectors = [
      'v-toolbar',
      '[role="toolbar"]',
      '.toolbar',
      '.v-toolbar',
      'header',
      'nav'
    ];
    
    let toolbarFound = false;
    for (const selector of toolbarSelectors) {
      const toolbar = await page.$(selector);
      if (toolbar) {
        console.log(`✅ Toolbar area found: ${selector}`);
        toolbarFound = true;
        break;
      }
    }
    
    if (!toolbarFound) {
      console.log('⚠️  No toolbar area detected with common selectors');
    }
    
    // Check for viewer/canvas area
    const canvasSelectors = [
      'canvas',
      '#viewer',
      '.viewer',
      '[class*="viewer"]',
      '[id*="viewer"]'
    ];
    
    let canvasFound = false;
    for (const selector of canvasSelectors) {
      const canvas = await page.$(selector);
      if (canvas) {
        console.log(`✅ Viewer/Canvas area found: ${selector}`);
        canvasFound = true;
        break;
      }
    }
    
    if (!canvasFound) {
      console.log('⚠️  No viewer/canvas area detected');
    }
    
    // Check for auth blockers
    const authSelectors = [
      'input[type="password"]',
      'input[placeholder*="password"]',
      'input[placeholder*="用户"]',
      'button[type="submit"]',
      '[role="dialog"]'
    ];
    
    let authBlockerFound = false;
    for (const selector of authSelectors) {
      const auth = await page.$(selector);
      if (auth) {
        console.log(`⚠️  Possible auth blocker detected: ${selector}`);
        authBlockerFound = true;
      }
    }
    
    if (!authBlockerFound) {
      console.log('✅ No obvious auth blockers detected');
    }
    
    // Get page HTML structure summary
    const bodyHTML = await page.evaluate(() => {
      const body = document.body;
      const summary = {
        childCount: body.children.length,
        hasCanvas: !!document.querySelector('canvas'),
        hasToolbar: !!document.querySelector('v-toolbar, [role="toolbar"], header, nav'),
        hasViewer: !!document.querySelector('#viewer, .viewer, [class*="viewer"]'),
        ids: Array.from(document.querySelectorAll('[id]')).slice(0, 10).map(el => el.id),
        classes: Array.from(new Set(Array.from(document.querySelectorAll('[class]')).slice(0, 20).map(el => el.className))).slice(0, 10)
      };
      return summary;
    });
    
    console.log('\n📊 Page structure summary:');
    console.log(JSON.stringify(bodyHTML, null, 2));
    
    console.log('\n✅ Validation complete!');
    console.log('📝 Summary:');
    console.log('   - Page loaded: YES');
    console.log(`   - Toolbar area: ${toolbarFound ? 'YES' : 'UNCERTAIN'}`);
    console.log(`   - Viewer area: ${canvasFound ? 'YES' : 'UNCERTAIN'}`);
    console.log(`   - Auth blocker: ${authBlockerFound ? 'YES' : 'NO'}`);
    
  } catch (error) {
    console.error('❌ Error during validation:', error.message);
    await page.screenshot({ path: '/tmp/app-error.png', fullPage: true });
    throw error;
  } finally {
    await browser.close();
  }
}

validateApp().catch(err => {
  console.error('❌ Validation failed:', err);
  process.exit(1);
});
