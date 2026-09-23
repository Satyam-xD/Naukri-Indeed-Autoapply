// ============================================================
// INDEED MAIN LOOP — orchestrates discovery, card iteration,
// applying, human delay, and pagination.
// ============================================================

var INDEED_SEEN_KEY = 'indeed_autoApply_seen_v1';

var indeedSeen = new Set(
  JSON.parse(localStorage.getItem(INDEED_SEEN_KEY) || '[]')
);

function markIndeedSeen(item) {
  if (!item) return;
  indeedSeen.add(item);
  try {
    localStorage.setItem(
      INDEED_SEEN_KEY,
      JSON.stringify(Array.from(indeedSeen).slice(-1000))
    );
  } catch (_) {}
}

function isIndeedSecurityCheck() {
  const t = (document.title + ' ' + ((document.querySelector('h1') || {}).textContent || '') + ' ' + (document.body?.innerText || '')).toLowerCase();
  return /additional verification required|verify you are human|challenge-platform|cf-challenge/i.test(t);
}

if (isIndeedSecurityCheck()) {
  log('🚨 [SECURITY CHECK] Indeed challenge detected ("Additional Verification Required")');
  log('👉 Please click the verification box in the browser window to continue!');
  if (typeof playAlertBeep === 'function') playAlertBeep();

  while (isIndeedSecurityCheck()) {
    await sleep(2000);
  }
  log('✅ Security check solved! Resuming Indeed automation...');
  await sleep(2000);
}

// ── Check if this is a full-page Indeed Apply flow ────────────
var isApplyPage = /apply\.indeed\.com|smartapply|m5\.apply|indeed\.com\/beta\/indeedapply/i.test(location.href);

// ── Check if this is a standalone viewjob page ────────────────
var isStandaloneJob = !isApplyPage && /\/viewjob/i.test(location.href);

if (isApplyPage) {
  // ── Full-page Indeed Apply Flow ──────────────────────────────
  log('📋 Full-page Indeed Apply flow: ' + location.href.slice(0, 80));

  var jkMatchApply = location.href.match(/[?&]jk=([a-zA-Z0-9_-]+)/);
  var jkApply = jkMatchApply ? jkMatchApply[1] : '';

  var rawTitleApply =
    (document.querySelector('h1, [class*="jobTitle"], [data-testid="jobTitle"]') || {}).textContent || '';
  var titleApply = cleanTitle(rawTitleApply.trim()) || 'Software Engineer';
  var companyApply = cleanCompany(
    ((document.querySelector('[data-testid="company-name"], [class*="companyName"]') || {}).textContent || '').trim()
  );

  var appliedApply = await handleIndeedApplyFlow(companyApply, titleApply);

  if (appliedApply) {
    markIndeedSeen(location.href.split('?')[0]);
    if (jkApply) markIndeedSeen(jkApply);
    await humanDelay();
  } else {
    await sleep(2000);
  }

  if (window.opener) {
    try { window.close(); } catch (_) {}
  } else {
    var lastSearchApply = sessionStorage.getItem('indeed_last_search');
    if (lastSearchApply) {
      location.href = lastSearchApply;
    } else {
      window.history.back();
    }
  }

} else if (isStandaloneJob) {
  // ── Standalone Job Detail Page ────────────────────────────────
  log('📄 Standalone job view: ' + location.href.slice(0, 80));

  var jkMatchStd = location.href.match(/jk=([a-zA-Z0-9_-]+)/);
  var jkStd = jkMatchStd ? jkMatchStd[1] : '';

  markIndeedSeen(location.href.split('?')[0]);
  if (jkStd) markIndeedSeen(jkStd);

  var rawTitleStd = ((document.querySelector('h1') || {}).textContent || '').trim();
  var titleStd = cleanTitle(rawTitleStd) || 'Software Engineer';
  var companyStd = cleanCompany(
    ((document.querySelector('[data-testid="inlineHeader-companyName"]') || {}).textContent || '').trim()
  );

  var appliedStd = await applyOnIndeedJob({
    title: titleStd,
    company: companyStd,
    link: location.href,
    titleLink: null,
    jk: jkStd,
  });

  if (appliedStd) {
    await humanDelay();
  } else {
    await sleep(2000);
  }

  try {
    window.close();
  } catch (_) {
    window.history.back();
  }

} else {
  // ── Search Results Page ───────────────────────────────────────
  sessionStorage.setItem('indeed_last_search', location.href);
  log(
    '🚀 Indeed search active | DRY_RUN=' + CONFIG.DRY_RUN +
    ' | max=' + CONFIG.MAX_APPLICATIONS +
    ' | ' + indeedSeen.size + ' seen'
  );

  // Give the page extra time for React to render job cards
  // waitForCards() inside findIndeedCards will poll up to 18s on top of this
  await sleep(2500);

  // Smooth scroll to trigger lazy-loaded cards
  for (var si = 0; si < 4; si++) {
    window.scrollBy({ top: 600, behavior: 'smooth' });
    await sleep(350);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
  await sleep(500);

  // findIndeedCards is now async (polls internally for cards to render)
  var found = await findIndeedCards(indeedSeen);
  var rawCards = found.rawCards;
  var eligible = found.eligible;

  if (eligible.length === 0) {
    log('ℹ No eligible jobs remaining on this page.');

    var nextBtnEmpty =
      document.querySelector('a[data-testid="pagination-page-next"]') ||
      document.querySelector('a[aria-label="Next Page"]') ||
      document.querySelector('a[aria-label="Next"]') ||
      document.querySelector('nav[role="navigation"] a:last-child');

    if (nextBtnEmpty && visible(nextBtnEmpty)) {
      log('➡ Navigating to next page of results...');
      nextBtnEmpty.scrollIntoView({ block: 'center' });
      await sleep(600);
      nextBtnEmpty.click();
    } else {
      log('🏁 Reached end of results for this search query.');
      window.__aaFinished = true;
    }
  } else {
    log('🎯 Processing ' + eligible.length + ' eligible jobs on this page...');

    for (var ci = 0; ci < eligible.length; ci++) {
      var card = eligible[ci];

      // Check global application cap
      if (CONFIG.MAX_APPLICATIONS > 0) {
        var submittedSoFar = window.__aaSubmittedCount || 0;
        if (submittedSoFar >= CONFIG.MAX_APPLICATIONS) {
          log('🏁 Reached max applications (' + CONFIG.MAX_APPLICATIONS + ') — stopping.');
          window.__aaFinished = true;
          break;
        }
      }

      markIndeedSeen(card.link);
      if (card.jk) markIndeedSeen(card.jk);

      var success = false;
      try {
        success = await applyOnIndeedJob(card);
      } catch (err) {
        log('⚠ Error applying for "' + card.title + '": ' + err.message);
        try { closeIndeedModal(); } catch (_) {}
      }

      if (success) {
        window.__aaSubmittedCount = (window.__aaSubmittedCount || 0) + 1;
        log('⏳ Application submitted — taking human delay...');
        await humanDelay();
      } else {
        await sleep(1800);
      }

      // Stop if we've navigated away from search results
      if (!/indeed\.com\/jobs/i.test(location.href) && !/indeed\.com\/?$/i.test(location.href)) {
        log('  ℹ Page changed during apply — stopping card loop.');
        break;
      }
    }

    // Paginate after processing all cards
    if (!window.__aaFinished) {
      var nextBtnFull =
        document.querySelector('a[data-testid="pagination-page-next"]') ||
        document.querySelector('a[aria-label="Next Page"]') ||
        document.querySelector('a[aria-label="Next"]');

      if (nextBtnFull && visible(nextBtnFull)) {
        log('➡ Proceeding to next page...');
        nextBtnFull.scrollIntoView({ block: 'center' });
        await sleep(600);
        nextBtnFull.click();
      } else {
        window.__aaFinished = true;
      }
    }
  }
}
