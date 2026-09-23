const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const profileDir = path.join(__dirname, '..', '.indeed-chrome-profile');
  const browser = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    channel: 'msedge',
  });

  const page = browser.pages()[0] || (await browser.newPage());
  
  await page.goto('https://in.indeed.com/jobs?q=software+engineer&l=India&sort=date', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  // Function to dismiss any popup on Indeed
  async function dismissPopups(p) {
    await p.evaluate(() => {
      // Close job alert popup
      const closeButtons = document.querySelectorAll(
        'button[aria-label="close"], button[aria-label="Close"], button[data-testid="close-button"], .icl-CloseButton, [class*="closeButton" i], [class*="CloseButton" i]'
      );
      for (const btn of closeButtons) {
        if (btn.offsetWidth > 0 && btn.offsetHeight > 0) {
          console.log('Dismissing popup button:', btn.className);
          btn.click();
        }
      }
      // Press Escape
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27 }));
    }).catch(() => {});
  }

  await dismissPopups(page);
  await page.waitForTimeout(1000);

  // Click card
  const card = await page.$('div.job_seen_beacon h2 a, div[data-jk] h2 a');
  if (card) {
    console.log('Clicking card...');
    await card.click({ force: true });
    await page.waitForTimeout(3000);
  }

  await dismissPopups(page);

  // Listen for popup
  const pagePromise = browser.waitForEvent('page', { timeout: 15000 }).catch(() => null);

  const applySelector = [
    'a[data-testid="viewjob-indeed-apply"]',
    'a[href*="smartapply"]',
    'a[href*="indeedapply"]',
    '[data-testid="primary-apply-action"] a',
    '[data-testid="job-header-actions"] a',
    'button[id*="indeedApply" i]',
    'button[data-testid*="indeedApply" i]',
  ].join(', ');

  const applyBtn = await page.$(applySelector);
  console.log('Found apply element?', !!applyBtn);

  if (applyBtn) {
    console.log('Clicking apply button...');
    await applyBtn.click({ force: true });
    const newPage = await pagePromise;
    if (newPage) {
      console.log('New tab opened! Waiting for navigation...');
      await newPage.waitForTimeout(5000);
      console.log('New tab URL:', newPage.url());

      // Dismiss cookie banner on new tab
      try {
        const cookie = await newPage.$('#onetrust-accept-btn-handler');
        if (cookie && await cookie.isVisible()) {
          await cookie.click();
          await newPage.waitForTimeout(1000);
        }
      } catch (_) {}

      // Poll new tab URL and content for 30s
      for (let s = 1; s <= 15; s++) {
        await newPage.waitForTimeout(2000);
        const state = await newPage.evaluate(() => {
          const body = document.body ? document.body.innerText : '';
          const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), select, textarea')).map(i => ({
            tag: i.tagName,
            type: i.type,
            name: i.name,
            id: i.id,
            val: i.value,
          }));
          const buttons = Array.from(document.querySelectorAll('button, a[role="button"], input[type="submit"]')).map(b => ({
            tag: b.tagName,
            text: (b.innerText || b.value || '').trim().replace(/\s+/g, ' '),
            id: b.id,
            testid: b.getAttribute('data-testid'),
            disabled: b.disabled,
            visible: b.offsetWidth > 0 && b.offsetHeight > 0,
          })).filter(b => b.visible && b.text.length > 0 && b.text.length < 50);

          return {
            url: location.href,
            title: document.title,
            inputs,
            buttons,
            snippet: body.slice(0, 400).replace(/\n+/g, ' | '),
          };
        }).catch(e => ({ error: e.message }));

        console.log(`[Step ${s * 2}s]`, JSON.stringify(state, null, 2));
      }
    }
  }

  await browser.close();
})();
