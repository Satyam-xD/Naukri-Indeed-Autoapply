// ============================================================
// INDEED FINDER — scans Indeed search results, filters cards,
// and yields eligible jobs.
// ============================================================

const INDEED_TITLE_BLOCK_RE = /\b(senior|sr\.?|lead|principal|staff|director|head|vp|vice president|architect|manager|consultant|specialist|expert)\b/i;

const INDEED_TITLE_ALLOW_RE = /\b(software|developer|engineer|programmer|fresher|trainee|intern|junior|jr\.?|associate|web|frontend|front-end|backend|back-end|full-?stack|fullstack|react|node|javascript|typescript|python|golang|java|ai|ml)\b/i;

const INDEED_EXP_BLOCK_RE = /\b([3-9]|\d{2,})\+?\s*(?:to\s*\d+\s*)?(?:years?|yrs?)\b/i;

function isSeniorOrOverqualified(title = '', snippet = '') {
  if (INDEED_TITLE_BLOCK_RE.test(title)) return true;
  if (INDEED_EXP_BLOCK_RE.test(snippet)) return true;
  return false;
}

function parseIndeedCard(card, seenHrefs) {
  // Title anchor
  const titleLink =
    card.querySelector('h2.jobTitle a') ||
    card.querySelector('a[data-jk]') ||
    card.querySelector('a[id^="job_"]') ||
    card.querySelector('a[class*="jcs-JobTitle"]');

  if (!titleLink) return null;

  const rawTitle = titleLink.textContent?.trim() || '';
  const title = cleanTitle(rawTitle);
  if (!title || title.length < 3) return null;

  // Job link & Key (data-jk)
  const jk = card.getAttribute('data-jk') ||
             titleLink.getAttribute('data-jk') ||
             (titleLink.href.match(/jk=([a-zA-Z0-9_-]+)/) || [])[1] || '';

  const jobUrl = jk ? `https://in.indeed.com/viewjob?jk=${jk}` : (titleLink.href || '').split('&')[0];
  if (!jobUrl) return null;

  // Company
  const compEl =
    card.querySelector('[data-testid="company-name"]') ||
    card.querySelector('span[class*="companyName"]') ||
    card.querySelector('.company_location [class*="company"]');
  const company = cleanCompany(compEl?.textContent?.trim() || '');

  // Location
  const locEl =
    card.querySelector('[data-testid="text-location"]') ||
    card.querySelector('.companyLocation');
  const locationText = locEl?.textContent?.trim() || '';

  // Salary
  const salEl =
    card.querySelector('[data-testid="attribute_snippet_testid"]') ||
    card.querySelector('.salary-snippet-container') ||
    card.querySelector('.metadata.salary-snippet-container');
  const salary = salEl?.textContent?.trim() || '';

  const fullCardText = card.innerText || '';

  // Easily apply check
  const hasEasilyApply = !!(
    card.querySelector('span.iaIcon') ||
    card.querySelector('[data-testid="indeedApply"]') ||
    /easily apply|apply with your indeed resume/i.test(fullCardText)
  );

  const isExternal = !!(
    /apply on company site/i.test(fullCardText) ||
    card.querySelector('a[data-indeed-apply="false"]')
  );

  const seen = seenHrefs.has(jobUrl) || (jk && seenHrefs.has(jk));
  const overqualified = isSeniorOrOverqualified(title, fullCardText);
  const titleAllowed = INDEED_TITLE_ALLOW_RE.test(title);

  return {
    el: card,
    titleLink,
    jk,
    title,
    company,
    salary,
    location: locationText,
    link: jobUrl,
    hasEasilyApply,
    isExternal,
    seen,
    overqualified,
    titleAllowed,
  };
}

function findIndeedCards(seenHrefs) {
  const cardElements = [
    ...document.querySelectorAll(
      'div.job_seen_beacon, td.resultContent, div.cardOutline, div[data-testid="jobCard"], li:has(h2.jobTitle)'
    )
  ];

  // De-duplicate if nested
  const seenNodes = new Set();
  const rawCards = [];

  for (const el of cardElements) {
    const parentBeacon = el.closest('div.job_seen_beacon') || el;
    if (seenNodes.has(parentBeacon)) continue;
    seenNodes.add(parentBeacon);

    const parsed = parseIndeedCard(parentBeacon, seenHrefs);
    if (parsed) rawCards.push(parsed);
  }

  const eligible = rawCards.filter((c) => {
    if (c.seen) return false;
    if (c.isExternal) return false;
    if (c.overqualified) return false;
    if (!c.titleAllowed) return false;
    return true;
  });

  log(`  📊 Found ${rawCards.length} cards | ${rawCards.filter(c => c.seen).length} seen | ${rawCards.filter(c => c.isExternal).length} external | ${eligible.length} eligible`);

  return { rawCards, eligible };
}
