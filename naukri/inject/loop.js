// ============================================================
// NAUKRI MAIN LOOP — orchestrates discovery, navigation, apply, and delays.
// ============================================================

const NAUKRI_SEEN_KEY = 'naukri_autoApply_seen_v2';  // v2 = fresh start after likelyExternal fix

// Keep last 800 seen hrefs; trim on every write so the key never bloats.
const naukriSeen = new Set(JSON.parse(localStorage.getItem(NAUKRI_SEEN_KEY) || '[]'));

function markNaukriSeen(href) {
  if (!href) return;
  naukriSeen.add(href);
  try {
    localStorage.setItem(NAUKRI_SEEN_KEY, JSON.stringify([...naukriSeen].slice(-800)));
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
    const cleanHref = j.href.split('?')[0];
    return (
      !naukriSeen.has(j.href) &&
      !naukriSeen.has(cleanHref) &&
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
    // Try Next Page button first
    const nextBtn = [...document.querySelectorAll('a, button')]
      .filter(visible)
      .find((a) =>
        /next\s*(page)?$/i.test(a.textContent.trim()) ||
        a.getAttribute('aria-label') === 'Next' ||
        a.getAttribute('title') === 'Next'
      );

    if (nextBtn) {
      log('📄 Next page →');
      nextBtn.click();
      await sleep(2500);
      return;
    }

    log('🔄 Search feed exhausted — supervisor will rotate URL');
    window.__aaFinished = true;
    return;
  }

  // ── Pick and apply to the best eligible job ───────────────────────────────
  const job = eligible[0];
  markNaukriSeen(job.href);
  markNaukriSeen(job.href.split('?')[0]);

  log(`▶ Target: "${job.title}" @ ${job.company} | ${job.expRequired || ''} | ${job.salary || ''}`);

  if (job.isExternal || job.likelyExternal) {
    // Confirmed external → skip, don't reload (we already marked seen)
    log(`  ⏭ External skip — moving on`);
    return; // supervisor will re-inject and find next eligible

  } else if (job.applyBtn && visible(job.applyBtn)) {
    // Has a card-level Apply button → Quick Apply without navigating
    log(`  📌 Quick Apply from card`);
    const ok = await applyDirectOnCard(job);
    if (ok) await humanDelay();
    // Reload so the script re-injects and picks next card
    window.location.reload();

  } else {
    // No card button (most Naukri cards) → navigate to detail page
    // apply.js will handle it there, including external early-bail
    log(`  🌐 Navigating to job page: ${job.href.slice(0, 80)}`);
    sessionStorage.setItem('naukri_last_search', location.href);
    location.href = job.href;
  }
}
