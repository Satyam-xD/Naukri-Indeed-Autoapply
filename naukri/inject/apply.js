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

  // 2. EARLY external bail-out (Item 1) — scan page text BEFORE waiting 5s for button
  //    Saves ~5s per external job vs the old approach of waiting for the button.
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

  // 4. Find the apply button (5s timeout instead of 7s — early bail handles most externals above)
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

  // ── 0. Checkboxes: terms / consent / agree ──────────────────────
  const checkboxes = [...container.querySelectorAll('input[type="checkbox"]')].filter(visible);
  for (const cb of checkboxes) {
    const lbl = labelTextOf(cb).toLowerCase();
    // Auto-check consent/terms/agreement boxes
    if (/terms|consent|agree|privacy|accept|authorize|acknowledge/i.test(lbl) && !cb.checked) {
      cb.click();
      await sleep(150);
    }
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

  // ── 3. Text / Number inputs (Item 6 — always fill key fields) ────
  const inputs = [...container.querySelectorAll('input[type="text"], input[type="number"], textarea')].filter(visible);
  for (const inp of inputs) {
    const label = labelTextOf(inp).toLowerCase();
    let val = null;

    // Check QA bank first for any custom text inputs
    const bankVal = typeof findQABankAnswer === 'function' ? findQABankAnswer(CONFIG.QA_BANK, label) : null;
    if (bankVal !== null && bankVal !== undefined) {
      val = bankVal;
    } else if (/current\s*ctc|current\s*salary/i.test(label))        val = CV.currentCTC  || '0';
    else if (/expected\s*ctc|expected\s*salary/i.test(label)) val = CV.expectedCTC || '4';
    else if (/\byears?\b.*exp|\bexp\b.*\byears?\b|\btotal\s*exp/i.test(label)) val = '0';
    else if (/notice\s*period/i.test(label))                  val = 'Immediate';
    else if (/location|city/i.test(label))                    val = CV.location?.split(',')[0]?.trim() || 'India';
    else if (inp.value && inp.value.trim() !== '')             continue; // skip other prefilled fields
    else                                                       val = await answerQuestion(label);

    if (val !== null && val !== '') { setValue(inp, String(val)); await sleep(200); }
  }

  // ── 4. Select dropdowns (Item 2 — Gemini-powered) ────────
  const selects = [...container.querySelectorAll('select')].filter(visible);
  for (const sel of selects) {
    // Skip if already has a meaningful selection
    if (sel.value && sel.value !== '0' && sel.selectedIndex > 0) continue;
    const label = labelTextOf(sel).toLowerCase();
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

    // Rule-based for common fields
    if (!opt) {
      if (/notice/i.test(label)) {
        opt = options.find((o) => /immediate|0\s*days?|15\s*days?/i.test(o.text));
      } else if (/experience|exp/i.test(label)) {
        opt = options.find((o) => /^0|^less\s*than\s*1|fresher|0[-–]1/i.test(o.text));
      } else if (/ctc|salary/i.test(label)) {
        opt = options.find((o) => /not\s*disclosed|0|negotiable/i.test(o.text)) || options[0];
      } else if (/gender/i.test(label)) {
        opt = options.find((o) => /^male$/i.test(o.text));
      }
    }

    // Gemini fallback for unknown selects (Item 2)
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

  // ── 5. Submit / Next / Continue button ────────────────────
  await sleep(300);
  const actionBtn = [...container.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"], a.btn')]
    .filter(visible)
    .find((b) => !b.disabled && /save|submit|apply|send|continue|next|proceed/i.test((b.textContent || b.value || '').trim()));

  if (actionBtn) {
    actionBtn.scrollIntoView({ block: 'center' });
    await sleep(300);
    actionBtn.click();
    log(`  🖱 Clicked: "${actionBtn.textContent.trim().slice(0, 30)}"`);
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
