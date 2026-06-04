// TK Buje Piramida — unos rezultata, zamjena mjesta, kazne

// ---- SWAP TEAMS ----
async function swapTeams(challengerId, challengedId) {
  const t1 = allTeams.find(t=>t.id===challengerId);
  const t2 = allTeams.find(t=>t.id===challengedId);
  if(!t1||!t2) return;
  await Promise.all([
    sb.from('teams').update({ step:t2.step, position:t2.position }).eq('id',challengerId),
    sb.from('teams').update({ step:t1.step, position:t1.position }).eq('id',challengedId)
  ]);
  showToast('Timovi su zamijenili mjesta! 🔄', 'success');
}

// ---- RESULT MODAL ----
function openResultModal(challengeId) {
  const challenge = allChallenges.find(c=>c.id===challengeId);
  if(!challenge) return;
  activeResultChallenge = challenge;
  const t1 = allTeams.find(t=>t.id===challenge.challenger_id);
  const t2 = allTeams.find(t=>t.id===challenge.challenged_id);
  document.getElementById('result-match-info').innerHTML = `⚔️ <strong>${t1?.nickname}</strong> vs <strong>${t2?.nickname}</strong>`;
  document.getElementById('result-winner').innerHTML = `
    <option value="">— odaberi pobjednika —</option>
    <option value="${t1?.id}">${t1?.nickname}</option>
    <option value="${t2?.id}">${t2?.nickname}</option>`;
  document.getElementById('result-score').value = '';
  openModal('modal-result');
}

async function submitResult() {
  const winnerId = document.getElementById('result-winner').value;
  const score = document.getElementById('result-score').value.trim();
  if(!winnerId||!score) { showToast('Ispuni sva polja!','error'); return; }

  const btn = document.getElementById('submit-result-btn');
  btn.disabled=true; btn.textContent='Šaljem...';

  try {
    console.log('[SUBMIT RESULT] SAVE_START', { challengeId: activeResultChallenge.id });
    const updatedAt = new Date().toISOString();
    await supabaseRestRequest('/rest/v1/challenges?id=eq.' + encodeURIComponent(activeResultChallenge.id), {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'pending_result',
        result_winner_id: winnerId,
        result_score: score,
        updated_at: updatedAt
      })
    });
    console.log('[SUBMIT RESULT] SAVE_SUCCESS', { challengeId: activeResultChallenge.id });
    Object.assign(activeResultChallenge, {
      status: 'pending_result',
      result_winner_id: winnerId,
      result_score: score,
      updated_at: updatedAt
    });
    showToast('Rezultat poslan adminu na potvrdu! ✓','success');
    closeModal('modal-result');
    const didReload = await safeLoadAll('result-submit');
    if(!didReload) await renderChallenges();
  } catch(err) {
    console.error('[SUBMIT RESULT] SAVE_ERROR', err);
    showToast('Spremanje nije uspjelo. Provjeri internet i pokušaj ponovno.', 'error');
  } finally {
    console.log('[SUBMIT RESULT] SAVE_FINALLY', { challengeId: activeResultChallenge?.id });
    btn.disabled=false; btn.textContent='Pošalji na potvrdu';
  }
}

// ---- PENALTY SYSTEM ----
function getTeamPenaltyActivityInfo(team, baseDate = getPauseTimerNow()) {
  const isExemptStep = Number(team?.step) <= 2;
  const activeChallenge = allChallenges.find(c =>
    (
      (c.status === 'pending' && (!c.response_expires_at || new Date(c.response_expires_at) >= baseDate)) ||
      c.status === 'accepted' ||
      c.status === 'pending_result'
    ) &&
    (c.challenger_id === team.id || c.challenged_id === team.id)
  );
  const sentChallenges = allChallenges.filter(c => c.challenger_id === team.id && c.created_at);
  const lastSentChallengeAt = sentChallenges
    .map(c => new Date(c.created_at))
    .filter(d => !isNaN(d.getTime()))
    .sort((a, b) => b - a)[0] || null;
  const lastMatchAt = team.last_match_at ? new Date(team.last_match_at) : null;
  const createdAt = team.created_at ? new Date(team.created_at) : null;
  const activityDates = [lastMatchAt, lastSentChallengeAt, createdAt]
    .filter(d => d && !isNaN(d.getTime()));
  const lastActivityAt = activityDates.sort((a, b) => b - a)[0] || baseDate;
  const daysInactive = Math.floor((baseDate - lastActivityAt) / DAY_MS);
  const daysLeft = 15 - daysInactive;

  return {
    isExemptStep,
    activeChallenge,
    lastActivityAt,
    daysInactive,
    daysLeft,
    shouldPenalize: !team.penalty && !isExemptStep && !activeChallenge && daysInactive >= 15
  };
}

async function checkPenalties() {
  if(tournamentPause?.is_paused) return;
  const now = getPauseTimerNow();
  for(const team of allTeams) {
    const activityInfo = getTeamPenaltyActivityInfo(team, now);
    if(activityInfo.shouldPenalize) {
      await applyPenalty(team);
    }
  }
}

async function applyPenalty(team) {
  await sb.from('teams').update({ penalty: true, original_step: team.step }).eq('id', team.id);

  // Pomakni nasumični tim SAMO sa stepenica ispod kažnjene prema gore
  // Stepenice IZNAD kažnjene ostaju netaknute!
  const maxStep = Math.max(...allTeams.map(t => t.step));
  const movementLogs = [];
  const movementCreatedAt = new Date().toISOString();
  for(let s = team.step + 1; s <= maxStep; s++) {
    const teamsOnStep = allTeams.filter(t => t.step === s && !t.penalty);
    const available = teamsOnStep.filter(t =>
      !allChallenges.some(c =>
        ['pending','accepted'].includes(c.status) &&
        (c.challenger_id===t.id || c.challenged_id===t.id)
      )
    );
    if(available.length > 0) {
      const lucky = available[Math.floor(Math.random() * available.length)];
      await sb.from('teams').update({ step: s - 1 }).eq('id', lucky.id);
      movementLogs.push({
        created_at: movementCreatedAt,
        reason: 'penalty_zone_rebalance',
        affected_team_id: team.id,
        moved_team_id: lucky.id,
        old_step: lucky.step,
        old_position: lucky.position ?? null,
        new_step: s - 1,
        new_position: lucky.position ?? null,
        created_by: currentPlayer?.email || currentUser?.email || 'system'
      });
    }
  }

  if(movementLogs.length) {
    const { error } = await sb.from('pyramid_movement_log').insert(movementLogs);
    if(error) console.warn('Ne mogu spremiti pyramid_movement_log:', error.message);
    else allMovementLogs = [...movementLogs, ...allMovementLogs].slice(0, 20);
  }

  showToast(team.name + ' je kažnjen zbog neaktivnosti!', 'error');
  // NE zovemo loadAll() ovdje - poziva se izvana
}


async function adminSimulatePenalty(teamId) {
  const team = allTeams.find(t => t.id === teamId);
  if(!team) return;
  if(team.step <= 2) { showToast('Timovi na stepenicama 1 i 2 su izuzeti od kazne!', 'error'); return; }
  if(team.penalty) { showToast('Tim je već u kaznenoj zoni!', 'error'); return; }
  if(!confirm('Simulirati kaznu za tim "' + team.name + '"?')) return;
  await applyPenalty(team);
  await safeLoadAll('manual');
  showToast(team.name + ' premješten u kaznu! ✓', 'success');
  renderAdmin();
}

async function adminRemoveCooldown(challengeId) {
  if(!confirm('Ukloniti zaštitni rok za ovaj tim?')) return;
  // Postavi updated_at u prošlost da cooldown istekne
  await sb.from('challenges').update({
    updated_at: '2000-01-01T00:00:00.000Z'
  }).eq('id', challengeId);
  showToast('Zaštitni rok uklonjen! ✓', 'success');
  await safeLoadAll('manual'); renderAdmin();
}

async function adminRemovePenalty(teamId) {
  const team = allTeams.find(t => t.id === teamId);
  if(!team) return;
  if(!confirm('Izvaditi tim "' + team.name + '" iz kazne i vratiti ga na originalnu stepenicu?')) return;
  const originalStep = team.original_step || Math.max(...allTeams.filter(t=>!t.penalty).map(t=>t.step));
  await sb.from('teams').update({ penalty: false, step: originalStep, original_step: null }).eq('id', teamId);
  showToast(team.name + ' vraćen iz kazne! ✓', 'success');
  await safeLoadAll('manual'); renderAdmin();
}

async function returnFromPenalty(challengeId, penaltyTeamId) {
  // Tim iz kaznene zone je pobijedio — vraća ga u piramidu
  const team = allTeams.find(t => t.id === penaltyTeamId);
  if(!team) return;
  const targetStep = Math.max(...allTeams.filter(t=>!t.penalty).map(t=>t.step));
  await sb.from('teams').update({
    penalty: false,
    step: targetStep,
    original_step: null,
    last_match_at: new Date().toISOString()
  }).eq('id', penaltyTeamId);
}
