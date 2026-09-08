/**
 * indeed/runner/script-builder.js
 * Assembles the in-browser injection payload for Indeed.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const FILES      = ['utils.js', 'finder.js', 'apply.js', 'loop.js'];
const INJECT_DIR = path.join(__dirname, '..', 'inject');

function buildScript({ CV, geminiKey, dryRun, maxApplications, minDelayMs, maxDelayMs }) {
  const parts = FILES.map((f) => {
    const p = path.join(INJECT_DIR, f);
    return `\n// ===== indeed/inject/${f} =====\n` + fs.readFileSync(p, 'utf8');
  });

  const CONFIG = {
    SITE:             'indeed',
    DRY_RUN:          dryRun,
    MAX_APPLICATIONS: maxApplications,
    MIN_DELAY_MS:     typeof minDelayMs === 'number' ? minDelayMs : 5_000,
    MAX_DELAY_MS:     typeof maxDelayMs === 'number' ? maxDelayMs : 10_000,
    geminiKey:        geminiKey || '',
  };

  return `
(async function autoApply_indeed() {
  'use strict';
  if (window.__aaBusy) {
    console.log('[auto-apply] Already running — skipping re-injection');
    return;
  }
  window.__aaBusy = true;

  // --- Injected by runner (from .env / config.js) ---
  const CONFIG = ${JSON.stringify(CONFIG, null, 2)};
  const CV     = ${JSON.stringify(CV,     null, 2)};
  // --------------------------------------------------

  try {
${parts.join('\n')}
  } catch (err) {
    console.error('[auto-apply] Fatal error:', err && err.message, err && err.stack);
  } finally {
    window.__aaBusy = false;
  }
})();
`.trim();
}

module.exports = { buildScript };
