// In-page shared utilities for DOM queries, delay timers, and form answering.

function log(...args) {
  const msg = args.map(String).join(' ');
  console.log(`[auto-apply] ${msg}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function humanDelay() {
  // In dry-run mode skip the full human delay — no need to appear human
  if (typeof CONFIG !== 'undefined' && CONFIG.DRY_RUN) {
    log('⏳ [Timer] DRY_RUN — skipping human delay');
    await sleep(1200);
    return;
  }
  const min = CONFIG.MIN_DELAY_MS ?? 5000;
  const max = Math.max(min, CONFIG.MAX_DELAY_MS ?? 10000);
  const totalMs = min + Math.random() * (max - min);
  let remainingSec = Math.round(totalMs / 1000);

  while (remainingSec > 0) {
    log(`⏳ [Timer] Next application in: ${remainingSec}s`);
    await sleep(1000);
    remainingSec--;
  }
}

async function waitFor(fn, timeout = 15000, interval = 300) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const result = fn();
      if (result) return result;
    } catch (_) {}
    await sleep(interval);
  }
  return null;
}

const visible = (el) => {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
};

function setValue(el, rawVal) {
  const value = String(rawVal ?? '');
  const proto = Object.getPrototypeOf(el);
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

  if (el._valueTracker) {
    el._valueTracker.setValue('');
  }

  if (nativeSetter) {
    nativeSetter.call(el, value);
  } else {
    el.value = value;
  }

  el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
  el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
}

function labelTextOf(field) {
  if (field.id) {
    const lbl = document.querySelector(`label[for="${CSS.escape(field.id)}"]`);
    if (lbl) return lbl.textContent.trim();
  }
  if (field.getAttribute('aria-label')) {
    return field.getAttribute('aria-label').trim();
  }
  if (field.getAttribute('aria-labelledby')) {
    const ids = field.getAttribute('aria-labelledby').split(/\s+/);
    const text = ids.map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
    if (text) return text;
  }
  const wrapped = field.closest('label');
  if (wrapped) return wrapped.textContent.replace(field.value || '', '').trim();
  if (field.placeholder) return field.placeholder.trim();
  const ancestor = field.closest(
    '[class*="field" i], [class*="input" i], [class*="form-group" i], [data-testid*="form" i], fieldset, div'
  );
  return (ancestor?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function findButtonByText(scope, pattern) {
  const host = scope || document;
  return [...host.querySelectorAll(
    'button, input[type="submit"], [role="button"], [type="button"], a.btn'
  )].find((b) => {
    if (!visible(b)) return false;
    if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
    const text = (b.textContent || b.value || '').trim();
    return pattern.test(text);
  });
}

function cleanTitle(raw) {
  if (!raw) return '';
  let t = raw
    .replace(/(?:₹|\$|€)\s?[\d.,kLM]+(?:\s?[–-]\s?(?:₹|\$|€)?\s?[\d.,kLM]+)?/gi, '')
    .replace(/\b(?:Easily apply|Apply with your Indeed Resume|Urgent hiring|Responsive employer|Hiring multiple candidates|Actively Hiring|Recruiter recently active|Posted(?:\s+\d+\+?\s*)?(?:today|yesterday|\d+\s*days?\s*ago|\d+\s*weeks?\s*ago)|icn_repost|No equity)\b/gi, '')
    .replace(/\b(?:Remote only|Remote\s*\([^)]+\)|Onsite or remote|In office|Everywhere|Hybrid|On-?site)\b/gi, '')
    .replace(/\b(?:India|Hyderabad|Delhi|Bangalore(?:\s*Urban)?|Bengaluru|Pune|Mumbai|Noida|Gurgaon|Gurugram|United States|New York(?:\s*City)?|San Francisco|California|Boston|Atlanta|Seattle|Chicago|Los Angeles|Europe|Canada|Brazil)\b/gi, '')
    .replace(/\bL\s*[–-]\s*L\b/gi, '')
    .replace(/[•·|].*/, '')
    .replace(/\s+/g, ' ')
    .trim();

  const cut = t.match(/^(.+?)(?:Remote|Onsite|In office|Posted|Recruiter|Actively|$)/i);
  return (cut ? cut[1] : t).replace(/\s+/g, ' ').trim();
}

function cleanCompany(raw) {
  if (!raw) return '';
  return raw
    .replace(/^apply\s+(?:to|at|for)\s+/i, '')
    .split(/(?:Actively|Hiring|solves|elevates?|employees|Transforming|clinical|Building|Empowering|Leading|Backed|Seed|Series\s*[A-C]|Stealth)/i)[0]
    .replace(/(?:company )?logo/i, '')
    .replace(/[•·|].*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Gemini Integration ─────────────────────────────────────────

const CV_SUMMARY = [
  `Name: ${CV.name}`,
  `Current Role: ${CV.currentRole}`,
  `Experience: ${CV.yearsOfExperience}`,
  `Skills: ${CV.skills}`,
  `Education: ${CV.education}`,
  `Location: ${CV.location || 'India'} (open to onsite across India + remote globally)`,
  `Notice Period: ${CV.noticePeriod}`,
  `Expected Salary: ${CV.expectedSalary}`,
  `GitHub: ${CV.github}`,
  `LinkedIn: ${CV.linkedin}`,
  `Portfolio: ${CV.portfolio}`,
  `Key Projects:\n- ${(CV.highlights || []).filter(Boolean).join('\n- ')}`,
].join('\n').trim();

async function geminiAsk(prompt) {
  if (!CONFIG.geminiKey) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${CONFIG.geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 400 },
        }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch (e) {
    return null;
  }
}

// ── Cover Letter Generator ─────────────────────────────────────

function coverLetter(company, title) {
  const cleanComp = cleanCompany(company);
  const recipient = cleanComp ? cleanComp + ' team' : 'Hiring Manager';
  const skillsList = (CV.skills || '').split(',').slice(0, 6).map((s) => s.trim()).filter(Boolean).join(', ') || 'modern software engineering';
  const h = CV.highlights || [];

  return (
    `Dear ${recipient},\n\n` +
    `I am writing to express my strong interest in the ${title || 'Software Engineer'} role at ${cleanComp || 'your company'}.\n\n` +
    `I am ${CV.name}, a ${CV.currentRole || 'software engineer'} with practical experience in ${skillsList}. ` +
    `A key highlight from my experience: ${h[0] || 'building end-to-end full stack applications'}.\n\n` +
    `${h[1] ? h[1] + ' ' : ''}` +
    `I am excited about this role because it directly aligns with my technical background, and I can contribute effectively from day one with zero ramp-up time.\n\n` +
    `Thank you for your consideration.\n\n` +
    `Best regards,\n${CV.name}\n${CV.phone} | ${CV.email}\n${CV.linkedin} | ${CV.github}`
  );
}

// ── Factual Q&A Bank ───────────────────────────────────────────

const FACTUAL_QA = [
  // ── Primary skills / tech ────────────────────────────────────────────────
  [/primary (programming )?language|core language|coding language|main language/i,
    'JavaScript, TypeScript, Python'],
  [/technologies|tech stack|skills/i,
    CV.skills || 'JavaScript, TypeScript, React, Node.js, Python'],
  [/company name|current (company|employer)|organi[sz]ation/i,
    CV.company || ''],

  // ── Experience ───────────────────────────────────────────────────────────
  [/years? of (work |professional )?experience|how (long|many years)|total experience/i,
    `I have ${CV.yearsOfExperience || '1 year of experience'}. Hands-on with ${(CV.skills || '').split(',').slice(0, 6).join(', ') || 'modern web development'}.`],
  [/\byears? of exp|experience.*years?|how many years/i, CV.yearsOfExperience || '1'],

  // Notice period
  [/notice.*month|notice.*in month/i,    String(Math.floor((Number(CV.noticePeriodDays) || 0) / 30) || '0')],
  [/notice.*week|notice.*in week/i,      String(Math.floor((Number(CV.noticePeriodDays) || 0) / 7)  || '0')],
  [/notice period|when can you (start|join)|start date|joining/i,
    CV.startDate || 'Immediate'],

  // ── Salary — current CTC (lakh / monthly / raw) ──────────────────────────
  [/current.{0,20}(ctc|salary|compensation).*(lpa|lakh)/i,
    String(CV.currentCTC || '0').replace(/[^0-9.]/g, '') || '0'],
  [/current.{0,20}(ctc|salary|compensation).*month/i,
    String(Math.round((Number(String(CV.currentSalary || '0').replace(/[^0-9]/g, '')) || 0) / 12))],
  [/current.{0,20}(ctc|salary|compensation)/i,
    CV.currentSalary || '0'],

  // ── Salary — expected / desired CTC (lakh / monthly / raw) ───────────────
  [/(expected|desired).{0,20}(ctc|salary|compensation|pay).*(lpa|lakh)/i,
    String(CV.expectedCTC || '4').match(/\d+/)?.[0] || '4'],
  [/(expected|desired).{0,20}(ctc|salary|compensation|pay).*month/i,
    String(Math.round((Number(String(CV.expectedSalary || '4').replace(/[^0-9]/g, '')) || 400000) / 12))],
  [/(expected|desired).{0,20}(ctc|salary|compensation|pay)|salary expectation/i,
    CV.expectedSalary || '4-6 LPA'],

  // Name variants
  [/first\s*name/i,    (CV.name || '').split(' ')[0] || CV.name],
  [/middle\s*name/i,   (CV.name || '').split(' ').slice(1, -1).join(' ') || ''],
  [/last\s*name|surname/i,
    (CV.name || '').split(' ').length > 1
      ? (CV.name || '').split(' ').slice(-1)[0]
      : (CV.name || '').split(' ')[0]],
  [/full\s*name|your\s*name|\bname\b/i, CV.name],
  [/signature|legal name/i, CV.name],

  // ── Contact ───────────────────────────────────────────────────────────────
  [/phone|mobile|contact number/i, CV.phone],
  [/e-?mail/i,                     CV.email],

  // ── Location ─────────────────────────────────────────────────────────────
  [/\bstreet\b|address/i,            CV.street  || '123 Main Street'],
  [/\bstate\b|province/i,            CV.state   || 'Maharashtra'],
  [/zip|postal code/i,               CV.zipcode || '400001'],
  [/\bcountry\b/i,                   CV.country || 'India'],
  [/\bcity\b|current location|where are you (based|located)/i,
    (CV.location || 'India').split(',')[0].trim()],

  // ── Education ─────────────────────────────────────────────────────────────
  [/education|degree|university|college|qualification/i, CV.education || "Bachelor's Degree"],
  [/bachelor|degree level/i, "Bachelor's"],
  [/cgpa|gpa|percentage|marks|aggregate/i, '8.2'],

  // Diversity & EEO
  [/disability|handicapped/i,        CV.disabilityStatus   || 'No'],
  [/veteran|protected\s*veteran/i,   CV.veteranStatus      || 'No'],
  [/gender|sex(?!ual)/i,             CV.gender             || 'Male'],
  [/ethnicity|race/i,                CV.ethnicity          || 'Decline'],
  [/citizenship|employment eligibility|authorized to work/i,
    CV.usCitizenship || 'Yes'],

  // ── Proficiency / confidence ──────────────────────────────────────────────
  [/scale of 1.{0,4}10|confidence level|rate yourself|on a scale/i,
    CV.confidenceLevel || '7'],
  [/proficiency/i, 'Professional'],

  // ── Online presence ───────────────────────────────────────────────────────
  [/linkedin/i,          CV.linkedin],
  [/github/i,            CV.github],
  [/portfolio|personal website/i, CV.portfolio],
  [/website|blog|link/i, CV.portfolio || CV.github],
  [/headline/i,          CV.headline  || CV.currentRole],
  [/summary/i,           CV.summary   || ''],
  [/recent\s*employer|current\s*employer/i, CV.company || 'Not Applicable'],

  // ── Work preferences ──────────────────────────────────────────────────────
  [/remote|work from home|wfh/i,
    'Yes, I am fully set up for remote work and open to hybrid/onsite.'],
  [/reloc|move to|shift to|work from (our )?office|on-?site|willing to work.*office/i,
    'Yes, I am open to relocation across India and remote roles globally.'],
  [/visa|sponsorship|require (visa )?sponsorship/i, 'No'],
  [/authorized|eligible to work|legally authorized/i, 'Yes'],
  [/immediate joiner|available immediately/i, 'Yes'],
  [/laptop|own (device|computer|system)|reliable internet/i, 'Yes'],
  [/languages? (known|spoken|proficiency)/i, 'English, Hindi'],
  [/willing to work (from )?office|in-?office/i, 'Yes'],

  // ── Misc / additional ─────────────────────────────────────────────────────
  [/are you a fresher|fresher candidate/i,
    'Yes, I am a fresher with hands-on full-stack development experience.'],
  [/date of birth|dob|birthday/i, CV.dob || ''],
  [/hear.{0,20}(this|about)|come across.{0,20}(job|position)/i, CV.linkedin || CV.github],

  // ── Employment status ────────────────────────────────────────────────────
  [/currently employed|are you employed|employment status/i, 'Yes, currently interning.'],
  [/gap in (employment|career)|career gap/i, 'No significant gap — I have been interning and building projects.'],

  // ── Salary negotiation ────────────────────────────────────────────────────
  [/salary negotiable|open to discussion/i, 'Yes, open to discussion.'],
  [/annual package|annual salary|annual ctc/i, CV.expectedSalary || '4-6 LPA'],

  // ── Academic marks ────────────────────────────────────────────────────────
  [/12th.*(?:marks|percentage|score)|hsc.*(?:marks|percentage)/i, '82'],
  [/10th.*(?:marks|percentage|score)|ssc.*(?:marks|percentage)/i, '85'],

  // ── Availability & joining ────────────────────────────────────────────────
  [/when.*available|when.*join|earliest.*join/i, CV.startDate || 'Immediately'],
  [/shift|rotational|night\s*shift/i, 'Yes, I am open to any shift timings.'],
  [/bond|service agreement|lock.?in/i, 'Yes, I am open to signing a bond if required.'],

  // ── Technical specifics ────────────────────────────────────────────────────
  [/primary tech|primary framework|preferred stack/i,
    'MERN stack (MongoDB, Express, React, Node.js) with Python for AI/ML tasks.'],
  [/describe your project|tell.{0,10}project/i,
    (CV.highlights || [])[0] || 'Built end-to-end full-stack applications using React and Node.js.'],
  [/hobby|interests|outside.*work|personal interests/i,
    'Open source contributions, competitive programming, reading tech blogs, and building side projects.'],
  [/pincode|postal code|area code/i, CV.zipcode || '400001'],
  [/area|locality|locality name/i, (CV.street || '').split(',')[0].trim() || 'Main Area'],
];


const GENERIC_ANSWER = (() => {
  const hPart = CV.highlights.slice(0, 2).filter(Boolean).join('; ');
  return `I'm ${CV.name}, ${CV.currentRole || 'a software developer'}.` +
    (hPart ? ` Key highlights: ${hPart}.` : '');
})();

const OPEN_ENDED_RE =
  /why (do you want|are you interested|this role|this company|us|join)|tell (us|me) about yourself|introduce yourself|about you|(biggest|proudest|favorite) (project|achievement)|describe your (experience|background|skills?)|what (can you|do you) bring|strength|weakness|challenge|motivation/i;

// ── QA Bank Lookup & Recorder ──────────────────────────────────

function findQABankAnswer(qaBank, questionText) {
  const bank = qaBank || (typeof QA_BANK !== 'undefined' ? QA_BANK : null) || (typeof CONFIG !== 'undefined' ? CONFIG.QA_BANK : null);
  if (!bank || typeof bank !== 'object') return null;

  const rawQ = String(questionText || '').trim();
  if (!rawQ) return null;

  const qNorm = rawQ.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!qNorm) return null;

  // Combine answers and any non-empty answers from unanswered
  const entries = [
    ...Object.entries(bank.answers || {}),
    ...Object.entries(bank.unanswered || {}).filter(([_, v]) => v !== undefined && v !== null && String(v).trim().length > 0 && String(v).trim() !== '[NEEDS_ANSWER]')
  ];

  // 1. Exact match (normalized)
  for (const [key, val] of entries) {
    if (val === undefined || val === null || val === '') continue;
    const kNorm = String(key).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (kNorm === qNorm) return String(val);
  }

  // 2. Regex pattern match if key is in /pattern/flags format
  for (const [key, val] of entries) {
    if (val === undefined || val === null || val === '') continue;
    if (key.startsWith('/') && key.lastIndexOf('/') > 0) {
      try {
        const lastSlash = key.lastIndexOf('/');
        const pat = key.slice(1, lastSlash);
        const flags = key.slice(lastSlash + 1) || 'i';
        const re = new RegExp(pat, flags);
        if (re.test(rawQ)) return String(val);
      } catch (_) {}
    }
  }

  // 3. Substring match (if key length >= 4)
  for (const [key, val] of entries) {
    if (val === undefined || val === null || val === '') continue;
    const kNorm = String(key).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (kNorm.length >= 4) {
      // Question contains the bank key (e.g. "what is your notice period?" contains "notice period")
      if (qNorm.includes(kNorm)) return String(val);
      // Bank key contains the question ONLY if the question is a multi-word specific phrase
      if (qNorm.length >= 8 && qNorm.includes(' ') && kNorm.includes(qNorm)) return String(val);
    }
  }

  // 4. Multi-word keyword overlap (if >= 2 words in key and all present in question)
  for (const [key, val] of entries) {
    if (val === undefined || val === null || val === '') continue;
    const words = String(key).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);
    if (words.length >= 2 && words.every(w => qNorm.includes(w))) {
      return String(val);
    }
  }

  return null;
}

function emitQARecord(item) {
  try {
    const payload = JSON.stringify({
      question: String(item.question || '').slice(0, 150),
      answer:   String(item.answer   || '').slice(0, 300),
      status:   item.status || 'known',
      source:   item.source || 'unknown',
    });
    console.log(`[auto-apply] [auto-apply-qa] ${payload}`);
  } catch (_) {}
}

const _sharedGeminiCache = (() => {
  // Use localStorage so cache survives page navigations within the same session
  try { return new Map(JSON.parse(localStorage.getItem('_aaGeminiCache') || '[]')); }
  catch (_) { return new Map(); }
})();

function _cacheSet(k, v) {
  _sharedGeminiCache.set(k, v);
  try { localStorage.setItem('_aaGeminiCache', JSON.stringify([..._sharedGeminiCache.entries()].slice(-200))); } catch (_) {}
}

function playAlertBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (_) {}
}

function promptUserForAnswer(questionText, defaultVal = '', options = []) {
  playAlertBeep();
  log(`🚨 [PAUSED] Unknown question: "${questionText.slice(0, 60)}" — Auto-Apply paused!`);
  log(`👉 Pop-up alert opened in Chrome window. Enter your answer to continue.`);

  try {
    console.log(`[auto-apply] [auto-apply-pause] ${JSON.stringify({ question: questionText })}`);
    emitQARecord({ question: questionText, answer: '', status: 'unanswered', source: 'unknown' });
  } catch (_) {}

  return new Promise((resolve) => {
    try {
      const oldModal = document.getElementById('__aa_qa_modal');
      if (oldModal) oldModal.remove();

      const overlay = document.createElement('div');
      overlay.id = '__aa_qa_modal';
      overlay.style.cssText = [
        'position: fixed !important',
        'top: 0 !important',
        'left: 0 !important',
        'width: 100vw !important',
        'height: 100vh !important',
        'background: rgba(10, 10, 15, 0.82) !important',
        'z-index: 2147483647 !important',
        'display: flex !important',
        'align-items: center !important',
        'justify-content: center !important',
        'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important',
        'backdrop-filter: blur(5px) !important',
      ].join(';');

      const card = document.createElement('div');
      card.style.cssText = [
        'background: #181825 !important',
        'color: #cdd6f4 !important',
        'border: 2px solid #fab387 !important',
        'border-radius: 14px !important',
        'padding: 24px !important',
        'width: 540px !important',
        'max-width: 92vw !important',
        'box-shadow: 0 16px 40px rgba(0,0,0,0.7), 0 0 25px rgba(250, 179, 135, 0.35) !important',
      ].join(';');

      const safeQ = String(questionText || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safeVal = String(defaultVal || '').replace(/"/g, '&quot;');

      const optionsHtml = Array.isArray(options) && options.length > 0
        ? `
          <div style="margin-bottom:14px;">
            <div style="font-size:11px; text-transform:uppercase; color:#89b4fa; font-weight:700; margin-bottom:8px; letter-spacing:0.5px;">Click to select option:</div>
            <div style="display:flex; flex-wrap:wrap; gap:8px; max-height:160px; overflow-y:auto;">
              ${options.map((opt) => {
                const s = String(opt || '').trim();
                const safeOpt = s.replace(/"/g, '&quot;');
                const safeDisplay = s.replace(/</g, '&lt;');
                return `<button type="button" class="__aa_opt_btn" data-val="${safeOpt}" style="background:#313244; color:#cdd6f4; border:1px solid #45475a; border-radius:6px; padding:6px 12px; font-size:13px; cursor:pointer; font-weight:500;">${safeDisplay}</button>`;
              }).join('')}
            </div>
          </div>
        `
        : '';

      card.innerHTML = `
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:14px;">
          <div style="background:#452219; border-radius:50%; width:38px; height:38px; display:flex; align-items:center; justify-content:center; font-size:20px;">⚠️</div>
          <div>
            <h3 style="margin:0; font-size:18px; color:#fab387; font-weight:700;">Unknown Question — Auto-Apply Paused</h3>
            <p style="margin:3px 0 0; font-size:12px; color:#a6adc8;">Provide an answer so wrong data isn't submitted. This answer will be saved to <b>qa-bank.json</b>!</p>
          </div>
        </div>
        <div style="background:#11111b; border:1px solid #313244; border-radius:8px; padding:12px; margin-bottom:16px;">
          <div style="font-size:11px; text-transform:uppercase; color:#89b4fa; font-weight:700; margin-bottom:4px; letter-spacing:0.5px;">Question:</div>
          <div style="font-size:14px; line-height:1.45; color:#ffffff; font-weight:500;">${safeQ}</div>
        </div>
        ${optionsHtml}
        <div style="margin-bottom:18px;">
          <label style="display:block; font-size:12px; color:#cdd6f4; margin-bottom:6px; font-weight:600;">Your Answer:</label>
          <input id="__aa_qa_input" type="text" value="${safeVal}" placeholder="e.g. 1, Yes, Immediate, or your custom answer..." style="width:100%; box-sizing:border-box; padding:11px 14px; border-radius:8px; border:1.5px solid #45475a; background:#1e1e2e; color:#fff; font-size:14px; outline:none; transition:border 0.2s;" />
        </div>
        <div style="display:flex; justify-content:flex-end; gap:10px;">
          <button id="__aa_qa_skip" style="background:#313244; color:#cdd6f4; border:none; padding:10px 18px; border-radius:8px; font-size:13px; cursor:pointer; font-weight:600;">Skip Field</button>
          <button id="__aa_qa_save" style="background:#a6e3a1; color:#11111b; border:none; padding:10px 22px; border-radius:8px; font-size:13px; cursor:pointer; font-weight:700;">Save & Continue</button>
        </div>
      `;

      overlay.appendChild(card);
      (document.body || document.documentElement).appendChild(overlay);

      const input = card.querySelector('#__aa_qa_input');
      const saveBtn = card.querySelector('#__aa_qa_save');
      const skipBtn = card.querySelector('#__aa_qa_skip');

      card.querySelectorAll('.__aa_opt_btn').forEach((btn) => {
        btn.onclick = () => {
          if (input) input.value = btn.getAttribute('data-val') || btn.textContent.trim();
          if (saveBtn) saveBtn.click();
        };
      });

      setTimeout(() => {
        if (input) {
          input.focus();
          input.select();
        }
      }, 100);

      const cleanup = (val) => {
        overlay.remove();
        resolve(val);
      };

      saveBtn.onclick = () => {
        const val = input.value.trim();
        if (val) {
          emitQARecord({ question: questionText, answer: val, status: 'known', source: 'user' });
          if (typeof CONFIG !== 'undefined' && CONFIG.QA_BANK && CONFIG.QA_BANK.answers) {
            CONFIG.QA_BANK.answers[questionText.toLowerCase().trim()] = val;
          }
          log(`  ✅ [QA Bank] Answer saved by user: "${val}"`);
          cleanup(val);
        } else {
          input.style.borderColor = '#f38ba8';
        }
      };

      skipBtn.onclick = () => {
        log(`  ⏭ [QA Bank] User chose to skip unknown question`);
        emitQARecord({ question: questionText, answer: '', status: 'unanswered', source: 'unknown' });
        cleanup('');
      };

      input.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveBtn.click();
        }
      };
    } catch (err) {
      log(`  ⚠ Pop-up alert error: ${err.message}`);
      resolve('');
    }
  });
}

// ── Answer Resolution Pipeline ─────────────────────────────────

async function answerQuestion(questionText, options = []) {
  if (!questionText || !questionText.trim()) return '';

  // 1. Check QA Bank (Highest priority — uses user-defined answers)
  const bankAnswer = findQABankAnswer(CONFIG.QA_BANK, questionText);
  if (bankAnswer !== null && bankAnswer !== undefined && bankAnswer !== '') {
    log(`  💾 [QA Bank] Used saved answer for "${questionText.slice(0, 50)}": "${bankAnswer}"`);
    return bankAnswer;
  }

  // 2. Check built-in Factual Q&A rules
  for (const [pattern, answer] of FACTUAL_QA) {
    if (pattern.test(questionText)) {
      const factualAns = answer || '';
      emitQARecord({ question: questionText, answer: factualAns, status: 'known', source: 'profile' });
      return factualAns;
    }
  }

  // 3. Fallback to Gemini AI if configured
  if (CONFIG.geminiKey) {
    const cacheKey = questionText.toLowerCase().trim().slice(0, 120);
    if (_sharedGeminiCache.has(cacheKey)) {
      log(`  💾 Cached: "${questionText.slice(0, 50)}"`);
      return _sharedGeminiCache.get(cacheKey);
    }

    const isEssay = OPEN_ENDED_RE.test(questionText);
    log(`  🤖 Gemini answering: "${questionText.slice(0, 60)}"`);
    const ans = await geminiAsk(
      `You are filling a job application on behalf of ${CV.name}.\n` +
      `Question: "${questionText}"\n\n` +
      `Candidate Profile:\n${CV_SUMMARY}\n\n` +
      (isEssay
        ? `Rules: Answer in first person, 2-3 sentences, professional tone, no bullet points.`
        : `Rules: Direct answer only (e.g., a number, "Yes", or a short word). If it asks years of experience, answer "1". If yes/no, answer "Yes".`)
    );
    if (ans) {
      const result = ans.trim();
      _cacheSet(cacheKey, result);
      emitQARecord({ question: questionText, answer: result, status: 'known', source: 'gemini' });
      return result;
    }
  }

  // 4. Unknown question — pause application and pop alert so wrong data doesn't get filled!
  const userTyped = await promptUserForAnswer(questionText, '', options);
  if (userTyped !== null && userTyped !== undefined && String(userTyped).trim().length > 0) {
    return String(userTyped).trim();
  }

  // If user skipped
  emitQARecord({ question: questionText, answer: '', status: 'unanswered', source: 'unknown' });
  return '';
}
