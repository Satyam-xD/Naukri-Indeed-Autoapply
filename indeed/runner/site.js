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
    // ── Core fresher / developer searches with "Easily apply" filter & date sort ──
    'https://in.indeed.com/jobs?q=software+engineer&sc=0kf%3Aattr(DS3S6)%3B&sort=date',
    'https://in.indeed.com/jobs?q=full+stack+developer&sc=0kf%3Aattr(DS3S6)%3B&sort=date',
    'https://in.indeed.com/jobs?q=frontend+developer&sc=0kf%3Aattr(DS3S6)%3B&sort=date',
    'https://in.indeed.com/jobs?q=backend+developer&sc=0kf%3Aattr(DS3S6)%3B&sort=date',
    'https://in.indeed.com/jobs?q=python+developer&sc=0kf%3Aattr(DS3S6)%3B&sort=date',
    'https://in.indeed.com/jobs?q=react+developer&sc=0kf%3Aattr(DS3S6)%3B&sort=date',
    'https://in.indeed.com/jobs?q=node+js+developer&sc=0kf%3Aattr(DS3S6)%3B&sort=date',
    'https://in.indeed.com/jobs?q=javascript+developer&sc=0kf%3Aattr(DS3S6)%3B&sort=date',
    'https://in.indeed.com/jobs?q=web+developer&sc=0kf%3Aattr(DS3S6)%3B&sort=date',
    'https://in.indeed.com/jobs?q=fresher+software+engineer&sc=0kf%3Aattr(DS3S6)%3B&sort=date',
    'https://in.indeed.com/jobs?q=junior+software+engineer&sc=0kf%3Aattr(DS3S6)%3B&sort=date',
    'https://in.indeed.com/jobs?q=software+trainee&sc=0kf%3Aattr(DS3S6)%3B&sort=date',
    // ── AI / ML searches ──────────────────────────────────────────
    'https://in.indeed.com/jobs?q=ai+engineer&sc=0kf%3Aattr(DS3S6)%3B&sort=date',
    'https://in.indeed.com/jobs?q=machine+learning+engineer&sc=0kf%3Aattr(DS3S6)%3B&sort=date',
    // ── Remote & City-pinned ──────────────────────────────────────
    'https://in.indeed.com/jobs?q=software+developer&l=Remote&sc=0kf%3Aattr(DS3S6)%3B&sort=date',
    'https://in.indeed.com/jobs?q=software+engineer&l=Bengaluru%2C+Karnataka&sc=0kf%3Aattr(DS3S6)%3B&sort=date',
    'https://in.indeed.com/jobs?q=software+engineer&l=Delhi&sc=0kf%3Aattr(DS3S6)%3B&sort=date',
    'https://in.indeed.com/jobs?q=software+engineer&l=Noida%2C+Uttar+Pradesh&sc=0kf%3Aattr(DS3S6)%3B&sort=date',
    'https://in.indeed.com/jobs?q=software+engineer&l=Hyderabad%2C+Telangana&sc=0kf%3Aattr(DS3S6)%3B&sort=date',
    'https://in.indeed.com/jobs?q=software+engineer&l=Pune%2C+Maharashtra&sc=0kf%3Aattr(DS3S6)%3B&sort=date',
  ],
  /** Return true for pages where the inject script should run. */
  injectOn: (url) => /indeed\.com\/(jobs|viewjob|cmp)/i.test(url) && !/secure\.indeed\.com\/auth/i.test(url),
};
