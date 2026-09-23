// ============================================================
// NAUKRI MAIN LOOP — orchestrates discovery, navigation, apply, and delays.
// ============================================================

// v3 = timestamped entries with 7-day expiry
const NAUKRI_SEEN_KEY = 'naukri_autoApply_seen_v3';
const SEVEN_DAYS_MS   = 7 * 24 * 60 * 60 * 1000;

// Load and prune entries older than 7 days
const _nowTs = Date.now();
const _rawSeen = (() => {
  try { return JSON.parse(localStorage.getItem(NAUKRI_SEEN_KEY) || '[]'); }
  catch (_) { return []; }
})();
// Support both old plain-string format and new [href, ts] format
const naukriSeenMap = new Map(
  (Array.isArray(_rawSeen) ? _rawSeen : [])
    .filter((e) => Array.isArray(e) ? (_nowTs - e[1] < SEVEN_DAYS_MS) : true)
    .map((e)   => Array.isArray(e) ? e : [e, _nowTs])
);
const naukriSeen = new Set(naukriSeenMap.keys());

/**
 * Extract a stable dedup key from a Naukri job URL.
 * Strips query params and prefers the numeric job ID from the slug.
 */
function naukriJobKey(href) {
  if (!href) return href;
  const clean = href.split('?')[0].split('#')[0];
  // e.g. /job-listings-software-engineer-company-123456789012
  const m = clean.match(/-([0-9]{8,12})$/);
  return m ? 'nk_' + m[1] : clean;
}

function markNaukriSeen(href) {
  if (!href) return;
  const key = naukriJobKey(href);
  naukriSeen.add(key);
  naukriSeen.add(href)          // also mark full href for backwards compat
  naukriSeenMap.set(key, Date.now());
  try {
    localStorage.setItem(
      NAUKRI_SEEN_KEY,
      JSON.stringify([...naukriSeenMap.entries()].slice(-800))
    );
  } catch (_) {}
}

function returnToSearchPage() {
  const lastSearch = sessionStorage.getItem('naukri_last_search');
  if (lastSearch && location.href !== lastSearch) {
    log(`🔙 Returning to search: ${lastSearch.slice(0, 80)}`);
    location.href = lastSearch;
  } else if (window.history.length > 1) {
    log('🔙 history.back() to search results');
    window.history.back();
  }
}

// ── Page-type check ───────────────────────────────────────────────────────────
const isJobPage = /job-listings|job-overview|\/jd\//i.test(location.href);

if (isJobPage) {
  // ══════════════════════════════════════════════════════════════
  // BRANCH A: JOB DETAILS PAGE
  // ══════════════════════════════════════════════════════════════
  log(`📄 Job page: ${location.href.slice(0, 80)}`);
  markNaukriSeen(location.href.split('?')[0]);

  let appliedOk = false;
  try {
    appliedOk = await applyOnJobDetailsPage();
  } catch (err) {
    log(`⚠ Error on job page: ${err.message}`);
    closeNaukriModal();
  }

  if (appliedOk) {
    log('⏳ Applied — taking human delay before next...');
    await humanDelay();
  } else {
    await sleep(1000);
  }

  returnToSearchPage();

} else {
  // ══════════════════════════════════════════════════════════════
  // BRANCH B: SEARCH RESULTS PAGE
  // ══════════════════════════════════════════════════════════════
  sessionStorage.setItem('naukri_last_search', location.href);
  log(`🚀 Naukri feed | DRY_RUN=${CONFIG.DRY_RUN} | max=${CONFIG.MAX_APPLICATIONS} | ${naukriSeen.size} seen`);

  // ── Sidebar filter activation ─────────────────────────────────────────────
  // Key includes base URL only (no page number) so we re-run on each search URL,
  // but NOT on every page within the same search.
  const FILTER_KEY = 'naukri_filters_v3_' + location.href.replace(/[&?]pageNo=\d+/, '').split('&').slice(0, 2).join('&');

  if (!sessionStorage.getItem(FILTER_KEY)) {
    sessionStorage.setItem(FILTER_KEY, '1');

    // Wait for sidebar to appear
    const sidebarReady = await waitFor(
      () => document.querySelector('[class*="filter" i], [class*="leftSide" i], aside, [class*="srp-filter" i]'),
      5000, 400
    );
    if (sidebarReady) await sleep(600);

    log('🎛  Activating sidebar filters...');
    let anyActivated = false;

    // Fast path: click a checkbox by its exact known DOM id
    function clickById(id, label) {
      const cb = document.getElementById(id);
      if (!cb) return null;
      if (cb.checked) return `[already set] ${label}`;
      try { cb.click(); return label; } catch (_) { return null; }
    }

    // Generic: walk visible text nodes to find a filter label and click it
    function activateFilter(nameRe, label) {
      const candidates = [...document.querySelectorAll('label, span, div, li, a, button')]
        .filter((el) => {
          if (!visible(el)) return false;
          const t = el.textContent?.trim() || '';
          return nameRe.test(t) && t.length < 80 && el.children.length <= 3;
        });

      for (const el of candidates) {
        // label[for=…]
        const forId = el.getAttribute('for');
        if (forId) {
          const cb = document.getElementById(forId);
          if (cb?.type === 'checkbox') {
            if (cb.checked) return `[already set] ${label}`;
            cb.click(); return label;
          }
        }
        // inner <input type="checkbox">
        const inner = el.querySelector('input[type="checkbox"]');
        if (inner) {
          if (inner.checked) return `[already set] ${label}`;
          inner.click(); return label;
        }
        // ARIA checkbox
        const aria = el.closest('[role="checkbox"], [role="option"]') || el;
        if (aria.getAttribute('aria-checked') === 'true') return `[already set] ${label}`;
        // Styled div fallback
        try { el.click(); return label; } catch (_) {}
      }
      return null;
    }

    // ── Filter 1: Easy Apply ─────────────────────────────────────────────────
    // Try the exact IDs Naukri uses (discovered via DOM dump)
    {
      let r =
        clickById('chk-Easy Apply-applyType-', 'Easy Apply') ||
        clickById('chk-EasyApply-applyType-', 'Easy Apply') ||
        clickById('chk-easy apply-applyType-', 'Easy Apply');

      if (!r) {
        // Attribute/text fallbacks
        for (const sel of [
          'input[id*="easyApply" i]', 'input[id*="quickApply" i]',
          'input[value*="easy" i][type="checkbox"]', 'label[for*="easyApply" i]',
          '[class*="easyApply" i] input[type="checkbox"]', '[data-label*="easy apply" i]',
        ]) {
          try {
            const el = document.querySelector(sel);
            if (el && visible(el)) {
              if (el.tagName === 'INPUT' && el.type === 'checkbox') {
                if (!el.checked) { el.click(); r = sel; break; }
                else { r = '[already set] Easy Apply'; break; }
              } else { el.click(); r = sel; break; }
            }
          } catch (_) {}
        }
      }
      if (!r) r = activateFilter(/^(?:easy\s*apply|quick\s*apply)$/i, 'Easy Apply');

      if (r) {
        const was = r.startsWith('[already set]');
        log(`  ${was ? '☑' : '✅'} Easy Apply: ${r}`);
        if (!was) { anyActivated = true; await sleep(400); }
      } else {
        log('  ℹ Easy Apply: not in sidebar — URL applyRedirect=false handles it');
      }
    }

    // ── Filter 2: Department = Engineering - Software & QA ───────────────────
    // Exact ID confirmed from live DOM dump 2026-09-09
    {
      const r =
        clickById('chk-Engineering - Software & QA-functionAreaIdGid-', 'Dept: Eng/SW/QA') ||
        activateFilter(/^engineering\s*[-–]\s*software\s*(&|and)\s*qa$/i, 'Dept: Eng/SW/QA');
      if (r) {
        const was = r.startsWith('[already set]');
        log(`  ${was ? '☑' : '✅'} Department: ${r}`);
        if (!was) { anyActivated = true; await sleep(400); }
      }
    }

    // ── Filter 3: Experience — SKIP sidebar, URL has experience=0 already ────
    // Clicking the sidebar filter ON TOP of the URL param causes 0 results.
    log('  ☑ Experience: handled by URL (?experience=0 / fresher path)');

    // ── Filter 4: WFH — only for remote-intent search URLs ──────────────────
    if (/remote|wfh|work.from.home/i.test(location.href)) {
      const r = activateFilter(/^(?:work\s*from\s*home|wfh|remote|hybrid\s*\/?remote)$/i, 'WFH/Remote');
      if (r) {
        const was = r.startsWith('[already set]');
        log(`  ${was ? '☑' : '✅'} WFH: ${r}`);
        if (!was) { anyActivated = true; await sleep(300); }
      }
    }

    // ── Filter 5: Posted Date = Last 7 days ─────────────────────────────────
    {
      const r = activateFilter(/^(?:last\s*7\s*days?|past\s*week|7\s*days?)$/i, 'Posted: Last 7 days');
      if (r) {
        const was = r.startsWith('[already set]');
        log(`  ${was ? '☑' : '✅'} Freshness: ${r}`);
        if (!was) { anyActivated = true; await sleep(300); }
      }
    }

    if (anyActivated) {
      log('⏳ Filters activated — waiting for page reload...');
      await sleep(3500);
    } else {
      log('🎛  Filters already set / unavailable — proceeding');
    }
  }

  // ── Scan for cards ────────────────────────────────────────────────────────
  await waitFor(() => findNaukriJobRows().length > 0, 7000, 500);

  const isEligible = (j) => {
    const key = naukriJobKey(j.href);
    return (
      !naukriSeen.has(key) &&
      !naukriSeen.has(j.href) &&
      !naukriSeen.has(j.href.split('?')[0]) &&
      !j.likelyExternal &&
      isNaukriTitleOk(j.title, j.snippet)
    );
  };

  let cards    = findNaukriJobRows();
  let eligible = cards.filter(isEligible);

  // Stats for debugging
  const extCnt     = cards.filter((j) => j.isExternal).length;
  const likelyExt  = cards.filter((j) => j.likelyExternal && !j.isExternal).length;
  const seenCnt    = cards.filter((j) => naukriSeen.has(j.href) || naukriSeen.has(j.href.split('?')[0])).length;
  const noBtnCnt   = cards.filter((j) => !j.applyBtn).length;
  log(`  📊 ${cards.length} cards | ${seenCnt} seen | ${extCnt} ext | ${likelyExt} likely-ext | ${noBtnCnt} no-btn | ${eligible.length} eligible`);

  // Debug: show first 3 card titles so we can see what Naukri returned
  if (cards.length > 0 && eligible.length === 0) {
    cards.slice(0, 5).forEach((c) => {
      const why = !isNaukriTitleOk(c.title, c.snippet) ? 'title-blocked' :
                  c.likelyExternal ? 'external' :
                  (naukriSeen.has(c.href) || naukriSeen.has(c.href.split('?')[0])) ? 'seen' : 'ok';
      log(`    📌 "${c.title}" @ ${c.company} [${why}]`);
    });
  }

  // ── Scroll to load more if no eligible cards yet ──────────────────────────
  if (!eligible.length && cards.length > 0) {
    let prev = cards.length;
    let gotNew = false;
    for (let s = 0; s < 4 && !gotNew; s++) {
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(1200);
      const cur = findNaukriJobRows();
      if (cur.length > prev) {
        if (cur.filter(isEligible).length > 0) gotNew = true;
        prev = cur.length;
      }
    }
    if (gotNew) {
      cards    = findNaukriJobRows();
      eligible = cards.filter(isEligible);
    }
  }

  // ── Paginate or rotate URL ────────────────────────────────────────────────
  if (!eligible.length) {
    // Try Next Page button first — use a wide set of selectors
    const nextBtn = (
      document.querySelector('a[aria-label="Next"], button[aria-label="Next"]') ||
      document.querySelector('[class*="pagination"] a:last-child') ||
      document.querySelector('[class*="pagination-next" i]') ||
      [...document.querySelectorAll('a, button')]
        .filter(visible)
        .find((a) =>
          /^\s*next\s*(page)?\s*$/i.test(a.textContent.trim()) ||
          a.getAttribute('title') === 'Next'
        )
    );

    if (nextBtn && visible(nextBtn)) {
      log('📄 Next page →');
      nextBtn.scrollIntoView({ block: 'center' });
      await sleep(400);
      nextBtn.click();
      await sleep(2500);
      return;
    }

    log('🔄 Search feed exhausted — supervisor will rotate URL');
    window.__aaFinished = true;
    return;
  }

  // ── Pick and apply to eligible jobs ──────────────────────────────────────
  // Separate cards into two buckets:
  //   A) Cards with a direct Apply button  — can batch in one cycle
  //   B) Cards without a button            — must navigate to job page
  const btnCards    = eligible.filter((j) => !j.isExternal && !j.likelyExternal && j.applyBtn && visible(j.applyBtn));
  const noBtn       = eligible.filter((j) => !j.isExternal && !j.likelyExternal && !(j.applyBtn && visible(j.applyBtn)));
  const skipList    = eligible.filter((j) => j.isExternal || j.likelyExternal);

  // Log skips
  for (const j of skipList) {
    markNaukriSeen(j.href);
    log(`  ⏭ Ext skip — ${j.title} @ ${j.company}`);
  }

  if (btnCards.length > 0) {
    // ── BATCH: apply to all button-cards in one inject cycle ──────────────────────
    log(`📊 Processing ${btnCards.length} quick-apply card(s) + ${noBtn.length} page-nav card(s)`);
    let batchApplied = 0;

    for (const job of btnCards) {
      markNaukriSeen(job.href);
      log(`▶ [${batchApplied + 1}] Quick Apply: "${job.title}" @ ${job.company} | ${job.salary || ''}`);

      const ok = await applyDirectOnCard(job);
      if (ok) {
        batchApplied++;
        await humanDelay();
      } else {
        await sleep(800);
      }

      // Safety: check we haven't navigated away from a search page
      if (!/naukri\.com/.test(location.href)) break;
    }

    log(`✔ Batch done: ${batchApplied}/${btnCards.length} applied via card buttons`);
    window.location.reload();

  } else if (noBtn.length > 0) {
    // ── NAVIGATE: go to job detail page for first no-button card ────────────────
    const job = noBtn[0];
    markNaukriSeen(job.href);

    log(`▶ Target: "${job.title}" @ ${job.company} | ${job.expRequired || ''} | ${job.salary || ''}`);
    log(`  🌐 Navigating to job page: ${job.href.slice(0, 80)}`);
    sessionStorage.setItem('naukri_last_search', location.href);
    location.href = job.href;
  }
}
