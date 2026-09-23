/**
 * dashboard/server.js
 * Lightweight local dashboard server & live command center for Naukri & Indeed Auto-Apply.
 * Run via: npm run dashboard  (or node dashboard/server.js)
 */
'use strict';

const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');
const { spawn } = require('child_process');

const PORT = parseInt(process.env.PORT || '3456', 10);
const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(__dirname, 'public');
const ENV_PATH = path.join(ROOT, '.env');

const qaManager = require('../shared/runner/qa-manager');
const { loadResumeConfig, RESUMES_DIR, CONFIG_FILE: RESUMES_CONFIG_FILE } = require('../shared/runner/resume-selector');

// Track active child processes spawned from the dashboard
const activeProcesses = {
  naukri:    null,
  indeed:    null,
  all:       null,
};

// Circular In-Memory Log Buffer & SSE Client Management
const MAX_LOGS = 2500;
let logIdCounter = 0;
const logBuffer = [];
const sseClients = new Set();

function cleanAnsi(text) {
  return String(text || '').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

function detectLogLevel(text) {
  const t = text.toLowerCase();
  if (t.includes('[paused]') || t.includes('[auto-apply-pause]') || t.includes('unknown question')) return 'pause';
  if (t.includes('error') || t.includes('fail') || t.includes('fatal') || t.includes('exception')) return 'error';
  if (t.includes('warn') || t.includes('⚠') || t.includes('cloudflare') || t.includes('turnstile')) return 'warn';
  if (t.includes('submitted') || t.includes('success') || t.includes('✅') || t.includes('sent')) return 'success';
  if (t.includes('applying:') || t.includes('▶') || t.includes('🖱') || t.includes('step')) return 'action';
  return 'info';
}

function addLog(rawText, platform = 'system', explicitLevel = null) {
  const clean = cleanAnsi(rawText).trimEnd();
  if (!clean) return;

  const lines = clean.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const level = explicitLevel || detectLogLevel(line);
    const entry = {
      id: ++logIdCounter,
      time: new Date().toLocaleTimeString(),
      platform: platform.toLowerCase(),
      level,
      text: line,
    };

    logBuffer.push(entry);
    if (logBuffer.length > MAX_LOGS) {
      logBuffer.shift();
    }

    // Broadcast to SSE clients
    const payload = `data: ${JSON.stringify(entry)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(payload);
        if (level === 'pause') {
          client.write(`event: pause\ndata: ${JSON.stringify(entry)}\n\n`);
        }
      } catch (_) {
        sseClients.delete(client);
      }
    }

    // Also echo to node console
    const colorTag = platform === 'indeed' ? '\x1b[32m[indeed]\x1b[0m' :
                     platform === 'naukri' ? '\x1b[34m[naukri]\x1b[0m' : '\x1b[36m[system]\x1b[0m';
    process.stdout.write(`${colorTag} ${line}\n`);
  }
}

// ── .ENV SETTINGS MANAGEMENT ─────────────────────────────────
function parseEnvFile() {
  const result = {};
  if (!fs.existsSync(ENV_PATH)) return result;
  const content = fs.readFileSync(ENV_PATH, 'utf8').replace(/^\uFEFF/, '');
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[m[1]] = val;
  }
  return result;
}

function getSettingsStructured() {
  const env = parseEnvFile();
  const highlights = (env.HIGHLIGHTS || '')
    .split('||')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    identity: {
      name:     env.NAME || '',
      email:    env.EMAIL || '',
      phone:    env.PHONE || '',
      location: env.LOCATION || '',
      dob:      env.DOB || '',
      gender:   env.GENDER || 'Male',
    },
    profile: {
      currentRole:     env.CURRENT_ROLE || '',
      company:         env.COMPANY || '',
      education:       env.EDUCATION || '',
      yearsExperience: env.YEARS_EXPERIENCE || '',
      skills:          env.SKILLS || '',
    },
    highlights: highlights.length > 0 ? highlights : ['', '', '', '', ''],
    applicationAnswers: {
      noticePeriod: env.NOTICE_PERIOD || 'Immediate (0 days)',
      currentCTC:   env.CURRENT_CTC || '0',
      expectedCTC:  env.EXPECTED_CTC || '3-5',
      workAuth:     env.WORK_AUTH || 'Authorized to work in my country of residence.',
    },
    links: {
      github:    env.GITHUB_URL || '',
      linkedin:  env.LINKEDIN_URL || '',
      portfolio: env.PORTFOLIO_URL || '',
    },
    automation: {
      minDelay:         env.MIN_DELAY_SECONDS || '5',
      maxDelay:         env.MAX_DELAY_SECONDS || '10',
      geminiKey:        env.GEMINI_KEY || '',
      naukriProfileUrl: env.NAUKRI_PROFILE_URL || 'https://www.naukri.com/mnjuser/profile',
      browserChannel:   env.BROWSER_CHANNEL || 'msedge',
    },
    credentials: {
      googleEmail: env.GOOGLE_EMAIL || '',
      password:    env.PASSWORD || '',
    }
  };
}

function saveSettingsStructured(settings) {
  const existing = parseEnvFile();
  const id = settings.identity || {};
  const prof = settings.profile || {};
  const appAns = settings.applicationAnswers || {};
  const links = settings.links || {};
  const auto = settings.automation || {};
  const creds = settings.credentials || {};
  const rawHighlights = Array.isArray(settings.highlights)
    ? settings.highlights.map((h) => String(h).trim()).filter(Boolean).join('||')
    : String(settings.highlights || '');

  const finalPassword = creds.password || existing.PASSWORD || existing.GOOGLE_PASSWORD || '';
  const finalGooglePassword = creds.googlePassword || creds.password || existing.GOOGLE_PASSWORD || existing.PASSWORD || '';

  const lines = [
    '# ============================================================',
    '#  Auto-Apply config — Generated & Managed via Command Center',
    '# ============================================================',
    '',
    '# --- Login credentials (used for auto-login) ---',
    `GOOGLE_EMAIL=${creds.googleEmail || id.email || existing.GOOGLE_EMAIL || ''}`,
    `GOOGLE_PASSWORD=${finalGooglePassword}`,
    `PASSWORD=${finalPassword}`,
    '',
    '# --- Naukri ---',
    `NAUKRI_PROFILE_URL=${auto.naukriProfileUrl || existing.NAUKRI_PROFILE_URL || 'https://www.naukri.com/mnjuser/profile'}`,
    '',
    '# --- Identity / contact ---',
    `NAME=${id.name || ''}`,
    `EMAIL=${id.email || ''}`,
    `PHONE=${id.phone || ''}`,
    `LOCATION=${id.location || ''}`,
    '',
    '# --- Profile ---',
    `CURRENT_ROLE=${prof.currentRole || ''}`,
    `COMPANY=${prof.company || ''}`,
    `EDUCATION=${prof.education || ''}`,
    `YEARS_EXPERIENCE=${prof.yearsExperience || ''}`,
    `SKILLS=${prof.skills || ''}`,
    '',
    '# Up to 5 resume highlights, separated by ||',
    `HIGHLIGHTS=${rawHighlights}`,
    '',
    '# --- Application answers ---',
    `NOTICE_PERIOD=${appAns.noticePeriod || 'Immediate (0 days)'}`,
    `CURRENT_CTC=${appAns.currentCTC || '0'}`,
    `EXPECTED_CTC=${appAns.expectedCTC || '3-5'}`,
    `DOB=${id.dob || ''}`,
    `GENDER=${id.gender || 'Male'}`,
    `WORK_AUTH=${appAns.workAuth || 'Authorized to work in my country of residence.'}`,
    '',
    '# --- Links ---',
    `GITHUB_URL=${links.github || ''}`,
    `LINKEDIN_URL=${links.linkedin || ''}`,
    `PORTFOLIO_URL=${links.portfolio || ''}`,
    '',
    '# --- Optional: Gemini API key fallback for unmatched questions ---',
    `GEMINI_KEY=${auto.geminiKey || ''}`,
    '',
    '# --- Speed & Delays between applications (seconds) ---',
    `MIN_DELAY_SECONDS=${auto.minDelay || '5'}`,
    `MAX_DELAY_SECONDS=${auto.maxDelay || '10'}`,
    '',
    '# --- Browser Configuration ---',
    `BROWSER_CHANNEL=${auto.browserChannel || existing.BROWSER_CHANNEL || 'msedge'}`,
    '',
  ];

  fs.writeFileSync(ENV_PATH, lines.join('\n'), 'utf8');

  // Also update current process.env
  const updated = parseEnvFile();
  for (const [k, v] of Object.entries(updated)) {
    process.env[k] = v;
  }
}

// ── UTILITIES ────────────────────────────────────────────────
function readJsonSafe(filePath, fallback = {}) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (_) {}
  return fallback;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseCSVRows(csvPath) {
  if (!fs.existsSync(csvPath)) return [];
  try {
    const raw = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return [];

    const firstRowValues = parseCSVLine(lines[0]);
    const isHeaderRow = /^(date|site|role|company|timestamp)/i.test(firstRowValues[0] || '') ||
                        /^(date|site|role)/i.test(firstRowValues[1] || '');

    const startIndex = isHeaderRow ? 1 : 0;
    const items = [];

    for (let i = startIndex; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (!values || values.length === 0) continue;

      items.push({
        date:       values[0] || '',
        site:       values[1] || '',
        role:       values[2] || '',
        company:    values[3] || '',
        experience: values[4] || '',
        salary:     values[5] || '',
        skills:     values[6] || '',
        link:       values[7] || '',
        jd:         values[8] || '',
      });
    }
    return items.reverse(); // Most recent first
  } catch (_) {
    return [];
  }
}

function getStats() {
  const nk = readJsonSafe(path.join(ROOT, 'apply-state-naukri.json'), { count: 0, date: '' });
  const ind = readJsonSafe(path.join(ROOT, 'apply-state-indeed.json'), { count: 0, date: '' });

  const apps = parseCSVRows(path.join(ROOT, 'applications.csv'));
  const qaBank = qaManager.getQABank();
  const knownCount = Object.keys(qaBank.answers || {}).length;
  const unansweredCount = Array.isArray(qaBank.unanswered)
    ? qaBank.unanswered.length
    : Object.keys(qaBank.unanswered || {}).length;

  const runners = {
    naukri:    !!(activeProcesses.naukri && !activeProcesses.naukri.killed),
    indeed:    !!(activeProcesses.indeed && !activeProcesses.indeed.killed),
    all:       !!(activeProcesses.all && !activeProcesses.all.killed),
  };

  return {
    quota: {
      naukri:    { count: nk.count || 0, limit: 50, date: nk.date || '' },
      indeed:    { count: ind.count || 0, limit: 60, date: ind.date || '' },
    },
    platforms: {
      naukri:    { count: nk.count || 0, cap: 50, date: nk.date || '' },
      indeed:    { count: ind.count || 0, cap: 60, date: ind.date || '' },
    },
    totalApplications: apps.length,
    qaBank: {
      knownCount,
      unansweredCount,
    },
    runners,
    recentApplications: apps.slice(0, 10),
  };
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// ── RUNNER SPAWNER WITH PIPE STREAMING ───────────────────────
function launchRunnerProcess(target, live = false) {
  if (activeProcesses[target] && !activeProcesses[target].killed) {
    throw new Error(`Runner for ${target} is already running`);
  }

  const args = [path.join(ROOT, 'index.js'), target, '--no-watch'];
  if (live) args.push('--live');

  addLog(`🚀 [LAUNCH] Starting ${target.toUpperCase()} runner (mode: ${live ? 'LIVE' : 'DRY RUN'})...`, target, 'action');

  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, AA_CHILD: '1', AA_SITE: target },
  });

  activeProcesses[target] = child;

  child.stdout.on('data', (buf) => {
    addLog(buf.toString('utf8'), target);
  });

  child.stderr.on('data', (buf) => {
    addLog(buf.toString('utf8'), target, 'error');
  });

  child.on('exit', (code, signal) => {
    activeProcesses[target] = null;
    const msg = `🛑 [EXIT] ${target.toUpperCase()} runner stopped (code: ${code}, signal: ${signal || 'none'})`;
    addLog(msg, target, code === 0 ? 'info' : 'warn');
  });

  child.on('error', (err) => {
    activeProcesses[target] = null;
    addLog(`❌ [PROCESS ERROR] ${target}: ${err.message}`, target, 'error');
  });

  return child;
}

// ── HTTP SERVER ──────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // ── SERVER-SENT EVENTS (SSE) FOR LIVE LOGS ───────────────────
  if (pathname === '/api/runner/logs/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(`data: ${JSON.stringify({ type: 'connected', text: 'Connected to live log stream' })}\n\n`);

    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // ── API ROUTES ──────────────────────────────────────────────
  if (pathname === '/api/runner/logs' && req.method === 'GET') {
    return sendJson(res, 200, { logs: logBuffer });
  }

  if (pathname === '/api/runner/clear-logs' && req.method === 'POST') {
    logBuffer.length = 0;
    for (const client of sseClients) {
      try { client.write(`event: clear\ndata: {}\n\n`); } catch (_) {}
    }
    return sendJson(res, 200, { success: true });
  }

  if (pathname === '/api/settings' && req.method === 'GET') {
    return sendJson(res, 200, getSettingsStructured());
  }

  if (pathname === '/api/settings' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      saveSettingsStructured(body);
      addLog(`⚙️ Candidate profile & .env settings updated via dashboard.`, 'system', 'success');
      return sendJson(res, 200, { success: true, settings: getSettingsStructured() });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (pathname === '/api/stats' && req.method === 'GET') {
    return sendJson(res, 200, getStats());
  }

  if (pathname === '/api/qa-bank' && req.method === 'GET') {
    return sendJson(res, 200, qaManager.getQABank());
  }

  if ((pathname === '/api/qa-bank' || pathname === '/api/qa-bank/answer') && req.method === 'POST') {
    try {
      const { question, answer } = await parseBody(req);
      if (!question || !question.trim()) {
        return sendJson(res, 400, { error: 'Question is required' });
      }
      const ansTrimmed = String(answer || '').trim();
      qaManager.recordQA({
        question: question.trim(),
        answer: ansTrimmed,
        status: ansTrimmed ? 'known' : 'unanswered',
        source: 'user',
      });
      qaManager.saveQABankNow();
      addLog(`❓ [QA BANK] Saved question: "${question.trim()}" ${ansTrimmed ? `-> "${ansTrimmed}"` : '(pending answer)'}`, 'system', 'success');
      return sendJson(res, 200, { success: true, qaBank: qaManager.getQABank() });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (pathname === '/api/qa-bank/delete' && req.method === 'POST') {
    try {
      const { question, section } = await parseBody(req);
      const bank = qaManager.getQABank();
      const qKey = String(question || '').toLowerCase().replace(/[?*:]+$/g, '').trim();

      if (section === 'answers' && bank.answers) {
        delete bank.answers[qKey];
        delete bank.answers[question];
      } else if (section === 'unanswered') {
        if (Array.isArray(bank.unanswered)) {
          bank.unanswered = bank.unanswered.filter((item) => {
            const q = typeof item === 'string' ? item : item.question;
            return q !== question && q.toLowerCase().replace(/[?*:]+$/g, '').trim() !== qKey;
          });
        } else if (bank.unanswered && typeof bank.unanswered === 'object') {
          delete bank.unanswered[qKey];
          delete bank.unanswered[question];
        }
      }
      qaManager.saveQABankNow();
      return sendJson(res, 200, { success: true, qaBank: bank });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (pathname === '/api/applications' && req.method === 'GET') {
    const apps = parseCSVRows(path.join(ROOT, 'applications.csv'));
    return sendJson(res, 200, { applications: apps });
  }

  if (pathname === '/api/resumes' && req.method === 'GET') {
    const config = loadResumeConfig();
    let availableFiles = [];
    try {
      if (fs.existsSync(RESUMES_DIR)) {
        availableFiles = fs.readdirSync(RESUMES_DIR)
          .filter((f) => f.endsWith('.pdf'))
          .map((f) => {
            const stats = fs.statSync(path.join(RESUMES_DIR, f));
            return { name: f, size: stats.size };
          });
      }
    } catch (_) {}
    return sendJson(res, 200, {
      config,
      profiles: config.profiles || config.roles || [],
      availableFiles,
      files: availableFiles.map((f) => f.name),
    });
  }

  if (pathname === '/api/resumes/config' && req.method === 'POST') {
    try {
      const newConfig = await parseBody(req);
      fs.writeFileSync(RESUMES_CONFIG_FILE, JSON.stringify(newConfig, null, 2), 'utf8');
      addLog(`📁 Resume mapping config updated via dashboard.`, 'system', 'success');
      return sendJson(res, 200, { success: true, config: newConfig });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (pathname === '/api/runner/status' && req.method === 'GET') {
    const status = {};
    for (const [k, p] of Object.entries(activeProcesses)) {
      status[k] = !!(p && !p.killed);
    }
    return sendJson(res, 200, status);
  }

  if (pathname === '/api/runner/start' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const target = body.platform || body.site || 'all';
      const live = !!body.live;

      const child = launchRunnerProcess(target, live);
      return sendJson(res, 200, { success: true, target, live, pid: child.pid });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (pathname === '/api/runner/stop' && req.method === 'POST') {
    try {
      const { site, platform } = await parseBody(req);
      const target = platform || site;
      let stoppedCount = 0;

      if (target && activeProcesses[target]) {
        try { activeProcesses[target].kill(); } catch (_) {}
        activeProcesses[target] = null;
        stoppedCount++;
        addLog(`🛑 Stopped runner: ${target}`, target, 'warn');
      } else {
        for (const [k, p] of Object.entries(activeProcesses)) {
          if (p) {
            try { p.kill(); } catch (_) {}
            activeProcesses[k] = null;
            stoppedCount++;
          }
        }
        addLog(`🛑 Stopped all active runners.`, 'system', 'warn');
      }
      return sendJson(res, 200, { success: true, stoppedCount });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // ── STATIC FILES ────────────────────────────────────────────
  let reqPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC_DIR, reqPath);

  // Security: prevent path traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404 Not Found');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Error: Port ${PORT} is already in use by another process.`);
    console.error(`💡 Tip: Run 'taskkill /F /IM node.exe' or kill the existing server, or pass PORT=3457.\n`);
    process.exit(1);
  } else {
    throw err;
  }
});

server.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`⚡ Auto-Apply Command Center running at:`);
  console.log(`👉 http://localhost:${PORT}`);
  console.log(`==================================================\n`);
  addLog(`Command Center initialized on port ${PORT}. Ready to launch runners.`, 'system', 'info');
});

module.exports = server;
