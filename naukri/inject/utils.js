// ============================================================
// UTILITIES — injected into the browser page alongside all other inject/ files.
// All symbols defined here are in scope for every file that follows.
// ============================================================

/**
 * log() — prefixes every message with "[auto-apply]" so the
 * Playwright runner's console listener can pick it up reliably.
 */
function log(...args) {
  const msg = args.map(String).join(' ');
  console.log(`[auto-apply] ${msg}`);
}

/** Promise-based delay. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * humanDelay — wait between CONFIG.MIN_DELAY_MS and CONFIG.MAX_DELAY_MS.
 * Emits a countdown update every second so the terminal stays informed with a live timer.
 */
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

/**
 * waitFor — polls fn() every `interval` ms until it returns a truthy value,
 * or until `timeout` ms elapses, then returns null.
 */
async function waitFor(fn, timeout = 15000, interval = 300) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const result = fn();
      if (result) return result;
    } catch (_) { /* element may not exist yet */ }
    await sleep(interval);
  }
  return null;
}

/**
 * visible — returns true only if the element is attached to the DOM,
 * has non-zero bounding rect, and is not hidden via CSS.
 */
const visible = (el) => {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
};

/**
 * setValue — React 16/17/18/19 compatible field setter.
 * Resets React's internal _valueTracker so synthetic change/input events fire correctly.
 */
function setValue(el, rawVal) {
  const value = String(rawVal ?? '');
  const proto = Object.getPrototypeOf(el);
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

  // Clear React's value tracker so it recognizes the value change
  if (el._valueTracker) {
    el._valueTracker.setValue('');
  }

  if (nativeSetter) {
    nativeSetter.call(el, value);
  } else {
    el.value = value;
  }

  // Fire input, change, and blur events with bubbling
  el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
  el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
}

/**
 * labelTextOf — finds the human-readable label text for a form field.
 * Tries: explicit <label for>, aria-label, aria-labelledby, placeholder,
 * wrapping <label>, then the nearest ancestor field container.
 */
function labelTextOf(field) {
  if (field.id) {
    const lbl = document.querySelector(`label[for="${CSS.escape(field.id)}"]`);
    if (lbl) return lbl.textContent.trim();
  }
  if (field.getAttribute('aria-label'))
    return field.getAttribute('aria-label').trim();
  if (field.getAttribute('aria-labelledby')) {
    const ids = field.getAttribute('aria-labelledby').split(/\s+/);
    const text = ids.map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
    if (text) return text;
  }
  const wrapped = field.closest('label');
  if (wrapped) return wrapped.textContent.replace(field.value || '', '').trim();
  if (field.placeholder) return field.placeholder.trim();
  const ancestor = field.closest(
    '[class*="field" i], [class*="input" i], [class*="form-group" i], fieldset, div'
  );
  return (ancestor?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * findButtonByText — finds the first visible, enabled button/submit/role=button
 * inside `scope` whose text or value matches `pattern`.
 */
function findButtonByText(scope, pattern) {
  const host = scope || document;
  return [...host.querySelectorAll(
    'button, input[type="submit"], [role="button"], [type="button"]'
  )].find((b) => {
    if (!visible(b)) return false;
    if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
    const text = (b.textContent || b.value || '').trim();
    return pattern.test(text);
  });
}

/**
 * cleanTitle — strips extra metadata (salary, remote/onsite tags, recruiter notes)
 * from a job link's text to isolate the pure job title.
 */
function cleanTitle(raw) {
  if (!raw) return '';
  let t = raw
    .replace(/(?:₹|\$|€)\s?[\d.,kLM]+(?:\s?[–-]\s?(?:₹|\$|€)?\s?[\d.,kLM]+)?/gi, '')
    .replace(/\b(?:Remote only|Remote\s*\([^)]+\)|Onsite or remote|In office|Everywhere|Hybrid)\b/gi, '')
    .replace(/\b(?:Actively Hiring|Recruiter recently active|Posted(?:\s+\d+\+?\s*)?(?:today|yesterday|\d+\s*days?\s*ago|\d+\s*weeks?\s*ago)|icn_repost|No equity)\b/gi, '')
    .replace(/\b(?:India|Hyderabad|Delhi|Bangalore(?:\s*Urban)?|Bengaluru|Pune|Mumbai|Noida|United States|New York(?:\s*City)?|San Francisco|California|Boston|Atlanta|Seattle|Chicago|Los Angeles|Europe|Canada|Brazil)\b/gi, '')
    .replace(/\bL\s*[–-]\s*L\b/gi, '')
    .replace(/[•·|].*/, '')
    .replace(/\s+/g, ' ')
    .trim();

  const cut = t.match(/^(.+?)(?:Remote|Onsite|In office|Posted|Recruiter|Actively|$)/i);
  return (cut ? cut[1] : t).replace(/\s+/g, ' ').trim();
}

/**
 * cleanCompany — isolates pure company name from tags, logos, and mission statements.
 */
function cleanCompany(raw) {
  if (!raw) return '';
  return raw
    .replace(/^apply to /i, '')
    // Split on common noise words that appear after the company name in Wellfound card text.
    // Use a case-insensitive split that doesn't require a word boundary before the keyword
    // (textContent sometimes concatenates words without whitespace e.g. "HealthActively").
    .split(/(?:Actively|Hiring|solves|elevates?|employees|Transforming|clinical|Building|Empowering|Leading|Backed|Seed|Series\s*[A-C]|Stealth)/i)[0]
    .replace(/(?:company )?logo/i, '')
    .replace(/[•·|].*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * getCompany — reads the clean company name from the "Apply to <Company>" modal header.
 */
function getCompany() {
  const allHeaders = [...document.querySelectorAll('h1, h2, h3, [role="dialog"] h1, [role="dialog"] h2, [role="dialog"] h3')];
  const applyHeader = allHeaders.find((h) => visible(h) && /apply to /i.test(h.textContent));
  if (applyHeader) {
    const m = applyHeader.textContent.match(/apply to ([^\n\r•·]+)/i);
    if (m) return cleanCompany(m[1]);
  }
  const link = document.querySelector('[role="dialog"] a[href*="/company/"]');
  if (link && visible(link)) return cleanCompany(link.textContent);
  return '';
}
// ============================================================
// GEMINI API HELPER
// Requires: CONFIG.geminiKey, CV (both injected by the runner)
// ============================================================

/**
 * CV_SUMMARY — a compact plain-text profile fed to Gemini prompts.
 * Built once at script start from the CV object.
 */
const CV_SUMMARY = [
  `Name: ${CV.name}`,
  `Current Role: ${CV.currentRole}`,
  `Experience: ${CV.yearsOfExperience}`,
  `Skills: ${CV.skills}`,
  `Education: ${CV.education}`,
  `Location: ${CV.location || 'India'} (open to onsite anywhere in India + remote globally)`,
  `Notice Period: ${CV.noticePeriod}`,
  `Expected Salary: ${CV.expectedSalary}`,
  `GitHub: ${CV.github}`,
  `LinkedIn: ${CV.linkedin}`,
  `Portfolio: ${CV.portfolio}`,
  `Key Projects:\n- ${(CV.highlights || []).filter(Boolean).join('\n- ')}`,
].join('\n').trim();

/**
 * geminiAsk — calls Gemini 2.5 Flash with the given prompt.
 * Returns the response text, or null if the key is missing / call fails.
 */
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
          generationConfig: { temperature: 0.7, maxOutputTokens: 450 },
        }),
      }
    );
    if (!res.ok) { log(`Gemini HTTP ${res.status}`); return null; }
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch (e) {
    log(`Gemini call failed: ${e.message.split('\n')[0]}`);
    return null;
  }
}
// ============================================================
// ANSWER BANK — maps application questions → CV-backed answers.
// Requires: CV, CV_SUMMARY, geminiAsk (all defined in earlier inject files)
// ============================================================

// ── Cover letter ─────────────────────────────────────────────

/**
 * coverLetter — generates the personalized cover letter from the CV profile template.
 * Fast, instant, and reliable with clean company name.
 */
function coverLetter(company, title) {
  const cleanComp = cleanCompany(company);
  const recipient = cleanComp ? cleanComp + ' team' : 'Hiring Manager';
  const skillsList = (CV.skills || '').split(',').slice(0, 6).map((s) => s.trim()).filter(Boolean).join(', ') || 'modern software engineering';
  const h = CV.highlights || [];

  return (
    `Dear ${recipient},\n\n` +
    `I'd like to apply for the ${title || 'Software Engineer'} position at ${cleanComp || 'your company'}.\n\n` +
    `I'm ${CV.name}, currently ${CV.currentRole || 'a software developer'} with hands-on experience in ` +
    `${skillsList}. ` +
    `A recent highlight: ${h[0] || 'building full-stack features end to end'}.\n\n` +
    `${h[1] ? h[1] + ' ' : ''}` +
    `${h[2] ? h[2] + '.' : ''}\n\n` +
    `I'm excited about this role as it directly aligns with my stack, and I'm eager to contribute immediately with zero ramp-up time.\n\n` +
    `Thank you for your time.\n\n` +
    `Sincerely,\n${CV.name}\n${CV.phone} · ${CV.email}\n${CV.linkedin} · ${CV.github} · ${CV.portfolio}`
  );
}

// ── Factual Q&A bank ─────────────────────────────────────────
// Each entry: [regex to match the question label, answer string]

const FACTUAL_QA = [
  [/primary (programming )?language|favorite (coding )?language|core language|coding language|main language/i,
    'JavaScript, TypeScript, Python'],
  [/technologies|tech stack|skills/i,
    CV.skills || 'JavaScript, TypeScript, React, Node.js, Python'],
  [/company name|current (company|employer)|organi[sz]ation/i,
    CV.company || ''],
  [/years? of (work |professional )?experience|how (long|many years)|total experience/i,
    `I have ${CV.yearsOfExperience || '0-1 years of experience'}. Hands-on with ${(CV.skills || '').split(',').slice(0, 6).join(', ') || 'modern web development'}.`],
  [/notice period|when can you (start|join)|start date|joining/i,
    CV.startDate],
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
    `Yes, I am fully set up for remote work and can collaborate effectively across any timezone.`],
  [/reloc|move to|shift to|based out of|work from (our )?office|on-?site/i,
    `Yes — I am based in India and open to relocating anywhere in India (Bangalore, Delhi, Hyderabad, Mumbai, Pune, Noida). I am also open to remote roles globally.`],
  [/authorized to work in india|eligible to work in india/i,
    'Yes'],
  [/visa|sponsorship|work authorization|legally authorized|right to work|citizen/i,
    CV.workAuth],
  [/where are you (based|located)|current location|city/i,
    `India (Lakhimpur Kheri, UP) — open to relocating anywhere in India or working remotely globally.`],
  [/linkedin/i,          CV.linkedin],
  [/github/i,            CV.github],
  [/portfolio|personal website/i, CV.portfolio],
  [/link/i,              CV.links],
  [/phone|contact number|mobile/i, CV.phone],
  [/e-?mail/i,           CV.email],
  [/your name|full name|\bname\b/i, CV.name],
  [/education|degree|university|college|qualification/i, CV.education],
  [/are you a fresher|fresher candidate|fresh graduate/i,
    'Yes, I am a fresher with hands-on internship experience in full-stack development and AI.'],
  [/shift|rotational|night shift|shift timing/i,
    'I prefer standard business hours but can discuss shift requirements if needed.'],
  [/laptop|own (device|computer|system)|work (device|equipment)/i,
    'Yes, I have my own laptop and a reliable high-speed internet connection for remote work.'],
  [/languages? (known|spoken|proficiency)|language skills/i,
    'English (professional), Hindi (native)'],
  [/immediate joiner|available immediately|joining immediately|can you join/i,
    `Yes, I am an immediate joiner. ${CV.startDate}`],
  [/willing to work (from )?office|in-?office|onsite preference/i,
    'Yes, I am open to working from office and also comfortable with hybrid or fully remote setups.'],
  [/gender/i, CV.gender || 'Male'],
  [/date of birth|dob|birthday/i, CV.dob],
];

const GENERIC_ANSWER = (() => {
  const hPart = CV.highlights.slice(0, 2).filter(Boolean).join('; ');
  return `I'm ${CV.name}, ${CV.currentRole || 'a software developer'}.` +
    (hPart ? ` Key highlights: ${hPart}.` : '');
})();

/** Regex for open-ended / essay-style questions — best answered by Gemini */
const OPEN_ENDED_RE =
  /why (do you want|are you interested|this role|this company|us|join)|tell (us|me) about yourself|introduce yourself|about you|(biggest|proudest|favorite) (project|achievement)|describe your (experience|background|skills?)|what (can you|do you) bring|strength|weakness|challenge|motivation|passion|goal|career/i;

/**
 * answerQuestion — answers form questions.
 * Known fields are answered instantly from FACTUAL_QA (no API calls).
 * ALL other unknown questions are sent to Gemini API, with sessionStorage caching.
 */

// Cache Gemini answers for this session to avoid re-asking the same question
const _geminiCache = (() => {
  try { return new Map(JSON.parse(sessionStorage.getItem('_aaCacheV1') || '[]')); }
  catch (_) { return new Map(); }
})();
function _cacheSet(k, v) {
  _geminiCache.set(k, v);
  try { sessionStorage.setItem('_aaCacheV1', JSON.stringify([..._geminiCache.entries()].slice(-120))); } catch (_) {}
}

async function answerQuestion(questionText) {
  // 1. Check known fields first (instant, 0 API calls)
  for (const [pattern, answer] of FACTUAL_QA) {
    if (pattern.test(questionText)) return answer || '';
  }

  // 2. Send ALL unmatched questions to Gemini (with cache)
  if (CONFIG.geminiKey) {
    const cacheKey = questionText.toLowerCase().trim().slice(0, 120);
    if (_geminiCache.has(cacheKey)) {
      log(`  💾 Cached: "${questionText.slice(0, 50)}"`);
      return _geminiCache.get(cacheKey);
    }

    const isEssay = OPEN_ENDED_RE.test(questionText);
    log(`  🤖 Gemini answering ${isEssay ? 'essay' : 'factual'} question: "${questionText.slice(0, 60)}"`);
    const ans = await geminiAsk(
      `You are filling a job application form on behalf of ${CV.name}.\n` +
      `Question: "${questionText}"\n\n` +
      `Candidate Profile:\n${CV_SUMMARY}\n\n` +
      (isEssay
        ? `Rules: Answer in first person, 2-4 sentences, professional tone, no markdown, no bullet points. Be concise and relevant to the profile.`
        : `Rules: Give only the direct answer value — no explanation, no sentences, just the bare answer (e.g. a number, a city name, a short phrase). If it is a yes/no question answer "Yes" or "No". Match the format expected by the field.`)
    );
    if (ans) {
      const result = ans.trim();
      _cacheSet(cacheKey, result);
      return result;
    }
  }

  return GENERIC_ANSWER;
}
