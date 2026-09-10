/**
 * runner/supervisor.js
 * Playwright-side orchestration loop: wires console events from the
 * injected script, detects submissions, rotates search URLs on idle,
 * and logs results to the CSV.
 */
'use strict';

const path            = require('path');
const qaManager       = require('../../shared/runner/qa-manager');
const { getBestResume } = require('../../shared/runner/resume-selector');

/** How long the supervisor runs before giving up. */
const MAX_RUNTIME_MS = 100 * 60 * 1000;  // 100 minutes

/** If the injected script hasn't logged anything in this period, rotate. */
const IDLE_ROTATE_MS = 4 * 60 * 1000;    // 4 minutes

// ── Helpers ───────────────────────────────────────────────────

const isBusy     = (p) => p.evaluate('!!window.__aaBusy').catch(() => false);
const isFinished = (p) => p.evaluate('!!window.__aaFinished').catch(() => false);

/**
 * scrapeJobDetails — evaluates in-page to scrape JD, salary, company, and
 * experience requirement from the currently-open apply panel.
 * Merges any non-empty fields it finds into `job` (mutates in place).
 *
 * @param {import('playwright').Page} page
 * @param {object} job  The pending job object to enrich.
 */
async function scrapeJobDetails(page, job) {
  const d = await page.evaluate(() => {
    const q        = (sel) => document.querySelector(sel)?.textContent?.trim() || '';
    const bodyText = document.body.innerText || '';
    const expMatch = bodyText.match(
      /\b(fresher|entry.?level|[0-9]+\s*[-–]?\s*[0-9]*\s*\+?\s*(?:years?|yrs?)(?:\s*(?:of\s*)?exp(?:erience)?)?)/i
    );
    return {
      company: (bodyText.match(/Apply to (.{2,60})/) || [])[1]?.trim()
             || q('a[href^="/company/"]'),
      salary: (bodyText.match(
        /(?:₹|\$)\s?[\d,.]+(?:\s?[-–]\s?(?:₹|\$)?[\d,.]+)?[^\n]{0,30}/
      ) || [''])[0],
      expRequired: expMatch ? expMatch[0].replace(/\s+/g, ' ').trim() : '',
      jd: (
        q('[class*="jobDescription" i]') ||
        q('[class*="description" i]')
      ).slice(0, 1200),
    };
  }).catch(() => null);

  if (!d) return;
  if (d.company)     job.company     = job.company     || d.company;
  if (d.salary)      job.salary      = job.salary      || d.salary;
  if (d.expRequired) job.expRequired = job.expRequired || d.expRequired;
  if (d.jd)         job.jd          = d.jd;
}

/**
 * startClickRelay — starts a 500 ms interval that watches for
 * `window.__aaReadyToSubmit` and fires a trusted CDP mouse click.
 * Returns a `stop()` function that clears the interval.
 *
 * @param {import('playwright').Page} mainPage
 * @param {Function} log
 * @returns {{ stop: Function }}
 */
function startClickRelay(mainPage, log, getJob) {
  let tick = 0;
  const id = setInterval(async () => {
    try {
      tick++;
      if (tick % 5 === 0) {
        try {
          const hasFileInput = await mainPage.evaluate(() => {
            const fi = document.querySelector('input[type="file"]');
            return fi && !fi.disabled && (!fi.files || fi.files.length === 0);
          }).catch(() => false);

          if (hasFileInput) {
            const job = typeof getJob === 'function' ? getJob() : null;
            const resume = getBestResume(job || {});
            const fiLoc = mainPage.locator('input[type="file"]').first();
            if (await fiLoc.count() > 0) {
              await fiLoc.setInputFiles(resume.path);
              log(`  📄 Attached resume: "${resume.filename}" (${resume.label})`);
              await mainPage.waitForTimeout(1000);
            }
          }
        } catch (_) {}
      }

      const signal = await mainPage.evaluate(() => {
        const s = window.__aaReadyToSubmit;
        if (!s || typeof s !== 'object' || !s.x) return null;
        return { x: Number(s.x), y: Number(s.y), label: String(s.label || '') };
      }).catch(() => null);
      if (!signal) return;

      // Consume immediately to prevent double-clicks
      await mainPage.evaluate('window.__aaReadyToSubmit = false').catch(() => {});
      log(`  🖱 Supervisor clicking at (${signal.x}, ${signal.y}) — "${signal.label || '?'}"`);

      let clicked = false;

      // Attempt 1: coordinate-based CDP mouse click (fastest, no DOM search)
      try {
        await mainPage.mouse.move(signal.x, signal.y);
        await mainPage.mouse.click(signal.x, signal.y);
        log('  ✅ Trusted mouse.click() sent via CDP (coordinate)');
        clicked = true;
      } catch (coordErr) {
        log(`  ⚠ Coordinate click failed: ${coordErr.message.split('\n')[0]} — trying accessibility fallback`);
      }

      // Attempt 2: accessibility-tree click (independent of CSS / coordinates)
      if (!clicked) {
        try {
          const btnRE  = new RegExp(`^${(signal.label || 'apply').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
          const btn    = mainPage.getByRole('button', { name: btnRE }).last();
          if (await btn.count() > 0 && await btn.isVisible().catch(() => false)) {
            await btn.click({ timeout: 5000, force: false });
            log(`  ✅ Trusted click via getByRole("button", "${signal.label || 'apply'}")`);
            clicked = true;
          } else {
            // Broader fallback: any visible Apply/Submit button
            const broadBtn = mainPage.getByRole('button', { name: /^(apply|submit|send)$/i }).last();
            if (await broadBtn.count() > 0 && await broadBtn.isVisible().catch(() => false)) {
              await broadBtn.click({ timeout: 5000, force: false });
              log('  ✅ Trusted click via broad getByRole fallback');
              clicked = true;
            }
          }
        } catch (roleErr) {
          log(`  ⚠ Accessibility click failed: ${roleErr.message.split('\n')[0]} — injected fallback will run`);
        }
      }

      if (clicked) {
        await mainPage.evaluate('window.__aaSubmitDone = true').catch(() => {});
      } else {
        log('  ⚠ All supervisor click methods failed — injected script fallback will run');
      }
    } catch (e) {
      log(`⚠ [trusted-click relay] Unexpected error: ${e.message.split('\n')[0]}`);
    }
  }, 500);

  return { stop: () => clearInterval(id) };
}

// ── Wire page ─────────────────────────────────────────────────

/**
 * wirePage — attaches console and load event listeners to a page.
 * Returns no value; the caller owns `submitted`, `pendingJob`, etc.
 */
function wirePage({ page, site, script, live, target, dayState, logApplication, log, state }) {
  page.on('console', (msg) => {
    const text = msg.text();
    if (!/\[auto-apply\]/.test(text)) return;
    state.lastActivity = Date.now();

    if (text.includes('[auto-apply-pause]')) {
      try {
        const jsonStr = text.slice(text.indexOf('[auto-apply-pause]') + '[auto-apply-pause]'.length).trim();
        const data = JSON.parse(jsonStr);
        process.stdout.write('\x07'); // Terminal beep
        log(`\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        log(`  🚨 [PAUSED] Unknown question: "${data.question.slice(0, 60)}"`);
        log(`  👉 Pop-up opened in Chrome! Type answer & click Save to resume.`);
        log(`  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
      } catch (_) {}
      return;
    }

    if (text.includes('[auto-apply-qa]')) {
      try {
        const jsonStr = text.slice(text.indexOf('[auto-apply-qa]') + '[auto-apply-qa]'.length).trim();
        const qaData = JSON.parse(jsonStr);
        qaManager.recordQA(qaData);
        if (qaData.status === 'unanswered') {
          log(`  ❓ [QA Bank] Unanswered question saved: "${qaData.question.slice(0, 55)}" (open qa-bank.json to answer)`);
        } else {
          log(`  💾 [QA Bank] Recorded answer for: "${qaData.question.slice(0, 55)}"`);
        }
      } catch (_) {}
      return;
    }

    const clean = text.replace(/.*\[auto-apply\]\s*/, '').trim();

    // Live 1-second countdown timer: update in place on the same terminal line
    if (clean.startsWith('⏳ [Timer]')) {
      const now = new Date();
      const isoTs = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
      process.stdout.write(`\r[${isoTs}] [${site.name}]   ${clean}   `);
      state.lastWasTimer = true;
      return;
    }

    if (state.lastWasTimer) {
      process.stdout.write('\n');
      state.lastWasTimer = false;
    }

    log('  ' + clean.slice(0, 200));

    // Take a screenshot when the script can't find the submit button, or hits a hard block
    if (/no Submit button|Submit button is disabled|🚫/.test(clean)) {
      const snapPath = path.join(__dirname, '..', `blocked-${Date.now()}.png`);
      page.screenshot({ path: snapPath }).catch(() => {});
      log(`  📸 Screenshot saved: ${snapPath}`);
    }

    // "▶ Applying: <title> @ <company> | <link> | <salary> | <exp>"   (Wellfound)
    // "▶ [1/10] <title> @ <company>"                                    (Naukri)
    const applyMatch = clean.match(/▶ (?:Applying: |\[\d+\/\d+\] )(.+)/);
    if (applyMatch) {
      const [main, link = '', salaryRaw = '', expRaw = ''] = applyMatch[1].split(' | ');
      const parts   = main.split(' @ ');
      const company = parts.length > 1 ? parts.pop() : '';
      const title   = parts.join(' @ ');
      state.pendingJob = {
        title:       title.trim(),
        company:     company.replace(/^\?$/, '').trim(),
        link:        link.trim(),
        salary:      salaryRaw.trim(),
        expRequired: expRaw.trim(),
        skills:      '',
        jd:          '',
      };

      // Scrape additional details from the open apply panel after a short delay
      setTimeout(() => {
        if (!state.pendingJob) return;
        scrapeJobDetails(page, state.pendingJob).catch(() => {});
      }, 2500);
    }

    // Detect successful submission (matches both Wellfound and Naukri success messages)
    if (/✅ (?:application sent|Applied to)|DRY_RUN — would click/i.test(text)) {
      state.submitted++;
      if (live) dayState.bump();
      log(`==> ${state.submitted}/${target} this run (${dayState.count}/${dayState.cap} today)`);

      // Capture the live job reference so the 3s timer picks up any JD data
      // that the scrapeJobDetails setTimeout(2500) populated after the "▶ Applying"
      // log line. We clone it now for CSV writing but keep the reference alive.
      const jobRef   = state.pendingJob || { title: 'unknown' };
      const jobToLog = { ...jobRef }; // snapshot of current fields
      state.pendingJob = null;

      // Wait 3s for scrapeJobDetails (fires at 2.5s) to finish enriching jobRef,
      // then merge any newly-populated fields into the snapshot before CSV write.
      setTimeout(() => {
        // Merge enriched fields from the live reference into our snapshot
        jobToLog.company     = jobToLog.company     || jobRef.company;
        jobToLog.salary      = jobToLog.salary      || jobRef.salary;
        jobToLog.expRequired = jobToLog.expRequired || jobRef.expRequired;
        jobToLog.jd          = jobToLog.jd          || jobRef.jd;

        try { logApplication(jobToLog); }
        catch (e) { log('CSV write failed: ' + e.message); }
      }, 3000);
    }
  });

  // Re-inject the script on every navigation that matches our site
  page.on('load', async () => {
    const currentUrl = page.url();

    // If clicking Apply navigated to an external site, go back to the search URL
    if (!site.injectOn(currentUrl)) {
      if (/^https?:\/\//i.test(currentUrl) && !/naukri\.com/i.test(currentUrl)) {
        const fallbackUrl = state.searchUrlFn ? state.searchUrlFn() : site.searches[0];
        log(`⚠ External redirect detected (${currentUrl.slice(0, 60)}...) — returning to search`);
        await page.goto(fallbackUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
        state.lastActivity = Date.now();
      }
      return;
    }

    state.lastActivity = Date.now();
    await page.evaluate(script).catch((e) =>
      log(`⚠ [load] Script re-injection failed: ${e.message.split('\n')[0]}`)
    );
  });
}

// ── Main export ───────────────────────────────────────────────

/**
 * runSupervisor — drives the Playwright page with the injected script.
 *
 * @param {object} opts
 * @param {import('playwright').BrowserContext} opts.ctx
 * @param {import('playwright').Page}           opts.mainPage
 * @param {object}   opts.site          Site config from runner/sites.js
 * @param {string}   opts.script        Assembled injection string
 * @param {number}   opts.target        Max applications this run
 * @param {boolean}  opts.live          true = real mode (bump count + log CSV)
 * @param {object}   opts.dayState      DailyState instance
 * @param {Function} opts.logApplication (job) => void
 * @param {Function} opts.log           Logging function
 */
async function runSupervisor({ ctx, mainPage, site, script, target, live, dayState, logApplication, log }) {
  const deadline = Date.now() + MAX_RUNTIME_MS;
  let searchIdx  = 0;

  // Shared mutable state passed into wirePage so the closure can update it
  const state = {
    submitted:    0,
    lastActivity: Date.now(),
    lastWasTimer: false,
    pendingJob:   null,
    // Allows wirePage's load handler to resolve the current search URL
    searchUrlFn:  () => site.searches[searchIdx] || site.searches[0],
  };

  wirePage({ page: mainPage, site, script, live, target, dayState, logApplication, log, state });

  // Handle unexpected extra tabs.
  // • New tabs on naukri.com: Naukri's Apply button sometimes opens the apply
  //   flow in a new tab (target="_blank"). Inject our script there too so the
  //   application can complete, then close it and reload main page afterward.
  // • Truly external tabs (non-naukri.com): close immediately.
  ctx.on('page', async (newPage) => {
    if (newPage === mainPage) return;
    const tabUrl = newPage.url() || '';

    if (/naukri\.com/i.test(tabUrl)) {
      // Naukri-domain tab: wait for it to fully load, then redirect to main
      log(`Naukri apply tab opened: ${tabUrl.slice(0, 80)} — redirecting to main tab`);
      await newPage.waitForLoadState('domcontentloaded').catch(() => {});
      // Navigate main page to the same Naukri URL so the script runs there
      await mainPage.goto(tabUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await newPage.close().catch(() => {});
    } else {
      log(`External tab closed: ${tabUrl.slice(0, 80)}`);
      await newPage.close().catch(() => {});
    }
  });

  // Kick off the first injection on the already-open page
  await mainPage.evaluate(script).catch((e) =>
    log(`⚠ Initial script injection failed: ${e.message.split('\n')[0]}`)
  );

  // ── Trusted-click relay (live mode only) ──────────────────────────
  // The injected script can't fire trusted (isTrusted=true) mouse events.
  // startClickRelay polls for window.__aaReadyToSubmit and fires a real CDP click.
  const clickRelay = live ? startClickRelay(mainPage, log, () => state.pendingJob) : null;

  // ── Supervisor polling loop ───────────────────────────────────────
  while (state.submitted < target && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 30_000)); // check every 30 seconds
    const remainingMins = Math.ceil((deadline - Date.now()) / 60_000);
    log(`[Supervisor] ${state.submitted}/${target} submitted | ${remainingMins}m left`);

    if (await isFinished(mainPage)) {
      // Injected script exhausted this search URL — rotate to the next one
      await mainPage.evaluate('window.__aaFinished = false').catch(() => {});
      searchIdx++;
      if (searchIdx >= site.searches.length) {
        log('All search URLs exhausted for today.');
        break;
      }
      const nextUrl = site.searches[searchIdx];
      log(`🔄 Search URL exhausted — rotating → ${nextUrl}`);
      await mainPage.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch((e) =>
        log(`⚠ [rotate] Navigation to ${nextUrl} failed: ${e.message.split('\n')[0]}`)
      );
      state.lastActivity = Date.now();
      continue;
    }

    if (await isBusy(mainPage)) continue; // injected script is still running

    const idleMs = Date.now() - state.lastActivity;
    if (idleMs > IDLE_ROTATE_MS) {
      searchIdx++;
      if (searchIdx >= site.searches.length) {
        log('All search URLs exhausted for today.');
        break;
      }
      const nextUrl = site.searches[searchIdx];
      log(`Rotating → ${nextUrl}`);
      await mainPage.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch((e) =>
        log(`⚠ [rotate] Navigation to ${nextUrl} failed: ${e.message.split('\n')[0]}`)
      );
      state.lastActivity = Date.now();
    } else {
      // Script is not busy and not idle enough to rotate → re-inject
      await mainPage.evaluate(script).catch((e) =>
        log(`⚠ [re-inject] Script evaluation failed: ${e.message.split('\n')[0]}`)
      );
    }
  }

  if (clickRelay) clickRelay.stop();

  const verb = live ? 'submitted' : 'simulated (dry run)';
  log(`Supervisor done: ${state.submitted}/${target} applications ${verb}.`);
}

module.exports = { runSupervisor };
