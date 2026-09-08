// ============================================================
// MAIN APPLICATION LOOP — orchestrates job discovery → apply → delay.
// This is the last file concatenated into the IIFE, so it can use
// everything defined in utils, gemini, answers, apply, and finder.
// ============================================================

// Search URLs iterated when the current page runs out of matching jobs.
// The runner also rotates these externally on idle, but in-script rotation
// handles the case where the SPA router is available.
const SEARCH_PAGES = [
  // ── Entry-level / 0-experience specific (yoe=0 = Wellfound "0 years" filter) ──
  '/jobs?roleSlugs[]=software-engineer&yoe=0',
  '/jobs?roleSlugs[]=full-stack-developer&yoe=0',
  '/jobs?roleSlugs[]=frontend-developer&yoe=0',
  '/jobs?roleSlugs[]=backend-developer&yoe=0',
  '/jobs?roleSlugs[]=ai-engineer&yoe=0',
  '/jobs?roleSlugs[]=javascript-developer&yoe=0',
  '/jobs?roleSlugs[]=react-developer&yoe=0',
  '/jobs?roleSlugs[]=nodejs-developer&yoe=0',
  '/jobs?remote=true&roleSlugs[]=software-engineer&yoe=0',
  '/jobs?locationSlugs[]=india&roleSlugs[]=software-engineer&yoe=0',
  '/jobs?locationSlugs[]=bangalore-karnataka-india&roleSlugs[]=software-engineer&yoe=0',
  '/jobs?locationSlugs[]=delhi-india&roleSlugs[]=software-engineer&yoe=0',
  '/jobs?locationSlugs[]=hyderabad-telangana-india&roleSlugs[]=software-engineer&yoe=0',
  '/jobs?locationSlugs[]=pune-maharashtra-india&roleSlugs[]=software-engineer&yoe=0',
  '/jobs?locationSlugs[]=noida-uttar-pradesh-india&roleSlugs[]=software-engineer&yoe=0',
  '/jobs?remote=true&locationSlugs[]=india&yoe=0',
  // ── Broader fallback (no yoe filter) in case yoe=0 yields too few cards ──
  '/jobs?roleSlugs[]=software-engineer',
  '/jobs?roleSlugs[]=full-stack-developer',
  '/jobs?roleSlugs[]=frontend-developer',
  '/jobs?roleSlugs[]=backend-developer',
  '/jobs?roleSlugs[]=ai-engineer',
  '/jobs?roleSlugs[]=react-developer',
  '/jobs?roleSlugs[]=nodejs-developer',
  '/jobs?remote=true&roleSlugs[]=software-engineer',
  '/jobs?locationSlugs[]=india&roleSlugs[]=software-engineer',
  '/jobs?remote=true&locationSlugs[]=india',
];

// Start from the index BEFORE the current page so that goToNextSearchPage()
// (which always increments first) lands on the correct next URL.
// If we're already on a search page, we stay within it before moving on.
const _currentIdx = SEARCH_PAGES.findIndex((p) => location.pathname + location.search === p);
let searchIdx = _currentIdx >= 0 ? _currentIdx - 1 : -1;

/**
 * goToNextSearchPage — moves to the next search URL via the SPA router.
 * Returns true if navigation was initiated, false if all pages exhausted.
 */
async function goToNextSearchPage() {
  searchIdx++;
  if (searchIdx >= SEARCH_PAGES.length) return false;
  const url = SEARCH_PAGES[searchIdx];
  log(`🌐 Moving to next search page: ${url}`);
  if (window.next?.router?.push) {
    window.next.router.push(url);
    await sleep(2000); // let new cards render
    window.scrollTo(0, 400);
    return true;
  }
  // SPA router unavailable → full page load (script will be re-injected by runner)
  log('⚠ SPA router not available — full page load. Runner will re-inject the script.');
  location.href = 'https://wellfound.com' + url;
  return false;
}

// ── Seen-jobs set: persisted in localStorage so re-injections don't re-apply ──
const SEEN_KEY = 'wf_autoApply_seen_v3';
const seen = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'));
function markSeen(href) {
  seen.add(href);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-500)));
  } catch (e) { log(`⚠ localStorage quota exceeded — seen-jobs list will not persist: ${e.message.split('\n')[0]}`); }
}

// ── Company dedup: avoid applying to the same company multiple times in one session ──
const COMPANY_SEEN_KEY = 'wf_autoApply_companies_v1';
const seenCompanies = new Set(JSON.parse(sessionStorage.getItem(COMPANY_SEEN_KEY) || '[]'));
function markCompanySeen(company) {
  if (!company) return;
  const key = company.toLowerCase().trim();
  seenCompanies.add(key);
  try {
    sessionStorage.setItem(COMPANY_SEEN_KEY, JSON.stringify([...seenCompanies]));
  } catch (_) {}
}

// ── Main loop ───────────────────────────────────────────────
let applied = 0;
log(`🚀 Starting. DRY_RUN=${CONFIG.DRY_RUN} | max=${CONFIG.MAX_APPLICATIONS} | ${seen.size} jobs seen | ${seenCompanies.size} companies recorded`);
log('Keep this tab focused. Do not navigate away.');
await sleep(1500); // let the feed finish rendering on initial load

while (applied < CONFIG.MAX_APPLICATIONS) {
  const allRows = findJobRows();
  const jobs    = allRows.filter((j) => {
    if (seen.has(j.href)) return false;
    if (j.company && seenCompanies.has(j.company.toLowerCase().trim())) return false;
    return titleOk(j.title, j.rowText);
  });

  if (!jobs.length) {
    // Breakdown of why cards were skipped
    let expBlocked = 0, titleBlocked = 0, alreadySeen = 0, companyDuplicate = 0;
    for (const r of allRows) {
      if (seen.has(r.href)) { alreadySeen++; continue; }
      if (r.company && seenCompanies.has(r.company.toLowerCase().trim())) { companyDuplicate++; continue; }
      if (!titleOk(r.title, r.rowText)) {
        if (EXP_DEMAND_RE.test(r.rowText) && !FRESHER_ALLOW_RE.test(r.rowText)) expBlocked++;
        else titleBlocked++;
        // Debug: log first few blocked titles so we can tune the filter
        if (titleBlocked <= 3) log(`  🚫 title-blocked: "${r.title}"`);
      }
    }
    log(`(feed: ${allRows.length} cards | ${alreadySeen} seen, ${expBlocked} exp-blocked, ${titleBlocked} title-filtered, ${companyDuplicate} same-company)`);

    // Try a "Load more" / "Show more" button first
    const moreBtn = findButtonByText(document, /load more|show more/i);
    if (moreBtn) { moreBtn.click(); await sleep(1500); continue; }

    // Smart infinite scroll: stop early if 2 consecutive scrolls yield no new cards
    let grew = false;
    let consecutiveNoGrowth = 0;
    let prevCount = allRows.length;
    for (let s = 0; s < 6 && !grew; s++) {
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(1000);
      const curRows = findJobRows();
      if (curRows.length <= prevCount) {
        consecutiveNoGrowth++;
        if (consecutiveNoGrowth >= 2) break; // page has no more cards
      } else {
        consecutiveNoGrowth = 0;
        prevCount = curRows.length;
      }
      grew = curRows.some((j) =>
        !seen.has(j.href) &&
        (!j.company || !seenCompanies.has(j.company.toLowerCase().trim())) &&
        titleOk(j.title, j.rowText)
      );
    }
    if (grew) continue;

    // Page exhausted → move to next search URL
    if (await goToNextSearchPage()) continue;
    log('✅ All search pages exhausted — done for this run.');
    window.__aaFinished = true;
    break;
  }

  // ── Process the highest-priority matching job ───────────────
  const job = jobs[0];
  markSeen(job.href);
  // Extract experience requirement from the card text before clicking
  const expRequired = (() => {
    const m = (job.cardText || job.rowText || '').match(/\b(fresher|entry.?level|[0-9]+\s*[-–]?\s*[0-9]*\s*\+?\s*(?:years?|yrs?)(?:\s*(?:of\s*)?exp(?:erience)?)?)/i);
    return m ? m[0].replace(/\s+/g, ' ').trim() : '';
  })();
  log(`▶ Applying: ${job.title} @ ${job.company || '?'} | ${job.href} | ${job.salary || ''} | ${expRequired}`);

  // Per-job try/catch: a single bad modal or DOM error must NOT kill the whole session.
  let ok = false;
  try {
    // Scroll the card into view before clicking
    job.linkEl.scrollIntoView({ block: 'center' });
    await sleep(300);

    // Prefer the card's Apply button — opens the form directly
    const clickTarget = job.applyBtn || job.linkEl;
    if (clickTarget.target === '_blank') clickTarget.setAttribute('target', '_self');
    clickTarget.click();
    await waitFor(() => findApplyPanel(), 2500, 200);
    await sleep(300);

    const companyName = getCompany() || job.company || '';
    ok = await fillAndSubmit(companyName, job.title);
    if (ok && companyName) {
      markCompanySeen(companyName);
    }
  } catch (jobErr) {
    log(`⚠ Unexpected error on "${job.title}": ${jobErr.message} — skipping to next job`);
    // Try to dismiss any stuck modal before continuing
    try { closeModal(document.querySelector('[role="dialog"]')); } catch (e) {
      log(`⚠ Could not close stuck modal: ${e.message.split('\n')[0]}`);
    }
  }

  if (ok) {
    applied++;
    log(`progress: ${applied}/${CONFIG.MAX_APPLICATIONS}`);
  }

  // Close the overlay before trying the next card
  closeModal(document.querySelector('[role="dialog"]'));
  await sleep(300);

  // Kill any lingering modal backdrops so they don't block future card clicks
  document.querySelectorAll('[role="dialog"], [class*="modal" i]').forEach((m) => {
    if (visible(m) && !/apply to/i.test(m.textContent)) {
      try { m.style.display = 'none'; } catch (_) { /* cosmetic — ignore */ }
    }
  });
  await sleep(200);

  // Wait between applications; short pause in dry-run / failed apply
  if (ok && !CONFIG.DRY_RUN) {
    await humanDelay();
  } else {
    await sleep(800);
  }
}

if (applied >= CONFIG.MAX_APPLICATIONS || searchIdx >= SEARCH_PAGES.length) {
  window.__aaFinished = true;
}

log(
  CONFIG.DRY_RUN
    ? `🏁 DRY RUN complete — ${applied} applications simulated. Set --live to apply for real.`
    : `🏁 Finished — applied to ${applied} jobs this run.`
);
