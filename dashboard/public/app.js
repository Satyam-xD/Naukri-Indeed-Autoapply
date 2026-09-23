// Global State
let state = {
  stats: null,
  qaBank: null,
  applications: [],
  settings: null,
  logs: [],
  logFilter: 'all',
  autoScroll: true,
  activeQaFilter: 'all',
  qaSearch: '',
  appsSearch: '',
  appsSiteFilter: 'all',
  currentPausedQuestion: ''
};

// DOM Elements
const el = {
  tabBtns: document.querySelectorAll('.tab-btn'),
  tabPanels: document.querySelectorAll('.tab-panel'),
  btnRefreshAll: document.getElementById('btn-refresh-all'),
  toast: document.getElementById('toast'),

  // Badges & Counters
  unansweredCountBadge: document.getElementById('unanswered-count-badge'),
  totalAppsBadge: document.getElementById('total-apps-badge'),
  statTotalApps: document.getElementById('stat-total-apps'),
  statQaKnown: document.getElementById('stat-qa-known'),
  statQaPending: document.getElementById('stat-qa-pending'),

  // Platform Cards
  nkFraction: document.getElementById('nk-fraction'),
  nkBar: document.getElementById('nk-bar'),
  statusTagNk: document.getElementById('status-tag-nk'),

  indFraction: document.getElementById('ind-fraction'),
  indBar: document.getElementById('ind-bar'),
  statusTagInd: document.getElementById('status-tag-ind'),

  // Terminal
  terminalBody: document.getElementById('terminal-body'),
  miniTerminalBox: document.getElementById('mini-terminal-box'),
  autoscrollState: document.getElementById('autoscroll-state'),
  autoscrollIcon: document.getElementById('autoscroll-icon'),
  activeRunnersSummary: document.getElementById('active-runners-summary'),
  logFilterBtns: document.querySelectorAll('[data-logfilter]'),

  // QA Tab
  qaSearchInput: document.getElementById('qa-search-input'),
  qaCountAll: document.getElementById('qa-count-all'),
  qaCountUnanswered: document.getElementById('qa-count-unanswered'),
  qaCountAnswers: document.getElementById('qa-count-answers'),
  qaTableBody: document.getElementById('qa-table-body'),
  qaPillBtns: document.querySelectorAll('[data-qafilter]'),

  // QA Modal
  qaModal: document.getElementById('qa-modal'),
  qaModalTitle: document.getElementById('qa-modal-title'),
  modalQuestionInput: document.getElementById('modal-question-input'),
  modalAnswerInput: document.getElementById('modal-answer-input'),

  // Pause Alert Modal
  pauseModal: document.getElementById('pause-modal'),
  pauseQuestionDisplay: document.getElementById('pause-question-display'),
  pauseAnswerInput: document.getElementById('pause-answer-input'),

  // Applications Tab
  appsSearchInput: document.getElementById('apps-search-input'),
  appsSiteFilter: document.getElementById('apps-site-filter'),
  appsTableBody: document.getElementById('apps-table-body'),

  // Settings Form
  setName: document.getElementById('set-name'),
  setEmail: document.getElementById('set-email'),
  setPhone: document.getElementById('set-phone'),
  setLocation: document.getElementById('set-location'),
  setDob: document.getElementById('set-dob'),
  setGender: document.getElementById('set-gender'),
  setCurrentRole: document.getElementById('set-currentRole'),
  setCompany: document.getElementById('set-company'),
  setEducation: document.getElementById('set-education'),
  setYearsExperience: document.getElementById('set-yearsExperience'),
  setSkills: document.getElementById('set-skills'),
  setHl: [
    document.getElementById('set-hl-0'),
    document.getElementById('set-hl-1'),
    document.getElementById('set-hl-2'),
    document.getElementById('set-hl-3'),
    document.getElementById('set-hl-4'),
  ],
  setNoticePeriod: document.getElementById('set-noticePeriod'),
  setCurrentCTC: document.getElementById('set-currentCTC'),
  setExpectedCTC: document.getElementById('set-expectedCTC'),
  setWorkAuth: document.getElementById('set-workAuth'),
  setGithub: document.getElementById('set-github'),
  setLinkedin: document.getElementById('set-linkedin'),
  setPortfolio: document.getElementById('set-portfolio'),
  setMinDelay: document.getElementById('set-minDelay'),
  setMaxDelay: document.getElementById('set-maxDelay'),
  setNaukriUrl: document.getElementById('set-naukriUrl'),
  setGeminiKey: document.getElementById('set-geminiKey'),
};

// Toast notification
function showToast(message, duration = 3000) {
  if (!el.toast) return;
  el.toast.textContent = message;
  el.toast.classList.add('show');
  setTimeout(() => {
    el.toast.classList.remove('show');
  }, duration);
}

// Navigation Tabs
function setupTabs() {
  el.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-tab');
      switchToTab(target);
    });
  });
}

window.switchToTab = function(target) {
  el.tabBtns.forEach(b => b.classList.remove('active'));
  el.tabPanels.forEach(p => p.classList.remove('active'));

  const btn = document.querySelector(`.tab-btn[data-tab="${target}"]`);
  const panel = document.getElementById(`panel-${target}`);
  if (btn) btn.classList.add('active');
  if (panel) panel.classList.add('active');

  if (target === 'terminal' && state.autoScroll && el.terminalBody) {
    el.terminalBody.scrollTop = el.terminalBody.scrollHeight;
  }
};

// ── SSE LIVE LOGS STREAMING ──────────────────────────────────
function setupLogStream() {
  // 1. Fetch initial logs
  fetch('/api/runner/logs')
    .then(r => r.json())
    .then(data => {
      if (data && data.logs) {
        state.logs = data.logs;
        renderTerminalLogs();
      }
    })
    .catch(() => {});

  // 2. Connect to SSE
  const es = new EventSource('/api/runner/logs/stream');

  es.onmessage = (event) => {
    try {
      const entry = JSON.parse(event.data);
      if (entry.type === 'connected') return;

      state.logs.push(entry);
      if (state.logs.length > 2500) state.logs.shift();

      appendTerminalLine(entry);
      appendMiniTerminalLine(entry);

      if (entry.level === 'pause') {
        handlePauseAlert(entry.text);
      }
    } catch (_) {}
  };

  es.addEventListener('pause', (event) => {
    try {
      const entry = JSON.parse(event.data);
      handlePauseAlert(entry.text);
    } catch (_) {}
  });

  es.addEventListener('clear', () => {
    state.logs = [];
    if (el.terminalBody) el.terminalBody.innerHTML = '';
    if (el.miniTerminalBox) el.miniTerminalBox.innerHTML = '';
  });

  es.onerror = () => {
    // EventSource auto-reconnects
  };
}

function appendTerminalLine(entry) {
  if (!el.terminalBody) return;

  // Filter check
  if (!shouldShowLog(entry)) return;

  const lineDiv = createLogLineElement(entry);
  el.terminalBody.appendChild(lineDiv);

  if (state.autoScroll) {
    el.terminalBody.scrollTop = el.terminalBody.scrollHeight;
  }
}

function appendMiniTerminalLine(entry) {
  if (!el.miniTerminalBox) return;

  const lineDiv = createLogLineElement(entry);
  el.miniTerminalBox.appendChild(lineDiv);

  while (el.miniTerminalBox.children.length > 6) {
    el.miniTerminalBox.removeChild(el.miniTerminalBox.firstChild);
  }
  el.miniTerminalBox.scrollTop = el.miniTerminalBox.scrollHeight;
}

function shouldShowLog(entry) {
  if (state.logFilter === 'all') return true;
  if (state.logFilter === 'pause') return entry.level === 'pause';
  if (state.logFilter === 'error') return entry.level === 'error';
  return entry.platform === state.logFilter;
}

function createLogLineElement(entry) {
  const div = document.createElement('div');
  div.className = `terminal-line ${entry.level || 'info'}`;

  const badgeClass = entry.platform === 'naukri' ? 'term-badge-nk' :
                     entry.platform === 'indeed' ? 'term-badge-ind' : 'term-badge-sys';

  div.innerHTML = `
    <span class="term-time">[${escapeHtml(entry.time || '')}]</span>
    <span class="term-badge ${badgeClass}">[${escapeHtml(entry.platform || 'sys')}]</span>
    <span class="term-text">${escapeHtml(entry.text || '')}</span>
  `;
  return div;
}

function renderTerminalLogs() {
  if (!el.terminalBody) return;
  el.terminalBody.innerHTML = '';

  const filtered = state.logs.filter(shouldShowLog);
  filtered.forEach(entry => {
    el.terminalBody.appendChild(createLogLineElement(entry));
  });

  if (state.autoScroll) {
    el.terminalBody.scrollTop = el.terminalBody.scrollHeight;
  }
}

window.toggleAutoScroll = function() {
  state.autoScroll = !state.autoScroll;
  el.autoscrollState.textContent = state.autoScroll ? 'ON' : 'OFF';
  el.autoscrollIcon.textContent = state.autoScroll ? '⬇' : '⏸';
  if (state.autoScroll && el.terminalBody) {
    el.terminalBody.scrollTop = el.terminalBody.scrollHeight;
  }
};

window.clearTerminalLogs = async function() {
  try {
    await fetch('/api/runner/clear-logs', { method: 'POST' });
    state.logs = [];
    if (el.terminalBody) el.terminalBody.innerHTML = '';
    if (el.miniTerminalBox) el.miniTerminalBox.innerHTML = '';
    showToast('Terminal logs cleared');
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
};

window.copyTerminalLogs = function() {
  const text = state.logs.map(l => `[${l.time}] [${l.platform}] ${l.text}`).join('\n');
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied all terminal logs to clipboard');
  }).catch(() => {
    showToast('Failed to copy to clipboard');
  });
};

function handlePauseAlert(text) {
  // Beep sound
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (_) {}

  // Parse question text if present: e.g. Unknown question: "..."
  const match = text.match(/question[:\s]+"([^"]+)"/i) || text.match(/"([^"]+)"/);
  const question = match ? match[1] : text;

  openPauseModal(question);
}

// ── PAUSE ALERT MODAL ────────────────────────────────────────
function openPauseModal(question) {
  state.currentPausedQuestion = question;
  if (el.pauseQuestionDisplay) el.pauseQuestionDisplay.textContent = question;
  if (el.pauseAnswerInput) el.pauseAnswerInput.value = '';
  if (el.pauseModal) el.pauseModal.classList.add('open');
  if (el.pauseAnswerInput) el.pauseAnswerInput.focus();
}

window.closePauseModal = function() {
  if (el.pauseModal) el.pauseModal.classList.remove('open');
};

window.submitPauseAnswer = async function() {
  const ans = (el.pauseAnswerInput ? el.pauseAnswerInput.value : '').trim();
  const q = state.currentPausedQuestion || '';

  if (!ans) {
    alert('Please enter an answer to save and resume the bot.');
    return;
  }

  try {
    const res = await fetch('/api/qa-bank', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, answer: ans })
    });
    const data = await res.json();
    if (data.success) {
      closePauseModal();
      showToast('Answer saved! Bot will use this answer to continue applying.');
      await fetchQaBank();
      await fetchStats();
    } else {
      alert(`Could not save answer: ${data.error}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
};

// ── DATA FETCHERS ────────────────────────────────────────────
async function fetchStats() {
  try {
    const res = await fetch('/api/stats');
    if (res.ok) {
      state.stats = await res.json();
      renderStats();
    }
  } catch (err) {
    console.warn('Failed fetching stats:', err);
  }
}

async function fetchQaBank() {
  try {
    const res = await fetch('/api/qa-bank');
    if (res.ok) {
      state.qaBank = await res.json();
      renderQaBank();
    }
  } catch (err) {
    console.warn('Failed fetching qa-bank:', err);
  }
}

async function fetchApplications() {
  try {
    const res = await fetch('/api/applications');
    if (res.ok) {
      const data = await res.json();
      state.applications = data.applications || [];
      renderApplications();
    }
  } catch (err) {
    console.warn('Failed fetching applications:', err);
  }
}

async function fetchSettings() {
  try {
    const res = await fetch('/api/settings');
    if (res.ok) {
      state.settings = await res.json();
      populateSettingsForm(state.settings);
    }
  } catch (err) {
    console.warn('Failed fetching settings:', err);
  }
}

async function syncAll() {
  await Promise.all([fetchStats(), fetchQaBank(), fetchApplications(), fetchSettings()]);
  showToast('Synced all data with runner engine');
}

// ── RENDER STATS & RUNNER BADGES ─────────────────────────────
function renderStats() {
  if (!state.stats) return;
  const { quota = {}, totalApplications = 0, qaBank = {}, runners = {} } = state.stats;

  // Naukri
  if (quota.naukri) {
    const { count = 0, limit = 50 } = quota.naukri;
    const pct = Math.min(100, Math.round((count / (limit || 50)) * 100));
    el.nkFraction.textContent = `${count} / ${limit}`;
    el.nkBar.style.width = `${pct}%`;
  }
  updateRunnerStatusTag(el.statusTagNk, runners.naukri);

  // Indeed
  if (quota.indeed) {
    const { count = 0, limit = 60 } = quota.indeed;
    const pct = Math.min(100, Math.round((count / (limit || 60)) * 100));
    el.indFraction.textContent = `${count} / ${limit}`;
    el.indBar.style.width = `${pct}%`;
  }
  updateRunnerStatusTag(el.statusTagInd, runners.indeed);

  // Counters
  el.totalAppsBadge.textContent = totalApplications;
  el.statTotalApps.textContent = totalApplications;
  el.unansweredCountBadge.textContent = qaBank.unansweredCount || 0;
  el.statQaKnown.textContent = qaBank.knownCount || 0;
  el.statQaPending.textContent = qaBank.unansweredCount || 0;

  // Terminal Runner Summary
  const runningList = [];
  if (runners.naukri) runningList.push('Naukri');
  if (runners.indeed) runningList.push('Indeed');
  if (runners.all) runningList.push('All');

  if (el.activeRunnersSummary) {
    el.activeRunnersSummary.textContent = runningList.length > 0 ? `Running: ${runningList.join(', ')}` : 'Idle';
    el.activeRunnersSummary.style.color = runningList.length > 0 ? '#34d399' : '#9ca3af';
  }
}

function updateRunnerStatusTag(tagElement, isRunning) {
  if (!tagElement) return;
  if (isRunning) {
    tagElement.textContent = 'Active Running';
    tagElement.className = 'status-tag running';
  } else {
    tagElement.textContent = 'Idle';
    tagElement.className = 'status-tag';
  }
}

// ── SETTINGS FORM CONTROLLER ─────────────────────────────────
function populateSettingsForm(s) {
  if (!s) return;
  const id = s.identity || {};
  const prof = s.profile || {};
  const hls = s.highlights || [];
  const appAns = s.applicationAnswers || {};
  const links = s.links || {};
  const auto = s.automation || {};

  if (el.setName) el.setName.value = id.name || '';
  if (el.setEmail) el.setEmail.value = id.email || '';
  if (el.setPhone) el.setPhone.value = id.phone || '';
  if (el.setLocation) el.setLocation.value = id.location || '';
  if (el.setDob) el.setDob.value = id.dob || '';
  if (el.setGender) el.setGender.value = id.gender || 'Male';

  if (el.setCurrentRole) el.setCurrentRole.value = prof.currentRole || '';
  if (el.setCompany) el.setCompany.value = prof.company || '';
  if (el.setEducation) el.setEducation.value = prof.education || '';
  if (el.setYearsExperience) el.setYearsExperience.value = prof.yearsExperience || '';
  if (el.setSkills) el.setSkills.value = prof.skills || '';

  el.setHl.forEach((input, idx) => {
    if (input) input.value = hls[idx] || '';
  });

  if (el.setNoticePeriod) el.setNoticePeriod.value = appAns.noticePeriod || '';
  if (el.setCurrentCTC) el.setCurrentCTC.value = appAns.currentCTC || '';
  if (el.setExpectedCTC) el.setExpectedCTC.value = appAns.expectedCTC || '';
  if (el.setWorkAuth) el.setWorkAuth.value = appAns.workAuth || '';

  if (el.setGithub) el.setGithub.value = links.github || '';
  if (el.setLinkedin) el.setLinkedin.value = links.linkedin || '';
  if (el.setPortfolio) el.setPortfolio.value = links.portfolio || '';

  if (el.setMinDelay) el.setMinDelay.value = auto.minDelay || '5';
  if (el.setMaxDelay) el.setMaxDelay.value = auto.maxDelay || '10';
  if (el.setNaukriUrl) el.setNaukriUrl.value = auto.naukriProfileUrl || '';
  if (el.setGeminiKey) el.setGeminiKey.value = auto.geminiKey || '';
}

window.saveAllSettings = async function(event) {
  if (event) event.preventDefault();

  const payload = {
    identity: {
      name:     (el.setName ? el.setName.value : '').trim(),
      email:    (el.setEmail ? el.setEmail.value : '').trim(),
      phone:    (el.setPhone ? el.setPhone.value : '').trim(),
      location: (el.setLocation ? el.setLocation.value : '').trim(),
      dob:      (el.setDob ? el.setDob.value : '').trim(),
      gender:   (el.setGender ? el.setGender.value : 'Male'),
    },
    profile: {
      currentRole:     (el.setCurrentRole ? el.setCurrentRole.value : '').trim(),
      company:         (el.setCompany ? el.setCompany.value : '').trim(),
      education:       (el.setEducation ? el.setEducation.value : '').trim(),
      yearsExperience: (el.setYearsExperience ? el.setYearsExperience.value : '').trim(),
      skills:          (el.setSkills ? el.setSkills.value : '').trim(),
    },
    highlights: el.setHl.map(input => (input ? input.value.trim() : '')).filter(Boolean),
    applicationAnswers: {
      noticePeriod: (el.setNoticePeriod ? el.setNoticePeriod.value : '').trim(),
      currentCTC:   (el.setCurrentCTC ? el.setCurrentCTC.value : '').trim(),
      expectedCTC:  (el.setExpectedCTC ? el.setExpectedCTC.value : '').trim(),
      workAuth:     (el.setWorkAuth ? el.setWorkAuth.value : '').trim(),
    },
    links: {
      github:    (el.setGithub ? el.setGithub.value : '').trim(),
      linkedin:  (el.setLinkedin ? el.setLinkedin.value : '').trim(),
      portfolio: (el.setPortfolio ? el.setPortfolio.value : '').trim(),
    },
    automation: {
      minDelay:         (el.setMinDelay ? el.setMinDelay.value : '5').trim(),
      maxDelay:         (el.setMaxDelay ? el.setMaxDelay.value : '10').trim(),
      naukriProfileUrl: (el.setNaukriUrl ? el.setNaukriUrl.value : '').trim(),
      geminiKey:        (el.setGeminiKey ? el.setGeminiKey.value : '').trim(),
    }
  };

  showToast('Saving profile & .env settings...');
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast('✅ Saved settings to .env successfully!');
      state.settings = data.settings;
      populateSettingsForm(data.settings);
    } else {
      alert(`Error saving settings: ${data.error}`);
    }
  } catch (err) {
    alert(`Network error saving settings: ${err.message}`);
  }
};

// ── QA BANK CONTROLLER ───────────────────────────────────────
function renderQaBank() {
  if (!state.qaBank) return;
  const { answers = {}, unanswered = {} } = state.qaBank;

  const answerEntries = Object.entries(answers || {}).map(([q, a]) => ({ question: q, answer: String(a || ''), status: 'saved' }));
  let unansweredEntries = [];
  if (Array.isArray(unanswered)) {
    unansweredEntries = unanswered.map(item => {
      if (typeof item === 'string') return { question: item, answer: '', status: 'unanswered' };
      return { question: item?.question || '', answer: item?.answer || '', status: 'unanswered', ...item };
    }).filter(i => i.question);
  } else if (unanswered && typeof unanswered === 'object') {
    unansweredEntries = Object.entries(unanswered).map(([q, a]) => ({
      question: q,
      answer: String(a || '').replace('[NEEDS_ANSWER]', '').trim(),
      status: 'unanswered'
    }));
  }

  if (el.qaCountAll) el.qaCountAll.textContent = answerEntries.length + unansweredEntries.length;
  if (el.qaCountAnswers) el.qaCountAnswers.textContent = answerEntries.length;
  if (el.qaCountUnanswered) el.qaCountUnanswered.textContent = unansweredEntries.length;

  let combined = [];
  if (state.activeQaFilter === 'all') {
    combined = [...unansweredEntries, ...answerEntries];
  } else if (state.activeQaFilter === 'unanswered') {
    combined = unansweredEntries;
  } else if (state.activeQaFilter === 'answers') {
    combined = answerEntries;
  }

  // Filter search
  if (state.qaSearch && state.qaSearch.trim()) {
    const qLower = state.qaSearch.toLowerCase();
    combined = combined.filter(item =>
      item.question.toLowerCase().includes(qLower) ||
      (item.answer && item.answer.toLowerCase().includes(qLower))
    );
  }

  el.qaTableBody.innerHTML = '';
  if (combined.length === 0) {
    el.qaTableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 32px;">No questions found matching criteria.</td></tr>`;
    return;
  }

  combined.forEach(item => {
    const tr = document.createElement('tr');

    const tdQ = document.createElement('td');
    tdQ.className = 'qa-question-cell';
    tdQ.textContent = item.question;

    const tdA = document.createElement('td');
    if (item.answer) {
      tdA.innerHTML = `<span class="qa-answer-cell">${escapeHtml(item.answer)}</span>`;
    } else {
      tdA.innerHTML = `<span class="qa-answer-cell empty">Needs Answer (Bot will pause)</span>`;
    }

    const tdStatus = document.createElement('td');
    if (item.status === 'saved') {
      tdStatus.innerHTML = `<span class="badge" style="background: rgba(16,185,129,0.15); color: #34d399; border: 1px solid rgba(16,185,129,0.3)">Saved</span>`;
    } else {
      tdStatus.innerHTML = `<span class="badge badge-amber">Pending</span>`;
    }

    const tdAction = document.createElement('td');
    tdAction.style.textAlign = 'right';
    tdAction.style.whiteSpace = 'nowrap';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-sm btn-ghost';
    editBtn.textContent = item.answer ? 'Edit' : 'Answer';
    editBtn.onclick = () => openEditQa(item.question, item.answer || '');
    tdAction.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-sm btn-ghost';
    delBtn.style.color = 'var(--accent-red, #f87171)';
    delBtn.style.marginLeft = '6px';
    delBtn.textContent = 'Delete';
    delBtn.onclick = () => deleteQaItem(item.question, item.status === 'saved' ? 'answers' : 'unanswered');
    tdAction.appendChild(delBtn);

    tr.appendChild(tdQ);
    tr.appendChild(tdA);
    tr.appendChild(tdStatus);
    tr.appendChild(tdAction);
    el.qaTableBody.appendChild(tr);
  });
}

// ── APPLICATIONS LOG CONTROLLER ──────────────────────────────
function renderApplications() {
  const apps = state.applications || [];
  let filtered = [...apps];

  if (state.appsSiteFilter !== 'all') {
    filtered = filtered.filter(a => (a.site || '').toLowerCase() === state.appsSiteFilter.toLowerCase());
  }

  if (state.appsSearch.trim()) {
    const q = state.appsSearch.toLowerCase();
    filtered = filtered.filter(a =>
      (a.role || '').toLowerCase().includes(q) ||
      (a.company || '').toLowerCase().includes(q) ||
      (a.skills || '').toLowerCase().includes(q) ||
      (a.date || '').toLowerCase().includes(q)
    );
  }

  el.appsTableBody.innerHTML = '';
  if (filtered.length === 0) {
    el.appsTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 32px;">No applications recorded yet. Run a bot to see live records!</td></tr>`;
    return;
  }

  filtered.forEach(app => {
    const tr = document.createElement('tr');

    const badgeClass = (app.site || '').toLowerCase() === 'naukri' ? 'nk-badge' : 'ind-badge';

    tr.innerHTML = `
      <td style="font-family: var(--font-mono); font-size: 12px; color: var(--text-muted);">${escapeHtml(app.date || '')}</td>
      <td><span class="platform-badge ${badgeClass}">${escapeHtml(app.site || '')}</span></td>
      <td style="font-weight: 600;">${escapeHtml(app.role || '')}</td>
      <td>${escapeHtml(app.company || '')}</td>
      <td style="color: #34d399; font-weight: 500;">${escapeHtml(app.salary || '-')}</td>
      <td>${escapeHtml(app.experience || '-')}</td>
      <td style="font-size: 12px; color: var(--text-muted); max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(app.skills || '')}">${escapeHtml(app.skills || '-')}</td>
      <td style="text-align: right;">
        ${app.link ? `<a href="${escapeHtml(app.link)}" target="_blank" class="app-link">View Job ↗</a>` : '-'}
      </td>
    `;
    el.appsTableBody.appendChild(tr);
  });
}

// ── RUNNER CONTROLS ──────────────────────────────────────────
window.startRunner = async function(platform, liveMode) {
  const mode = liveMode ? 'LIVE submission' : 'DRY RUN';
  if (liveMode && !confirm(`⚠️ Confirm: Launch ${platform.toUpperCase()} in LIVE apply mode? Applications will be submitted.`)) {
    return;
  }

  showToast(`Starting ${platform} in ${mode}...`);
  try {
    const res = await fetch('/api/runner/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, live: !!liveMode })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Started ${platform} runner!`);
      switchToTab('terminal');
      setTimeout(fetchStats, 1000);
    } else {
      showToast(`Runner alert: ${data.message || data.error || 'Error starting'}`);
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
};

window.stopAllRunners = async function() {
  showToast('Stopping runners...');
  try {
    const res = await fetch('/api/runner/stop', { method: 'POST' });
    const data = await res.json();
    showToast(`Runners stopped (${data.stoppedCount || 0} processes terminated)`);
    setTimeout(fetchStats, 1000);
  } catch (err) {
    showToast(`Error stopping: ${err.message}`);
  }
};

// ── QA MODAL CONTROLLER ──────────────────────────────────────
window.openAddQuestionModal = function() {
  el.qaModalTitle.textContent = 'Add Q&A Answer';
  el.modalQuestionInput.value = '';
  el.modalAnswerInput.value = '';
  el.qaModal.classList.add('open');
  el.modalQuestionInput.focus();
};

window.openEditQa = function(question, currentAnswer) {
  el.qaModalTitle.textContent = 'Edit Q&A Answer';
  el.modalQuestionInput.value = question;
  el.modalAnswerInput.value = currentAnswer;
  el.qaModal.classList.add('open');
  el.modalAnswerInput.focus();
};

window.closeQaModal = function() {
  el.qaModal.classList.remove('open');
};

window.saveModalQa = async function() {
  const question = el.modalQuestionInput.value.trim();
  const answer = el.modalAnswerInput.value.trim();

  if (!question) {
    alert('Please enter question keywords.');
    return;
  }

  try {
    const res = await fetch('/api/qa-bank', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, answer })
    });
    const data = await res.json();
    if (data.success) {
      closeQaModal();
      showToast(answer ? 'Saved answer to QA Bank!' : 'Added question to QA Bank (pending answer)');
      if (data.qaBank) {
        state.qaBank = data.qaBank;
        renderQaBank();
      } else {
        await fetchQaBank();
      }
      await fetchStats();
    } else {
      alert(`Could not save: ${data.error || 'Unknown error'}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
};

window.deleteQaItem = async function(question, section) {
  if (!confirm(`Delete "${question}" from QA Bank?`)) return;

  try {
    const res = await fetch('/api/qa-bank/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, section })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Deleted "${question}" from QA Bank`);
      if (data.qaBank) {
        state.qaBank = data.qaBank;
        renderQaBank();
      } else {
        await fetchQaBank();
      }
      await fetchStats();
    } else {
      alert(`Could not delete: ${data.error || 'Unknown error'}`);
    }
  } catch (err) {
    alert(`Error deleting: ${err.message}`);
  }
};

// ── FILTER SETUP ─────────────────────────────────────────────
function setupFilters() {
  // Terminal log filter pills
  el.logFilterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      el.logFilterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.logFilter = btn.getAttribute('data-logfilter');
      renderTerminalLogs();
    });
  });

  // QA filter pills
  el.qaPillBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      el.qaPillBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeQaFilter = btn.getAttribute('data-qafilter');
      renderQaBank();
    });
  });

  // QA search
  if (el.qaSearchInput) {
    el.qaSearchInput.addEventListener('input', (e) => {
      state.qaSearch = e.target.value;
      renderQaBank();
    });
  }

  // Applications search & dropdown
  if (el.appsSearchInput) {
    el.appsSearchInput.addEventListener('input', (e) => {
      state.appsSearch = e.target.value;
      renderApplications();
    });
  }

  if (el.appsSiteFilter) {
    el.appsSiteFilter.addEventListener('change', (e) => {
      state.appsSiteFilter = e.target.value;
      renderApplications();
    });
  }

  // Sync button
  if (el.btnRefreshAll) el.btnRefreshAll.addEventListener('click', syncAll);
}

// Utility
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Initializer
window.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupFilters();
  setupLogStream();
  syncAll();

  // Polling every 3 seconds for active runners and stats
  setInterval(fetchStats, 3000);
});
