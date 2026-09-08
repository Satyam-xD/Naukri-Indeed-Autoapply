// ============================================================
// NAUKRI JOB FINDER — finds job tuples on Naukri search pages
// and filters by title, experience, and seen history.
// ============================================================

/**
 * cleanNaukriText — strips Naukri's injected rating scores and review counts.
 * e.g. "Capgemini3.656.6K Reviews" → "Capgemini"
 */
function cleanNaukriText(raw) {
  if (!raw) return '';
  return raw
    .replace(/\s*\d\.\d+/g, '')
    .replace(/\s*[\d.,]+[KkMm]?\s*Reviews?\b/gi, '')
    .replace(/\|?\s*Verified\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Title allow / block lists ─────────────────────────────────────────────────

const NAUKRI_TITLE_ALLOW = [
  /\bsoftware\b/i,
  /\bdeveloper\b/i,
  /\bengineer\b/i,
  /\bprogrammer\b/i,
  /\bfull[\s-]?stack\b/i,
  /\bfront[\s-]?end\b/i,
  /\bback[\s-]?end\b/i,
  /\bweb\s*(?:developer|engineer|dev)?\b/i,
  /\bnode(?:\.js)?\b/i,
  /\breact(?:\.js)?\b/i,
  /\bjavascript\b/i,
  /\btypescript\b/i,
  /\bpython\b/i,
  /\bgo\s*developer\b|\bgolang\b/i,
  /\bmern\b/i,
  /\bai\s*(?:engineer|developer|ml)?\b/i,
  /\bllm\b|\bgenai\b|\bgen.?ai\b/i,
  /\bintern\b/i,
  /\btrainee\b/i,
  /\bfresher\b/i,
  /\bassociate\b/i,
  /\bjr\.?\b|\bjunior\b/i,
  /\bsde[\s-]?1?\b/i,
  /\bapprentice\b/i,
];

const NAUKRI_TITLE_BLOCK = [
  /\bsenior\b|\bsr\.?\s/i,
  /\blead\s+(?:engineer|dev|developer|architect)\b|\btech\s+lead\b|\bteam\s+lead\b/i,
  /\bprincipal\b|\bstaff\s+engineer\b/i,
  /\barchitect\b(?!\s+junior|\s+associate)/i,
  /\bmanager\b|\bdirector\b|\bvp\b|\bvice\s+president\b|\bhead\s+of\b/i,
  /\bqa\s+engineer\b|\btest\s+engineer\b|\bsdet\b|\bautomation\s+tester\b/i,
  /\bdevops\b|\bsre\b|\bsysadmin\b|\bsite\s+reliability\b/i,
  /\bdata\s*(?:analyst|scientist|analytics|engineer)\b/i,
  /\bml\s+engineer\b|\bmachine\s+learning\s+engineer\b/i,
  /\bsales\b|\bmarketing\b|\bbusiness\s+analyst\b/i,
  /\bwordpress\b|\bphp\s+developer\b|\bshopify\b|\blaravel\b/i,
  /\.net\s+developer\b|\bc#\s+developer\b|\bjava\s+developer\b/i,
  /\bflutter\b|\bandroid\s+developer\b|\bios\s+developer\b/i,
  /\bsalesforce\b|\bsap\s+/i,
  /\bblockchain\b|\bsolidity\b|\bweb3\b/i,
  /\bembedded\b|\bfirmware\b|\bhardware\b/i,
];

const NAUKRI_EXP_BLOCK = [
  /\b[3-9]\s*(?:[-–]\s*[0-9]+)?\s*(?:years?|yrs?)/i,
  /\b1[0-9]\s*(?:[-–]\s*[0-9]+)?\s*(?:years?|yrs?)/i,
  /\b[3-9]\+\s*(?:years?|yrs?)/i,
];

function isNaukriTitleOk(title, snippet = '') {
  if (!title) return false;
  const t = title.trim();

  // Block senior/management/unrelated roles
  if (NAUKRI_TITLE_BLOCK.some((re) => re.test(t))) return false;

  // Block experience demands >= 3 years from snippet/exp field
  const combined = t + ' ' + snippet;
  if (NAUKRI_EXP_BLOCK.some((re) => re.test(combined))) {
    if (!/\bfresher|entry|0\s*[-–]\s*1|0\s*years/i.test(combined)) return false;
  }

  // Must match at least one allowed target role keyword
  return NAUKRI_TITLE_ALLOW.some((re) => re.test(t));
}

// ── Card discovery ────────────────────────────────────────────────────────────

const CARD_SELECTORS = [
  'div.srp-jobtuple-wrapper',
  'div.cust-job-tuple',
  'article.jobTuple',
  '[data-job-id]',
  'div[class*="styles_job-tuple" i]',
  'div[class*="jobTuple" i]',
  'article[class*="tuple" i]',
  'div[class*="job-card" i]',
  'li[class*="jobCard" i]',
  'div[class*="result" i][data-job-id]',
].join(', ');

/**
 * findNaukriJobRows — parses all job cards on the current Naukri search results page.
 * Returns an array of job objects ready for eligibility filtering in loop.js.
 */
function findNaukriJobRows() {
  const cards = [...document.querySelectorAll(CARD_SELECTORS)].filter(visible);

  const results = [];
  let debugCount = 0;

  for (const card of cards) {
    // ── Title extraction: 4 strategies in priority order ─────────────
    let titleEl =
      card.querySelector('a.title') ||
      card.querySelector('a[class*="title" i]') ||
      card.querySelector('[class*="title" i] a') ||
      card.querySelector('h2 a, h3 a') ||
      card.querySelector('a[href*="job-listings"]') ||
      card.querySelector('a[href*="/jd/"]');

    // If still no title element, try any anchor whose text looks like a job title
    if (!titleEl) {
      const anchors = [...card.querySelectorAll('a')].filter(
        (a) => a.textContent.trim().length > 4 && a.textContent.trim().length < 120
      );
      titleEl = anchors.find((a) => /engineer|developer|intern|trainee|fresher|designer|analyst/i.test(a.textContent));
    }

    if (!titleEl) {
      if (debugCount < 2) {
        log(`  ⚠ No title element in card: ${card.className?.slice(0, 60)}`);
        debugCount++;
      }
      continue;
    }

    const titleRaw = titleEl.textContent?.trim() || '';
    const title = cleanNaukriText(titleRaw);
    const href  = titleEl.href || '';
    if (!href || !title) continue;

    // ── Company ────────────────────────────────────────────────────────
    const compEl =
      card.querySelector('a.comp-name') ||
      card.querySelector('[class*="comp-name" i]') ||
      card.querySelector('a[class*="company" i]') ||
      card.querySelector('[class*="compName" i]');
    const company = cleanNaukriText(compEl?.textContent?.trim() || '');

    // ── Experience / Salary / Snippet ─────────────────────────────────
    const expEl = card.querySelector(
      'span.exp-wrap, [class*="exp-wrap" i], [class*="experience" i]'
    );
    const expRequired = expEl?.textContent?.trim() || '';

    const salEl = card.querySelector('span.sal-wrap, [class*="sal-wrap" i], [class*="salary" i]');
    const salary = salEl?.textContent?.trim() || '';

    const descEl = card.querySelector(
      'div.job-desc, [class*="job-desc" i], [class*="jobDescription" i], [class*="job-snippet" i]'
    );
    const snippet = descEl?.textContent?.trim() || '';

    // ── Apply button ───────────────────────────────────────────────────
    // Naukri's current layout often omits the apply button on search cards;
    // the detail page always has it. Not having a button ≠ external.
    const applyBtn = card.querySelector([
      'button[id*="apply" i]',
      'button[class*="apply" i]',
      '[class*="apply-button" i]',
      '[class*="applyBtn" i]',
      '[class*="apply-btn" i]',
      'a[class*="apply" i]',
      'button.apply',
      '[data-ga-label*="apply" i]',
      '[data-track*="apply" i]',
    ].join(', '));

    // ── External detection: ONLY positive signals ─────────────────────
    const cardText = card.textContent || '';
    const isExternal = (
      /apply on company site|apply via company|company site|external apply|apply externally|redirected to/i.test(cardText) ||
      !!card.querySelector('[class*="external" i], [data-applytype="external"], [class*="redirect" i]')
    );

    // likelyExternal = confirmed external only.
    // Do NOT flag for absence of apply button — Naukri omits card buttons for Easy Apply jobs too.
    const likelyExternal = isExternal;

    results.push({
      cardEl:      card,
      titleEl,
      applyBtn,
      title,
      company,
      expRequired,
      salary,
      href,
      snippet,
      cardText,
      isExternal,
      likelyExternal,
    });
  }

  return results;
}
