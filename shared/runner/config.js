/**
 * shared/runner/config.js
 * Centralized candidate profile, credentials, and configuration loader.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const E = loadEnv(path.join(__dirname, '..', '..', '.env'));
const g = (k, d = '') => (E[k] != null && E[k] !== '' ? E[k] : (process.env[k] || d));

const CV = {
  name:              g('NAME'),
  email:             g('EMAIL'),
  phone:             g('PHONE'),
  location:          g('LOCATION'),
  currentRole:       g('CURRENT_ROLE'),
  company:           g('COMPANY') || (g('CURRENT_ROLE') ? (g('CURRENT_ROLE').split(' at ')[1] || '').split(' (')[0] : ''),
  education:         g('EDUCATION'),
  yearsOfExperience: g('YEARS_EXPERIENCE'),
  skills:            g('SKILLS'),
  highlights:        (g('HIGHLIGHTS') || '').split('||').map((s) => s.trim()).filter(Boolean),
  noticePeriod:      g('NOTICE_PERIOD'),
  currentCTC:        g('CURRENT_CTC'),
  expectedCTC:       g('EXPECTED_CTC'),
  currentSalary:     g('CURRENT_CTC') ? g('CURRENT_CTC') + ' LPA' : '',
  expectedSalary:    g('EXPECTED_CTC') ? g('EXPECTED_CTC') + ' LPA' : '',
  dob:               g('DOB'),
  gender:            g('GENDER'),
  workAuth:          g('WORK_AUTH', 'Authorized to work in my country of residence.'),
  github:            g('GITHUB_URL'),
  linkedin:          g('LINKEDIN_URL'),
  portfolio:         g('PORTFOLIO_URL'),
  links:             `GitHub: ${g('GITHUB_URL')} | LinkedIn: ${g('LINKEDIN_URL')} | Portfolio: ${g('PORTFOLIO_URL')}`,
  remoteOk:          'Yes, I am fully set up for remote work and also open to hybrid/onsite.',
  relocate:          g('LOCATION') ? `Yes, I am open to relocation. I am currently based in ${g('LOCATION')}.` : 'Yes, I am open to relocation.',
  startDate:         g('NOTICE_PERIOD') ? `I can start within ${g('NOTICE_PERIOD')}.` : 'Available to join immediately.',

  // ── LinkedIn-style extended fields ─────────────────────────────────────────
  // Notice period in raw days (for months/weeks math in apply.js)
  noticePeriodDays:   parseInt(g('NOTICE_PERIOD_DAYS', '0'), 10) || 0,

  // Address (for street/state/zip/country questions)
  street:   g('STREET',  '123 Main Street'),
  state:    g('STATE',   'Maharashtra'),
  zipcode:  g('ZIPCODE', '400001'),
  country:  g('COUNTRY', 'India'),

  // EEO / diversity questions (LinkedIn-style: "Decline" is also a valid answer)
  disabilityStatus: g('DISABILITY_STATUS', 'No'),     // "Yes", "No", "Decline"
  veteranStatus:    g('VETERAN_STATUS',    'No'),     // "Yes", "No", "Decline"
  ethnicity:        g('ETHNICITY',         'Decline'), // "Decline", "Asian", etc.
  usCitizenship:    g('US_CITIZENSHIP',    'Yes'),    // "U.S. Citizen/Permanent Resident", ...

  // Profile answers
  confidenceLevel:  g('CONFIDENCE_LEVEL', '7'),   // 1-10 scale
  headline:         g('HEADLINE', ''),             // LinkedIn-style headline
  summary:          g('SUMMARY',  ''),             // LinkedIn summary / bio
};

const CREDS = {
  email:    g('EMAIL') || g('GOOGLE_EMAIL'),
  password: g('PASSWORD') || g('GOOGLE_PASSWORD'),
};

const geminiKey       = g('GEMINI_KEY');
const minDelaySeconds = parseInt(g('MIN_DELAY_SECONDS', '5'), 10);
const maxDelaySeconds = parseInt(g('MAX_DELAY_SECONDS', '10'), 10);
const browserChannel  = g('BROWSER_CHANNEL', 'msedge');
if (!process.env.BROWSER_CHANNEL) {
  process.env.BROWSER_CHANNEL = browserChannel;
}

module.exports = { CV, CREDS, geminiKey, minDelaySeconds, maxDelaySeconds, browserChannel };
