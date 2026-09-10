/**
 * shared/runner/browser.js
 * Launches a persistent Chrome/Edge/Chromium context with stealth patches.
 */
'use strict';

const path = require('path');

let chromium;
try {
  const { addExtra } = require('playwright-extra');
  chromium = addExtra(require('playwright-core').chromium);
  chromium.use(require('puppeteer-extra-plugin-stealth')());
  console.log('[browser] Stealth plugin loaded ✓');
} catch (_) {
  ({ chromium } = require('playwright-core'));
  console.log('[browser] Stealth not available — using plain Playwright');
}

/**
 * launchBrowser — returns an open PersistentContext.
 *
 * @param {string}  profileDir  Path to the Chrome profile directory.
 * @param {boolean} offscreen   Move window offscreen.
 */
async function launchBrowser(profileDir, offscreen = false) {
  const fullProfile = path.isAbsolute(profileDir)
    ? profileDir
    : path.join(__dirname, '..', '..', profileDir);

  const baseArgs = [
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
    '--disable-dev-shm-usage',
    '--disable-popup-blocking',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--enable-features=NetworkService,NetworkServiceInProcess',
    ...(offscreen ? ['--window-position=-32000,-32000'] : []),
  ];

  const baseOpts = {
    headless:          false,
    viewport:          { width: 1280, height: 900 },
    locale:            'en-IN',
    timezoneId:        'Asia/Kolkata',
    ignoreDefaultArgs: ['--enable-automation'],
    args:              baseArgs,
  };

  for (const channel of ['chrome', 'msedge', null]) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const launchOpts = channel ? { ...baseOpts, channel } : baseOpts;
        const ctx = await chromium.launchPersistentContext(fullProfile, launchOpts);
        await new Promise((r) => setTimeout(r, 800));
        const pages = ctx.pages();
        if (!pages || pages.length === 0) {
          await ctx.newPage();
        }
        console.log(`[browser] Launched successfully (channel=${channel || 'bundled chromium'})`);
        return ctx;
      } catch (e) {
        if (attempt === 1 && channel === 'msedge') {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        console.log(`[browser] channel=${channel ?? 'bundled'} failed: ${e.message.split('\n')[0]}`);
        break;
      }
    }
  }
  throw new Error('Could not launch any browser — is Chrome or Edge installed?');
}

module.exports = { launchBrowser };
