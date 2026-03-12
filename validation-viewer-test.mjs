import { chromium } from 'playwright';

async function validateViewer() {
  console.log('🚀 Starting viewer validation...');
  
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
    
    await page.waitForTimeout(2000);
    
    // Get all project cards
    const projectCards = await page.$$('.project-card');
    console.log(`✅ Found ${projectCards.length} project cards`);
    
    if (projectCards.length > 1) {
      // Click the second project (AMS)
      console.log('🖱️  Clicking AMS project (card #2)...');
      await projectCards[1].click();
      await page.waitForTimeout(5000);
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      
      await page.screenshot({ path: '/tmp/app-viewer.png', fullPage: true });
      console.log('📸 Screenshot saved: /tmp/app-viewer.png');
      
      // Check for viewer elements
      const hasCanvas = await page.$('canvas');
      const hasViewer = await page.$('#viewer, .viewer, [class*="viewer"]');
      const canvases = await page.$$('canvas');
      
      console.log('\n✅ Viewer state:');
      console.log(`   - Canvas elements: ${canvases.length}`);
      console.log(`   - Has viewer container: ${hasViewer ? 'YES' : 'NO'}`);
      console.log(`   - Current URL: ${page.url()}`);
      
      if (canvases.length > 0) {
        console.log('\n🎨 Canvas details:');
        for (let i = 0; i < Math.min(canvases.length, 3); i++) {
          const canvasInfo = await canvases[i].evaluate(canvas => ({
            id: canvas.id,
            width: canvas.width,
            height: canvas.height,
            classes: canvas.className
          }));
          console.log(`   Canvas ${i+1}: id="${canvasInfo.id}" ${canvasInfo.width}x${canvasInfo.height}`);
        }
      }
      
      // Check for toolbar/menu items
      const buttons = await page.$$('button, [role="button"], .v-btn, .mdi');
      console.log(`\n🔘 Interactive elements: ${buttons.length}`);
      
      // Check for panels
      const panels = await page.$$('[class*="panel"], [class*="dock"], [class*="drawer"]');
      console.log(`📋 Panels/docks: ${panels.length}`);
      
      // Get detailed structure
      const structure = await page.evaluate(() => {
        const getElementInfo = (selector) => {
          const el = document.querySelector(selector);
          return el ? {
            exists: true,
            id: el.id,
            classes: el.className.slice(0, 80),
            childCount: el.children.length
          } : { exists: false };
        };
        
        return {
          app: getElementInfo('#app'),
          viewer: getElementInfo('#viewer, .viewer, [class*="viewer"]'),
          toolbar: getElementInfo('v-toolbar, [role="toolbar"], header nav'),
          canvas: getElementInfo('canvas'),
          dockview: getElementInfo('[class*="dockview"]'),
          allCanvases: Array.from(document.querySelectorAll('canvas')).map(c => ({
            id: c.id,
            parent: c.parentElement?.className.slice(0, 50)
          }))
        };
      });
      
      console.log('\n📊 Detailed structure:');
      console.log(JSON.stringify(structure, null, 2));
      
      // Check if viewer is in a ready state
      const isReady = await page.evaluate(() => {
        return {
          hasCanvas: !!document.querySelector('canvas'),
          hasButtons: document.querySelectorAll('button').length > 0,
          hasPanels: document.querySelectorAll('[class*="panel"]').length > 0,
          urlPath: window.location.pathname,
          urlSearch: window.location.search
        };
      });
      
      console.log('\n✅ Viewer readiness:');
      console.log(`   - Has canvas: ${isReady.hasCanvas}`);
      console.log(`   - Has buttons: ${isReady.hasButtons}`);
      console.log(`   - Has panels: ${isReady.hasPanels}`);
      console.log(`   - URL path: ${isReady.urlPath}`);
      console.log(`   - URL search: ${isReady.urlSearch}`);
      
    } else {
      console.log('⚠️  Not enough project cards found');
    }
    
    console.log('\n✅ Validation complete!');
    
  } catch (error) {
    console.error('❌ Error during viewer validation:', error.message);
    await page.screenshot({ path: '/tmp/app-viewer-error.png', fullPage: true });
    throw error;
  } finally {
    await browser.close();
  }
}

validateViewer().catch(err => {
  console.error('❌ Validation failed:', err);
  process.exit(1);
});
