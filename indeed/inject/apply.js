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
    // ── Name split (LinkedIn-style) ─────────────────────────────────────────
    if (/first\s*name/i.test(label)) {
      answer = CV.name.split(' ')[0] || CV.name;
    } else if (/middle\s*name/i.test(label)) {
      const parts = CV.name.split(' ');
      answer = parts.length > 2 ? parts.slice(1, -1).join(' ') : '';
    } else if (/last\s*name|surname/i.test(label)) {
      const parts = CV.name.split(' ');
      answer = parts.length > 1 ? parts[parts.length - 1] : CV.name;
    } else if (/full\s*name|\bname\b|signature|legal name/i.test(label)) {
      answer = CV.name;
    // ── Contact ──────────────────────────────────────────────────────────────
    } else if (/e-?mail/i.test(label)) {
      answer = CV.email;
    } else if (/phone|mobile/i.test(label)) {
      answer = CV.phone;
    // ── Location ─────────────────────────────────────────────────────────────
    } else if (/\bcity\b|location|address/i.test(label)) {
      answer = (CV.location || 'India').split(',')[0].trim();
    } else if (/\bstreet\b/i.test(label)) {
      answer = CV.street || '123 Main Street';
    } else if (/\bstate\b|province/i.test(label)) {
      answer = CV.state || 'Maharashtra';
    } else if (/zip|postal/i.test(label)) {
      answer = CV.zipcode || '400001';
    } else if (/\bcountry\b/i.test(label)) {
      answer = CV.country || 'India';
    // ── Notice period (months / weeks / days) — LinkedIn-style ───────────────
    } else if (/notice.*month|notice.*in month/i.test(label)) {
      answer = String(Math.floor((Number(CV.noticePeriodDays) || 0) / 30) || '0');
    } else if (/notice.*week|notice.*in week/i.test(label)) {
      answer = String(Math.floor((Number(CV.noticePeriodDays) || 0) / 7) || '0');
    } else if (/notice\s*period/i.test(label)) {
      answer = CV.startDate || 'Immediate';
    // ── Salary — current (lakh / monthly / raw) — LinkedIn-style ─────────────
    } else if (/current.{0,20}(ctc|salary|compensation).*(lpa|lakh)/i.test(label)) {
      answer = String(CV.currentCTC || '0').replace(/[^0-9.]/g, '') || '0';
    } else if (/current.{0,20}(ctc|salary|compensation).*month/i.test(label)) {
      answer = String(Math.round((Number(String(CV.currentSalary || '0').replace(/[^0-9]/g, '')) || 0) / 12));
    } else if (/current.{0,20}(ctc|salary|compensation)/i.test(label)) {
      answer = CV.currentSalary || '0';
    // ── Salary — expected (lakh / monthly / raw) — LinkedIn-style ────────────
    } else if (/(expected|desired).{0,20}(ctc|salary|compensation|pay).*(lpa|lakh)/i.test(label)) {
      answer = String(CV.expectedCTC || '4').match(/\d+/)?.[0] || '4';
    } else if (/(expected|desired).{0,20}(ctc|salary|compensation|pay).*month/i.test(label)) {
      answer = String(Math.round((Number(String(CV.expectedSalary || '4').replace(/[^0-9]/g, '')) || 400000) / 12));
    } else if (/(expected|desired).{0,20}(ctc|salary|compensation|pay)|salary expectation/i.test(label)) {
      answer = CV.expectedSalary || '4-6 LPA';
    // ── Diversity / EEO — LinkedIn-style ─────────────────────────────────────
    } else if (/disability|handicapped/i.test(label)) {
      answer = CV.disabilityStatus || 'No';
    } else if (/veteran|protected.*veteran/i.test(label)) {
      answer = CV.veteranStatus || 'No';
    } else if (/gender|sex(?!ual)/i.test(label)) {
      answer = CV.gender || 'Male';
    } else if (/ethnicity|race/i.test(label)) {
      answer = CV.ethnicity || 'Decline';
    } else if (/citizenship|employment eligibility/i.test(label)) {
      answer = CV.usCitizenship || 'Yes';
    // ── Online presence / misc ────────────────────────────────────────────────
    } else if (/linkedin/i.test(label)) {
      answer = CV.linkedin || '';
    } else if (/github/i.test(label)) {
      answer = CV.github || '';
    } else if (/portfolio|personal website/i.test(label)) {
      answer = CV.portfolio || CV.github || '';
    } else if (/headline/i.test(label)) {
      answer = CV.headline || CV.currentRole || '';
    } else if (/recent\s*employer/i.test(label)) {
      answer = CV.company || 'Not Applicable';
    } else if (/scale of 1.{0,4}10|confidence level|rate yourself/i.test(label)) {
      answer = CV.confidenceLevel || '7';
    } else if (/education|degree/i.test(label)) {
      answer = CV.education || "Bachelor's";
    } else if (/cgpa|gpa|percentage|marks/i.test(label)) {
      answer = '8.2';
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

    // LinkedIn-style: city/location fields need ArrowDown+Enter to dismiss autocomplete
    const needsAutocomplete = /\bcity\b|location/i.test(label) && answer;

    setValue(input, answer);
    if (needsAutocomplete) {
      await sleep(500);
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await sleep(300);
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
    filledAny = true;
    await sleep(200);
  }

  // 2. Textarea inputs
  const textareas = [...scopeEl.querySelectorAll('textarea')].filter(visible);
  for (const ta of textareas) {
    if (ta.value && ta.value.trim().length > 0) continue;
    const label = labelTextOf(ta);

    let answer = '';
    // LinkedIn-style: summary → CV.summary, cover → coverLetter(), else Gemini
    if (/\bsummary\b/i.test(label)) {
      answer = CV.summary || await answerQuestion(label);
    } else if (/cover\s*letter|message|additional|why\s*(should\s*we|hire|join)/i.test(label)) {
      answer = coverLetter(company, title);
    } else {
      answer = await answerQuestion(label);
    }

    if (answer) { setValue(ta, answer); filledAny = true; }
    await sleep(200);
  }

  // 3. Select dropdowns
  const selects = [...scopeEl.querySelectorAll('select')].filter(visible);
  for (const sel of selects) {
    if (sel.selectedIndex > 0 && sel.value) continue;
    const label = labelTextOf(sel);

    // Skip phone country code — LinkedIn bot explicitly skips this dropdown
    if (/phone country code/i.test(label)) continue;

    let chosenIdx = -1;
    const opts = [...sel.options];

    // Check QA bank for select dropdown
    const bankSelectAns = typeof findQABankAnswer === 'function' ? findQABankAnswer(CONFIG.QA_BANK, label) : null;
    if (bankSelectAns) {
      const norm = String(bankSelectAns).toLowerCase().trim();
      chosenIdx = opts.findIndex((o) => o.text.toLowerCase().includes(norm) || norm.includes(o.text.toLowerCase().trim()));
    }

    // Rule-based matching (LinkedIn-style)
    if (chosenIdx === -1) {
      if (/authorized|eligible|work in|relocate|degree|bachelor|immediate/i.test(label)) {
        chosenIdx = opts.findIndex((o) => /^yes/i.test(o.text.trim()));
      } else if (/sponsorship|require.*visa/i.test(label)) {
        chosenIdx = opts.findIndex((o) => /^no/i.test(o.text.trim()));
      } else if (/gender/i.test(label)) {
        const g = (CV.gender || 'Male').toLowerCase();
        chosenIdx = opts.findIndex((o) => o.text.toLowerCase().includes(g));
      } else if (/disability|handicapped/i.test(label)) {
        const d = (CV.disabilityStatus || 'No').toLowerCase();
        chosenIdx = opts.findIndex((o) => o.text.toLowerCase().includes(d));
      } else if (/veteran/i.test(label)) {
        const v = (CV.veteranStatus || 'No').toLowerCase();
        chosenIdx = opts.findIndex((o) => o.text.toLowerCase().includes(v));
      } else if (/ethnicity|race/i.test(label)) {
        const e = (CV.ethnicity || 'Decline').toLowerCase();
        chosenIdx = opts.findIndex((o) => o.text.toLowerCase().includes(e.slice(0, 6)));
      } else if (/proficiency/i.test(label)) {
        chosenIdx = opts.findIndex((o) => /professional/i.test(o.text));
        if (chosenIdx === -1) chosenIdx = opts.findIndex((o) => /intermediate|full/i.test(o.text));
      } else if (/notice/i.test(label)) {
        chosenIdx = opts.findIndex((o) => /immediate|0\s*days?|15\s*days?/i.test(o.text));
      } else if (/experience|exp/i.test(label)) {
        chosenIdx = opts.findIndex((o) => /^0|^less\s*than\s*1|fresher/i.test(o.text));
      } else if (/country/i.test(label)) {
        const c = (CV.country || 'India').toLowerCase();
        chosenIdx = opts.findIndex((o) => o.text.toLowerCase().includes(c));
      } else if (/state/i.test(label)) {
        const s = (CV.state || 'Maharashtra').toLowerCase();
        chosenIdx = opts.findIndex((o) => o.text.toLowerCase().includes(s));
      }
    }

    // LinkedIn-style fuzzy phrase fallback: try answer from answerQuestion then map onto options
    if (chosenIdx === -1) {
      const aiLabel = label.length > 3 ? label : null;
      if (aiLabel) {
        const aiAns = await answerQuestion(aiLabel);
        if (aiAns) {
          const lowerAns = aiAns.toLowerCase().trim();
          // Direct option text match
          chosenIdx = opts.findIndex((o) => o.text.toLowerCase().includes(lowerAns.slice(0, 20)));
          // LinkedIn-style phrase mapping (Decline, Yes, No)
          if (chosenIdx === -1) {
            const candidatePhrases = /decline|prefer not|not wish/i.test(lowerAns)
              ? ['Decline', 'not wish', "don't wish", 'Prefer not', 'not want']
              : /^yes|agree|i do/i.test(lowerAns)
              ? ['Yes', 'Agree', 'I do', 'I have']
              : /^no|disagree|do not/i.test(lowerAns)
              ? ['No', 'Disagree', "I don't", 'I do not']
              : [aiAns];
            for (const phrase of candidatePhrases) {
              const lp = phrase.toLowerCase();
              chosenIdx = opts.findIndex((o) =>
                o.text.toLowerCase().includes(lp) || lp.includes(o.text.toLowerCase().trim())
              );
              if (chosenIdx !== -1) break;
            }
          }
        }
      }
    }

    // Last resort: pick first non-empty, non-placeholder option
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
      // LinkedIn-style: specific field rules first
      if (/citizenship|employment eligibility/i.test(groupLabel)) {
        targetRadio = group.find((r) => /citizen|yes|authorized|eligible/i.test(labelTextOf(r)));
      } else if (/veteran|protected/i.test(groupLabel)) {
        const v = (CV.veteranStatus || 'No').toLowerCase();
        targetRadio = group.find((r) => labelTextOf(r).toLowerCase().includes(v));
      } else if (/disability|handicapped/i.test(groupLabel)) {
        const d = (CV.disabilityStatus || 'No').toLowerCase();
        // LinkedIn uses Decline → map to "prefer not" phrasing
        const possiblePhrases = d === 'decline'
          ? ['Decline', 'not wish', "don't wish", 'Prefer not', 'not want']
          : [d];
        for (const phrase of possiblePhrases) {
          targetRadio = group.find((r) => labelTextOf(r).toLowerCase().includes(phrase.toLowerCase()));
          if (targetRadio) break;
        }
      } else if (/sponsorship|require.*visa/i.test(groupLabel)) {
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

  // 5. Checkboxes — LinkedIn-style: always check ALL unchecked boxes
  //    (consent, terms, follow, agree — all of them, not just consent-named ones)
  const checkboxes = [...scopeEl.querySelectorAll('input[type="checkbox"]')].filter(visible);
  for (const cb of checkboxes) {
    if (cb.checked) continue;
    const label = labelTextOf(cb).toLowerCase();
    // Skip "unsubscribe" or "do not contact" type boxes
    if (/unsubscribe|opt.out|do not (contact|email|send)/i.test(label)) continue;
    cb.click();
    filledAny = true;
    await sleep(150);
  }

  // 6. Date picker — LinkedIn-style: click today's date if present
  const todayBtn = scopeEl.querySelector('button[aria-label*="This is today"], button[aria-label*="today" i][class*="calendar" i], td[aria-label*="today" i] button');
  if (todayBtn && visible(todayBtn)) {
    todayBtn.click();
    filledAny = true;
    await sleep(300);
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

    // Log step progress indicator if present (Step X of N)
    const stepIndicator = scopeEl.querySelector('[class*="steps" i], [class*="progress" i], [aria-label*="step" i]');
    const stepText = stepIndicator?.textContent?.trim()?.match(/step\s*(\d+)\s*(?:of|\/)\s*(\d+)/i);
    if (stepText) {
      log(`  📋 Apply progress: Step ${stepText[1]} of ${stepText[2]}`);
    }

    // Handle file upload step — Indeed remembers resume from profile, skip gracefully
    const fileInput = scopeEl.querySelector('input[type="file"]');
    if (fileInput && visible(fileInput)) {
      log(`  📎 File upload field detected — skipping (Indeed uses resume on file)`);
      // Don't block on file upload — try to find a Continue/Skip button to move past it
      const skipBtn = findButtonByText(scopeEl, /continue|next|skip|proceed/i);
      if (skipBtn && visible(skipBtn) && !skipBtn.disabled) {
        skipBtn.click();
        await sleep(1500);
      }
      continue;
    }

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

    // Check for already-applied state first
    const appliedState = detailsPane.querySelector(
      'button[aria-label*="applied" i], [data-testid="already-applied"], [class*="alreadyApplied" i]'
    );
    if (appliedState) return null; // signal to skip

    const btn =
      detailsPane.querySelector('#indeedApplyButton') ||
      detailsPane.querySelector('button[id*="indeedApply" i]') ||
      detailsPane.querySelector('button[data-testid="indeedApplyButton"]') ||
      detailsPane.querySelector('[data-testid="apply-button"]') ||
      detailsPane.querySelector('.indeed-apply-button') ||
      detailsPane.querySelector('button[class*="IndeedApplyButton" i]') ||
      detailsPane.querySelector('button[data-dd-action-name*="apply" i]') ||
      detailsPane.querySelector('a[href*="indeedapply"]') ||
      findButtonByText(detailsPane, /^Apply now$|^Easily apply$|^Apply with Indeed$|^Apply with your Indeed Resume$/i);

    if (!btn || !visible(btn)) return null;
    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return null;

    const text = (btn.textContent || btn.value || '').trim();
    if (/^loading|^wait|^applied$/i.test(text)) return null;

    return btn;
  }, 8000, 400);

  if (!applyBtn) {
    // Detect external "Apply on company site" buttons (text-based)
    const allButtons = [...document.querySelectorAll('a, button')];
    const externalBtn = allButtons.find(
      (el) => /apply on company site/i.test(el.textContent?.trim() || '')
    );
    // Detect "Applied" / "Already Applied" state
    const alreadyApplied = allButtons.find(
      (el) => /^(?:applied|you applied|already applied)$/i.test((el.textContent?.trim() || el.getAttribute('aria-label') || ''))
    );
    if (alreadyApplied) {
      log(`  ⏩ Already applied to "${title}" — skipping`);
    } else if (externalBtn) {
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

  // Signal CDP mouse click relay for trusted hardware click
  try {
    const rect = applyBtn.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      window.__aaReadyToSubmit = {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        label: btnText,
      };
    }
  } catch (_) {}

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
