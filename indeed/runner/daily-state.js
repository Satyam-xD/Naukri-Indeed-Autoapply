/**
 * indeed/runner/daily-state.js
 * Tracks daily application counts to enforce the daily quota.
 * Persisted in apply-state-indeed.json.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', '..', 'apply-state-indeed.json');

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

class DailyState {
  constructor(siteName = 'indeed', cap = 60) {
    this.siteName = siteName;
    this.cap      = cap;
    this.today    = todayKey();
    this.data     = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        if (raw.date === this.today) return raw;
      }
    } catch (_) {}
    return { date: this.today, count: 0 };
  }

  _save() {
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.data, null, 2));
    } catch (_) {}
  }

  get count() {
    return this.data.count || 0;
  }

  get remaining() {
    return Math.max(0, this.cap - this.count);
  }

  get atCap() {
    return this.count >= this.cap;
  }

  get target() {
    return this.remaining;
  }

  bump() {
    this.data.count = (this.data.count || 0) + 1;
    this._save();
    return this.data.count;
  }
}

module.exports = DailyState;
