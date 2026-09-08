// ============================================================
// INDEED MAIN LOOP — orchestrates discovery, card iteration,
// applying, human delay, and pagination.
// ============================================================

const INDEED_SEEN_KEY = 'indeed_autoApply_seen_v1';

const indeedSeen = new Set(JSON.parse(localStorage.getItem(INDEED_SEEN_KEY) || '[]'));

function markIndeedSeen(item) {
  if (!item) return;
  indeedSeen.add(item);
  try {
    localStorage.setItem(INDEED_SEEN_KEY, JSON.stringify([...indeedSeen].slice(-1000)));
  } catch (_) {}
}

const isStandaloneJob = /\/viewjob/i.test(location.href);

if (isStandaloneJob) {
  // ── Standalone Job Page ───────────────────────────────────────
  log(`📄 Standalone job view: ${location.href.slice(0, 80)}`);
  markIndeedSeen(location.href.split('?')[0]);
  const jkMatch = location.href.match(/jk=([a-zA-Z0-9_-]+)/);
  if (jkMatch) markIndeedSeen(jkMatch[1]);

  const rawTitle = document.querySelector('h1')?.textContent?.trim() || '';
  const title = cleanTitle(rawTitle) || 'Software Engineer';
  const company = cleanCompany(document.querySelector('[data-testid="inlineHeader-companyName"]')?.textContent?.trim() || '');

  const applied = await applyOnIndeedJob({
    title,
    company,
    link: location.href,
    titleLink: null,
  });

  if (applied) {
    await humanDelay();
  } else {
    await sleep(2000);
  }

  const lastSearch = sessionStorage.getItem('indeed_last_search');
  if (lastSearch) {
    location.href = lastSearch;
  } else {
    window.history.back();
  }

} else {
  // ── Search Results Page ───────────────────────────────────────
  sessionStorage.setItem('indeed_last_search', location.href);
  log(`🚀 Indeed search active | DRY_RUN=${CONFIG.DRY_RUN} | max=${CONFIG.MAX_APPLICATIONS} | ${indeedSeen.size} seen`);

  // Settle page
  await sleep(1500);

  // Smooth scroll down to load cards
  for (let i = 0; i < 3; i++) {
    window.scrollBy({ top: 500, behavior: 'smooth' });
    await sleep(400);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
  await sleep(600);

  const { rawCards, eligible } = findIndeedCards(indeedSeen);

  if (eligible.length === 0) {
    log('ℹ No eligible jobs remaining on this page.');

    // Look for next page button
    const nextBtn =
      document.querySelector('a[data-testid="pagination-page-next"]') ||
      document.querySelector('a[aria-label="Next Page"]') ||
      document.querySelector('a[aria-label="Next"]');

    if (nextBtn && visible(nextBtn)) {
      log('➡ Navigating to next page of results...');
      nextBtn.scrollIntoView({ block: 'center' });
      await sleep(500);
      nextBtn.click();
    } else {
      log('🏁 Reached end of results for this search query.');
      window.__aaFinished = true;
    }
  } else {
    log(`🎯 Processing ${eligible.length} eligible jobs on this page...`);

    for (const card of eligible) {
      markIndeedSeen(card.link);
      if (card.jk) markIndeedSeen(card.jk);

      let success = false;
      try {
        success = await applyOnIndeedJob(card);
      } catch (err) {
        log(`⚠ Error applying for "${card.title}": ${err.message}`);
        closeIndeedModal();
      }

      if (success) {
        log('⏳ Application submitted — taking human delay...');
        await humanDelay();
      } else {
        await sleep(1500);
      }
    }

    // After processing, check for next page
    const nextBtn =
      document.querySelector('a[data-testid="pagination-page-next"]') ||
      document.querySelector('a[aria-label="Next Page"]') ||
      document.querySelector('a[aria-label="Next"]');

    if (nextBtn && visible(nextBtn)) {
      log('➡ Proceeding to next page...');
      nextBtn.scrollIntoView({ block: 'center' });
      await sleep(500);
      nextBtn.click();
    } else {
      window.__aaFinished = true;
    }
  }
}
