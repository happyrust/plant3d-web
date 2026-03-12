import { chromium } from 'playwright';

async function validateNavigation() {
  console.log('🚀 Starting navigation validation...');
  
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
    
    // Check for project cards
    const projectCards = await page.$$('.project-card, [class*="project-card"]');
    console.log(`✅ Found ${projectCards.length} project cards`);
    
    if (projectCards.length > 0) {
      // Get project info
      const projectInfo = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.project-card, [class*="project-card"]'));
        return cards.slice(0, 3).map(card => {
          const title = card.querySelector('.title, h2, h3, [class*="title"]')?.textContent?.trim();
          const subtitle = card.querySelector('.subtitle, [class*="subtitle"]')?.textContent?.trim();
          return { title, subtitle };
        });
      });
      
      console.log('📋 Available projects:');
      projectInfo.forEach((proj, i) => {
        console.log(`   ${i+1}. ${proj.title || 'Unknown'} - ${proj.subtitle || ''}`);
      });
      
      // Click first project
      console.log('\n🖱️  Clicking first project...');
      await projectCards[0].click();
      await page.waitForTimeout(3000);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      
      await page.screenshot({ path: '/tmp/app-after-project-click.png', fullPage: true });
      console.log('📸 Screenshot saved: /tmp/app-after-project-click.png');
      
      // Check for viewer elements after navigation
      const hasCanvas = await page.$('canvas');
      const hasViewer = await page.$('#viewer, .viewer, [class*="viewer"]');
      const hasToolbar = await page.$('v-toolbar, [role="toolbar"], header nav, .toolbar');
      
      console.log('\n✅ After project selection:');
      console.log(`   - Canvas: ${hasCanvas ? 'YES' : 'NO'}`);
      console.log(`   - Viewer area: ${hasViewer ? 'YES' : 'NO'}`);
      console.log(`   - Toolbar: ${hasToolbar ? 'YES' : 'NO'}`);
      
      // Get current URL
      const currentUrl = page.url();
      console.log(`   - Current URL: ${currentUrl}`);
      
      // Check for toolbar buttons/icons
      const toolbarButtons = await page.$$('button, [role="button"], .v-btn');
      console.log(`   - Toolbar buttons found: ${toolbarButtons.length}`);
      
      if (toolbarButtons.length > 0) {
        const buttonInfo = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button, [role="button"], .v-btn'));
          return btns.slice(0, 10).map(btn => ({
            text: btn.textContent?.trim().slice(0, 30),
            title: btn.getAttribute('title'),
            ariaLabel: btn.getAttribute('aria-label'),
            classes: btn.className.slice(0, 50)
          }));
        });
        console.log('\n🔘 Sample toolbar buttons:');
        buttonInfo.forEach((btn, i) => {
          const label = btn.text || btn.title || btn.ariaLabel || 'No label';
          console.log(`   ${i+1}. ${label}`);
        });
      }
      
      // Check DOM structure
      const structure = await page.evaluate(() => {
        return {
          hasModelTree: !!document.querySelector('[class*="tree"], [class*="model-tree"]'),
          hasPanel: !!document.querySelector('[class*="panel"]'),
          hasDock: !!document.querySelector('[class*="dock"]'),
          mainDivs: Array.from(document.querySelectorAll('body > div')).map(d => ({
            id: d.id,
            classes: d.className.slice(0, 50)
          })).slice(0, 5)
        };
      });
      
      console.log('\n📊 DOM structure:');
      console.log(JSON.stringify(structure, null, 2));
      
    } else {
      console.log('⚠️  No project cards found');
    }
    
  } catch (error) {
    console.error('❌ Error during navigation validation:', error.message);
    await page.screenshot({ path: '/tmp/app-navigation-error.png', fullPage: true });
    throw error;
  } finally {
    await browser.close();
  }
}

validateNavigation().catch(err => {
  console.error('❌ Validation failed:', err);
  process.exit(1);
});
