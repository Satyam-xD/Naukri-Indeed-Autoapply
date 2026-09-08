/**
 * naukri/site.js
 * Naukri-specific configuration, search URLs, and route rules.
 */
'use strict';

module.exports = {
  name:       'naukri',
  profile:    '.naukri-chrome-profile',
  loginUrl:   'https://www.naukri.com/nlogin/login',
  profileUrl: 'https://www.naukri.com/mnjuser/profile',
  dailyCap:   60,
  searches: [
    // ── Core fresher / 0-exp searches (sorted by recency) ──────────────────
    'https://www.naukri.com/software-engineer-jobs?experience=0&applyRedirect=false&sort=r',
    'https://www.naukri.com/full-stack-developer-jobs?experience=0&applyRedirect=false&sort=r',
    'https://www.naukri.com/frontend-developer-jobs?experience=0&applyRedirect=false&sort=r',
    'https://www.naukri.com/backend-developer-jobs?experience=0&applyRedirect=false&sort=r',
    'https://www.naukri.com/react-js-developer-jobs?experience=0&applyRedirect=false&sort=r',
    'https://www.naukri.com/node-js-developer-jobs?experience=0&applyRedirect=false&sort=r',
    'https://www.naukri.com/python-developer-jobs?experience=0&applyRedirect=false&sort=r',
    'https://www.naukri.com/mern-stack-developer-jobs?experience=0&applyRedirect=false&sort=r',
    'https://www.naukri.com/web-developer-jobs?experience=0&applyRedirect=false&sort=r',
    'https://www.naukri.com/javascript-developer-jobs?experience=0&applyRedirect=false&sort=r',
    // ── Fresher-path URLs (no experience param — these ARE the 0-exp searches) ─
    'https://www.naukri.com/fresher-software-engineer-jobs?applyRedirect=false&sort=r',
    'https://www.naukri.com/software-trainee-jobs?applyRedirect=false&sort=r',
    'https://www.naukri.com/junior-software-engineer-jobs?applyRedirect=false&sort=r',
    'https://www.naukri.com/fresher-developer-jobs?applyRedirect=false&sort=r',
    // ── AI / GenAI roles (growing demand, fewer candidates) ─────────────────
    'https://www.naukri.com/ai-engineer-jobs?experience=0&applyRedirect=false&sort=r',
    'https://www.naukri.com/generative-ai-jobs?experience=0&applyRedirect=false&sort=r',
    // ── City-pinned (increases acceptance by local recruiters) ──────────────
    'https://www.naukri.com/software-engineer-jobs-in-delhi?experience=0&applyRedirect=false&sort=r',
    'https://www.naukri.com/software-engineer-jobs-in-bengaluru-bangalore?experience=0&applyRedirect=false&sort=r',
    'https://www.naukri.com/software-engineer-jobs-in-noida?experience=0&applyRedirect=false&sort=r',
    'https://www.naukri.com/software-engineer-jobs-in-hyderabad-secunderabad?experience=0&applyRedirect=false&sort=r',
  ],
  /** Return true for pages where the inject script should run. */
  injectOn: (url) => /naukri\.com/.test(url) && !/naukri\.com\/nlogin/.test(url),
};
