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
  await page.waitForTimeout(3000);

  // Dismiss popup
  await page.evaluate(() => {
    document.querySelectorAll('button[aria-label*="close" i], button[data-testid="close-button"]').forEach(b => b.click());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27 }));
  });

  const card = await page.$('div.job_seen_beacon h2 a, div[data-jk] h2 a');
  if (card) {
    await card.click({ force: true });
    await page.waitForTimeout(3000);
  }

  const pagePromise = browser.waitForEvent('page', { timeout: 15000 }).catch(() => null);
  const applyBtn = await page.$('a[data-testid="viewjob-indeed-apply"], a[href*="smartapply"]');

  if (applyBtn) {
    await applyBtn.click({ force: true });
    const newPage = await pagePromise;
    if (newPage) {
      await newPage.waitForTimeout(6000);
      try {
        const cookie = await newPage.$('#onetrust-accept-btn-handler');
        if (cookie && await cookie.isVisible()) await cookie.click();
      } catch (_) {}
      await newPage.waitForTimeout(6000);

      const reviewDetails = await newPage.evaluate(() => {
        const submit = document.querySelector('button[data-testid="submit-application-button"]');
        const errors = Array.from(document.querySelectorAll('[class*="error" i], [aria-invalid="true"], [role="alert"]')).map(e => e.innerText);
        const requiredMissing = Array.from(document.querySelectorAll('[required], [aria-required="true"]')).map(e => ({
          tag: e.tagName,
          name: e.name,
          id: e.id,
          val: e.value,
        }));
        
        // Scroll to the submit button
        if (submit) {
          submit.scrollIntoView({ block: 'center' });
        }

        return {
          submitExists: !!submit,
          submitDisabled: submit ? submit.disabled : null,
          submitAriaDisabled: submit ? submit.getAttribute('aria-disabled') : null,
          submitClass: submit ? submit.className : null,
          errors,
          requiredMissing,
          mainHtmlSnippet: (document.querySelector('main') || document.body).innerHTML.slice(0, 2000),
        };
      });

      console.log('Review Details:', JSON.stringify(reviewDetails, null, 2));

      // After scrolling into view, check if submit is enabled
      await newPage.waitForTimeout(2000);
      const isStillDisabled = await newPage.evaluate(() => {
        const submit = document.querySelector('button[data-testid="submit-application-button"]');
        return submit ? submit.disabled : null;
      });
      console.log('Is submit still disabled after scrollIntoView?', isStillDisabled);
    }
  }

  await browser.close();
})();
