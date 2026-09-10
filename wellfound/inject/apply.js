// ============================================================
// APPLICATION FILLER — fills and submits the "Apply to <Company>" modal.
// Requires: sleep, waitFor, visible, setValue, labelTextOf,
//           findButtonByText, coverLetter, answerQuestion, CV, CONFIG, GENERIC_ANSWER
// ============================================================

// ── Module-scope constants ────────────────────────────────────

/** Regex matching all Wellfound submit button label variants. */
const SEND_BTN_RE    = /\bapply\b|^send$|^submit$|send application|submit application/i;

/** Answer-selection helpers — defined once, shared across dropdown/radio/checkbox handlers. */
const YES_RE         = /yes|willing|open to|agree|relocat|remote|immediat|i am able|i can/i;
const NO_RE          = /^no\b|do not|don't|not required|false/i;
const NEGATIVE_Q_RE  = /sponsorship|require.*visa|need.*visa|non-compete|felony|criminal|disciplinary/i;
const PLACEHOLDER_RE = /^select|^choose|^--|^pick/i;

/** Matches the lowest-experience option text in any dropdown or radio group. */
const LOW_EXP_RE     = /\b0\b|^0[-\u20131]|fresher|entry|less than 1|<\s*1|no exp/i;

// ── Shared helpers ────────────────────────────────────────────

/**
 * pickExpOption — returns the best element for an "experience" field.
 * Prefers 0 / fresher / entry-level options; falls back to options[0].
 *
 * @param {Element[]} options  Candidate option elements.
 * @param {Function}  textOf  (el) => string — extracts the option's display text.
 */
function pickExpOption(options, textOf) {
  return options.find((o) => LOW_EXP_RE.test(textOf(o))) || options[0];
}

/**
 * coerceFieldValue — coerces an answer string to match a field's input type.
 * Returns the coerced string; never mutates the field directly.
 *
 * @param {HTMLInputElement} field
 * @param {string}           label  Human-readable label for the field.
 * @param {string}           answer Raw answer from answerQuestion().
 */
function coerceFieldValue(field, label, answer) {
  if (field.type === 'number' || field.inputMode === 'numeric') {
    if (/years?.*exp|experience|how many years/i.test(label)) {
      // Extract the leading digit from e.g. "0-1 years (Internships...)"
      const m = String(CV.yearsOfExperience || '0').match(/^\d+/);
      return m ? m[0] : '0';
    }
    const m = String(answer).match(/\d+/);
    return m ? m[0] : '0';
  }
  if (field.type === 'tel')   return CV.phone || answer;
  if (field.type === 'email') return CV.email || answer;
  return answer;
}

// ── Panel / button finders ────────────────────────────────────
/**
 * Wellfound renders the apply form as a RIGHT-SIDE PANEL (not a dialog).
 * It may have class="ApplicationForm", "ApplyPanel", "applyPanel", etc.
 * or role="dialog". We try multiple strategies and return the MOST SPECIFIC
 * visible container that actually contains the apply form.
 */
function findApplyPanel() {
  const hasFormFields = (el) =>
    el.querySelector('textarea') ||
    el.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])') ||
    el.querySelector('select');

  const PANEL_SEL = [
    '[role="dialog"]',
    '[class*="ApplicationForm" i]',
    '[class*="application-form" i]',
    '[class*="applyPanel" i]',
    '[class*="apply-panel" i]',
    '[class*="applyForm" i]',
    '[class*="ApplyForm"]',
    '[class*="applyDrawer" i]',
    '[class*="sidePanel" i]',
  ].join(', ');

  const PANEL_MATCH_RE = /apply\s+(?:to|at|for)\b|application\s+(?:to|for)\b/i;

  const candidates = [...document.querySelectorAll(PANEL_SEL)]
    .filter((el) => visible(el) && PANEL_MATCH_RE.test(el.textContent) && hasFormFields(el));

  const fallback = [...document.querySelectorAll('div, section, form, aside')]
    .filter((el) => {
      if (!visible(el) || el === document.body || el === document.documentElement) return false;
      if (!PANEL_MATCH_RE.test(el.textContent)) return false;
      if (!hasFormFields(el)) return false;
      return el.querySelectorAll('*').length <= 300;
    });

  const all = [...new Set([...candidates, ...fallback])];
  if (!all.length) return null;

  all.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
  return all.find((el) => el.querySelector('textarea')) || all[0];
}

/**
 * findCardApplyButton — locates the primary Apply button on a job card or detail pane.
 */
function findCardApplyButton(scope) {
  const host = scope || document;
  return [...host.querySelectorAll('button, [role="button"], a')]
    .filter((b) => visible(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true')
    .find((b) => {
      const text = (b.textContent || b.value || '').trim();
      if (/^(applied|save|saved|share|bookmark)$/i.test(text)) return false;
      return /^apply(\s+now)?$/i.test(text) || /^apply\s+(?:to|at|for)\b/i.test(text);
    }) || null;
}

/**
 * openApplyForm — Wellfound shows job details first; click Apply to open the form.
 */
async function openApplyForm(scope) {
  if (findApplyPanel()) return true;

  const host = scope || document;
  let applyBtn = findCardApplyButton(host);

  if (!applyBtn) {
    applyBtn = await waitFor(() => findCardApplyButton(document), 8000);
  }

  if (applyBtn) {
    applyBtn.scrollIntoView({ block: 'center' });
    await sleep(500);
    applyBtn.click();
    log('  📋 Clicked Apply to open application form');
    await sleep(2500);
  }

  return !!(await waitFor(() => findApplyPanel(), 12000));
}

/**
 * isExperienceHardBlocked — only true when Wellfound actually blocks applying.
 * Informational hints like "improve your odds" must NOT skip the job.
 */
function isExperienceHardBlocked(scope) {
  const text = (scope?.textContent || '').replace(/\s+/g, ' ');
  if (/you (?:do not|don't) meet the (?:minimum )?experience/i.test(text)) return true;
  if (/outside the years of experience (?:required|for this role)/i.test(text)) return true;
  if (/not eligible(?: to apply)?.*experience/i.test(text)) return true;
  return false;
}

/**
 * closeModal — dismisses the apply overlay either via a close button or Escape.
 */
function closeModal(scope) {
  const host = scope || document;
  const closeBtn =
    host.querySelector('button[aria-label*="close" i], [data-test*="close" i]') ||
    document.querySelector('button[aria-label*="close" i], [data-test*="close" i]') ||
    findButtonByText(host,     /^\u00d7$|^\u2715$|^close$/i) ||
    findButtonByText(document, /^\u00d7$|^\u2715$|^close$/i);

  if (closeBtn) {
    closeBtn.click();
  } else {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    window.dispatchEvent(  new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
  }
}

// ── Core apply logic ──────────────────────────────────────────

/**
 * fillAndSubmit — the core apply logic for one job.
 *
 * Steps:
 *   1.  Wait for "Apply to <Company>" modal / pane
 *   2.  Detect early hard blocks (location-gated, experience-blocked)
 *   3.  Fill cover-letter textarea
 *   4.  Fill extra text / number / email / tel inputs
 *   5.  Handle location-mismatch prompt
 *   6a. Native <select> dropdowns
 *   6b. React-Select / combobox dropdowns
 *   6c. Radio groups
 *   6d. Checkboxes
 *   6e. Post-fill hard-block check
 *   7.  Click the Send / Apply / Submit button (or dry-run)
 *   8.  Wait for server confirmation
 *
 * Returns true if the application was sent (or dry-run counted), false if skipped.
 */
async function fillAndSubmit(company, title) {
  // ── 1. Wait for the apply panel ─────────────────────────────
  let modal = await waitFor(() => findApplyPanel(), 8000);
  if (!modal) {
    let opened = await openApplyForm();
    if (!opened) {
      // Retry once after brief cooldown in case of transient animation delay
      await sleep(1500);
      opened = await openApplyForm();
    }
    if (!opened) {
      log('⚠ No apply panel found — skipping (Apply form never opened)');
      log('  (Expected "Apply to <Company>" header with form fields)');
      return false;
    }
    modal = findApplyPanel();
  }
  if (!modal) {
    log('⚠ No apply panel found — skipping (panel never appeared)');
    return false;
  }
  log(`  🔍 Panel found: <${modal.tagName.toLowerCase()}> — ${modal.querySelectorAll('*').length} child nodes`);

  // ── 2. Early hard blocks ─────────────────────────────────────
  if (/not accepting applications from your (current )?location/i.test(modal.textContent)) {
    log('🚫 Location-blocked by company — skipping');
    closeModal(modal);
    return false;
  }
  if (isExperienceHardBlocked(modal)) {
    log('🚫 Experience requirement hard-block — skipping');
    closeModal(modal);
    return false;
  }

  // ── 3. Cover letter ──────────────────────────────────────────
  const effectiveCompany = getCompany() || company || '';
  const letter = coverLetter(effectiveCompany, title);
  const textareas = [...modal.querySelectorAll('textarea')].filter(visible);
  if (textareas.length) {
    setValue(textareas[0], letter);
    log('✍ Cover letter filled');
    await sleep(400);
  } else {
    // Check for rich text / contenteditable fields used as note/letter inputs
    const editables = [...modal.querySelectorAll('[contenteditable="true"], [role="textbox"]')].filter(visible);
    if (editables.length) {
      editables[0].focus();
      editables[0].innerText = letter;
      editables[0].dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      editables[0].dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      log('✍ Cover letter filled (contenteditable)');
      await sleep(400);
    }
  }

  // ── 4. Extra text / number / email / tel inputs ──────────────
  const extraInputSel =
    'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])' +
    ':not([type="submit"]):not([type="file"]):not([type="button"])';
  const extraFields = [
    ...textareas.slice(1),
    ...[...modal.querySelectorAll(extraInputSel)].filter((f) => visible(f) && !f.value),
  ];

  for (const field of extraFields) {
    const label  = labelTextOf(field);
    if (/search/i.test(label)) continue;

    const raw    = await answerQuestion(label);
    const answer = coerceFieldValue(field, label, raw);
    const required =
      field.required ||
      field.getAttribute('aria-required') === 'true' ||
      /\*/.test(label);

    if (answer === GENERIC_ANSWER && !required) {
      log(`⏭ Optional unknown field skipped: "${label.slice(0, 55)}"`);
      continue;
    }

    setValue(field, answer);
    log(`✍ Answered: "${label.slice(0, 60)}"`);
    await sleep(250);
  }

  // ── 5. Wellfound location-mismatch prompt ────────────────────
  if (/does not support the locations|update your location preferences/i.test(modal.textContent)) {
    const relocateBtn = [...modal.querySelectorAll('label, [role="radio"], button, div')]
      .filter(visible)
      .find((el) => /i can relocate/i.test(el.textContent) && el.textContent.length < 80);

    if (relocateBtn) {
      relocateBtn.click();
      log('📍 Chose "I can relocate to…"');
      await sleep(800);

      const nativeSel = [...modal.querySelectorAll('select')].filter(visible).pop();
      const combo     = [...modal.querySelectorAll('[role="combobox"], input[id*="react-select" i]')]
                          .filter(visible).pop();

      if (nativeSel) {
        const opts = [...nativeSel.options].filter((o) => o.value && !/select|choose/i.test(o.text));
        if (opts.length) { setValue(nativeSel, opts[0].value); log(`📍 Location: ${opts[0].text.trim()}`); }
      } else if (combo) {
        combo.focus(); combo.click(); await sleep(600);
        const opt = await waitFor(
          () => [...document.querySelectorAll('[role="option"]')].find(visible),
          3000
        );
        if (opt) {
          opt.click();
          log(`📍 Location: ${opt.textContent.trim().slice(0, 40)}`);
        } else {
          for (const key of ['ArrowDown', 'Enter']) {
            combo.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
            await sleep(300);
          }
          log('📍 Location picked via keyboard fallback');
        }
      } else {
        log('⚠ Relocate chosen but no location picker found');
      }
      await sleep(500);
    }
  }

  // ── 6a. Native <select> dropdowns ───────────────────────────
  for (const sel of [...modal.querySelectorAll('select')].filter(visible)) {
    const opts = [...sel.options].filter((o) => o.value && !PLACEHOLDER_RE.test(o.text.trim()));
    if (!opts.length) continue;
    const label = labelTextOf(sel);
    let pick;
    if (/years?.*exp|experience/i.test(label)) {
      pick = pickExpOption(opts, (o) => o.text);
    } else if (NEGATIVE_Q_RE.test(label)) {
      pick = opts.find((o) => NO_RE.test(o.text)) || opts.find((o) => !YES_RE.test(o.text)) || opts[0];
    } else {
      pick =
        opts.find((o) => YES_RE.test(o.text)) ||
        opts.find((o) => CV.location && o.text.toLowerCase().includes(CV.location.split(',')[0].trim().toLowerCase())) ||
        opts[0];
    }
    setValue(sel, pick.value);
    log(`☑ Dropdown "${label.slice(0, 45)}" → "${pick.text.trim()}"`);
    await sleep(200);
  }

  // ── 6b. React-Select / combobox dropdowns ───────────────────
  // Wellfound renders many dropdowns (especially "years of experience") as
  // React-Select widgets: a [role="combobox"] input + [role="option"] list.
  const combos = [...modal.querySelectorAll(
    '[role="combobox"]:not([aria-readonly="true"]), input[id*="react-select" i]'
  )].filter((c) => visible(c) && !c.disabled);

  for (const combo of combos) {
    const label = labelTextOf(combo);
    if (/search/i.test(label)) continue;

    combo.focus();
    combo.click();
    await sleep(600);

    // Try keyboard open if click didn't surface options
    const opts = await waitFor(
      () => { const a = [...document.querySelectorAll('[role="option"]')].filter(visible); return a.length ? a : null; },
      3000
    );
    if (!opts) {
      combo.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await sleep(400);
    }

    const optList = [...document.querySelectorAll('[role="option"]')].filter(visible);
    if (!optList.length) { log(`⚠ React-Select: no options for "${label.slice(0, 45)}"`); continue; }

    let pick;
    if (/years?.*exp|experience/i.test(label)) {
      pick = pickExpOption(optList, (o) => o.textContent);
    } else if (NEGATIVE_Q_RE.test(label)) {
      pick = optList.find((o) => NO_RE.test(o.textContent)) || optList[0];
    } else {
      pick = optList.find((o) => YES_RE.test(o.textContent)) || optList[0];
    }

    pick.click();
    log(`☑ React-Select "${label.slice(0, 45)}" → "${pick.textContent.trim().slice(0, 40)}"`);
    await sleep(300);
  }

  // ── 6c. Radio groups ─────────────────────────────────────────
  const radioGroups = {};
  for (const r of [...modal.querySelectorAll('input[type="radio"]')].filter(visible)) {
    const key = r.name || labelTextOf(r);
    (radioGroups[key] ||= []).push(r);
  }
  for (const group of Object.values(radioGroups)) {
    const ctx = (
      group[0].closest('fieldset')?.textContent ||
      group.map((r) => labelTextOf(r)).join(' ')
    ).slice(0, 200);

    let pick;
    if (/gender|^sex\b/i.test(ctx)) {
      pick = group.find((r) => { const l = labelTextOf(r); return /male/i.test(l) && !/female/i.test(l); });
    } else if (/disability|disabled/i.test(ctx)) {
      pick = group.find((r) => /no disability|not disabled|^no\b|none/i.test(labelTextOf(r)));
    } else if (/years?.*exp|experience/i.test(ctx)) {
      pick = pickExpOption(group, (r) => labelTextOf(r));
    } else if (NEGATIVE_Q_RE.test(ctx)) {
      pick = group.find((r) => NO_RE.test(labelTextOf(r))) || group.find((r) => !YES_RE.test(labelTextOf(r))) || group[0];
    }
    pick = pick || group.find((r) => YES_RE.test(labelTextOf(r))) || group[0];
    if (!pick.checked) { pick.click(); await sleep(200); }
    log(`☑ Radio: "${labelTextOf(pick).slice(0, 50)}"`);
  }

  // ── 6d. Checkboxes ───────────────────────────────────────────
  for (const cb of [...modal.querySelectorAll('input[type="checkbox"]')].filter(visible)) {
    const own       = labelTextOf(cb);
    const groupText = (
      cb.closest('fieldset')?.querySelector('legend')?.textContent ||
      cb.closest('fieldset, [role="group"]')?.textContent || ''
    ).trim();
    const isLocation = /relocat|locat|city|office|work from|based in|move to/i.test(groupText);
    const matchLoc   = !isLocation ||
      /india|delhi|bangalore|bengaluru|hyderabad|mumbai|pune|noida|remote|anywhere|all/i.test(own) ||
      (CV.location && own.toLowerCase().includes(CV.location.split(',')[0].trim().toLowerCase()));
    if (!cb.checked && matchLoc && (isLocation || /relocat|agree|confirm|authoriz|terms|acknowledge|remote/i.test(own))) {
      cb.click();
      await sleep(200);
      log(`☑ Checked: "${own.slice(0, 50)}"`);
    }
  }

  // ── 6e. Post-fill hard-block check ───────────────────────────
  // Wellfound sometimes shows an experience mismatch banner only after
  // the user fills dropdowns — check here before waiting for the submit button.
  if (isExperienceHardBlocked(modal)) {
    log('🚫 Experience hard-block appeared after filling form — skipping');
    closeModal(modal);
    return false;
  }

  // ── 7. Find and click Send / Apply / Submit ──────────────────
  const sendBtn = await waitFor(() => findButtonByText(modal, SEND_BTN_RE), 12000);

  if (!sendBtn) {
    const anyBtn = [...modal.querySelectorAll('button, [type="submit"]')]
      .find((b) => SEND_BTN_RE.test(b.textContent.trim()));
    log(anyBtn && (anyBtn.disabled || anyBtn.getAttribute('aria-disabled') === 'true')
      ? '🚫 Submit button is disabled (required fields missing) — skipping'
      : '⚠ No enabled Submit button found after 12s — skipping');
    closeModal(modal);
    return false;
  }

  if (CONFIG.DRY_RUN) {
    log(`🔍 DRY_RUN — would click: "${sendBtn.textContent.trim()}"`);
    closeModal(modal);
    return true;
  }

  sendBtn.scrollIntoView({ block: 'center' });
  await sleep(600);

  // ── Trusted click via Playwright supervisor ───────────────────
  // Programmatic element.click() inside an injected script creates isTrusted=false
  // events — Wellfound's React handlers silently ignore these.
  // Solution: pass the button's exact screen coordinates to the Playwright
  // supervisor so it can fire page.mouse.click(x, y) — a real CDP mouse event.
  const btnRect  = sendBtn.getBoundingClientRect();
  const clickX   = Math.round(btnRect.left + btnRect.width  / 2);
  const clickY   = Math.round(btnRect.top  + btnRect.height / 2);
  const btnLabel = sendBtn.textContent.trim().slice(0, 50);

  window.__aaSubmitDone    = false;
  window.__aaReadyToSubmit = { x: clickX, y: clickY, label: btnLabel };
  log(`  🖱 Signalling supervisor to click: "${btnLabel}" at (${clickX}, ${clickY})`);

  const supervisorClicked = await waitFor(() => window.__aaSubmitDone, 9000, 300);

  if (!supervisorClicked) {
    log('  ⚠ Supervisor click timed out — using direct click fallback');
    sendBtn.focus();
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
      try {
        sendBtn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      } catch (e) {
        log(`⚠ Fallback event "${type}" dispatch failed: ${e.message.split('\n')[0]}`);
      }
    });
    if (typeof sendBtn.click === 'function') sendBtn.click();
    const form = sendBtn.closest('form');
    if (form) {
      try { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); } catch (e) {
        log(`⚠ Fallback form submit dispatch failed: ${e.message.split('\n')[0]}`);
      }
    }
  }

  // ── 8. Wait for server confirmation ──────────────────────────
  // Only trust explicit Wellfound server-confirmed success text.
  // React isTrusted=false clicks can update UI locally WITHOUT firing the API.
  log('  ⏳ Submitted, waiting for Wellfound confirmation...');

  const SUCCESS_RE = /application submitted|application sent|you've applied|successfully applied|your application has been/i;

  const confirmed = await waitFor(() => {
    const modalText = modal.textContent || '';
    const bodyText  = document.body.textContent || '';
    if (SUCCESS_RE.test(modalText)) return 'modal-text';
    if (SUCCESS_RE.test(bodyText))  return 'page-toast';
    const pendingEl = [...modal.querySelectorAll('button, span, div')]
      .filter(visible)
      .find((el) => /^(applied|pending review|application pending)$/i.test(el.textContent.trim()));
    if (pendingEl) return 'pending-badge';
    return false;
  }, 15000);

  if (confirmed) {
    log(`✅ application sent (${confirmed})`);
    await sleep(2500);
    return true;
  }

  // No server confirmation — diagnose what happened
  const stillOpen  = visible(modal) && document.contains(modal);
  const submitGone = !findButtonByText(modal, SEND_BTN_RE);
  const errorEl    = modal.querySelector(
    'p[class*="error" i], span[class*="error" i], div[class*="errorMessage" i], [class*="fieldError" i]'
  );

  if (errorEl && visible(errorEl) && errorEl.textContent.trim().length > 3) {
    log(`🚫 Form field error: "${errorEl.textContent.trim().slice(0, 80)}"`);
  } else if (!stillOpen) {
    log('⚠ Modal closed without a Wellfound server confirmation — isTrusted click likely failed, application NOT sent');
  } else if (submitGone) {
    log('⚠ Submit button gone (React local state) but no server confirmation — application NOT counted to avoid false CSV entries');
  } else {
    log('⚠ No confirmation after 15s — skipping');
  }

  closeModal(modal);
  return false;
}
