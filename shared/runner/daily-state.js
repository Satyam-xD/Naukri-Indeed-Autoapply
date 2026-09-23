/**
 * shared/runner/daily-state.js
 * Tracks daily application counts to enforce the daily quota.
 * Persisted in apply-state-<site>.json.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

class DailyState {
  constructor(siteName = 'naukri', cap = 50) {
    this.siteName  = siteName;
    this.cap       = cap;
    this.today     = todayKey();
    this.stateFile = path.join(__dirname, '..', '..', `apply-state-${siteName}.json`);
    this.data      = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const raw = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
        if (raw.date === this.today) return raw;
      }
    } catch (_) {}
    return { date: this.today, count: 0 };
  }

  _save() {
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify(this.data, null, 2));
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
