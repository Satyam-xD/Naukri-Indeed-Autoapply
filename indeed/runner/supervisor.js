/**
 * indeed/runner/supervisor.js
 * Playwright-side orchestration loop: wires console events from the
 * injected script, detects submissions, rotates search URLs on idle,
 * and logs results to the CSV.
 */
'use strict';

const path            = require('path');
const qaManager       = require('../../shared/runner/qa-manager');
const { getBestResume } = require('../../shared/runner/resume-selector');

const MAX_RUNTIME_MS = 100 * 60 * 1000;  // 100 minutes
const IDLE_ROTATE_MS = 5 * 60 * 1000;    // 5 minutes (accounts for 18s card-wait in finder)

const isBusy     = (p) => p.evaluate('!!window.__aaBusy').catch(() => false);
const isFinished = (p) => p.evaluate('!!window.__aaFinished').catch(() => false);

/**
 * scrapeJobDetails — evaluates in-page to scrape JD, salary, company, and
 * experience requirement from the currently-open Indeed job details view.
 */
async function scrapeJobDetails(page, job) {
  const d = await page.evaluate(() => {
    const q        = (sel) => document.querySelector(sel)?.textContent?.trim() || '';
    const bodyText = document.body.innerText || '';
    const expMatch = bodyText.match(
      /\b(fresher|entry.?level|[0-9]+\s*[-–]?\s*[0-9]*\s*\+?\s*(?:years?|yrs?)(?:\s*(?:of\s*)?exp(?:erience)?)?)/i
    );
    return {
      company: q('[data-testid="inlineHeader-companyName"]')
             || q('[data-testid="company-name"]')
             || q('.jobsearch-CompanyInfoContainer')
             || '',
      salary: (bodyText.match(
        /(?:₹|\$)\s?[\d,.]+(?:\s?[-–]\s?(?:₹|\$)?[\d,.]+)?[^\n]{0,30}/
      ) || [''])[0],
      expRequired: expMatch ? expMatch[0].replace(/\s+/g, ' ').trim() : '',
      jd: (
        q('#jobDescriptionText') ||
        q('[class*="jobDescription" i]') ||
        q('.jobsearch-JobComponent-description')
      ).slice(0, 1200),
    };
  }).catch(() => null);

  if (!d) return;
  if (d.company)     job.company     = job.company     || d.company;
  if (d.salary)      job.salary      = job.salary      || d.salary;
  if (d.expRequired) job.expRequired = job.expRequired || d.expRequired;
  if (d.jd)          job.jd          = d.jd;
}

/**
 * tryAutoSolveCloudflare — detects Cloudflare Turnstile verification and attempts to click it via CDP.
 */
async function tryAutoSolveCloudflare(page, log) {
  try {
    const hasChallenge = await page.evaluate(() => {
      const t = (document.title + ' ' + (document.body?.innerText || '')).toLowerCase();
      return /additional verification required|verify you are human|challenge-platform|cf-challenge/i.test(t) ||
        !!document.querySelector('iframe[src*="cloudflare"], iframe[src*="challenges"], #turnstile-wrapper');
    }).catch(() => false);

    if (!hasChallenge) return false;

    for (const frame of page.frames()) {
      if (/challenges\.cloudflare\.com|turnstile/i.test(frame.url())) {
        const cb = frame.locator('input[type="checkbox"], div[role="checkbox"], #challenge-stage, .ctp-checkbox-container').first();
        if (await cb.isVisible({ timeout: 1000 }).catch(() => false)) {
          const box = await cb.boundingBox().catch(() => null);
          if (box) {
            log('  🤖 Cloudflare Turnstile detected — attempting auto-click...');
            const tx = box.x + box.width / 2;
            const ty = box.y + box.height / 2;
            await page.mouse.move(tx - 30, ty - 20, { steps: 5 });
            await new Promise((r) => setTimeout(r, 100));
            if (page.isClosed()) return false;
            await page.mouse.move(tx, ty, { steps: 3 });
            await new Promise((r) => setTimeout(r, 150));
            if (page.isClosed()) return false;
            await page.mouse.click(tx, ty);
            log('  ✅ Sent trusted CDP click to Turnstile checkbox');
            await new Promise((r) => setTimeout(r, 2000));
            return true;
          }
        }
      }
    }

    const wrapper = page.locator('iframe[src*="challenges.cloudflare"], iframe[src*="turnstile"], #turnstile-wrapper').first();
    if (await wrapper.isVisible({ timeout: 1000 }).catch(() => false)) {
      const box = await wrapper.boundingBox().catch(() => null);
      if (box && box.width > 20 && box.height > 20) {
        log('  🤖 Cloudflare widget detected — sending CDP coordinate click...');
        const tx = box.x + 28;
        const ty = box.y + Math.min(box.height / 2, 32);
        await page.mouse.move(tx - 25, ty - 15, { steps: 4 });
        await new Promise((r) => setTimeout(r, 120));
        if (page.isClosed()) return false;
        await page.mouse.move(tx, ty, { steps: 3 });
        await new Promise((r) => setTimeout(r, 150));
        if (page.isClosed()) return false;
        await page.mouse.click(tx, ty);
        log('  ✅ Clicked Cloudflare checkbox coordinate');
        await new Promise((r) => setTimeout(r, 2000));
        return true;
      }
    }
  } catch (_) {}
  return false;
}

/**
 * startClickRelay — watches for `window.__aaReadyToSubmit` and fires trusted CDP mouse clicks.
 */
function startClickRelay(mainPage, log, getJob) {
  let tick = 0;
  const id = setInterval(async () => {
    try {
      if (!mainPage || mainPage.isClosed()) {
        clearInterval(id);
        return;
      }
      tick++;
      if (tick % 6 === 0) {
        await tryAutoSolveCloudflare(mainPage, log).catch(() => {});
      }



      const signal = await mainPage.evaluate(() => {
        const s = window.__aaReadyToSubmit;
        if (!s || typeof s !== 'object' || !s.x) return null;
        return { x: Number(s.x), y: Number(s.y), label: String(s.label || '') };
      }).catch(() => null);
      if (!signal) return;

      await mainPage.evaluate('window.__aaReadyToSubmit = false').catch(() => {});
      log(`  🖱 Supervisor clicking at (${signal.x}, ${signal.y}) — "${signal.label || '?'}"`);

      let clicked = false;
      try {
        await mainPage.mouse.move(signal.x, signal.y);
        await mainPage.mouse.click(signal.x, signal.y);
        log('  ✅ Trusted mouse.click() sent via CDP');
        clicked = true;
      } catch (coordErr) {
        log(`  ⚠ Coordinate click failed: ${coordErr.message.split('\n')[0]}`);
      }

      if (!clicked) {
        try {
          const btnRE = new RegExp(`^${(signal.label || 'apply').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
          const btn   = mainPage.getByRole('button', { name: btnRE }).last();
          if (await btn.count() > 0 && await btn.isVisible().catch(() => false)) {
            await btn.click({ timeout: 5000, force: false });
            log(`  ✅ Trusted click via getByRole("button", "${signal.label}")`);
          }
        } catch (_) {}
      }
    } catch (_) {}
  }, 350);

  return { stop: () => clearInterval(id) };
}

function wirePage(page, { script, state, site, live, target, dayState, logApplication, log }) {
  page.on('console', (msg) => {
    const text  = msg.text();
    const clean = text.replace(/^\[auto-apply\]\s*/, '');

    if (!text.startsWith('[auto-apply]')) {
      // ── Silence Indeed's own page noise ──────────────────────────
      if (
        // Network / security errors from Indeed's own scripts
        /Blocked|CORS|net::ERR|ERR_ABORTED|ERR_BLOCKED/i.test(text) ||
        // Apollo GraphQL client internal warnings
        /apollo|ApolloClient|invariant|go\.apollo\.dev/i.test(text) ||
        // React/webpack module federation errors
        /react-dom|__webpack_require__|bootstrap:|container-entry|sharedDeps|homepageRemoteEntry|mosaic-provider/i.test(text) ||
        // CSP policy violations from Indeed's ad/analytics scripts
        /Content Security Policy|violates the following|script-src|img-src|default-src/i.test(text) ||
        // Preload resource warnings
        /was preloaded using link preload but not used/i.test(text) ||
        // Deprecated library warnings
        /\[DEPRECATED\]|Default export is deprecated/i.test(text) ||
        // DoubleClick / ad tracking
        /doubleclick\.net|scorecardresearch|tvpixel|optimizely/i.test(text) ||
        // Google Analytics / measurement
        /google\.com\/measurement|google-analytics|ga-audiences/i.test(text) ||
        // OneTrust cookie banner
        /OneTrust|otSDKStub/i.test(text) ||
        // Browser feature / device detection noise
        /getDeviceModel|Touch (End|Bank|Start)|Cannot record touch/i.test(text) ||
        // zustand / state management deprecation
        /zustand|create.*from/i.test(text) ||
        // Unsatisfied module version warnings
        /Unsatisfied version|singleton module|shared singleton/i.test(text) ||
        // DevTools download prompts
        /Download the Apollo DevTools|chrome\.google\.com\/webstore/i.test(text) ||
        // Indeed smart-apply asset preload noise
        /smart-apply|indeedapply.*preload|formVendor|applyRemoteEntry|i18n.*min\.js|applyForm/i.test(text) ||
        // Generic font/asset preload
        /IndeedSans|\.woff2.*preload|\.css.*preload/i.test(text) ||
        // Fetch API blocked by CSP
        /Fetch API cannot load/i.test(text) ||
        // Module loading errors from Indeed's own micro-frontend
        /Unable to load mosaic-provider|assertProviderIsLazy|isLazy/i.test(text) ||
        // postMessage origin mismatch from embedded widgets / Google sign-in
        /Failed to execute 'postMessage'|target origin provided/i.test(text)
      ) {
        return;
      }
    }

    state.lastActivity = Date.now();

    if (text.includes('[auto-apply-pause]')) {
      try {
        const jsonStr = text.slice(text.indexOf('[auto-apply-pause]') + '[auto-apply-pause]'.length).trim();
        const data = JSON.parse(jsonStr);
        if (data.question) {
          qaManager.recordQA({ question: data.question, answer: '', status: 'unanswered', source: 'unknown' });
        }
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

    if (/⏳ \[Timer\] Next application in: \d+s/.test(clean)) {
      const sec = clean.match(/in: (\d+)s/)?.[1] || '';
      process.stdout.write(`\r[${new Date().toLocaleTimeString('en-IN')}] [indeed]   ⏳ Next application in: ${sec.padStart(2)}s  `);
      state.lastWasTimer = true;
      return;
    }

    if (state.lastWasTimer) {
      process.stdout.write('\n');
      state.lastWasTimer = false;
    }

    log('  ' + clean.slice(0, 200));


    // Capture job when applying begins
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

      setTimeout(() => {
        if (!state.pendingJob) return;
        scrapeJobDetails(page, state.pendingJob).catch(() => {});
      }, 2500);
    }

    // Detect submission confirmation
    if (/✅ (?:application sent|Applied to)|DRY_RUN — would click/i.test(text)) {
      state.submitted++;
      if (live) dayState.bump();
      log(`==> ${state.submitted}/${target} this run (${dayState.count}/${dayState.cap} today)`);

      const jobRef   = state.pendingJob || { title: 'unknown' };
      const jobToLog = { ...jobRef };
      state.pendingJob = null;

      setTimeout(() => {
        jobToLog.company     = jobToLog.company     || jobRef.company;
        jobToLog.salary      = jobToLog.salary      || jobRef.salary;
        jobToLog.expRequired = jobToLog.expRequired || jobRef.expRequired;
        jobToLog.jd          = jobToLog.jd          || jobRef.jd;

        try { logApplication(jobToLog); }
        catch (e) { log('CSV write failed: ' + e.message); }
      }, 3000);
    }
  });

  page.on('load', async () => {
    if (page.isClosed()) return;
    const currentUrl = page.url();
    if (!site.injectOn(currentUrl)) {
      // Only redirect away if it's a truly external (non-Indeed) domain
      const isIndeedDomain = /indeed\.com|smartapply/i.test(currentUrl);
      if (/^https?:\/\//i.test(currentUrl) && !isIndeedDomain) {
        const fallbackUrl = state.searchUrlFn ? state.searchUrlFn() : site.searches[0];
        log(`⚠ External redirect detected (${currentUrl.slice(0, 60)}...) — returning to search`);
        if (!page.isClosed()) {
          await page.goto(fallbackUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
        }
        state.lastActivity = Date.now();
      }
      return;
    }

    state.lastActivity = Date.now();
    if (!page.isClosed()) {
      await page.evaluate(script).catch((e) => {
        if (!page.isClosed()) {
          log(`⚠ [load] Script re-injection failed: ${e.message.split('\n')[0]}`);
        }
      });
    }
  });
}

/**
 * runSupervisor — drives the Playwright page with the injected script.
 */
async function runSupervisor({
  ctx,
  mainPage,
  site,
  script,
  target,
  live,
  dayState,
  logApplication,
  log,
}) {
  let searchIndex = 0;
  const nextSearchUrl = () => {
    const url = site.searches[searchIndex % site.searches.length];
    searchIndex++;
    return url;
  };

  const state = {
    submitted:    0,
    lastActivity: Date.now(),
    lastWasTimer: false,
    pendingJob:   null,
    searchUrlFn:  nextSearchUrl,
  };

  wirePage(mainPage, { script, state, site, live, target, dayState, logApplication, log });
  const relay = startClickRelay(mainPage, log, () => state.pendingJob);

  // Smart Extra Tabs Handler:
  // Indeed opens the apply flow in a new tab (smartapply.indeed.com or beta/indeedapply).
  // We process the application directly inside the new tab using our injected script.
  // Once the application completes (or is cancelled), the tab closes, and the main
  // search page seamlessly proceeds to the next job card without reloading.
  ctx.on('page', async (newPage) => {
    try {
      if (newPage === mainPage || newPage.isClosed()) return;

      if (newPage.url() === 'about:blank') {
        await newPage.waitForURL((u) => u.toString() !== 'about:blank', { timeout: 12_000 }).catch(() => {});
      }
      if (newPage.isClosed()) return;
      await newPage.waitForLoadState('domcontentloaded').catch(() => {});
      if (newPage.isClosed()) return;
      const url = newPage.url();

      const isIndeedApplyTab = /smartapply|apply\.indeed|indeed\.com\/beta\/indeedapply|m5\.apply/i.test(url);
      const isIndeedViewJob = /indeed\.com\/viewjob/i.test(url);

      if (isIndeedApplyTab || isIndeedViewJob) {
        log(`  📑 Indeed apply tab opened (${url.slice(0, 70)}...) — processing in tab...`);
        if (!mainPage.isClosed()) {
          await mainPage.evaluate('window.__aaTabInFlight = true').catch(() => {});
        }

        wirePage(newPage, { script, state, site, live, target, dayState, logApplication, log });
        const tabRelay = startClickRelay(newPage, log, () => state.pendingJob);

        try {
          if (!newPage.isClosed()) {
            await newPage.evaluate(script).catch((e) => {
              if (!newPage.isClosed()) {
                log(`  ⚠ Tab injection note: ${e.message.split('\n')[0]}`);
              }
            });
          }

          // Wait until the tab finishes applying or closes or times out (up to 90s)
          const tabStart = Date.now();
          while (!newPage.isClosed() && Date.now() - tabStart < 90_000) {
            const isTabFinished = await newPage.evaluate('!!window.__aaFinished || !window.__aaBusy').catch(() => true);
            if (isTabFinished && Date.now() - tabStart > 4000) break;
            await new Promise((r) => setTimeout(r, 1500));
          }
        } finally {
          tabRelay.stop();
          if (!newPage.isClosed()) {
            await newPage.close().catch(() => {});
          }
          log(`  📑 Indeed apply tab finished. Returning to search.`);
          if (!mainPage.isClosed()) {
            await mainPage.evaluate('window.__aaTabInFlight = false; window.__aaTabCompleted = true').catch(() => {});
          }
        }
      } else {
        log(`  🛑 External tab detected (closing): ${url.slice(0, 60)}`);
        if (!newPage.isClosed()) {
          await newPage.close().catch(() => {});
        }
      }
    } catch (err) {
      if (!newPage.isClosed()) {
        log(`  ⚠ Tab handler error: ${err.message.split('\n')[0]}`);
        try { await newPage.close(); } catch (_) {}
      }
      if (!mainPage.isClosed()) {
        await mainPage.evaluate('window.__aaTabInFlight = false; window.__aaTabCompleted = true').catch(() => {});
      }
    }
  });

  const firstUrl = nextSearchUrl();
  log(`Navigating to first search URL: ${firstUrl}`);
  await mainPage.goto(firstUrl, { waitUntil: 'load', timeout: 60_000 });
  await new Promise((r) => setTimeout(r, 4000));
  if (!mainPage.isClosed()) {
    await mainPage.evaluate(script).catch((e) => log(`Initial eval error: ${e.message}`));
  }

  const startTime = Date.now();

  while (state.submitted < target && Date.now() - startTime < MAX_RUNTIME_MS) {
    if (mainPage.isClosed() || (ctx.pages && ctx.pages().length === 0)) {
      log('Main page or browser window was closed — ending supervisor loop.');
      break;
    }

    await new Promise((r) => setTimeout(r, 15_000));

    if (mainPage.isClosed()) {
      log('Browser window was closed — ending supervisor loop.');
      break;
    }

    const busy = await isBusy(mainPage);
    const idleMs = Date.now() - state.lastActivity;

    if (!busy && idleMs > IDLE_ROTATE_MS) {
      const nextUrl = nextSearchUrl();
      log(`Idle for ${(idleMs / 1000).toFixed(0)}s — rotating to next search: ${nextUrl}`);
      state.lastActivity = Date.now();
      await mainPage.goto(nextUrl, { waitUntil: 'load', timeout: 60_000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 3000));
      if (!mainPage.isClosed()) {
        await mainPage.evaluate(script).catch((e) => log(`Rotate eval error: ${e.message}`));
      }
      continue;
    }

    const finished = await isFinished(mainPage);
    if (finished) {
      const nextUrl = nextSearchUrl();
      log(`Page finished all eligible jobs — advancing to next search: ${nextUrl}`);
      state.lastActivity = Date.now();
      await mainPage.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 2000));
      if (!mainPage.isClosed()) {
        await mainPage.evaluate(script).catch((e) => log(`Next search eval error: ${e.message}`));
      }
      continue;
    }

    if (!busy && !mainPage.isClosed() && site.injectOn(mainPage.url())) {
      await mainPage.evaluate(script).catch(() => {});
    }
  }

  relay.stop();
  log(`Supervisor finished. Submitted: ${state.submitted}/${target}`);
}

module.exports = { runSupervisor };
