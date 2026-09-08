/**
 * indeed/runner/supervisor.js
 * Playwright-side orchestration loop: wires console events from the
 * injected script, detects submissions, rotates search URLs on idle,
 * and logs results to the CSV.
 */
'use strict';

const path = require('path');

const MAX_RUNTIME_MS = 100 * 60 * 1000;  // 100 minutes
const IDLE_ROTATE_MS = 3 * 60 * 1000;    // 3 minutes

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
 * startClickRelay — watches for `window.__aaReadyToSubmit` and fires trusted CDP mouse clicks.
 */
function startClickRelay(mainPage, log) {
  const id = setInterval(async () => {
    try {
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
      if (/Blocked|CORS|net::ERR/i.test(text)) return;
    }

    state.lastActivity = Date.now();

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

    if (/no Submit button|Submit button is disabled|🚫/.test(clean)) {
      const snapPath = path.join(__dirname, '..', `blocked-${Date.now()}.png`);
      page.screenshot({ path: snapPath }).catch(() => {});
      log(`  📸 Screenshot saved: ${snapPath}`);
    }

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
    const currentUrl = page.url();
    if (!site.injectOn(currentUrl)) {
      if (/^https?:\/\//i.test(currentUrl) && !/indeed\.com/i.test(currentUrl)) {
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
  const relay = startClickRelay(mainPage, log);

  // Smart Extra Tabs Handler:
  // Indeed sometimes opens smartapply or job details in a new tab.
  ctx.on('page', async (newPage) => {
    await newPage.waitForLoadState('domcontentloaded').catch(() => {});
    const url = newPage.url();

    if (/indeed\.com|smartapply/i.test(url)) {
      log(`  📑 Indeed tab opened (${url.slice(0, 60)}...) — redirecting main window...`);
      try {
        await mainPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await newPage.close().catch(() => {});
        state.lastActivity = Date.now();
        await mainPage.evaluate(script).catch(() => {});
      } catch (e) {
        log(`  ⚠ Tab redirect note: ${e.message.split('\n')[0]}`);
      }
    } else {
      log(`  🛑 External tab detected (closing): ${url.slice(0, 60)}`);
      await newPage.close().catch(() => {});
    }
  });

  const firstUrl = nextSearchUrl();
  log(`Navigating to first search URL: ${firstUrl}`);
  await mainPage.goto(firstUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await mainPage.waitForTimeout(2000);
  await mainPage.evaluate(script).catch((e) => log(`Initial eval error: ${e.message}`));

  const startTime = Date.now();

  while (state.submitted < target && Date.now() - startTime < MAX_RUNTIME_MS) {
    await mainPage.waitForTimeout(15_000);

    const busy = await isBusy(mainPage);
    const idleMs = Date.now() - state.lastActivity;

    if (!busy && idleMs > IDLE_ROTATE_MS) {
      const nextUrl = nextSearchUrl();
      log(`Idle for ${(idleMs / 1000).toFixed(0)}s — rotating to next search: ${nextUrl}`);
      state.lastActivity = Date.now();
      await mainPage.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      await mainPage.waitForTimeout(2000);
      await mainPage.evaluate(script).catch((e) => log(`Rotate eval error: ${e.message}`));
      continue;
    }

    const finished = await isFinished(mainPage);
    if (finished) {
      const nextUrl = nextSearchUrl();
      log(`Page finished all eligible jobs — advancing to next search: ${nextUrl}`);
      state.lastActivity = Date.now();
      await mainPage.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      await mainPage.waitForTimeout(2000);
      await mainPage.evaluate(script).catch((e) => log(`Next search eval error: ${e.message}`));
      continue;
    }

    if (!busy && site.injectOn(mainPage.url())) {
      await mainPage.evaluate(script).catch(() => {});
    }
  }

  relay.stop();
  log(`Supervisor finished. Submitted: ${state.submitted}/${target}`);
}

module.exports = { runSupervisor };
