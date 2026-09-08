/**
 * indeed/runner/csv-logger.js
 * Appends one CSV row per submitted application to applications.csv.
 * UTF-8 BOM is prepended so Excel renders ₹/– correctly.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const CSV_FILE = path.join(__dirname, '..', '..', 'applications.csv');
const HEADER   = ['Date', 'Site', 'Role', 'Company', 'Experience Required', 'CTC/Salary', 'Skills', 'Job Link', 'Job Description'];

/** Tech keywords extracted from title + JD to populate the Skills column. */
const SKILL_LIST = [
  'JavaScript', 'TypeScript', 'Python', 'Java', 'Go', 'Rust', 'C++', 'C#',
  'React', 'Next.js', 'React Native', 'Vue', 'Angular',
  'Node.js', 'Express', 'FastAPI', 'Django', 'Flask', 'Spring Boot',
  'MongoDB', 'PostgreSQL', 'MySQL', 'Redis', 'GraphQL', 'WebSockets',
  'Docker', 'Kubernetes', 'GCP', 'AWS', 'Azure', 'CI/CD',
  'LangChain', 'LangGraph', 'RAG', 'LLM', 'GenAI',
  'Machine Learning', 'MCP', 'Pinecone', 'FAISS',
];

function matchSkills(text = '') {
  const l = text.toLowerCase();
  return SKILL_LIST.filter((s) => l.includes(s.toLowerCase())).join('; ');
}

function csvEscape(v) {
  return '"' + String(v || '').replace(/"/g, '""').replace(/\s+/g, ' ').trim() + '"';
}

function csvRow(vals) {
  return vals.map(csvEscape).join(',') + '\n';
}

function ensureFile() {
  if (!fs.existsSync(CSV_FILE)) {
    fs.writeFileSync(CSV_FILE, '\uFEFF' + csvRow(HEADER));
  }
}

/**
 * extractExp — pulls the experience requirement out of freeform text.
 */
function extractExp(text = '') {
  const m = text.match(/\b(fresher|entry.?level|0[-–1]\s*year|[0-9]+\s*[+-]?\s*[0-9]*\s*\+?\s*(?:years?|yrs?)(?:\s*(?:of\s*)?(?:exp(?:erience)?)?)?)/i);
  return m ? m[0].replace(/\s+/g, ' ').trim() : 'Not specified';
}

/**
 * logApplication — appends one row to applications.csv.
 *
 * @param {string} siteName  e.g. 'indeed'
 * @param {object} job       { title, company, expRequired, salary, skills, link, jd }
 */
function logApplication(siteName, job) {
  ensureFile();
  const expText = job.expRequired || extractExp((job.jd || '') + ' ' + (job.title || ''));
  fs.appendFileSync(CSV_FILE, csvRow([
    new Date().toLocaleString('en-IN'),
    siteName,
    job.title   || '',
    job.company || '',
    expText,
    job.salary  || '',
    job.skills  || matchSkills((job.title || '') + ' ' + (job.jd || '')),
    job.link    || '',
    (job.jd || '').slice(0, 1200),
  ]));
}

module.exports = { logApplication, matchSkills };
