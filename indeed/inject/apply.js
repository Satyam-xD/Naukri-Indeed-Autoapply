// ============================================================
// INDEED APPLY — handles the Indeed Apply multi-step modal/page,
// questionnaire answering, resume selection, and submission.
//
// Architecture note:
//   Indeed Apply can appear in two ways:
//   1. An inline iframe on the job listing page (same persistent
//      Chrome profile — no cross-origin restriction with cookies).
//   2. A full redirect to https://m5.apply.indeed.com/... which
//      the supervisor catches as a new tab and navigates the main
//      window to it.
//   In both cases we resolve the "scope" to the active document.
// ============================================================

const INDEED_SUCCESS_RE = /Your application was submitted|Application submitted|You applied on|Your application has been sent|Application received|Thanks for applying|application has been received/i;

/**
 * getApplyScope — returns the document/element that contains the
 * Indeed Apply form. Handles both iframe-embedded and full-page flows.
 *
 * Cross-origin iframes (contentDocument === null) fall through to
 * the main document, which is correct when the supervisor has already
 * navigated the main page to the apply URL.
 */
function getApplyScope() {
  // 1. Try to find an accessible same-origin iframe
  const iframes = document.querySelectorAll(
    'iframe[name*="indeedapply" i], iframe[id*="indeedapply" i], iframe[title*="Indeed Apply" i], iframe[src*="indeed"], iframe[src*="apply"]'
  );
  for (const iframe of iframes) {
    try {
      const doc = iframe.contentDocument;
      if (doc && doc.body && doc.body.innerText.trim().length > 5) {
        return doc;
      }
    } catch (_) {
      // Cross-origin — skip
    }
  }

  // 2. Check for an Indeed Apply modal dialog overlay in the main document
  const modal = document.querySelector(
    'div[role="dialog"] .ia-BasePage, div.ia-BasePage, div.ia-Container, #indeed-apply-widget, [class*="ia-BasePage"], [class*="IndeedApplyWidget"], div[data-testid="indeed-apply-modal"]'
  );
  if (modal && visible(modal)) {
    return modal;
  }

  // 3. Full-page apply (after supervisor redirect or tab navigation)
  // On https://m5.apply.indeed.com/ or similar, the whole document IS the form
  if (/apply\.indeed\.com|smartapply|m5\.apply|indeed\.com\/beta\/indeedapply/i.test(location.href)) {
    return document;
  }

  // 4. Fall back to null — no apply form currently present
  return null;
}

function closeIndeedModal() {
  const scope = getApplyScope();
  const closeBtn =
    (scope && scope !== document
      ? scope.querySelector('button[aria-label*="close" i], button[data-testid="close-button"], [class*="closeButton" i]')
      : null) ||
    document.querySelector('div[role="dialog"] button[aria-label*="close" i], [class*="ia-"] button[aria-label*="close" i]');
  if (closeBtn && visible(closeBtn)) {
    try { closeBtn.click(); } catch (_) {}
  }
}

async function fillIndeedFormStep(scope, company, title) {
  let filledAny = false;
  const q = (sel) => (scope === document ? document : scope).querySelectorAll
    ? (scope.querySelectorAll ? scope : document).querySelectorAll(sel)
    : document.querySelectorAll(sel);

  const scopeEl = scope.querySelectorAll ? scope : document;

  // 1. Text & Number Inputs
  const inputs = [...scopeEl.querySelectorAll(
    'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"]):not([type="submit"]):not([type="button"])'
  )].filter(visible);

  for (const input of inputs) {
    if (input.value && input.value.trim().length > 0) continue;
    const label = labelTextOf(input);
    if (!label) continue;

    let answer = '';
    if (/first\s*name/i.test(label)) {
      answer = CV.name.split(' ')[0] || CV.name;
    } else if (/last\s*name/i.test(label)) {
      answer = CV.name.split(' ').slice(1).join(' ') || CV.name.split(' ')[0];
    } else if (/full\s*name|\bname\b/i.test(label)) {
      answer = CV.name;
    } else if (/e-?mail/i.test(label)) {
      answer = CV.email;
    } else if (/phone|mobile/i.test(label)) {
      answer = CV.phone;
    } else if (/city|location/i.test(label)) {
      answer = CV.location || 'India';
    } else {
      answer = await answerQuestion(label);
    }

    if (
      input.type === 'number' ||
      /years?|experience|ctc|salary|marks|percentage/i.test(label)
    ) {
      const numMatch = String(answer).match(/\d+/);
      if (numMatch) answer = numMatch[0];
    }

    setValue(input, answer);
    filledAny = true;
    await sleep(200);
  }

  // 2. Textarea inputs
  const textareas = [...scopeEl.querySelectorAll('textarea')].filter(visible);
  for (const ta of textareas) {
    if (ta.value && ta.value.trim().length > 0) continue;
    const label = labelTextOf(ta);

    let answer = '';
    if (/cover\s*letter|message|additional|why\s*(should\s*we|hire|join)/i.test(label)) {
      answer = coverLetter(company, title);
    } else {
      answer = await answerQuestion(label);
    }

    setValue(ta, answer);
    filledAny = true;
    await sleep(200);
  }

  // 3. Select dropdowns
  const selects = [...scopeEl.querySelectorAll('select')].filter(visible);
  for (const sel of selects) {
    if (sel.selectedIndex > 0 && sel.value) continue;
    const label = labelTextOf(sel);

    let chosenIdx = -1;
    const opts = [...sel.options];

    // Check QA bank for select dropdown
    const bankSelectAns = typeof findQABankAnswer === 'function' ? findQABankAnswer(CONFIG.QA_BANK, label) : null;
    if (bankSelectAns) {
      const norm = String(bankSelectAns).toLowerCase().trim();
      chosenIdx = opts.findIndex((o) => o.text.toLowerCase().includes(norm) || norm.includes(o.text.toLowerCase().trim()));
    }

    if (chosenIdx === -1) {
      if (/authorized|eligible|work in|relocate|degree|bachelor|immediate/i.test(label)) {
        chosenIdx = opts.findIndex((o) => /^yes/i.test(o.text.trim()));
      } else if (/sponsorship|require.*visa/i.test(label)) {
        chosenIdx = opts.findIndex((o) => /^no/i.test(o.text.trim()));
      }
    }

    if (chosenIdx === -1) {
      chosenIdx = opts.findIndex((o, idx) => idx > 0 && o.value && o.text.trim());
      if (typeof emitQARecord === 'function' && label.length > 3) {
        emitQARecord({ question: label, answer: '', status: 'unanswered', source: 'unknown' });
      }
    }

    if (chosenIdx > 0) {
      sel.selectedIndex = chosenIdx;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      filledAny = true;
      await sleep(150);
    }
  }

  // 4. Radio button groups
  const radioGroups = {};
  const radios = [...scopeEl.querySelectorAll('input[type="radio"]')].filter(visible);
  for (const r of radios) {
    const name = r.name || r.id || 'grp';
    if (!radioGroups[name]) radioGroups[name] = [];
    radioGroups[name].push(r);
  }

  for (const [, group] of Object.entries(radioGroups)) {
    const isAnyChecked = group.some((r) => r.checked);
    if (isAnyChecked) continue;

    // Check if it's a resume selection
    const resumeOption = group.find((r) => {
      const lbl = labelTextOf(r);
      return /resume|cv/i.test(lbl);
    });
    if (resumeOption) {
      resumeOption.click();
      filledAny = true;
      continue;
    }

    const groupLabel = labelTextOf(group[0]);
    let targetRadio = null;

    // Check QA bank for radio question
    const bankRadioAns = typeof findQABankAnswer === 'function' ? findQABankAnswer(CONFIG.QA_BANK, groupLabel) : null;
    if (bankRadioAns) {
      const norm = String(bankRadioAns).toLowerCase().trim();
      targetRadio = group.find((r) => {
        const lbl = labelTextOf(r).toLowerCase().trim();
        return lbl.includes(norm) || norm.includes(lbl);
      });
      if (targetRadio) {
        log(`  💾 [QA Bank] Radio matched "${groupLabel.slice(0, 40)}" → "${bankRadioAns}"`);
      }
    }

    if (!targetRadio) {
      const isSponsorship = /sponsorship|require.*visa/i.test(groupLabel);
      if (isSponsorship) {
        targetRadio = group.find((r) => /^no/i.test(labelTextOf(r)));
      } else if (/relocat|shift|travel|authorized|eligible|agree|confirm/i.test(groupLabel)) {
        targetRadio = group.find((r) => /^yes/i.test(labelTextOf(r)));
      } else {
        targetRadio = group.find((r) => /^yes/i.test(labelTextOf(r)));
        if (typeof emitQARecord === 'function' && groupLabel.length > 3) {
          emitQARecord({ question: groupLabel, answer: '', status: 'unanswered', source: 'unknown' });
        }
      }
    }

    if (!targetRadio) targetRadio = group[0];
    if (targetRadio) {
      targetRadio.click();
      filledAny = true;
      await sleep(150);
    }
  }

  // 5. Checkboxes (terms / agreements / authorizations)
  const checkboxes = [...scopeEl.querySelectorAll('input[type="checkbox"]')].filter(visible);
  for (const cb of checkboxes) {
    if (cb.checked) continue;
    const label = labelTextOf(cb);
    if (/terms|agree|privacy|consent|authorize|acknowledge|certify|confirm/i.test(label)) {
      cb.click();
      filledAny = true;
      await sleep(150);
    }
  }

  return filledAny;
}

function isSearchButton(btn) {
  if (!btn) return true;
  const txt = (btn.textContent || btn.value || btn.getAttribute('aria-label') || '').trim().toLowerCase();
  if (/find jobs|search jobs|\bsearch\b|filter|clear/i.test(txt)) return true;
  if (btn.closest('form[action*="jobs"], form.jobsearch, form[role="search"], [data-testid="InlineWhatWhere"]')) return true;
  return false;
}

async function handleIndeedApplyFlow(company, title) {
  log(`  📝 Handling Indeed Apply flow for "${title}" @ ${company}...`);

  for (let step = 1; step <= 15; step++) {
    await sleep(1400);
    const scope = getApplyScope();
    if (!scope) {
      log(`  ℹ Apply scope closed or no longer present.`);
      break;
    }
    const scopeEl = scope.querySelectorAll ? scope : document;

    // bodyText from scope
    const bodyText = (() => {
      try {
        if (scope === document) return document.body?.innerText || '';
        if (typeof scope.innerText === 'string') return scope.innerText;
        if (scope.body) return scope.body.innerText || '';
        return scope.textContent || '';
      } catch (_) { return ''; }
    })();

    // Check if application is already successful
    if (INDEED_SUCCESS_RE.test(bodyText)) {
      log(`  ✅ Application sent for "${title}" @ ${company}`);
      closeIndeedModal();
      return true;
    }

    // Check for final Submit / Apply button
    const submitBtn =
      findButtonByText(scopeEl, /^Submit your application$|^Submit application$|^Submit$|^Send application$|^Complete application$/i) ||
      (() => {
        const explicit = scopeEl.querySelector(
          'button[data-testid="submit-button"], button#submit-button, button[data-testid="ia-SubmitButton"], button.ia-continueButton[type="submit"]'
        );
        return (explicit && !isSearchButton(explicit)) ? explicit : null;
      })();

    if (submitBtn && visible(submitBtn) && !submitBtn.disabled && !isSearchButton(submitBtn)) {
      if (CONFIG.DRY_RUN) {
        log(`  🔵 DRY_RUN — would click "${submitBtn.textContent?.trim()}" for "${title}" @ ${company}`);
        closeIndeedModal();
        return true;
      }

      log(`  🚀 Final Step: Clicking "${submitBtn.textContent?.trim()}"...`);
      submitBtn.scrollIntoView({ block: 'center' });
      await sleep(400);

      const rect = submitBtn.getBoundingClientRect();
      window.__aaReadyToSubmit = {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        label: submitBtn.textContent?.trim() || 'Submit',
      };

      submitBtn.click();
      await sleep(3500);

      const postScope = getApplyScope();
      if (!postScope) {
        log(`  ✅ Application sent for "${title}" @ ${company}`);
        return true;
      }
      const postScopeEl = postScope.querySelectorAll ? postScope : document;
      const postText = (() => {
        try {
          if (postScope === document) return document.body?.innerText || '';
          if (typeof postScope.innerText === 'string') return postScope.innerText;
          if (postScope.body) return postScope.body.innerText || '';
          return postScope.textContent || '';
        } catch (_) { return ''; }
      })();

      if (INDEED_SUCCESS_RE.test(postText) || !visible(submitBtn)) {
        log(`  ✅ Application sent for "${title}" @ ${company}`);
        closeIndeedModal();
        return true;
      }

      // May need one more step (confirmation page)
      log(`  ℹ Clicked submit — waiting for confirmation...`);
      await sleep(2000);
      return true;
    }

    // Fill current step fields
    await fillIndeedFormStep(scope, company, title);

    // Look for Next / Continue / Review button
    const continueBtn =
      findButtonByText(scopeEl, /^Continue$|^Next$|^Review your application$|^Review$|^Save and continue$|^Continue to apply$/i) ||
      (() => {
        const explicit = scopeEl.querySelector(
          'button[data-testid="continue-button"], button.ia-continueButton, button[data-dd-action-name*="continue" i]'
        );
        return (explicit && !isSearchButton(explicit)) ? explicit : null;
      })();

    if (continueBtn && visible(continueBtn) && !continueBtn.disabled && !isSearchButton(continueBtn)) {
      log(`  ➡ Step ${step}: Clicking "${continueBtn.textContent?.trim()}"...`);
      continueBtn.scrollIntoView({ block: 'center' });
      await sleep(300);
      continueBtn.click();
      await sleep(1800);
    } else {
      // No continue button and no submit button — check for page-level "Apply now" only inside modal or apply page
      if (scope !== document || /smartapply|apply\.indeed|indeed\.com\/beta\/indeedapply|m5\.apply/i.test(location.href)) {
        const applyNow = findButtonByText(scopeEl, /^Apply now$|^Apply$/i);
        if (applyNow && visible(applyNow) && !applyNow.disabled && !isSearchButton(applyNow)) {
          log(`  ➡ Step ${step}: Clicking Apply now...`);
          applyNow.click();
          await sleep(1800);
        } else if (step > 4) {
          log(`  ℹ No further action button found on step ${step}.`);
          break;
        } else {
          await sleep(1000);
        }
      } else if (step > 4) {
        log(`  ℹ No further action button found on step ${step}.`);
        break;
      } else {
        await sleep(1000);
      }
    }
  }

  closeIndeedModal();
  return false;
}

async function applyOnIndeedJob(cardObj) {
  const { title, company, link } = cardObj;
  log(`▶ Applying: ${title} @ ${company} | ${link}`);

  // 1. If on search results, click the card to open the details pane
  if (cardObj.titleLink) {
    cardObj.titleLink.scrollIntoView({ block: 'center' });
    await sleep(600);
    cardObj.titleLink.click();
    await sleep(2500);
  }

  // 2. Wait for the "Apply now" / "Easily apply" / Indeed Apply button to appear in details pane
  const applyBtn = await waitFor(() => {
    const detailsPane = document.querySelector(
      '#jobsearch-ViewjobPaneWrapper, .jobsearch-RightPane, [data-testid="jobsearch-ViewjobPaneWrapper"], #viewJobSSRRoot, .jobsearch-JobComponent'
    ) || document;

    const btn =
      detailsPane.querySelector('#indeedApplyButton') ||
      detailsPane.querySelector('button[id*="indeedApply" i]') ||
      detailsPane.querySelector('button[data-testid="indeedApplyButton"]') ||
      detailsPane.querySelector('[data-testid="apply-button"]') ||
      detailsPane.querySelector('.indeed-apply-button') ||
      detailsPane.querySelector('button[class*="IndeedApplyButton" i]') ||
      findButtonByText(detailsPane, /^Apply now$|^Easily apply$|^Apply with Indeed$|^Apply with your Indeed Resume$/i);

    if (!btn || !visible(btn)) return null;
    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return null;

    const text = (btn.textContent || btn.value || '').trim();
    if (/^loading|^wait/i.test(text)) return null;

    return btn;
  }, 8000, 400);

  if (!applyBtn) {
    // Detect external "Apply on company site" buttons (text-based)
    const allButtons = [...document.querySelectorAll('a, button')];
    const externalBtn = allButtons.find(
      (el) => /apply on company site/i.test(el.textContent?.trim() || '')
    );
    if (externalBtn) {
      log(`  ⏩ Skipping external company application for "${title}"`);
    } else {
      log(`  ⚠ No Indeed Apply button found for "${title}"`);
    }
    return false;
  }

  const btnText = (applyBtn.textContent || 'Apply').trim().replace(/\s+/g, ' ');
  log(`  🖱 Clicking "${btnText}"...`);
  applyBtn.scrollIntoView({ block: 'center' });
  await sleep(400);

  window.__aaTabCompleted = false;
  window.__aaTabInFlight = false;

  applyBtn.click();

  // Wait for:
  // (a) Supervisor to handle the new tab
  // (b) In-page modal or iframe to appear
  // (c) Full-page redirect
  const waitStart = Date.now();
  while (Date.now() - waitStart < 90_000) {
    await sleep(1000);

    // (a) Handled in new tab
    if (window.__aaTabCompleted) {
      log(`  ✅ Tab application finished for "${title}" @ ${company}`);
      return true;
    }

    // (b) Full-page redirect occurred
    if (/apply\.indeed\.com|smartapply|m5\.apply|viewjob.*applied/i.test(location.href)) {
      log(`  📄 Detected full-page Indeed Apply flow at ${location.href.slice(0, 80)}`);
      return await handleIndeedApplyFlow(company, title);
    }

    // (c) In-page modal or iframe
    const scope = getApplyScope();
    if (scope) {
      log(`  📝 In-page Indeed Apply form detected`);
      return await handleIndeedApplyFlow(company, title);
    }

    // If no tab opened and no in-page modal after 8s, stop waiting
    if (!window.__aaTabInFlight && Date.now() - waitStart > 8000) {
      break;
    }
  }

  if (window.__aaTabCompleted) {
    log(`  ✅ Tab application finished for "${title}" @ ${company}`);
    return true;
  }

  log(`  ⚠ Apply button was clicked but no apply flow detected for "${title}"`);
  return false;
}
