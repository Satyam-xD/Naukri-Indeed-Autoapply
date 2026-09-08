// ============================================================
// INDEED APPLY — handles the Indeed Apply multi-step modal,
// questionnaire answering, resume selection, and submission.
// ============================================================

const INDEED_SUCCESS_RE = /Your application was submitted|Application submitted|You applied on|Your application has been sent|Application received/i;

function getApplyScope() {
  const iframe = document.querySelector('iframe[name*="indeedapply" i], iframe#indeed-apply-iframe, iframe[title*="Indeed Apply" i]');
  if (iframe && iframe.contentDocument && iframe.contentDocument.body) {
    return iframe.contentDocument;
  }
  const modal = document.querySelector('div[role="dialog"], div.ia-BasePage, div.ia-Container, #indeed-apply-widget');
  if (modal && visible(modal)) {
    return modal;
  }
  return document;
}

function closeIndeedModal() {
  const scope = getApplyScope();
  const closeBtn =
    scope.querySelector('button[aria-label*="close" i], button[data-testid="close-button"], [class*="closeButton" i]') ||
    document.querySelector('button[aria-label*="close" i]');
  if (closeBtn && visible(closeBtn)) {
    try { closeBtn.click(); } catch (_) {}
  }
}

async function fillIndeedFormStep(scope, company, title) {
  let filledAny = false;

  // 1. Text & Number Inputs
  const inputs = [...scope.querySelectorAll('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"]):not([type="submit"])')]
    .filter(visible);

  for (const input of inputs) {
    if (input.value && input.value.trim().length > 0) continue;
    const label = labelTextOf(input);

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

    if (input.type === 'number' || /years?|experience|ctc|salary|marks|percentage/i.test(label)) {
      const numMatch = String(answer).match(/\d+/);
      if (numMatch) answer = numMatch[0];
    }

    setValue(input, answer);
    filledAny = true;
    await sleep(200);
  }

  // 2. Textarea inputs
  const textareas = [...scope.querySelectorAll('textarea')].filter(visible);
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
  const selects = [...scope.querySelectorAll('select')].filter(visible);
  for (const sel of selects) {
    if (sel.selectedIndex > 0 && sel.value) continue;
    const label = labelTextOf(sel);

    // Look for best matching option
    let chosenIdx = -1;
    const opts = [...sel.options];

    if (/authorized|eligible|work in|relocate|degree|bachelor|immediate/i.test(label)) {
      chosenIdx = opts.findIndex((o) => /^yes/i.test(o.text.trim()));
    } else if (/sponsorship|require.*visa/i.test(label)) {
      chosenIdx = opts.findIndex((o) => /^no/i.test(o.text.trim()));
    }

    if (chosenIdx === -1) {
      // Pick first non-empty option
      chosenIdx = opts.findIndex((o, idx) => idx > 0 && o.value && o.text.trim());
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
  const radios = [...scope.querySelectorAll('input[type="radio"]')].filter(visible);
  for (const r of radios) {
    const name = r.name || r.id || 'grp';
    if (!radioGroups[name]) radioGroups[name] = [];
    radioGroups[name].push(r);
  }

  for (const [name, group] of Object.entries(radioGroups)) {
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

    // Yes/No question
    const groupLabel = labelTextOf(group[0]);
    const isSponsorship = /sponsorship|require.*visa/i.test(groupLabel);

    let targetRadio = null;
    if (isSponsorship) {
      targetRadio = group.find((r) => /^no/i.test(labelTextOf(r)));
    } else {
      targetRadio = group.find((r) => /^yes/i.test(labelTextOf(r)));
    }

    if (!targetRadio) targetRadio = group[0];
    if (targetRadio) {
      targetRadio.click();
      filledAny = true;
      await sleep(150);
    }
  }

  // 5. Checkboxes (terms / agreements / authorizations)
  const checkboxes = [...scope.querySelectorAll('input[type="checkbox"]')].filter(visible);
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

async function handleIndeedApplyFlow(company, title) {
  log(`  📝 Handling Indeed Apply flow for "${title}" @ ${company}...`);

  for (let step = 1; step <= 15; step++) {
    await sleep(1200);
    const scope = getApplyScope();

    // Check if application is already successful
    const bodyText = (scope.body ? scope.body.innerText : scope.innerText) || '';
    if (INDEED_SUCCESS_RE.test(bodyText)) {
      log(`  ✅ Application sent for "${title}" @ ${company}`);
      closeIndeedModal();
      return true;
    }

    // Check for final Submit / Apply button
    const submitBtn =
      findButtonByText(scope, /^Submit your application$|^Submit application$|^Submit$|^Apply$/i) ||
      scope.querySelector('button[data-testid="submit-button"], button#submit-button');

    if (submitBtn && visible(submitBtn)) {
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

      const postText = (getApplyScope().body ? getApplyScope().body.innerText : getApplyScope().innerText) || '';
      if (INDEED_SUCCESS_RE.test(postText) || !visible(submitBtn)) {
        log(`  ✅ Application sent for "${title}" @ ${company}`);
        closeIndeedModal();
        return true;
      }
      return true;
    }

    // Fill current step fields
    await fillIndeedFormStep(scope, company, title);

    // Look for Next / Continue / Review button
    const continueBtn =
      findButtonByText(scope, /^Continue$|^Next$|^Review your application$|^Review$|^Save and continue$/i) ||
      scope.querySelector('button[data-testid="continue-button"], button.ia-continueButton');

    if (continueBtn && visible(continueBtn)) {
      log(`  ➡ Step ${step}: Clicking "${continueBtn.textContent?.trim()}"...`);
      continueBtn.scrollIntoView({ block: 'center' });
      await sleep(300);
      continueBtn.click();
      await sleep(1500);
    } else {
      // No continue button and no submit button
      if (step > 3) {
        log(`  ℹ No further action button found on step ${step}.`);
        break;
      }
    }
  }

  closeIndeedModal();
  return false;
}

async function applyOnIndeedJob(cardObj) {
  const { title, company, link, jk } = cardObj;
  log(`▶ Applying: ${title} @ ${company} | ${link}`);

  // 1. If we are on search results, click card to open details pane, or navigate
  if (cardObj.titleLink) {
    cardObj.titleLink.scrollIntoView({ block: 'center' });
    await sleep(400);
    cardObj.titleLink.click();
    await sleep(2000);
  }

  // 2. Find Apply button (in right pane, on page, or in card)
  const applyBtn = await waitFor(() => {
    return (
      document.querySelector('#indeedApplyButton') ||
      document.querySelector('button[id*="indeedApply" i]') ||
      document.querySelector('button[data-testid="indeedApplyButton"]') ||
      document.querySelector('.indeed-apply-button') ||
      findButtonByText(document, /^Apply now$|^Easily apply$/i)
    );
  }, 6000, 300);

  if (!applyBtn) {
    // Check if it's an external company apply
    const hasExternal = !!document.querySelector('button[href*="http"], a[href*="http"]:has-text("Apply on company site")');
    if (hasExternal) {
      log(`  ⏩ Skipping external company application for "${title}"`);
    } else {
      log(`  ⚠ No Indeed Apply button found for "${title}"`);
    }
    return false;
  }

  // Prevent opening in new tab
  applyBtn.setAttribute('target', '_self');
  const parentAnchor = applyBtn.closest('a');
  if (parentAnchor) parentAnchor.setAttribute('target', '_self');

  log(`  🖱 Clicking "${applyBtn.textContent?.trim() || 'Apply'}"...`);
  applyBtn.scrollIntoView({ block: 'center' });
  await sleep(400);
  applyBtn.click();
  await sleep(2500);

  return await handleIndeedApplyFlow(company, title);
}
