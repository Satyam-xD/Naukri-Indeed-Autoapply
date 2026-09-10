#!/usr/bin/env node
/**
 * index.js — Multi-platform Job Auto-Applier Orchestrator
 * ========================================================
 *
 * When running "all", automatically opens each platform in its
 * own VS Code terminal tab (if inside VS Code) or a separate
 * PowerShell window (if run from a plain terminal).
 *
 * USAGE:
 *   node index.js all --live            Both Wellfound + Naukri in split terminals
 *   node index.js wellfound --live      Only Wellfound
 *   node index.js naukri --live         Only Naukri
 *   node index.js all login             One-time: log in to both platforms
 *   node index.js wellfound login       One-time: log in to Wellfound only
 *   node index.js naukri login          One-time: log in to Naukri only
 */
'use strict';

const path           = require('path');
const { spawn }      = require('child_process');

const SITE_ARG   = (process.argv[2] || 'all').toLowerCase();
const LOGIN_MODE = process.argv.includes('login');
const LIVE       = process.argv.includes('--live');
const OFFSCREEN  = process.argv.includes('--offscreen');
const NO_WATCH   = process.argv.includes('--no-watch');
const IS_CHILD   = process.env.AA_CHILD === '1'; // spawned by the orchestrator

const VALID_SITES = ['wellfound', 'naukri', 'indeed', 'all'];
if (!VALID_SITES.includes(SITE_ARG)) {
  console.error('Usage: node index.js [wellfound|naukri|indeed|all] [login|--live|--offscreen]');
  process.exit(1);
}

// ── Split-terminal orchestration ──────────────────────────────
// When running "all" from within VS Code (TERM_PROGRAM or VSCODE_PID set),
// spawn each site as a child process in its OWN new VS Code terminal.
// Outside VS Code, open each in a separate PowerShell window.

const inVSCode = !!(
  process.env.TERM_PROGRAM === 'vscode' ||
  process.env.VSCODE_PID ||
  process.env.VSCODE_INJECTION ||
  process.env.VSCODE_CWD
);

const shouldSplit = SITE_ARG === 'all' && !IS_CHILD && !LOGIN_MODE;

if (shouldSplit) {
  const ts  = () => new Date().toLocaleString('en-IN');
  const log = (msg) => console.log(`[${ts()}] [main] ${msg}`);

  const sites = ['wellfound', 'naukri', 'indeed'];
  const baseArgs = [
    path.join(__dirname, 'index.js'),
    '--no-watch',
    ...(LIVE       ? ['--live']       : []),
    ...(OFFSCREEN  ? ['--offscreen']  : []),
  ];

  const labels = {
    wellfound: '🌐 Wellfound',
    naukri:    '📋 Naukri',
    indeed:    '💼 Indeed',
  };

  log(`🚀 Splitting into ${inVSCode ? 'VS Code' : 'PowerShell'} terminals — one per platform`);

  if (inVSCode) {
    // ── VS Code: open each site in a NEW PowerShell window ──
    // VS Code automatically adopts new terminal windows into its Terminal panel.
    for (const site of sites) {
      const title   = labels[site];
      const siteCmd = `node \\"${__dirname.replace(/\\/g, '\\\\')}\\index.js\\" ${site}${LIVE ? ' --live' : ''} --no-watch`;

      spawn(
        'cmd.exe',
        [
          '/c', 'start',
          `"${title}"`,                        // title bar
          'powershell.exe',
          '-NoLogo', '-NoProfile', '-NoExit',
          '-Command',
          // PowerShell command: set window title, change dir, run
          `$Host.UI.RawUI.WindowTitle = '${title}'; Set-Location '${__dirname}'; ${siteCmd.replace(/\\"/g, '"')}`,
        ],
        {
          detached: true,
          stdio:    'ignore',
          env:      { ...process.env, AA_CHILD: '1', AA_SITE: site },
        }
      ).unref();

      log(`  ↗ Opened terminal: ${title}`);
    }

  } else {
    // ── Plain terminal: open a new PowerShell window for each site ──
    for (const site of sites) {
      const title   = labels[site];
      const siteCmd = `node \\"${path.join(__dirname, 'index.js').replace(/\\/g, '\\\\')}\\" ${site}${LIVE ? ' --live' : ''} --no-watch`;

      spawn(
        'cmd.exe',
        [
          '/c',
          'start',
          `"${title}"`,                        // window title
          'powershell.exe',
          '-NoLogo', '-NoProfile', '-NoExit',
          '-Command',
          `cd '${__dirname}'; ${siteCmd.replace(/\\"/g, '"')}`,
        ],
        {
          detached: true,
          stdio:    'ignore',
          env:      { ...process.env, AA_CHILD: '1', AA_SITE: site },
        }
      ).unref();
    }

    log('✅ Opened separate PowerShell windows for each platform.');
    log('   🌐 Wellfound — running in its own window');
    log('   📋 Naukri    — running in its own window');
    log('   💼 Indeed    — running in its own window');
  }

  return;
}

// ── Auto-wrap with nodemon for live hot-reloading ─────────────
const isChild = IS_CHILD || process.env.NODEMON_ACTIVE === '1';

if (!isChild && !NO_WATCH && !LOGIN_MODE) {
  process.env.NODEMON_ACTIVE = '1';
  let nodemon;
  try {
    nodemon = require('nodemon');
  } catch (_) {
    // If nodemon is not available, proceed with plain node execution
  }

  if (nodemon) {
    const args = process.argv.slice(2).filter((a) => a !== '--no-watch');
    if (args.length === 0) args.push(SITE_ARG, '--live');

    nodemon({
      script: path.join(__dirname, 'index.js'),
      args:   [...args, '--no-watch'],
      watch:  ['index.js', '.env', 'wellfound', 'naukri', 'indeed'],
      ext:    'js,json,env',
      ignore: [
        '.wellfound-chrome-profile/**',
        '.naukri-chrome-profile/**',
        '.indeed-chrome-profile/**',
        '.*-chrome-profile/**',
        'apply-state-*.json',
        'applications*.csv',
        'qa-bank.json*',
        '*.png',
        'node_modules/**',
      ],
    });

    nodemon
      .on('start', () => {
        console.log('[nodemon] Auto-reload watcher active.');
      })
      .on('restart', (files) => {
        const names = files ? files.map((f) => path.basename(f)).join(', ') : 'files';
        console.log(`\n[nodemon] Detected changes in (${names}) — reloading...`);
      })
      .on('quit', () => {
        process.exit(0);
      });

    return;
  }
}

// ── Platform Runners ──────────────────────────────────────────
const { runWellfound } = require('./wellfound');
const { runNaukri }    = require('./naukri');
const { runIndeed }    = require('./indeed');

const ts  = () => new Date().toLocaleString('en-IN');
const log = (msg) => console.log(`[${ts()}] [${SITE_ARG}] ${msg}`);

process.on('unhandledRejection', (e) =>
  log(`unhandledRejection (ignored): ${String(e?.message || e).split('\n')[0]}`)
);
process.on('uncaughtException', (e) =>
  log(`uncaughtException (ignored): ${String(e?.message || e).split('\n')[0]}`)
);

const openContexts = new Set();

async function closeAllBrowsers() {
  for (const ctx of openContexts) {
    try { await ctx.close(); } catch (_) {}
  }
  openContexts.clear();
}

['SIGINT', 'SIGTERM', 'SIGUSR2'].forEach((sig) => {
  process.once(sig, async () => {
    log(`${sig} received — closing all browsers cleanly...`);
    await closeAllBrowsers();
    process.exit(0);
  });
});

const runners = {
  wellfound: (opts) => runWellfound({ ...opts, openContexts }),
  naukri:    (opts) => runNaukri({ ...opts, openContexts }),
  indeed:    (opts) => runIndeed({ ...opts, openContexts }),
};

// ── Main Orchestrator ─────────────────────────────────────────
(async () => {
  const sitesToRun = SITE_ARG === 'all'
    ? ['wellfound', 'naukri', 'indeed']
    : [SITE_ARG];

  const opts = { live: LIVE, loginMode: LOGIN_MODE, offscreen: OFFSCREEN };

  if (LOGIN_MODE) {
    log(`Starting login mode for: ${sitesToRun.join(' then ')}`);
    for (const s of sitesToRun) {
      await runners[s](opts);
    }
  } else {
    await Promise.all(sitesToRun.map((s) => runners[s](opts)));
  }

  log('🏁 All requested platform runs complete.');
})().catch((err) => {
  console.error(`[FATAL] ${err.message}`);
  process.exit(1);
});
