// ============================================================
// NAUKRI APPLY MODULE — handles job detail page apply, 1-click apply,
// questionnaire modals, and chatbot forms on Naukri.
// ============================================================

const NAUKRI_SUCCESS_RE =
  /applied successfully|application sent|successfully applied|already applied|you have applied|thank you for applying|application submitted|application received|we.ve received your application|your application has been/i;

/**
 * applyOnJobDetailsPage — handles applying when on a Naukri /job-listings-... page.
 * @returns {Promise<boolean>} true if applied
 */
async function applyOnJobDetailsPage() {
  await sleep(1500); // let the page hydrate

  // 1. Scrape title & company
  const titleEl = document.querySelector(
    'h1.styles_jd-header-title__rZwM1, h1[class*="header-title" i], h1[class*="jd-header" i], h1'
  );
  const title = cleanNaukriText(titleEl?.textContent?.trim() || 'Software Engineer');

  const compEl = document.querySelector(
    'a.styles_jd-header-comp-name__MvqAI, [class*="header-comp-name" i], [class*="comp-name" i], [class*="company-name" i], a[href*="/overview/"]'
  );
  const company = cleanNaukriText(compEl?.textContent?.trim() || '');

  const expEl = document.querySelector('[class*="experience" i], [class*="exp-wrap" i], [class*="exp" i]');
  const expRequired = expEl?.textContent?.trim() || '';

  const salEl = document.querySelector('[class*="salary" i], [class*="sal-wrap" i]');
  const salary = salEl?.textContent?.trim() || '';

  log(`▶ Applying: ${title} @ ${company} | ${location.href} | ${salary} | ${expRequired}`);

  // 2. Early external detection — skip jobs redirecting off-platform
  const earlyText = (document.body.innerText || '').slice(0, 4000);
  if (/apply on company site|apply via company\s*website|you('ll| will) be redirected|redirected to (the )?company|apply externally/i.test(earlyText)) {
    log(`  ⏭ Early external detect: "${title}" @ ${company}`);
    return false;
  }

  // 3. Check if already applied
  const isAlreadyApplied = [...document.querySelectorAll('button, span, div')].filter(visible).some((el) => {
    const t = el.textContent?.trim() || '';
    return /^(?:already applied|applied)$/i.test(t);
  });
  if (isAlreadyApplied) {
    log(`  ℹ Already applied to ${company} for "${title}" — skipping`);
    return false;
  }

  // 4. Find the apply button
  const applyBtn = await waitFor(() => {
    const candidates = [
      document.querySelector('#apply-button'),
      document.querySelector('button.apply-button'),
      document.querySelector('button[class*="apply-button" i]'),
      document.querySelector('button[id*="apply" i]'),
      ...document.querySelectorAll('button, a[role="button"]'),
    ].filter(Boolean).filter(visible);

    return candidates.find((b) => {
      const t = b.textContent?.trim() || '';
      return /^(?:easy\s+)?apply$/i.test(t) || /^apply on company site$/i.test(t);
    });
  }, 5000);

  if (!applyBtn) {
    log(`  ⚠ No apply button found for "${title}" — moving on`);
    return false;
  }

  // 5. External checks on the button itself
  if (/company site|external/i.test(applyBtn.textContent || '')) {
    log(`  ⏭ Skipping external apply: "${title}" @ ${company}`);
    return false;
  }
  const btnHref = applyBtn.getAttribute('href') ||
                  applyBtn.closest('a')?.getAttribute('href') ||
                  applyBtn.getAttribute('data-href') || '';
  if (btnHref && !/naukri\.com/i.test(btnHref) && btnHref !== '#' && !btnHref.startsWith('/')) {
    log(`  ⏭ Skipping external link apply: "${title}" @ ${company}`);
    return false;
  }
  const btnTarget = applyBtn.getAttribute('target') || applyBtn.closest('a')?.getAttribute('target') || '';
  if (btnTarget === '_blank') {
    log(`  ⏭ Skipping _blank-target apply: "${title}" @ ${company}`);
    return false;
  }

  if (CONFIG.DRY_RUN) {
    log(`  🔍 DRY_RUN — would click Apply: "${title}" @ ${company}`);
    return true;
  }

  // 6. Click Apply — force same-tab so supervisor doesn't kill a new tab
  applyBtn.scrollIntoView({ block: 'center' });
  await sleep(400);
  // Remove any _blank target so clicking doesn't open a new tab
  applyBtn.setAttribute('target', '_self');
  const parentAnchor = applyBtn.closest('a');
  if (parentAnchor) parentAnchor.setAttribute('target', '_self');
  applyBtn.click();
  log(`  🖱 Clicked Apply on job page: "${title}" @ ${company}`);
  await sleep(2000);

  // 6b. Detect OTP / verification step — pause so user can complete it
  const otpInput = await waitFor(
    () => document.querySelector('input[name*="otp" i], input[placeholder*="otp" i], input[placeholder*="one time" i], input[autocomplete="one-time-code"]'),
    3000, 500
  );
  if (otpInput && visible(otpInput)) {
    log(`  🛎 OTP / verification step detected — pausing for manual input!`);
    if (typeof promptUserForAnswer === 'function') {
      await promptUserForAnswer('OTP / Verification code required — enter the code sent to your phone/email, then click Save.');
    }
    await sleep(3000);
  }

  // 7. Handle chatbot / questionnaire steps — up to 15 steps
  let attempts = 0;
  while (attempts < 15) {
    if (NAUKRI_SUCCESS_RE.test(document.body.textContent || '')) break;

    const modal = document.querySelector(
      '[role="dialog"], [class*="apply-modal" i], [class*="chatbot" i], [class*="bot-container" i], ' +
      '[class*="apply-question" i], [class*="aQuestions" i], div.apply-message, ' +
      '[class*="apply-drawer" i], [class*="apply-form" i], [class*="quick-apply" i]'
    );
    if (!modal || !visible(modal)) break;
    if (NAUKRI_SUCCESS_RE.test(modal.textContent || '')) break;

    log(`  📋 Filling step ${attempts + 1}...`);
    const didAct = await fillNaukriQuestionnaire(modal);
    await sleep(1500);
    if (!didAct) break;
    attempts++;
  }

  // 8. Wait for success confirmation (Item 4 — expanded regex)
  const confirmed = await waitFor(() => {
    const text = document.body.textContent || '';
    if (NAUKRI_SUCCESS_RE.test(text)) return true;
    return !![...document.querySelectorAll('button, span, div, p')].filter(visible).find((el) =>
      /^(?:applied|already applied|application sent)$/i.test(el.textContent.trim())
    );
  }, 8000);

  if (confirmed) {
    log(`  ✅ Applied to ${company} for "${title}"`);
    closeNaukriModal();
    return true;
  }

  log(`  ⚠ No confirmation for "${title}" — moving on`);
  closeNaukriModal();
  return false;
}

/**
 * applyDirectOnCard — handles 1-click apply directly from the search card if present.
 */
async function applyDirectOnCard(job) {
  if (job.isExternal) return false;
  if (!job.applyBtn || !visible(job.applyBtn)) return false;

  log(`▶ Applying: ${job.title} @ ${job.company} | ${job.href} | ${job.salary} | ${job.expRequired}`);

  if (CONFIG.DRY_RUN) {
    log(`  🔍 DRY_RUN — would click Apply: "${job.title}" @ ${job.company}`);
    return true;
  }

  job.applyBtn.scrollIntoView({ block: 'center' });
  await sleep(400);
  job.applyBtn.click();
  log(`  🖱 Clicked card Apply: "${job.title}" @ ${job.company}`);
  await sleep(2000);

  // 7. Handle chatbot / questionnaire — up to 15 steps
  let attempts = 0;
  while (attempts < 15) {
    if (NAUKRI_SUCCESS_RE.test(document.body.textContent || '')) break;

    const modal = document.querySelector(
      '[role="dialog"], [class*="apply-modal" i], [class*="chatbot" i], ' +
      '[class*="apply-drawer" i], [class*="quick-apply" i], [class*="aQuestions" i]'
    );
    if (!modal || !visible(modal)) break;
    if (NAUKRI_SUCCESS_RE.test(modal.textContent || '')) break;

    const didAct = await fillNaukriQuestionnaire(modal);
    await sleep(1500);
    if (!didAct) break;
    attempts++;
  }

  const confirmed = await waitFor(() =>
    NAUKRI_SUCCESS_RE.test(document.body.textContent || ''), 6000
  );

  if (confirmed) {
    log(`  ✅ Applied to ${job.company} for "${job.title}"`);
    closeNaukriModal();
    return true;
  }

  closeNaukriModal();
  return false;
}

/**
 * fillNaukriQuestionnaire — fills inputs, selects, radios, and custom UI inside Naukri's apply drawer.
 * @returns {boolean} true if an action button (Next/Submit) was clicked
 */
async function fillNaukriQuestionnaire(container) {
  let actionClicked = false;

  // ── 0. Checkboxes — LinkedIn-style: always check ALL unchecked boxes
  //    Skip only explicit opt-out / unsubscribe boxes
  const checkboxes = [...container.querySelectorAll('input[type="checkbox"]')].filter(visible);
  for (const cb of checkboxes) {
    if (cb.checked) continue;
    const lbl = labelTextOf(cb).toLowerCase();
    if (/unsubscribe|opt.out|do not (contact|email|send)/i.test(lbl)) continue;
    cb.click();
    await sleep(150);
  }

  // ── 1. Standard <input type="radio"> groups ───────────────
  const radios = [...container.querySelectorAll('input[type="radio"]')].filter(visible);
  const radioGroups = {};
  for (const r of radios) {
    const name = r.name || 'unnamed_' + radios.indexOf(r);
    radioGroups[name] = radioGroups[name] || [];
    radioGroups[name].push(r);
  }
  for (const group of Object.values(radioGroups)) {
    const groupText = (
      group[0].closest('fieldset')?.textContent ||
      group[0].closest('[role="group"], [class*="question" i], [class*="field" i]')?.textContent ||
      ''
    ).trim();
    let pick = null;
    if (/notice\s*period|join/i.test(groupText)) {
      pick = group.find((r) => /immediate|0[-–]15|15\s*days|< ?15/i.test(labelTextOf(r))) || group[0];
    } else if (/relocat|move/i.test(groupText)) {
      pick = group.find((r) => /yes/i.test(labelTextOf(r))) || group[0];
    } else if (/experience/i.test(groupText)) {
      pick = group.find((r) => /0|fresher|entry|< ?1/i.test(labelTextOf(r))) || group[0];
    } else {
      pick = group.find((r) => /yes/i.test(labelTextOf(r))) || group[0];
    }
    if (pick && !pick.checked) { pick.click(); await sleep(200); }
  }

  // ── 2. Custom div/li radio UIs (Item 3) ─────────────────
  //    Naukri sometimes renders radio options as styled divs with role="radio"
  const customGroups = [...container.querySelectorAll(
    '[role="radiogroup"], [class*="radio-group" i], [class*="option-group" i], [class*="choices" i]'
  )];
  for (const grp of customGroups) {
    const opts = [...grp.querySelectorAll(
      '[role="radio"], [class*="option-item" i], [class*="choice-item" i], [class*="radio-item" i], li'
    )].filter(visible);
    if (!opts.length) continue;
    const grpText = grp.textContent?.trim() || '';
    let pick = null;

    // Check QA bank for custom group
    const bankGrpAns = typeof findQABankAnswer === 'function' ? findQABankAnswer(CONFIG.QA_BANK, grpText) : null;
    if (bankGrpAns) {
      const norm = String(bankGrpAns).toLowerCase().trim();
      pick = opts.find((o) => o.textContent?.toLowerCase().includes(norm) || norm.includes(o.textContent?.toLowerCase().trim()));
      if (pick) {
        log(`  💾 [QA Bank] Radio choice matched "${grpText.slice(0, 40)}" → "${bankGrpAns}"`);
      }
    }

    if (!pick) {
      if (/notice\s*period|join/i.test(grpText)) {
        pick = opts.find((o) => /immediate|0[-–]15/i.test(o.textContent)) || opts[0];
      } else if (/relocat|move|onsite/i.test(grpText)) {
        pick = opts.find((o) => /yes/i.test(o.textContent)) || opts[0];
      } else if (/experience/i.test(grpText)) {
        pick = opts.find((o) => /^0|fresher|0[-–]1|less than/i.test(o.textContent)) || opts[0];
      } else {
        pick = opts.find((o) => /yes/i.test(o.textContent)) || opts[0];
        if (typeof emitQARecord === 'function' && grpText.length > 3) {
          emitQARecord({ question: grpText, answer: '', status: 'unanswered', source: 'unknown' });
        }
      }
    }
    const alreadySelected =
      pick?.getAttribute('aria-checked') === 'true' ||
      pick?.classList.contains('selected') ||
      pick?.classList.contains('active') ||
      pick?.classList.contains('checked');
    if (pick && !alreadySelected) { pick.click(); await sleep(200); }
  }

  // ── 3. Text / Number inputs ─────────────────────────────────────────────────────────────
  const inputs = [...container.querySelectorAll('input[type="text"], input[type="number"], textarea')].filter(visible);
  for (const inp of inputs) {
    const label = labelTextOf(inp).toLowerCase();
    let val = null;

    // Check QA bank first for any custom text inputs
    const bankVal = typeof findQABankAnswer === 'function' ? findQABankAnswer(CONFIG.QA_BANK, label) : null;
    if (bankVal !== null && bankVal !== undefined) {
      val = bankVal;
    // ── Name split (LinkedIn-style) ────────────────────────────────────────────
    } else if (/first\s*name/i.test(label)) {
      val = (CV.name || '').split(' ')[0] || CV.name;
    } else if (/middle\s*name/i.test(label)) {
      const parts = (CV.name || '').split(' ');
      val = parts.length > 2 ? parts.slice(1, -1).join(' ') : '';
    } else if (/last\s*name|surname/i.test(label)) {
      const parts = (CV.name || '').split(' ');
      val = parts.length > 1 ? parts[parts.length - 1] : (CV.name || '');
    } else if (/full\s*name|\bname\b|signature|legal name/i.test(label)) {
      val = CV.name;
    // ── Contact ─────────────────────────────────────────────────────────────────
    } else if (/e-?mail/i.test(label)) {
      val = CV.email;
    } else if (/phone|mobile/i.test(label)) {
      val = CV.phone;
    // ── Location ─────────────────────────────────────────────────────────────────
    } else if (/\bcity\b|location/i.test(label)) {
      val = (CV.location || 'India').split(',')[0].trim();
    } else if (/\bstreet\b|address/i.test(label)) {
      val = CV.street || '123 Main Street';
    } else if (/\bstate\b|province/i.test(label)) {
      val = CV.state || 'Maharashtra';
    } else if (/zip|postal/i.test(label)) {
      val = CV.zipcode || '400001';
    } else if (/pincode/i.test(label)) {
      val = CV.zipcode || '400001';
    } else if (/area|locality/i.test(label)) {
      val = (CV.street || '').split(',')[0].trim() || 'Main Area';
    } else if (/\bcountry\b/i.test(label)) {
      val = CV.country || 'India';
    // ── Salary (LinkedIn-style: current / expected, lakh / monthly / raw) ────────
    } else if (/current.{0,20}(ctc|salary|compensation).*(lpa|lakh)/i.test(label)) {
      val = String(CV.currentCTC || '0').replace(/[^0-9.]/g, '') || '0';
    } else if (/current.{0,20}(ctc|salary|compensation).*month/i.test(label)) {
      val = String(Math.round((Number(String(CV.currentSalary || '0').replace(/[^0-9]/g, '')) || 0) / 12));
    } else if (/current\s*ctc|current\s*salary/i.test(label)) {
      val = CV.currentCTC || '0';
    } else if (/(expected|desired).{0,20}(ctc|salary|compensation|pay).*(lpa|lakh)/i.test(label)) {
      val = String(CV.expectedCTC || '4').match(/\d+/)?.[0] || '4';
    } else if (/(expected|desired).{0,20}(ctc|salary|compensation|pay).*month/i.test(label)) {
      val = String(Math.round((Number(String(CV.expectedSalary || '4').replace(/[^0-9]/g, '')) || 400000) / 12));
    } else if (/expected\s*ctc|expected\s*salary/i.test(label)) {
      val = CV.expectedCTC || '4';
    // ── Notice period (months / weeks / days) — LinkedIn-style ───────────────
    } else if (/notice.*month|notice.*in month/i.test(label)) {
      val = String(Math.floor((Number(CV.noticePeriodDays) || 0) / 30) || '0');
    } else if (/notice.*week|notice.*in week/i.test(label)) {
      val = String(Math.floor((Number(CV.noticePeriodDays) || 0) / 7) || '0');
    } else if (/notice\s*period/i.test(label)) {
      val = 'Immediate';
    // ── Experience ─────────────────────────────────────────────────────────────────
    } else if (/\byears?\b.*exp|\bexp\b.*\byears?\b|\btotal\s*exp/i.test(label)) {
      val = CV.yearsOfExperience || '0';
    // ── Diversity / EEO (LinkedIn-style) ───────────────────────────────────────
    } else if (/disability|handicapped/i.test(label)) {
      val = CV.disabilityStatus || 'No';
    } else if (/veteran|protected.*veteran/i.test(label)) {
      val = CV.veteranStatus || 'No';
    } else if (/gender|sex(?!ual)/i.test(label)) {
      val = CV.gender || 'Male';
    } else if (/ethnicity|race/i.test(label)) {
      val = CV.ethnicity || 'Decline';
    } else if (/citizenship|employment eligibility/i.test(label)) {
      val = CV.usCitizenship || 'Yes';
    // ── Online presence / misc (LinkedIn-style) ───────────────────────────────
    } else if (/linkedin/i.test(label)) {
      val = CV.linkedin || '';
    } else if (/github/i.test(label)) {
      val = CV.github || '';
    } else if (/portfolio|personal website/i.test(label)) {
      val = CV.portfolio || CV.github || '';
    } else if (/headline/i.test(label)) {
      val = CV.headline || CV.currentRole || '';
    } else if (/recent\s*employer/i.test(label)) {
      val = CV.company || 'Not Applicable';
    } else if (/scale of 1.{0,4}10|confidence level|rate yourself/i.test(label)) {
      val = CV.confidenceLevel || '7';
    } else if (/cgpa|gpa|percentage|marks/i.test(label)) {
      val = '8.2';
    } else if (inp.value && inp.value.trim() !== '') {
      continue; // skip other prefilled fields
    } else {
      val = await answerQuestion(label);
    }

    if (val !== null && val !== '') {
      setValue(inp, String(val));
      // LinkedIn-style: city/location fields need ArrowDown+Enter to dismiss autocomplete
      if (/\bcity\b|location/i.test(label)) {
        await sleep(500);
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        await sleep(300);
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      }
      await sleep(200);
    }
  }

  // ── 3b. Textarea inputs (LinkedIn-style: summary → CV.summary, cover → coverLetter) ──
  const textareas = [...container.querySelectorAll('textarea')].filter(visible);
  for (const ta of textareas) {
    if (ta.value && ta.value.trim().length > 0) continue;
    const taLabel = labelTextOf(ta);
    let taVal = '';
    if (/\bsummary\b/i.test(taLabel)) {
      taVal = CV.summary || await answerQuestion(taLabel);
    } else if (/cover\s*letter|message|additional|why/i.test(taLabel)) {
      taVal = typeof coverLetter === 'function' ? coverLetter(CV.company || '', CV.currentRole || '') : '';
    } else {
      taVal = await answerQuestion(taLabel);
    }
    if (taVal) { setValue(ta, taVal); await sleep(200); }
  }

  // ── 4. Select dropdowns (LinkedIn-style with fuzzy fallback) ───────────────────
  const selects = [...container.querySelectorAll('select')].filter(visible);
  for (const sel of selects) {
    // Skip if already has a meaningful selection
    if (sel.value && sel.value !== '0' && sel.selectedIndex > 0) continue;
    const label = labelTextOf(sel).toLowerCase();

    // Skip phone country code — LinkedIn bot explicitly skips this dropdown
    if (/phone country code/i.test(label)) continue;

    const options = [...sel.options]
      .map((o, i) => ({ i, text: o.text.trim(), val: o.value }))
      .filter((o) => o.text && o.val !== '' && o.val !== '0');

    if (!options.length) continue;

    let opt = null;

    // Check QA bank for select dropdown
    const bankSelectAns = typeof findQABankAnswer === 'function' ? findQABankAnswer(CONFIG.QA_BANK, label) : null;
    if (bankSelectAns) {
      const norm = String(bankSelectAns).toLowerCase().trim();
      opt = options.find((o) => o.text.toLowerCase().includes(norm) || norm.includes(o.text.toLowerCase().trim()));
    }

    // Rule-based for common fields (LinkedIn-style)
    if (!opt) {
      if (/notice/i.test(label)) {
        opt = options.find((o) => /immediate|0\s*days?|15\s*days?/i.test(o.text));
      } else if (/experience|exp/i.test(label)) {
        opt = options.find((o) => /^0|^less\s*than\s*1|fresher|0[-–]1/i.test(o.text));
      } else if (/current.{0,20}(ctc|salary)|expected.{0,20}(ctc|salary)/i.test(label)) {
        opt = options.find((o) => /not\s*disclosed|0|negotiable/i.test(o.text)) || options[0];
      } else if (/gender/i.test(label)) {
        const g = (CV.gender || 'Male').toLowerCase();
        opt = options.find((o) => o.text.toLowerCase().includes(g));
      } else if (/disability|handicapped/i.test(label)) {
        const d = (CV.disabilityStatus || 'No').toLowerCase();
        opt = options.find((o) => o.text.toLowerCase().includes(d));
      } else if (/veteran/i.test(label)) {
        const v = (CV.veteranStatus || 'No').toLowerCase();
        opt = options.find((o) => o.text.toLowerCase().includes(v));
      } else if (/ethnicity|race/i.test(label)) {
        const e = (CV.ethnicity || 'Decline').toLowerCase();
        opt = options.find((o) => o.text.toLowerCase().includes(e.slice(0, 6)));
      } else if (/proficiency/i.test(label)) {
        opt = options.find((o) => /professional/i.test(o.text));
        if (!opt) opt = options.find((o) => /intermediate|full/i.test(o.text));
      } else if (/citizenship/i.test(label)) {
        opt = options.find((o) => /yes|authorized|citizen/i.test(o.text));
      } else if (/country/i.test(label)) {
        const c = (CV.country || 'India').toLowerCase();
        opt = options.find((o) => o.text.toLowerCase().includes(c));
      } else if (/state/i.test(label)) {
        const s = (CV.state || 'Maharashtra').toLowerCase();
        opt = options.find((o) => o.text.toLowerCase().includes(s));
      }
    }

    // LinkedIn-style fuzzy phrase fallback via Gemini
    if (!opt && options.length > 1 && CONFIG.geminiKey) {
      const optStr = options.slice(0, 12).map((o) => `"${o.text}"`).join(', ');
      const answer = await answerQuestion(
        `Job application form field: "${label}". Available options: ${optStr}. ` +
        `Pick the best option for a fresher software developer with 0-1 years experience based in India. ` +
        `Reply with just the exact option text, nothing else.`
      );
      if (answer) {
        const norm = answer.toLowerCase().trim();
        opt = options.find((o) => o.text.toLowerCase().includes(norm.slice(0, 20))) ||
              options.find((o) => norm.includes(o.text.toLowerCase().slice(0, 20)));
      }
    }

    // Last resort
    if (!opt && options.length >= 1) opt = options[0];

    if (opt) {
      sel.value = opt.val;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      log(`  📝 Set select "${label}" → "${opt.text}"`);
      await sleep(200);
    }
  }

  // ── 5. Date picker — LinkedIn-style: click today's date if present
  const todayBtn = container.querySelector('button[aria-label*="This is today"], button[aria-label*="today" i][class*="calendar" i], td[aria-label*="today" i] button');
  if (todayBtn && visible(todayBtn)) {
    todayBtn.click();
    await sleep(300);
  }

  // ── 6. Submit / Next / Continue button ────────────────────
  await sleep(300);
  const actionBtn = [...container.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"], a.btn')]
    .filter(visible)
    .find((b) => !b.disabled && /save|submit|apply|send|continue|next|proceed/i.test((b.textContent || b.value || '').trim()));

  if (actionBtn) {
    actionBtn.scrollIntoView({ block: 'center' });
    await sleep(300);
    actionBtn.click();
    log(`  🖖 Clicked: "${actionBtn.textContent.trim().slice(0, 30)}"`);
    await sleep(2000);
    actionClicked = true;
  }

  return actionClicked;
}

/**
 * closeNaukriModal — closes any popup or drawer covering the page.
 */
function closeNaukriModal() {
  const closeBtns = [
    ...document.querySelectorAll(
      '[class*="cross" i], [class*="close" i], button[aria-label*="close" i], ' +
      '.drawer-close, .modal-close, [class*="closeBtn" i]'
    ),
  ].filter(visible);

  if (closeBtns.length) {
    try { closeBtns[0].click(); } catch (_) {}
  }

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}
