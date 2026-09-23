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
  await page.goto('https://in.indeed.com/jobs?q=software+engineer&l=India&sort=date&vjk=aa8022a9a29fb50e', { waitUntil: 'load' });
  await page.waitForTimeout(5000);

  const analysis = await page.evaluate(() => {
    const pane = document.querySelector('.jobsearch-RightPane');
    const paneHtml = pane ? pane.innerHTML.slice(0, 3000) : 'NO PANE';
    
    // Check all elements with role="button" or tag button or a in the right pane
    const allEls = pane ? Array.from(pane.querySelectorAll('*')).map(el => {
      const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
      if (text.length > 0 && text.length < 50 && (/apply/i.test(text) || /apply/i.test(el.id) || /apply/i.test(el.className))) {
        return {
          tag: el.tagName,
          id: el.id,
          className: String(el.className),
          text: text,
          attrs: Array.from(el.attributes).map(a => `${a.name}="${a.value}"`).join(' '),
        };
      }
      return null;
    }).filter(Boolean) : [];

    // Also check if there is an iframe inside the pane
    const paneIframes = pane ? Array.from(pane.querySelectorAll('iframe')).map(f => ({
      src: f.src,
      id: f.id,
      name: f.name,
      contentDocExists: !!f.contentDocument,
      contentDocText: f.contentDocument ? f.contentDocument.body?.innerText?.slice(0, 200) : null
    })) : [];

    // Check full page for any text containing "Apply"
    const applyTexts = Array.from(document.querySelectorAll('button, a, div[role="button"]'))
      .map(b => ({
        tag: b.tagName,
        id: b.id,
        className: String(b.className),
        text: (b.innerText || '').trim(),
      }))
      .filter(b => /apply/i.test(b.text));

    return {
      allEls,
      paneIframes,
      applyTexts,
      paneText: pane ? pane.innerText.slice(0, 500) : '',
    };
  });

  console.log('RightPane Analysis:', JSON.stringify(analysis, null, 2));

  await browser.close();
})();
