/**
 * naukri/auth.js
 * Naukri authentication check and credential auto-fill.
 */
'use strict';

/**
 * ensureLoggedIn — verifies if Naukri is authenticated, auto-fills credentials
 * if not, and waits for user / OTP completion.
 *
 * @param {import('playwright').Page} page
 * @param {object} site   Naukri site config
 * @param {object} creds  { email, password }
 * @param {Function} log  Site logger
 */
async function ensureLoggedIn(page, site, creds, log) {
  log('Checking Naukri login status...');

  await page.goto(site.searches[0], { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) =>
    log(`⚠ Navigation to job feed failed: ${e.message.split('\n')[0]}`)
  );
  await new Promise((r) => setTimeout(r, 4000));
  if (page.isClosed()) return false;

  const loggedIn = await isNaukriLoggedIn(page);
  if (loggedIn) {
    log('✅ Already logged in to Naukri — proceeding.');
    return true;
  }

  const { email, password } = creds;
  if (!email || !password) {
    log('⚠ No credentials in .env — please log in manually in the browser window (2 min).');
  } else {
    log(`🔑 Auto-logging in to Naukri as ${email}...`);
    await page.goto(site.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) =>
      log(`⚠ Navigation to login page failed: ${e.message.split('\n')[0]}`)
    );
    await new Promise((r) => setTimeout(r, 3000));
    if (page.isClosed()) return false;
    await autoFillNaukri(page, email, password, log);
  }

  log('⏳ Waiting for Naukri login to complete (up to 2 min, handles OTP / CAPTCHA)...');
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (page.isClosed()) return false;
    await new Promise((r) => setTimeout(r, 3000));
    if (page.isClosed()) return false;
    const url  = page.url();
    const done = await isNaukriLoggedIn(page);
    const urlConfirmed = /naukri\.com\/(mnjuser|homepage|profile)/i.test(url);

    if (done || urlConfirmed) {
      log('✅ Naukri login confirmed! Navigating to job feed...');
      await page.goto(site.searches[0], { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) =>
        log(`⚠ Post-login navigation failed: ${e.message.split('\n')[0]}`)
      );
      await new Promise((r) => setTimeout(r, 3000));
      return true;
    }
  }

  log('⚠ Naukri login timed out — proceeding anyway (applications may fail).');
  if (!page.isClosed()) {
    await page.goto(site.searches[0], { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) =>
      log(`⚠ Final navigation to job feed failed: ${e.message.split('\n')[0]}`)
    );
  }
  return false;
}

async function isNaukriLoggedIn(page) {
  return page.evaluate(() => {
    const hasNaukriProfile = !!(
      document.querySelector('a[href*="/mnjuser/profile"], .nI-gNb-drawer, .view-profile-wrapper, .user-name, [class*="profile-summary" i]') ||
      /mnjuser\/(homepage|profile)/i.test(location.href)
    );
    if (hasNaukriProfile) return true;
    const hasLoginLayer = !!document.querySelector('#login_Layer, a[href*="/nlogin/login"], a[id*="login_Layer"]');
    return !hasLoginLayer && /naukri\.com/i.test(location.href) && !/nlogin/i.test(location.href);
  }).catch(() => false);
}

async function autoFillNaukri(page, email, password, log) {
  try {
    const emailSel = 'input[placeholder*="Username" i], input[id*="usernameField"], input[type="text"], input[type="email"]';
    await page.waitForSelector(emailSel, { timeout: 8000 });
    await page.click(emailSel);
    await page.fill(emailSel, email);
    log(`  ✍ Email filled: ${email}`);
    await new Promise((r) => setTimeout(r, 500));

    const passSel = 'input[type="password"]';
    let passField = await page.$(passSel);
    if (!passField) {
      const nextBtn = await page.$('button[type="submit"], button:has-text("Continue"), button:has-text("Next")');
      if (nextBtn) { await nextBtn.click(); await new Promise((r) => setTimeout(r, 2000)); }
      try { await page.waitForSelector(passSel, { timeout: 8000 }); } catch (_) {}
      passField = await page.$(passSel);
    }
    if (passField) {
      await page.click(passSel);
      await page.fill(passSel, password);
      log('  ✍ Password filled');
      await new Promise((r) => setTimeout(r, 600));
    }

    const submitBtn =
      await page.$('button[type="submit"], [name="commit"], button.btn-primary') ||
      await page.evaluateHandle(() =>
        [...document.querySelectorAll('button')].find((b) => /log in|sign in|login/i.test(b.textContent))
      );
    if (submitBtn && (await submitBtn.asElement())) {
      await submitBtn.click();
      log('  Login form submitted — waiting for redirect...');
    }
  } catch (e) {
    log(`  ⚠ Auto-fill error: ${e.message.split('\n')[0]} — complete login manually.`);
  }
}

module.exports = { ensureLoggedIn, isNaukriLoggedIn };
