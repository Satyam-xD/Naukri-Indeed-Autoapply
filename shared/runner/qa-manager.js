/**
 * shared/runner/qa-manager.js
 * Manages reading, updating, and persisting qa-bank.json.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const QA_FILE = path.join(__dirname, '..', '..', 'qa-bank.json');

let cachedBank = null;
let lastMtime = 0;
let saveTimer = null;

function normalizeQuestion(q) {
  if (!q) return '';
  return String(q)
    .toLowerCase()
    .replace(/[?*:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadQABank() {
  try {
    if (fs.existsSync(QA_FILE)) {
      const stats = fs.statSync(QA_FILE);
      if (cachedBank && stats.mtimeMs === lastMtime) {
        return cachedBank;
      }
      const raw = fs.readFileSync(QA_FILE, 'utf8');
      const data = JSON.parse(raw);
      cachedBank = {
        _comment: data._comment || 'QA Bank for job applications',
        answers: data.answers || {},
        unanswered: data.unanswered || {},
      };
      lastMtime = stats.mtimeMs;
      return cachedBank;
    }
  } catch (e) {
    console.error(`[qa-manager] Error loading qa-bank.json: ${e.message}`);
  }

  // Default fallback if file does not exist
  cachedBank = {
    _comment: 'QA Bank: Add or update answers here.',
    answers: {},
    unanswered: {},
  };
  return cachedBank;
}

function saveQABankNow() {
  if (!cachedBank) return;
  try {
    const content = JSON.stringify(cachedBank, null, 2);
    const tmpFile = `${QA_FILE}.tmp`;
    fs.writeFileSync(tmpFile, content, 'utf8');
    fs.renameSync(tmpFile, QA_FILE);
    const stats = fs.statSync(QA_FILE);
    lastMtime = stats.mtimeMs;
  } catch (e) {
    console.error(`[qa-manager] Failed saving qa-bank.json: ${e.message}`);
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveQABankNow();
    saveTimer = null;
  }, 600);
}

/**
 * recordQA — called by the runner when a question is processed or encountered.
 *
 * @param {object} item
 * @param {string} item.question - The raw or cleaned question text
 * @param {string} [item.answer] - The answer string if known
 * @param {'known'|'unanswered'} [item.status]
 * @param {string} [item.source] - e.g. 'profile', 'gemini', 'user', 'unknown'
 */
function recordQA({ question, answer = '', status = 'known', source = 'profile' }) {
  const normQ = normalizeQuestion(question);
  if (!normQ || normQ.length < 3) return;

  const bank = loadQABank();
  let changed = false;

  const hasInAnswers = Object.prototype.hasOwnProperty.call(bank.answers, normQ);
  const hasInUnanswered = Object.prototype.hasOwnProperty.call(bank.unanswered, normQ);

  // If user already typed an answer in 'unanswered', move it to 'answers'
  if (hasInUnanswered && bank.unanswered[normQ] && String(bank.unanswered[normQ]).trim()) {
    bank.answers[normQ] = String(bank.unanswered[normQ]).trim();
    delete bank.unanswered[normQ];
    changed = true;
  }

  if (status === 'unanswered' || (!answer && answer !== 0)) {
    // If we don't have an answer in 'answers', log to 'unanswered'
    if (!hasInAnswers) {
      if (!hasInUnanswered) {
        bank.unanswered[normQ] = '';
        changed = true;
      }
    }
  } else {
    // We have an answer (from Gemini, rule, etc.)
    if (hasInUnanswered) {
      delete bank.unanswered[normQ];
      changed = true;
    }
    // Only set if not already present, or if explicitly provided by the user
    if (!hasInAnswers || source === 'user') {
      bank.answers[normQ] = String(answer).trim();
      changed = true;
    }
  }

  if (changed) {
    scheduleSave();
  }
}

function getQABank() {
  return loadQABank();
}

module.exports = {
  loadQABank,
  recordQA,
  getQABank,
  saveQABankNow,
};
