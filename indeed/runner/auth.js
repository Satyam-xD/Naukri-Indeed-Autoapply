/**
 * indeed/runner/auth.js
 * Indeed authentication check and login assistance.
 */
'use strict';

/**
 * ensureLoggedIn — verifies if Indeed is authenticated.
 *
 * @param {import('playwright').Page} page
 * @param {object} site   Indeed site config
 * @param {object} creds  { email, password }
 * @param {Function} log  Site logger
 */
async function ensureLoggedIn(page, site, creds, log) {
  log('Checking Indeed login status...');

  await page.goto(site.searches[0], { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) =>
    log(`⚠ Navigation to job feed failed: ${e.message.split('\n')[0]}`)
  );
  await new Promise((r) => setTimeout(r, 4000));
  if (page.isClosed()) return false;

  const loggedIn = await isIndeedLoggedIn(page);
  if (loggedIn) {
    log('✅ Already logged in to Indeed — proceeding.');
    return true;
  }

  const { email, password } = creds;
  if (!email || !password) {
    log('⚠ No credentials in .env — please log in manually in the browser window (2 min).');
  } else {
    log(`🔑 Navigating to login page for ${email}...`);
    await page.goto(site.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) =>
      log(`⚠ Navigation to login page failed: ${e.message.split('\n')[0]}`)
    );
    await new Promise((r) => setTimeout(r, 3000));
    if (page.isClosed()) return false;
    await autoFillIndeed(page, email, password, log);
  }

  log('⏳ Waiting for Indeed login to complete (up to 2 min, handles OTP / CAPTCHA)...');
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (page.isClosed()) return false;
    await new Promise((r) => setTimeout(r, 3000));
    if (page.isClosed()) return false;
    const done = await isIndeedLoggedIn(page);
    if (done) {
      log('✅ Indeed login confirmed! Navigating to job feed...');
      await page.goto(site.searches[0], { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) =>
        log(`⚠ Post-login navigation failed: ${e.message.split('\n')[0]}`)
      );
      await new Promise((r) => setTimeout(r, 3000));
      return true;
    }
  }

  log('⚠ Indeed login timed out or continuing as guest / saved profile.');
  if (!page.isClosed()) {
    await page.goto(site.searches[0], { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) =>
      log(`⚠ Final navigation to job feed failed: ${e.message.split('\n')[0]}`)
    );
  }
  return false;
}

async function isIndeedLoggedIn(page) {
  return page.evaluate(() => {
    const hasAccountMenu = !!(
      document.querySelector('[data-gnav-element-name="AccountMenu"], a[href*="/account"], a[href*="/profile"], [aria-label*="Account" i], [data-testid="account-menu-button"], [class*="AccountMenu" i]')
    );
    if (hasAccountMenu) return true;

    const hasSignInBtn = !!document.querySelector('a[href*="/auth"], a[href*="/account/login"], a[data-gnav-element-name="SignIn"]');
    return !hasSignInBtn && /indeed\.com/i.test(location.href) && !/secure\.indeed\.com\/auth/i.test(location.href);
  }).catch(() => false);
}

async function autoFillIndeed(page, email, password, log) {
  try {
    const emailSel = 'input[type="email"], input[name="__email"], input[id*="login-email"]';
    const hasEmail = await page.waitForSelector(emailSel, { timeout: 6000 }).catch(() => null);
    if (hasEmail) {
      await page.click(emailSel);
      await page.fill(emailSel, email);
      log(`  ✍ Email entered: ${email}`);
      await new Promise((r) => setTimeout(r, 600));

      const submitBtn = await page.$('button[type="submit"], button:has-text("Continue"), button:has-text("Next")');
      if (submitBtn) {
        await submitBtn.click();
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    const passSel = 'input[type="password"]';
    const hasPass = await page.waitForSelector(passSel, { timeout: 6000 }).catch(() => null);
    if (hasPass) {
      await page.click(passSel);
      await page.fill(passSel, password);
      log('  ✍ Password entered');
      await new Promise((r) => setTimeout(r, 600));

      const signinBtn = await page.$('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")');
      if (signinBtn) {
        await signinBtn.click();
        log('  Submitted login form');
      }
    }
  } catch (e) {
    log(`  ℹ Auto-fill note: ${e.message.split('\n')[0]} (manual action may be required)`);
  }
}

module.exports = { ensureLoggedIn, isIndeedLoggedIn };
