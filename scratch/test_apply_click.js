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
  
  await page.goto('https://in.indeed.com/jobs?q=software+engineer&l=India&sort=date', { waitUntil: 'load' });
  await page.waitForTimeout(4000);

  const card = await page.$('div.job_seen_beacon h2 a');
  if (card) {
    await card.click();
    await page.waitForTimeout(3000);
  }

  const pagePromise = browser.waitForEvent('page', { timeout: 15000 }).catch(() => null);

  const applyBtn = await page.$('a[data-testid="viewjob-indeed-apply"], a[href*="smartapply"], [data-testid="primary-apply-action"] a, [data-testid="job-header-actions"] a');

  if (applyBtn) {
    await applyBtn.click();
    const newPage = await pagePromise;
    if (newPage) {
      console.log('New page opened! Waiting for navigation to /form/ ...');
      
      // Wait for URL to include /form/
      await newPage.waitForURL(u => u.toString().includes('/form/'), { timeout: 20000 }).catch(e => console.log('waitForURL note:', e.message));
      console.log('Current URL:', newPage.url());

      // Wait another 5 seconds for React to finish rendering form
      await newPage.waitForTimeout(5000);

      // Dismiss cookies if needed
      try {
        const cookieBtn = await newPage.$('#onetrust-accept-btn-handler');
        if (cookieBtn && await cookieBtn.isVisible()) {
          await cookieBtn.click();
          await newPage.waitForTimeout(1000);
        }
      } catch (_) {}

      // Dump all elements inside main container
      const dump = await newPage.evaluate(() => {
        const main = document.querySelector('main, #main, [role="main"], div.ia-BasePage, div[class*="BasePage"]') || document.body;
        const allBtns = Array.from(main.querySelectorAll('button, a, input[type="submit"]')).map(b => ({
          tag: b.tagName,
          id: b.id,
          testid: b.getAttribute('data-testid'),
          className: b.className,
          text: (b.innerText || b.textContent || b.value || '').trim().replace(/\s+/g, ' '),
          visible: b.offsetWidth > 0 && b.offsetHeight > 0,
        })).filter(b => b.text.length > 0 && b.text.length < 50);

        return {
          url: location.href,
          title: document.title,
          mainText: main.innerText.slice(0, 1000),
          buttons: allBtns,
        };
      });

      console.log('Rendered Form Dump:', JSON.stringify(dump, null, 2));
    }
  }

  await browser.close();
})();
