// ============================================================
// SHARED UTILITIES — injected into the browser page.
// In-scope for finder.js, apply.js, loop.js across all platforms.
// ============================================================

function log(...args) {
  const msg = args.map(String).join(' ');
  console.log(`[auto-apply] ${msg}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function humanDelay() {
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
    .replace(/^apply to /i, '')
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
  [/primary (programming )?language|core language|coding language|main language/i,
    'JavaScript, TypeScript, Python'],
  [/technologies|tech stack|skills/i,
    CV.skills || 'JavaScript, TypeScript, React, Node.js, Python'],
  [/company name|current (company|employer)|organi[sz]ation/i,
    CV.company || ''],
  [/years? of (work |professional )?experience|how (long|many years)|total experience/i,
    `I have ${CV.yearsOfExperience || '1 year of experience'}. Hands-on with ${(CV.skills || '').split(',').slice(0, 6).join(', ') || 'modern web development'}.`],
  [/experience with (react|node|javascript|python|frontend|backend|web)/i,
    '1'],
  [/notice period|when can you (start|join)|start date|joining/i,
    CV.startDate || 'Available to join immediately.'],
  [/current .{0,15}(ctc|salary|compensation).*in (lpa|lakhs?)|current ctc/i,
    CV.currentCTC || '0'],
  [/current .{0,15}(ctc|salary|compensation)/i,
    CV.currentSalary || '0 LPA'],
  [/(expected|desired) .{0,15}(ctc|salary|compensation|pay).*in (lpa|lakhs?)|expected ctc/i,
    String(CV.expectedCTC || '4').match(/\d+/)?.[0] || '4'],
  [/(expected|desired) .{0,15}(ctc|salary|compensation|pay)|salary expectation/i,
    CV.expectedSalary || '4-6 LPA'],
  [/cgpa|gpa|percentage|marks|aggregate/i,
    '8.2'],
  [/remote|work from home|wfh/i,
    'Yes, I am fully set up for remote work and open to hybrid/onsite.'],
  [/reloc|move to|shift to|work from (our )?office|on-?site/i,
    'Yes, I am open to relocation across India and remote roles globally.'],
  [/authorized to work in india|eligible to work in india|legally authorized/i,
    'Yes'],
  [/visa|sponsorship|require (visa )?sponsorship/i,
    'No'],
  [/where are you (based|located)|current location|city/i,
    CV.location || 'India'],
  [/linkedin/i,          CV.linkedin],
  [/github/i,            CV.github],
  [/portfolio|personal website/i, CV.portfolio],
  [/link/i,              CV.links],
  [/phone|contact number|mobile/i, CV.phone],
  [/e-?mail/i,           CV.email],
  [/your name|full name|\bname\b/i, CV.name],
  [/education|degree|university|college|qualification/i, CV.education || "Bachelor's Degree"],
  [/bachelor|degree level/i, "Bachelor's"],
  [/are you a fresher|fresher candidate/i,
    'Yes, I am a fresher with hands-on full-stack development experience.'],
  [/laptop|own (device|computer|system)|reliable internet/i,
    'Yes'],
  [/languages? (known|spoken|proficiency)/i,
    'English, Hindi'],
  [/immediate joiner|available immediately/i,
    'Yes'],
  [/willing to work (from )?office|in-?office/i,
    'Yes'],
  [/gender/i, CV.gender || 'Male'],
  [/date of birth|dob|birthday/i, CV.dob],
];

const GENERIC_ANSWER = (() => {
  const hPart = CV.highlights.slice(0, 2).filter(Boolean).join('; ');
  return `I'm ${CV.name}, ${CV.currentRole || 'a software developer'}.` +
    (hPart ? ` Key highlights: ${hPart}.` : '');
})();

const OPEN_ENDED_RE =
  /why (do you want|are you interested|this role|this company|us|join)|tell (us|me) about yourself|introduce yourself|about you|(biggest|proudest|favorite) (project|achievement)|describe your (experience|background|skills?)|what (can you|do you) bring|strength|weakness|challenge|motivation/i;

const _sharedGeminiCache = (() => {
  try { return new Map(JSON.parse(sessionStorage.getItem('_aaSharedCache') || '[]')); }
  catch (_) { return new Map(); }
})();

function _cacheSet(k, v) {
  _sharedGeminiCache.set(k, v);
  try { sessionStorage.setItem('_aaSharedCache', JSON.stringify([..._sharedGeminiCache.entries()].slice(-120))); } catch (_) {}
}

async function answerQuestion(questionText) {
  for (const [pattern, answer] of FACTUAL_QA) {
    if (pattern.test(questionText)) return answer || '';
  }

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
      return result;
    }
  }

  return GENERIC_ANSWER;
}
