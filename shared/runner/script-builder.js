/**
 * shared/runner/script-builder.js
 * Assembles the in-browser injection payload for any platform.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * buildScript — bundles the shared utilities and site-specific inject scripts into one IIFE.
 *
 * @param {object} opts
 * @param {string} opts.site             e.g. 'wellfound' | 'naukri' | 'indeed'
 * @param {object} opts.CV               Candidate profile object
 * @param {string} [opts.geminiKey]      Gemini API key
 * @param {boolean} [opts.dryRun]        Dry run mode flag
 * @param {number} [opts.maxApplications] Target count
 * @param {number} [opts.minDelayMs]     Min delay between applications
 * @param {number} [opts.maxDelayMs]     Max delay between applications
 */
function buildScript({ site, CV, geminiKey, dryRun, maxApplications, minDelayMs, maxDelayMs }) {
  const siteInjectDir   = path.join(__dirname, '..', '..', site, 'inject');
  const sharedInjectDir = path.join(__dirname, '..', 'inject');

  const utilsPath = fs.existsSync(path.join(siteInjectDir, 'utils.js'))
    ? path.join(siteInjectDir, 'utils.js')
    : path.join(sharedInjectDir, 'utils.js');

  const files = [
    { name: 'utils.js',  path: utilsPath },
    { name: 'finder.js', path: path.join(siteInjectDir, 'finder.js') },
    { name: 'apply.js',  path: path.join(siteInjectDir, 'apply.js') },
    { name: 'loop.js',   path: path.join(siteInjectDir, 'loop.js') },
  ];

  const parts = files.map(({ name, path: p }) => {
    return `\n// ===== ${site}/inject/${name} =====\n` + fs.readFileSync(p, 'utf8');
  });

  const CONFIG = {
    SITE:             site,
    DRY_RUN:          dryRun,
    MAX_APPLICATIONS: maxApplications,
    MIN_DELAY_MS:     typeof minDelayMs === 'number' ? minDelayMs : 5_000,
    MAX_DELAY_MS:     typeof maxDelayMs === 'number' ? maxDelayMs : 10_000,
    geminiKey:        geminiKey || '',
  };

  return `
(async function autoApply_${site}() {
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
