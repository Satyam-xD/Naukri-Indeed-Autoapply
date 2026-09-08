/**
 * indeed/index.js
 * Indeed auto-apply module entry point.
 * Can be run directly:
 *   node indeed/index.js [--live] [login]
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

const ts = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
};

/**
 * runIndeed — executes the Indeed auto-apply workflow.
 *
 * @param {object} [options]
 * @param {boolean} [options.live]
 * @param {boolean} [options.loginMode]
 * @param {boolean} [options.offscreen]
 * @param {Set} [options.openContexts]
 */
async function runIndeed(options = {}) {
  const live       = options.live       ?? process.argv.includes('--live');
  const loginMode  = options.loginMode  ?? process.argv.includes('login');
  const offscreen  = options.offscreen  ?? process.argv.includes('--offscreen');
  const contexts   = options.openContexts;

  const siteLog = (msg) => console.log(`[${ts()}] [indeed] ${msg}`);
  siteLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  siteLog('🚀 INDEED runner starting');
  siteLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const dayState = new DailyState('indeed', site.dailyCap);

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
      siteLog('Browser open — log in to Indeed, then CLOSE the browser window.');
      siteLog('Session saved to: ' + site.profile);
      await new Promise((res) => ctx.on('close', res));
      siteLog('Session saved for Indeed.');
      return;
    }

    await ensureLoggedIn(mainPage, site, config.CREDS, siteLog);

    const script = buildScript({
      site:            'indeed',
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
      logApplication: (job) => logApplication('indeed', job),
      log:            siteLog,
    });

  } finally {
    siteLog('Closing Indeed browser...');
    try { await ctx.close(); } catch (_) {}
    if (contexts) contexts.delete(ctx);
  }
}

if (require.main === module) {
  (async () => {
    await runIndeed();
  })().catch((err) => {
    console.error(`[indeed FATAL] ${err.message}`);
    process.exit(1);
  });
}

module.exports = { runIndeed, site };
