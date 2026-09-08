// ============================================================
// JOB FINDER — discovers matching job cards on the Wellfound feed.
// Requires: visible, cleanTitle, CONFIG (injected config object)
// ============================================================

/** Job titles we actively target (Satyam's actual tech stack). */
const TITLE_KEYWORDS = [
  // Entry-level markers
  'fresher', 'entry level', 'entry-level', 'junior', 'trainee', 'associate', 'intern',
  // Full Stack / MERN
  'full stack', 'fullstack', 'full-stack', 'mern',
  // Frontend
  'frontend', 'front end', 'front-end', 'react', 'next.js', 'nextjs', 'vue',
  // Backend
  'backend', 'back end', 'back-end', 'node.js', 'node js', 'express', 'api developer',
  // AI / GenAI / LLM
  'ai engineer', 'ai developer', 'genai', 'gen ai', 'llm', 'ai full stack',
  // Languages & Frameworks
  'javascript', 'typescript', 'python', 'golang', 'go developer', 'go engineer',
  // General Software Engineering
  'software engineer', 'software developer', 'web developer', 'web engineer',
  'sde', 'sde-1', 'sde 1', 'sde i',
  // Broad catch — must come last (caught only after blocklist check)
  'developer', 'engineer',
];

/**
 * Titles that indicate seniority or an unrelated domain — skip these.
 * Each entry is matched as a word-boundary regex, not a plain substring,
 * to prevent false positives like 'lead' blocking 'lead developer',
 * or 'qa' blocking 'qa automation engineer' when user knows automation.
 */
const TITLE_BLOCKLIST_RE = [
  // Seniority / leadership — must be standalone words
  /\bsenior\b|\bsr\.?\s/i,
  /\bstaff\s+engineer\b|\bprincipal\b/i,
  /\bdirector\b|\bmanager\b|\bvp\b|\bvice\s+president\b/i,
  /\blead\s+(?:engineer|developer|architect|dev)\b|\btech\s+lead\b|\bteam\s+lead\b/i,
  /\bhead\s+of\b/i,
  // Infrastructure / platform / ops — these need precise matching
  /\barchitect\b(?!\s+junior|\s+associate)/i,
  /\bfounding\s+engineer\b/i,
  /\bdevops\b|\bsre\b|\bsite\s+reliability\b|\bdevsecops\b/i,
  /\binfrastructure\s+engineer\b|\bplatform\s+engineer\b/i,
  /\bcloud\s+engineer\b|\bnetwork\s+engineer\b|\bsystems\s+engineer\b/i,
  /\bsecurity\s+engineer\b|\bcybersecurity\b/i,
  // Data / ML (allow AI Engineer / GenAI, block pure data/ML titles)
  /\bdata\s+engineer\b|\bdata\s+scientist\b|\bdata\s+analyst\b/i,
  /\bbusiness\s+intelligence\b|\bmlops\b/i,
  /\bml\s+engineer\b|\bmachine\s+learning\s+engineer\b|\bdeep\s+learning\b/i,
  // QA / Testing
  /\bqa\s+engineer\b|\btest\s+engineer\b|\bsdet\b|\bautomation\s+tester\b/i,
  /\bquality\s+assurance\b/i,
  // Design / Product
  /\bux\s+designer\b|\bui\/ux\b|\bproduct\s+designer\b|\bgraphic\s+design\b/i,
  /\bproduct\s+manager\b/i,
  // Business / Non-tech
  /\bsales\s+(?:engineer|manager|executive)\b|\bmarketing\b|\bgrowth\s+hacker\b/i,
  /\bcustomer\s+success\b|\bcustomer\s+support\b|\bbusiness\s+development\b/i,
  /\bteacher\b|\btrainer\b|\btutor\b|\binstructor\b|\bcoach\b/i,
  /\be-?commerce\s+(?:manager|developer)\b/i,
  /\bsalesforce\b|\bsap\s+/i,
  // Hardware / specialized stacks we don't use
  /\.net\s+developer\b|\bc#\s+developer\b|\bphp\s+developer\b/i,
  /\bruby\s+(?:on\s+rails|developer)\b/i,
  /\bflutter\s+developer\b|\bandroid\s+(?:native|developer)\b|\bios\s+developer\b/i,
  /\bembedded\b|\bfirmware\b|\bhardware\b|\bmechanical\b|\belectrical\b/i,
  /\bblockchain\b|\bsolidity\b|\bweb3\b/i,
  /\bdba\b|\bdatabase\s+administrator\b/i,
  /\blaravel\b|\bwordpress\b|\bshopify\b|\bmagento\b/i,
  /\bforward\s+deployed\b/i,
];

const ALREADY_APPLIED_RE = /^applied$/i;

/** Compiled once at module load — used by titleOk() for every card scanned. */
const FRESHER_ALLOW_RE = /\b(?:fresher|entry[\s-]?level|0\s*(?:years?|yrs?)|less\s+than\s+1\s*(?:year|yr)|no\s+(?:prior\s+)?exp(?:erience)?)\b/i;
const EXP_DEMAND_RE    = /(?:minimum\s+|at\s+least\s+)?([2-9]|[1-9]\d)\s*\+?\s*(?:years?|yrs?)(?:\s*(?:of\s*)?(?:exp(?:erience)?)?)?/i;

/**
 * titleOk — returns true if the job matches our tech stack and experience level.
 *
 * @param {string} rawTitle   The raw job title text from the anchor.
 * @param {string} jobRowText The text of THIS job's immediate row (narrow context).
 *                            Must NOT be the full company card text — see findJobRows.
 */
function titleOk(rawTitle, jobRowText = '') {
  const clean = cleanTitle(rawTitle);
  const lower = clean.toLowerCase();

  // 1. Block senior or unrelated roles — use regex word-boundary matching
  //    to avoid false positives like 'lead' blocking 'lead developer'
  if (TITLE_BLOCKLIST_RE.some((re) => re.test(clean))) return false;

  // 2. Skip roles that explicitly require 2+ years of experience.
  //    We use jobRowText (narrow row context) to avoid false positives from company blurbs.
  //    Patterns blocked: "2+ years", "3 years exp", "minimum 2 years",
  //    "at least 2 years", "2-4 years", "5 years", etc.
  //    "1+ years" and "1 year" are intentionally ALLOWED — Wellfound uses these
  //    to label entry-level / fresher roles (0–1 yr band), not mid-level roles.
  const rowLower = jobRowText.toLowerCase();
  // If the row explicitly signals fresher/0-year, never block (guards against
  // rows like "0 years of experience required" tripping the digit regex).
  if (!FRESHER_ALLOW_RE.test(rowLower) && EXP_DEMAND_RE.test(rowLower)) return false;

  // 3. Must match at least one target keyword in the cleaned title
  return TITLE_KEYWORDS.some((k) => lower.includes(k));
}

/**
 * findJobRows — scrapes job cards from the current Wellfound feed page.
 * Returns an array of job objects: { href, title, company, salary, linkEl, rowText }.
 *
 * Guards:
 *  - Redirects to /jobs feed if we're on an individual job page.
 *  - Skips "Applied" cards.
 *  - Skips jobs posted > 14 days ago.
 *  - Only includes anchors whose href matches the /jobs/<id>-slug pattern.
 */
function findJobRows() {
  // If the SPA routed us to a single job page, bounce back to the feed
  if (location.pathname.startsWith('/jobs/') && location.pathname !== '/jobs') {
    log('⚠ On individual job page — bouncing back to feed...');
    if (window.next?.router?.push) window.next.router.push('/jobs');
    else location.href = 'https://wellfound.com/jobs';
    return [];
  }

  const rows = [];

  for (const anchor of document.querySelectorAll('a[href*="/jobs/"]')) {
    const href = anchor.getAttribute('href') || '';
    if (!/\/jobs\/\d/.test(href)) continue;          // must have numeric ID
    if (!visible(anchor)) continue;
    if (anchor.textContent.trim().length < 4) continue;

    // ── Company-level card (used for badge/date/company-name detection) ──
    let card = anchor.closest('[data-test="StartupResult"]') ||
               anchor.closest('[class*="StartupResult" i]') ||
               anchor.closest('[class*="result" i]');

    if (!card) {
      card = anchor.closest('div');
      for (let i = 0; i < 4 && card && card.textContent.trim().length < 60; i++) {
        card = card.parentElement;
      }
      card = card || anchor.parentElement;
    }

    // ── Job-row element: the narrowest ancestor that contains THIS job's metadata ──
    // Walk up from the anchor until we find a container that includes salary/exp tags
    // but is still much smaller than the full company card.
    let jobRow = anchor.parentElement;
    for (let i = 0; i < 6 && jobRow && jobRow !== card; i++) {
      const t = jobRow.textContent || '';
      // Stop as soon as this element contains salary, years, or job-type info
      if (/(?:₹|\$|€|years?|yrs?|remote|full.?time|part.?time|contract|internship)/i.test(t)) break;
      jobRow = jobRow.parentElement;
    }
    // Fallback: use the card itself but cap at 600 chars to avoid company blurbs
    const jobRowText = (jobRow && jobRow !== card)
      ? (jobRow.textContent || '')
      : (card.textContent || '').slice(0, 600);

    // Skip "Applied" cards
    const badges = [...card.querySelectorAll('button, span, div')]
      .map((el) => el.textContent.trim());
    if (badges.some((t) => ALREADY_APPLIED_RE.test(t))) continue;

    // Skip stale listings (> 30 days old).
    // The yoe=0 / role URL filters already narrow the pool significantly,
    // so we can afford to be generous on recency to find more eligible jobs.
    const cardText = card.textContent;
    const posted = cardText.match(/posted (?:about )?(\d+)\+? ?(hour|day|week|month)s? ago/i);
    if (posted) {
      const n = +posted[1];
      const unit = posted[2].toLowerCase();
      const days = unit === 'hour' ? 0 : unit === 'day' ? n : unit === 'week' ? n * 7 : n * 30;
      if (days > 30) continue;
    }

    // Company name: find heading or logo within THIS startup card only
    const companyRaw = (
      card.querySelector('h2, [class*="startupName" i], a[href^="/company/"]')?.textContent?.trim() ||
      card.querySelector('img[alt]')?.alt ||
      ''
    );
    const company = cleanCompany(companyRaw);

    // Job title: prefer dedicated title element over full anchor text (which includes location/salary noise)
    const titleEl =
      anchor.querySelector('h3, h4, [class*="jobTitle" i], [class*="JobTitle" i]') ||
      card.querySelector('h3, h4, [class*="jobTitle" i], [class*="JobTitle" i]');
    const titleRaw = titleEl?.textContent?.trim() || anchor.textContent;
    const title = cleanTitle(titleRaw);

    // Apply button on the card — preferred click target over the title link
    const applyBtn = findCardApplyButton(card);

    // Salary: grab the first currency match from the job row text (more accurate)
    const salary = (
      (jobRowText + card.textContent).match(/(?:₹|\$|€)\s?[\d.,k]+\s?(?:[–-]\s?(?:₹|\$|€)?\s?[\d.,k]+)?k?/i) || ['']
    )[0].trim();

    // Priority score: favor fresher, junior, AI, and fullstack roles with visible salary
    let score = 0;
    const lowerTitle = title.toLowerCase();
    if (/fresher|entry|intern|junior|associate/i.test(lowerTitle)) score += 25;
    if (/ai|genai|full stack|mern|react|node/i.test(lowerTitle)) score += 15;
    if (salary) score += 10;
    if (/today|yesterday|hour|\b1 day|\b2 days|\b3 days/i.test(cardText)) score += 10;

    rows.push({
      href:       (anchor.href || '').split('?')[0],
      title,
      company,
      salary,
      linkEl:     anchor,
      applyBtn,
      card,
      score,
      rowText:    jobRowText,   // narrow row text — used for exp filtering in titleOk()
      cardText:   card.textContent, // full card text — used for loop.js exp scrape
    });
  }

  // Sort descending by priority score
  rows.sort((a, b) => (b.score || 0) - (a.score || 0));

  return rows;
}
