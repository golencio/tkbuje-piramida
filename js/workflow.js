// TK Buje Piramida — workflow popup-i (termin, rezultat, admin potvrda)

// ---- DOLAZNI IZAZOV POPUP ----
let shownIncomingChallengeId = null;

function getIncomingPendingChallenge() {
  if(!myTeam) return null;
  return allChallenges
    .filter(c => c.status === 'pending' && c.challenged_id === myTeam.id)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0] || null;
}

function formatIncomingDeadline(challenge) {
  if(!challenge?.response_expires_at) return '—';
  const remaining = formatRemainingTime(challenge.response_expires_at, new Date());
  return remaining.text;
}

function maybeShowIncomingChallengePopup() {
  const modal = document.getElementById('modal-incoming-challenge');
  const content = document.getElementById('incoming-challenge-content');
  if(!modal || !content || !myTeam) return;

  const challenge = getIncomingPendingChallenge();
  if(!challenge) {
    shownIncomingChallengeId = null;
    modal.classList.remove('open');
    return;
  }

  // Prikaži jednom po ulasku u app za isti pending izazov.
  if(shownIncomingChallengeId === challenge.id || modal.classList.contains('open')) return;
  shownIncomingChallengeId = challenge.id;

  const challenger = derivedCache.teamById.get(challenge.challenger_id) || allTeams.find(t => t.id === challenge.challenger_id);
  const challengerName = adminTeamName(challenger);
  const sentAt = challenge.created_at ? new Date(challenge.created_at).toLocaleString('hr-HR') : '—';
  const deadline = formatIncomingDeadline(challenge);

  content.innerHTML =
    '<button class="modal-close" onclick="closeIncomingChallengePopup()">×</button>'
    + '<div class="incoming-icon">⚔️</div>'
    + '<div class="incoming-title">Izazvani ste!</div>'
    + '<div class="incoming-sub">Tim <strong>' + challengerName + '</strong> izazvao je vaš tim na meč.</div>'
    + '<div class="incoming-info">'
      + '<div class="incoming-info-row"><span>Izazivač</span><strong>' + challengerName + '</strong></div>'
      + '<div class="incoming-info-row"><span>Rok za odgovor</span><strong>' + deadline + '</strong></div>'
      + '<div class="incoming-info-row"><span>Poslano</span><strong>' + sentAt + '</strong></div>'
    + '</div>'
    + '<div class="incoming-actions">'
      + '<button class="incoming-action accept" onclick="incomingChallengeRespond(\'' + challenge.id + '\',\'accepted\')">✓ Prihvati izazov</button>'
      + '<button class="incoming-action decline" onclick="incomingChallengeRespond(\'' + challenge.id + '\',\'declined\')">✕ Odbij</button>'
    + '</div>';

  openModal('modal-incoming-challenge');
}

function closeIncomingChallengePopup() {
  closeModal('modal-incoming-challenge');
  // Ne mijenjamo status izazova. Popup se opet može prikazati kad se korisnik vrati na Piramidu.
}

async function incomingChallengeRespond(challengeId, response) {
  const isAccept = response === 'accepted';
  const ok = confirm(isAccept
    ? 'Prihvatiti ovaj izazov?'
    : 'Odbiti ovaj izazov?');
  if(!ok) return;

  closeModal('modal-incoming-challenge');
  await respondChallenge(challengeId, response);
}



// ---- WORKFLOW POPUPI: termin, rezultat, admin potvrda ----
let shownWorkflowPopupId = null;

function isMyTeamInChallenge(challenge) {
  return !!myTeam && (challenge.challenger_id === myTeam.id || challenge.challenged_id === myTeam.id);
}

function challengeTeamNames(challenge) {
  const challenger = derivedCache.teamById.get(challenge.challenger_id) || allTeams.find(t => t.id === challenge.challenger_id);
  const challenged = derivedCache.teamById.get(challenge.challenged_id) || allTeams.find(t => t.id === challenge.challenged_id);
  const winner = challenge.result_winner_id ? (derivedCache.teamById.get(challenge.result_winner_id) || allTeams.find(t => t.id === challenge.result_winner_id)) : null;
  return {
    challenger,
    challenged,
    winner,
    challengerName: adminTeamName(challenger),
    challengedName: adminTeamName(challenged),
    winnerName: winner ? adminTeamName(winner) : '—'
  };
}

function formatDateTimeForInput(dateObj) {
  const d = new Date(dateObj);
  const pad = n => String(n).padStart(2, '0');
  return {
    date: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
    time: pad(d.getHours()) + ':' + pad(d.getMinutes())
  };
}

function getNeedsScheduleChallenge() {
  if(!myTeam) return null;
  return allChallenges
    .filter(c => c.status === 'accepted' && !c.scheduled_at && isMyTeamInChallenge(c))
    .sort((a,b) => new Date(a.updated_at || a.created_at) - new Date(b.updated_at || b.created_at))[0] || null;
}

function getDueResultChallenge() {
  if(!myTeam) return null;
  const now = new Date();
  return allChallenges
    .filter(c => c.status === 'accepted' && c.scheduled_at && new Date(c.scheduled_at) <= now && isMyTeamInChallenge(c))
    .sort((a,b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))[0] || null;
}

function getAdminPendingResultChallenge() {
  if(!currentPlayer?.is_admin) return null;
  return allChallenges
    .filter(c => c.status === 'pending_result')
    .sort((a,b) => new Date(a.updated_at || a.created_at) - new Date(b.updated_at || b.created_at))[0] || null;
}

function closeWorkflowPopup() {
  closeModal('modal-workflow');
}

function showSchedulePopup(challenge) {
  const content = document.getElementById('workflow-content');
  if(!content) return;
  const names = challengeTeamNames(challenge);
  const defaultDate = formatDateTimeForInput(new Date(Date.now() + 24 * 60 * 60 * 1000));
  shownWorkflowPopupId = 'schedule-' + challenge.id;

  content.innerHTML =
    '<div class="workflow-icon">📅</div>'
    + '<div class="workflow-title">Dogovorite termin meča</div>'
    + '<div class="workflow-sub">Izazov je prihvaćen. Jedan od timova treba upisati datum i sat meča.</div>'
    + '<div class="workflow-card">'
      + '<div class="workflow-row"><span>Meč</span><strong>' + names.challengerName + ' vs ' + names.challengedName + '</strong></div>'
      + '<div class="workflow-row"><span>Status</span><strong>Prihvaćeno</strong></div>'
    + '</div>'
    + '<div class="workflow-form-grid">'
      + '<div class="form-group" style="margin:0"><label>Datum</label><input type="date" id="workflow-date" value="' + defaultDate.date + '"></div>'
      + '<div class="form-group" style="margin:0"><label>Vrijeme</label><input type="time" id="workflow-time" value="' + defaultDate.time + '"></div>'
    + '</div>'
    + '<div class="form-group" style="margin-top:0.75rem"><label>Napomena / teren (opcionalno)</label><input type="text" id="workflow-note" placeholder="npr. teren 1, dogovoreno telefonom"></div>'
    + '<div class="workflow-actions">'
      + '<button class="workflow-btn muted" onclick="closeWorkflowPopup()">Kasnije</button>'
      + '<button class="workflow-btn primary" onclick="saveChallengeSchedule(\'' + challenge.id + '\')">Spremi termin</button>'
    + '</div>';
  openModal('modal-workflow');
}

async function saveChallengeSchedule(challengeId) {
  const date = document.getElementById('workflow-date')?.value;
  const time = document.getElementById('workflow-time')?.value;
  const note = document.getElementById('workflow-note')?.value.trim() || null;
  if(!date || !time) { showToast('Upiši datum i vrijeme meča.', 'error'); return; }
  const scheduledAt = new Date(date + 'T' + time + ':00');
  if(isNaN(scheduledAt.getTime())) { showToast('Datum ili vrijeme nisu ispravni.', 'error'); return; }

  const { error } = await sb.from('challenges').update({
    scheduled_at: scheduledAt.toISOString(),
    scheduled_by: currentPlayer?.email || null,
    scheduled_created_at: new Date().toISOString(),
    scheduled_note: note,
    updated_at: new Date().toISOString()
  }).eq('id', challengeId);

  if(error) { showToast('Greška: ' + error.message, 'error'); return; }
  showToast('Termin meča je spremljen. 📅', 'success');
  closeWorkflowPopup();
  await safeLoadAll('manual');
}

function showResultDuePopup(challenge) {
  const content = document.getElementById('workflow-content');
  if(!content) return;
  const names = challengeTeamNames(challenge);
  const scheduled = challenge.scheduled_at ? new Date(challenge.scheduled_at).toLocaleString('hr-HR') : '—';
  shownWorkflowPopupId = 'result-' + challenge.id;

  content.innerHTML =
    '<div class="workflow-icon">🎾</div>'
    + '<div class="workflow-title">Unesite rezultat meča</div>'
    + '<div class="workflow-sub">Termin meča je stigao. Jedan od timova može poslati rezultat adminu na potvrdu.</div>'
    + '<div class="workflow-card">'
      + '<div class="workflow-row"><span>Meč</span><strong>' + names.challengerName + ' vs ' + names.challengedName + '</strong></div>'
      + '<div class="workflow-row"><span>Termin</span><strong>' + scheduled + '</strong></div>'
    + '</div>'
    + '<div class="form-group"><label>Pobjednički tim *</label><select id="workflow-result-winner">'
      + '<option value="">— odaberi pobjednika —</option>'
      + '<option value="' + challenge.challenger_id + '">' + names.challengerName + '</option>'
      + '<option value="' + challenge.challenged_id + '">' + names.challengedName + '</option>'
    + '</select></div>'
    + '<div class="form-group"><label>Rezultat *</label><input type="text" id="workflow-result-score" placeholder="6:4, 6:3"></div>'
    + '<div class="workflow-actions">'
      + '<button class="workflow-btn muted" onclick="closeWorkflowPopup()">Kasnije</button>'
      + '<button class="workflow-btn primary" onclick="submitWorkflowResult(\'' + challenge.id + '\')">Pošalji rezultat</button>'
    + '</div>';
  openModal('modal-workflow');
}

async function submitWorkflowResult(challengeId) {
  const winnerId = document.getElementById('workflow-result-winner')?.value;
  const score = document.getElementById('workflow-result-score')?.value.trim();
  if(!winnerId || !score) { showToast('Odaberi pobjednika i upiši rezultat.', 'error'); return; }

  const { error } = await sb.from('challenges').update({
    status: 'pending_result',
    result_winner_id: winnerId,
    result_score: score,
    updated_at: new Date().toISOString()
  }).eq('id', challengeId);

  if(error) { showToast('Greška: ' + error.message, 'error'); return; }
  showToast('Rezultat je poslan adminu na potvrdu. ✓', 'success');
  closeWorkflowPopup();
  await safeLoadAll('manual');
}

function showAdminConfirmationPopup(challenge) {
  const content = document.getElementById('workflow-content');
  if(!content) return;
  const names = challengeTeamNames(challenge);
  shownWorkflowPopupId = 'admin-' + challenge.id;

  content.innerHTML =
    '<div class="workflow-icon">✅</div>'
    + '<div class="workflow-title">Čeka potvrda rezultata</div>'
    + '<div class="workflow-sub">Možeš odmah potvrditi ili odbiti rezultat bez ulaska u admin panel.</div>'
    + '<div class="workflow-card">'
      + '<div class="workflow-row"><span>Meč</span><strong>' + names.challengerName + ' vs ' + names.challengedName + '</strong></div>'
      + '<div class="workflow-row"><span>Pobjednik</span><strong>' + names.winnerName + '</strong></div>'
      + '<div class="workflow-row"><span>Rezultat</span><strong>' + (challenge.result_score || '—') + '</strong></div>'
    + '</div>'
    + '<div class="workflow-actions">'
      + '<button class="workflow-btn red" onclick="adminRejectResultFromPopup(\'' + challenge.id + '\')">Odbij</button>'
      + '<button class="workflow-btn green" onclick="adminConfirmResultFromPopup(\'' + challenge.id + '\')">Potvrdi</button>'
    + '</div>'
    + '<button class="workflow-btn muted" style="width:100%;margin-top:0.6rem;" onclick="closeWorkflowPopup()">Kasnije</button>';
  openModal('modal-workflow');
}

async function adminConfirmResultFromPopup(challengeId) {
  if(!confirm('Potvrditi ovaj rezultat?')) return;
  closeWorkflowPopup();
  await adminConfirmResult(challengeId);
  shownWorkflowPopupId = null;
  setTimeout(maybeShowAppWorkflowPopups, 250);
}

async function adminRejectResultFromPopup(challengeId) {
  if(!confirm('Odbiti ovaj rezultat i vratiti meč kao prihvaćen?')) return;
  closeWorkflowPopup();
  await adminRejectResult(challengeId);
  shownWorkflowPopupId = null;
  setTimeout(maybeShowAppWorkflowPopups, 250);
}

function maybeShowAppWorkflowPopups() {
  if(!currentPlayer) return;
  const activeSection = document.querySelector('.section.active')?.id || '';
  if(activeSection !== 'sec-piramida') return;

  const workflowModal = document.getElementById('modal-workflow');
  const incomingModal = document.getElementById('modal-incoming-challenge');
  const fairplayModal = document.getElementById('modal-fairplay');
  if(workflowModal?.classList.contains('open') || incomingModal?.classList.contains('open') || fairplayModal?.classList.contains('open')) return;

  // 1) Admin ima prioritet: potvrda rezultata odmah na ulazu u Piramidu.
  const adminPending = getAdminPendingResultChallenge();
  if(adminPending) {
    const id = 'admin-' + adminPending.id;
    if(shownWorkflowPopupId !== id) showAdminConfirmationPopup(adminPending);
    return;
  }

  // 2) Dolazni izazov: prihvati / odbij.
  const incoming = getIncomingPendingChallenge();
  if(incoming) {
    maybeShowIncomingChallengePopup();
    return;
  }

  // 3) Prihvaćen meč bez termina: oba tima vide popup za unos datuma i sata.
  const needsSchedule = getNeedsScheduleChallenge();
  if(needsSchedule) {
    const id = 'schedule-' + needsSchedule.id;
    if(shownWorkflowPopupId !== id) showSchedulePopup(needsSchedule);
    return;
  }

  // 4) Kad dođe termin: oba tima vide popup za unos rezultata.
  const dueResult = getDueResultChallenge();
  if(dueResult) {
    const id = 'result-' + dueResult.id;
    if(shownWorkflowPopupId !== id) showResultDuePopup(dueResult);
  }
}
