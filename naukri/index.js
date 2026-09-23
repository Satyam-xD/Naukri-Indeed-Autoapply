/**
 * naukri/index.js
 * Naukri auto-apply module entry point.
 * Can be run directly:
 *   node naukri/index.js [--live] [login]
 * Or imported by the root runner.
 */
'use strict';

const site               = require('./runner/site');
const { ensureLoggedIn } = require('./runner/auth');
const { runSupervisor }  = require('./runner/supervisor');

const config             = require('../shared/runner/config');
const { launchBrowser }  = require('../shared/runner/browser');
const { buildScript }    = require('../shared/runner/script-builder');
const DailyState         = require('../shared/runner/daily-state');
const { logApplication } = require('../shared/runner/csv-logger');

const ts = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`; };

/**
 * runNaukri — executes the Naukri auto-apply workflow.
 *
 * @param {object} [options]
 * @param {boolean} [options.live]
 * @param {boolean} [options.loginMode]
 * @param {boolean} [options.offscreen]
 * @param {Set} [options.openContexts]
 */
async function runNaukri(options = {}) {
  const live       = options.live       ?? process.argv.includes('--live');
  const loginMode  = options.loginMode  ?? process.argv.includes('login');
  const offscreen  = options.offscreen  ?? process.argv.includes('--offscreen');
  const contexts   = options.openContexts;

  const siteLog = (msg) => console.log(`[${ts()}] [naukri] ${msg}`);
  siteLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  siteLog('🚀 NAUKRI runner starting');
  siteLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const dayState = new DailyState('naukri', site.dailyCap);

  if (!loginMode && dayState.atCap) {
    siteLog(`Daily cap of ${site.dailyCap} already reached (${dayState.count} today) — skipping.`);
    return;
  }

  siteLog(`Mode: ${live ? '🟢 LIVE' : '🔵 DRY RUN'}`);
  siteLog(`Target: ${dayState.target} applications (${dayState.count} today / cap ${site.dailyCap})`);

  const ctx = await launchBrowser(site.profile, offscreen);
  if (contexts) contexts.add(ctx);

  const mainPage = ctx.pages()[0] || (await ctx.newPage());
  if (contexts) ctx.on('close', () => contexts.delete(ctx));

  try {
    if (loginMode) {
      await mainPage.goto(site.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      siteLog('Browser open — log in to Naukri, then CLOSE the window.');
      siteLog('Session saved to: ' + site.profile);
      await new Promise((res) => ctx.on('close', res));
      siteLog('Session saved for Naukri.');
      return;
    }

    await ensureLoggedIn(mainPage, site, config.CREDS, siteLog);

    const script = buildScript({
      site:            'naukri',
      CV:              config.CV,
      geminiKey:       config.geminiKey,
      dryRun:          !live,
      maxApplications: dayState.target,
      minDelayMs:      config.minDelaySeconds * 1000,
      maxDelayMs:      config.maxDelaySeconds * 1000,
    });

    siteLog(`Script assembled: ${(script.length / 1024).toFixed(1)} KB`);

    await runSupervisor({
      ctx,
      mainPage,
      site,
      script,
      target:         dayState.target,
      live,
      dayState,
      logApplication: (job) => logApplication('naukri', job),
      log:            siteLog,
    });

  } catch (err) {
    if (/Target page, context or browser has been closed|Target closed|browser has been closed/i.test(err.message)) {
      siteLog('Browser window was closed.');
    } else {
      throw err;
    }
  } finally {
    siteLog('Closing Naukri browser...');
    try { await ctx.close(); } catch (_) {}
    if (contexts) contexts.delete(ctx);
  }
}

// Standalone execution support: node naukri/index.js
if (require.main === module) {
  (async () => {
    await runNaukri();
  })().catch((err) => {
    if (/Target page, context or browser has been closed|Target closed|browser has been closed/i.test(err.message)) {
      console.log(`[naukri] Browser window closed.`);
      process.exit(0);
    }
    console.error(`[naukri FATAL] ${err.message}`);
    process.exit(1);
  });
}

module.exports = { runNaukri, site };
