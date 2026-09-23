/**
 * indeed/runner/site.js
 * Indeed-specific configuration, search URLs, and route rules.
 */
'use strict';

module.exports = {
  name:       'indeed',
  profile:    '.indeed-chrome-profile',
  loginUrl:   'https://secure.indeed.com/auth',
  dailyCap:   60,
  searches: [
    // ── Core fresher / developer searches with date sort ──
    'https://in.indeed.com/jobs?q=software+engineer&l=India&sort=date',
    'https://in.indeed.com/jobs?q=software+developer&l=India&sort=date',
    'https://in.indeed.com/jobs?q=full+stack+developer&l=India&sort=date',
    'https://in.indeed.com/jobs?q=frontend+developer&l=India&sort=date',
    'https://in.indeed.com/jobs?q=backend+developer&l=India&sort=date',
    'https://in.indeed.com/jobs?q=python+developer&l=India&sort=date',
    'https://in.indeed.com/jobs?q=react+developer&l=India&sort=date',
    'https://in.indeed.com/jobs?q=node+js+developer&l=India&sort=date',
    'https://in.indeed.com/jobs?q=javascript+developer&l=India&sort=date',
    'https://in.indeed.com/jobs?q=web+developer&l=India&sort=date',
    'https://in.indeed.com/jobs?q=fresher+software+engineer&l=India&sort=date',
    'https://in.indeed.com/jobs?q=junior+software+engineer&l=India&sort=date',
    'https://in.indeed.com/jobs?q=software+trainee&l=India&sort=date',
    // ── AI / ML searches ──────────────────────────────────────────
    'https://in.indeed.com/jobs?q=ai+engineer&l=India&sort=date',
    'https://in.indeed.com/jobs?q=machine+learning+engineer&l=India&sort=date',
    // ── Remote & City-pinned ──────────────────────────────────────
    'https://in.indeed.com/jobs?q=software+developer&l=Remote&sort=date',
    'https://in.indeed.com/jobs?q=software+engineer&l=Mumbai%2C+Maharashtra&sort=date',
    'https://in.indeed.com/jobs?q=software+engineer&l=Bengaluru%2C+Karnataka&sort=date',
    'https://in.indeed.com/jobs?q=software+engineer&l=Delhi&sort=date',
    'https://in.indeed.com/jobs?q=software+engineer&l=Noida%2C+Uttar+Pradesh&sort=date',
    'https://in.indeed.com/jobs?q=software+engineer&l=Hyderabad%2C+Telangana&sort=date',
    'https://in.indeed.com/jobs?q=software+engineer&l=Pune%2C+Maharashtra&sort=date',
  ],
  /** Return true for pages where the inject script should run. */
  injectOn: (url) =>
    // Search results, job detail, and company pages
    (/indeed\.com\/(jobs|viewjob|cmp)/i.test(url) && !/secure\.indeed\.com\/auth/i.test(url)) ||
    // Full-page Indeed Apply redirect
    /smartapply|apply\.indeed|indeed\.com\/beta\/indeedapply|m5\.apply/i.test(url),
};
