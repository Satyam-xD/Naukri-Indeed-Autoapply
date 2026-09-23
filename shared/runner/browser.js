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

const fs = require('fs');

function getCandidateChannels() {
  const preferred = process.env.BROWSER_CHANNEL;

  if (process.platform === 'win32') {
    const chromePaths = [
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    const edgePaths = [
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ];
    const hasChrome = chromePaths.some((p) => p && fs.existsSync(p));
    const hasEdge = edgePaths.some((p) => p && fs.existsSync(p));

    const list = [];
    if (preferred) list.push(preferred);

    if (hasEdge && !list.includes('msedge')) list.push('msedge');
    if (hasChrome && !list.includes('chrome')) list.push('chrome');
    list.push(null); // bundled Chromium fallback
    if (!list.includes('msedge')) list.push('msedge');
    if (!list.includes('chrome')) list.push('chrome');
    return list;
  }

  const list = preferred ? [preferred] : [];
  for (const c of ['chrome', 'msedge', null]) {
    if (!list.includes(c)) list.push(c);
  }
  return list;
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

  const channels = getCandidateChannels();
  for (const channel of channels) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const launchOpts = channel ? { ...baseOpts, channel } : baseOpts;
        const ctx = await chromium.launchPersistentContext(fullProfile, launchOpts);
        await new Promise((r) => setTimeout(r, 800));
        const pages = ctx.pages();
        if (!pages || pages.length === 0) {
          await ctx.newPage();
        }

        // Globally prevent any screenshots from being saved to disk
        const disableScreenshot = (p) => {
          if (p) p.screenshot = async () => Buffer.alloc(0);
        };
        ctx.pages().forEach(disableScreenshot);
        ctx.on('page', disableScreenshot);

        console.log(`[browser] Launched successfully (channel=${channel || 'bundled chromium'})`);
        return ctx;
      } catch (e) {
        if (attempt === 1 && channel === 'msedge') {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        if (!e.message.includes('is not found at')) {
          console.log(`[browser] channel=${channel ?? 'bundled'} failed: ${e.message.split('\n')[0]}`);
        }
        break;
      }
    }
  }
  throw new Error('Could not launch any browser — is Chrome or Edge installed?');
}

module.exports = { launchBrowser };
