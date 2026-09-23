// ============================================================
// INDEED FINDER — scans Indeed search results, filters cards,
// and yields eligible jobs with "Easily Apply" / Indeed Apply.
// ============================================================

// ── Block: truly senior / irrelevant roles only ────────────────────────────
const INDEED_TITLE_BLOCK_RE = /\b(senior|sr\.?\s|lead\s|principal|staff\s|director|head\s(?:of)?|vp\b|vice\s*president|architect|manager|consultant|expert|verification\s*engineer|captcha)\b/i;

// ── Allow: any tech/dev/engineer role at any level ─────────────────────────
const INDEED_TITLE_ALLOW_RE = /\b(software|developer|engineer|programmer|fresher|trainee|intern|junior|jr\.?|associate|web|frontend|front.?end|backend|back.?end|full.?stack|fullstack|react|node|javascript|typescript|python|golang|java|ai|ml|data|devops|sde|swe|technology|application|tech|mobile|android|ios|cloud|api|database|ui|ux|qa|test|automation)\b/i;

// ── Exp block: only skip if 5+ years explicitly required ───────────────────
const INDEED_EXP_BLOCK_RE = /\b([5-9]|\d{2,})\+?\s*(?:to\s*\d+\s*)?(?:years?|yrs?)\s*(?:of\s*)?(?:exp(?:erience)?|work(?:ing)?)\b/i;

function isSeniorOrOverqualified(title = '', snippet = '') {
  const normTitle = title.replace(/[_/\\-]/g, ' ');
  if (INDEED_TITLE_BLOCK_RE.test(normTitle)) return true;
  if (INDEED_EXP_BLOCK_RE.test(snippet)) return true;
  return false;
}

/**
 * waitForCards — polls the DOM until at least one job card selector
 * matches (meaning React has rendered), or times out after maxMs.
 * Returns the first matching selector string, or null on timeout.
 */
async function waitForCards(maxMs, interval) {
  maxMs = maxMs || 18000;
  interval = interval || 700;

  const CARD_PROBES = [
    'div.job_seen_beacon',
    'td.resultContent',
    'div.cardOutline',
    'li[data-jk]',
    'div[data-jk]',
    'a[data-jk]',
    '#mosaic-provider-jobcards li',
    'ul#mosaic-provider-jobcards li',
    '[class*="JobCard"]',
    '[class*="jobCard"]',
    '[class*="ResultCard"]',
    '[data-testid="jobCard"]',
    'li:has(h2 a[data-jk])',
    'li:has(h2)',
  ];

  const start = Date.now();
  while (Date.now() - start < maxMs) {
    for (var i = 0; i < CARD_PROBES.length; i++) {
      var sel = CARD_PROBES[i];
      try {
        if (document.querySelectorAll(sel).length > 0) return sel;
      } catch (_) {}
    }
    await sleep(interval);
  }
  return null;
}

/**
 * getCardElements — returns job card elements using the first selector
 * that yields results, from a prioritized list.
 */
function getCardElements() {
  var SELECTORS = [
    'div.job_seen_beacon',
    'td.resultContent',
    'div.cardOutline',
    '#mosaic-provider-jobcards li',
    'ul#mosaic-provider-jobcards li',
    'li[data-jk]',
    'div[data-jk]',
    '[data-testid="jobCard"]',
    'li:has(h2 a[data-jk])',
    'li:has(h2)',
  ];

  for (var i = 0; i < SELECTORS.length; i++) {
    var sel = SELECTORS[i];
    try {
      var els = Array.from(document.querySelectorAll(sel));
      if (els.length > 0) {
        return { els: els, selector: sel };
      }
    } catch (_) {}
  }

  return { els: [], selector: null };
}

function parseIndeedCard(card, seenHrefs) {
  // Title anchor — try many selectors for different Indeed layouts
  var titleLink =
    card.querySelector('h2.jobTitle a[data-jk]') ||
    card.querySelector('h2.jobTitle a') ||
    card.querySelector('h2 a[data-jk]') ||
    card.querySelector('h2 a') ||
    card.querySelector('a[data-jk]') ||
    card.querySelector('a[id^="job_"]') ||
    card.querySelector('a[class*="jcs-JobTitle"]') ||
    card.querySelector('a[class*="JobTitle"]');

  if (!titleLink) return null;

  var rawTitle = (titleLink.textContent || '').trim();
  var title = cleanTitle(rawTitle);
  if (!title || title.length < 3) return null;

  // Job key
  var jk =
    card.getAttribute('data-jk') ||
    titleLink.getAttribute('data-jk') ||
    ((titleLink.href || '').match(/jk=([a-zA-Z0-9_-]+)/) || [])[1] || '';

  var jobUrl = jk
    ? 'https://in.indeed.com/viewjob?jk=' + jk
    : (titleLink.href || '').split('&')[0];
  if (!jobUrl) return null;

  // Company
  var compEl =
    card.querySelector('[data-testid="company-name"]') ||
    card.querySelector('span[class*="companyName"]') ||
    card.querySelector('[class*="company"]') ||
    card.querySelector('.company_location');
  var company = cleanCompany(compEl ? (compEl.textContent || '').trim() : '');

  // Location
  var locEl =
    card.querySelector('[data-testid="text-location"]') ||
    card.querySelector('.companyLocation') ||
    card.querySelector('[class*="location"]');
  var locationText = locEl ? (locEl.textContent || '').trim() : '';

  // Salary
  var salEl =
    card.querySelector('[data-testid="attribute_snippet_testid"]') ||
    card.querySelector('.salary-snippet-container') ||
    card.querySelector('[class*="salary"]') ||
    card.querySelector('[class*="Salary"]');
  var salary = salEl ? (salEl.textContent || '').trim() : '';

  var fullCardText = card.innerText || '';

  // "Easily apply" detection
  var hasEasilyApply = !!(
    card.querySelector('span.iaIcon') ||
    card.querySelector('[data-testid="indeedApply"]') ||
    card.querySelector('[data-indeed-apply="true"]') ||
    card.querySelector('[class*="indeedApply"]') ||
    card.querySelector('[class*="EasyApply"]') ||
    card.querySelector('[class*="easyApply"]') ||
    /easily apply|apply with your indeed resume|indeed apply/i.test(fullCardText)
  );

  var isExternal = !hasEasilyApply && !!(
    /\bapply on company site\b/i.test(fullCardText) ||
    card.querySelector('[data-indeed-apply="false"]')
  );

  var seen = seenHrefs.has(jobUrl) || (jk && seenHrefs.has(jk));
  var overqualified = isSeniorOrOverqualified(title, fullCardText);
  var titleAllowed = INDEED_TITLE_ALLOW_RE.test(title);

  return {
    el: card,
    titleLink: titleLink,
    jk: jk,
    title: title,
    company: company,
    salary: salary,
    location: locationText,
    link: jobUrl,
    hasEasilyApply: hasEasilyApply,
    isExternal: isExternal,
    seen: seen,
    overqualified: overqualified,
    titleAllowed: titleAllowed,
  };
}

async function findIndeedCards(seenHrefs) {
  // Poll until React renders the cards (up to 18 seconds)
  var matchedSel = await waitForCards(18000, 700);
  if (!matchedSel) {
    log('  ⚠ No job cards found after 18s — page may be empty, blocked, or layout changed.');
  }

  var result = getCardElements();
  var cardElements = result.els;
  var usedSelector = result.selector;

  // De-duplicate nested elements
  var seenNodes = new Set();
  var rawCards = [];

  for (var i = 0; i < cardElements.length; i++) {
    var el = cardElements[i];

    // Normalize to the outermost sensible container
    var beacon =
      el.closest('div.job_seen_beacon') ||
      el.closest('div[data-jk]') ||
      el.closest('li[data-jk]') ||
      el.closest('[data-testid="jobCard"]') ||
      el;

    if (seenNodes.has(beacon)) continue;
    seenNodes.add(beacon);

    var parsed = parseIndeedCard(beacon, seenHrefs);
    if (parsed) rawCards.push(parsed);
  }

  var seenCount     = rawCards.filter(function(c) { return c.seen; }).length;
  var externalCount = rawCards.filter(function(c) { return c.isExternal; }).length;
  var overqualCount = rawCards.filter(function(c) { return c.overqualified && !c.seen; }).length;
  var noTitle       = rawCards.filter(function(c) { return !c.titleAllowed && !c.seen; }).length;

  var eligible = rawCards.filter(function(c) {
    if (c.seen) return false;
    if (c.isExternal) return false;
    if (c.overqualified) return false;
    // titleAllowed is advisory only — don't block unfamiliar-but-valid titles
    return true;
  });


  log(
    '  📊 Found ' + rawCards.length + ' cards (via "' + (usedSelector || 'none') + '") | ' +
    seenCount + ' seen | ' + externalCount + ' external | ' +
    overqualCount + ' overqualified | ' + noTitle + ' title-blocked | ' +
    eligible.length + ' eligible'
  );

  return { rawCards: rawCards, eligible: eligible };
}
