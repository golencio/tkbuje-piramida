// TK Buje Piramida — unos rezultata, zamjena mjesta, kazne

// ---- SWAP TEAMS ----
async function swapTeams(challengerId, challengedId, options = {}) {
  const t1 = allTeams.find(t=>t.id===challengerId);
  const t2 = allTeams.find(t=>t.id===challengedId);
  if(!t1||!t2) return;
  const changed = Number(t1.step) !== Number(t2.step) || Number(t1.position) !== Number(t2.position);
  await Promise.all([
    sb.from('teams').update({ step:t2.step, position:t2.position }).eq('id',challengerId),
    sb.from('teams').update({ step:t1.step, position:t1.position }).eq('id',challengedId)
  ]);
  if(changed) {
    await capturePyramidSnapshot(options.reason || 'Zamjena mjesta', {
      relatedChallengeId: options.relatedChallengeId || null,
      relatedMatchId: options.relatedMatchId || null
    });
  }
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
const PENALTY_BLOCKING_CHALLENGE_STATUSES = ['pending', 'accepted', 'pending_result'];
const completingResultChallengeIds = new Set();

function isPenaltyBlockingChallengeForTeam(challenge, teamId, baseDate = getPauseTimerNow()) {
  if(!challenge || !teamId) return false;
  if(!(challenge.challenger_id === teamId || challenge.challenged_id === teamId)) return false;
  if(!PENALTY_BLOCKING_CHALLENGE_STATUSES.includes(challenge.status)) return false;
  return challenge.status !== 'pending' || !challenge.response_expires_at || new Date(challenge.response_expires_at) >= baseDate;
}

function hasPenaltyBlockingChallenge(teamId, baseDate = getPauseTimerNow()) {
  return allChallenges.some(c => isPenaltyBlockingChallengeForTeam(c, teamId, baseDate));
}

function getTeamPenaltyActivityInfo(team, baseDate = getPauseTimerNow()) {
  const isExemptStep = Number(team?.step) <= 2;
  const activeChallenge = allChallenges.find(c => isPenaltyBlockingChallengeForTeam(c, team.id, baseDate));
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
  if(completingResultChallengeIds.size > 0) return;
  const now = getPauseTimerNow();
  for(const team of allTeams) {
    const activityInfo = getTeamPenaltyActivityInfo(team, now);
    if(activityInfo.shouldPenalize) {
      try {
        await applyPenalty(team);
      } catch(error) {
        console.error('[PENALTY SQL ERROR]', error);
        console.error('[PENALTY ERROR]', error);
        showToast('Tim nije prebačen u kaznenu zonu. Detalji su u konzoli.', 'error');
      }
    }
  }
}

function getPenaltyActor() {
  return currentPlayer?.email || currentUser?.email || 'system';
}

function samePyramidSlot(team, step, position) {
  const teamStep = Number(team?.step);
  const expectedStep = Number(step);
  const teamPosition = team?.position == null ? null : Number(team.position);
  const expectedPosition = position == null ? null : Number(position);
  return teamStep === expectedStep && teamPosition === expectedPosition;
}

function getPenaltyTeamName(teamId) {
  const team = allTeams.find(t => t.id === teamId);
  return team ? (team.name || team.nickname || 'Tim') : 'Nepoznat tim';
}

async function createPenaltyEvent(team) {
  const { data, error } = await sb.from('penalty_events')
    .insert({
      team_id: team.id,
      old_step: team.step ?? null,
      old_position: team.position ?? null
    })
    .select('*')
    .single();

  if(error) throw new Error('penalty_events nije dostupan: ' + error.message);
  return data;
}

async function getActivePenaltyEvent(teamId) {
  const { data, error } = await sb.from('penalty_events')
    .select('*')
    .eq('team_id', teamId)
    .eq('is_active', true)
    .order('penalty_started_at', { ascending:false })
    .limit(1)
    .maybeSingle();

  if(error) throw new Error('Ne mogu učitati penalty_events: ' + error.message);
  return data || null;
}

async function getPenaltyRebalanceLogs(event, penaltyTeamId) {
  if(!event) return [];

  let query = sb.from('penalty_rebalance_log')
    .select('*')
    .eq('is_restored', false);

  if(event.id) query = query.eq('penalty_event_id', event.id);
  else query = query.eq('penalty_team_id', penaltyTeamId);

  const { data, error } = await query.order('created_at', { ascending:true });
  if(error) throw new Error('Ne mogu učitati penalty_rebalance_log: ' + error.message);

  return (data || []).sort((a, b) => Number(a.old_step || 0) - Number(b.old_step || 0));
}

function getPenaltyRestoreConflicts(event, logs, ignoredChallengeId = null) {
  const conflicts = [];
  const startedAt = event?.penalty_started_at ? new Date(event.penalty_started_at) : null;

  logs.forEach(log => {
    const movedTeam = allTeams.find(t => t.id === log.moved_team_id);
    if(!movedTeam) {
      conflicts.push('Tim ' + getPenaltyTeamName(log.moved_team_id) + ' više ne postoji.');
      return;
    }
    if(!samePyramidSlot(movedTeam, log.new_step, log.new_position)) {
      conflicts.push(
        getPenaltyTeamName(log.moved_team_id)
        + ' više nije na očekivanoj poziciji '
        + '(očekivano: stepenica ' + (log.new_step ?? '—')
        + ', pozicija ' + (log.new_position ?? '—')
        + '; trenutno: stepenica ' + (movedTeam.step ?? '—')
        + ', pozicija ' + (movedTeam.position ?? '—') + ').'
      );
    }
  });

  if(startedAt && !isNaN(startedAt.getTime())) {
    const rankingChange = allChallenges.find(c => {
      if(c.id === ignoredChallengeId) return false;
      if(!['completed','surrendered'].includes(c.status)) return false;
      const changedAt = c.updated_at || c.created_at;
      return changedAt && new Date(changedAt) > startedAt;
    });
    if(rankingChange) {
      conflicts.push('Nakon ulaska u kaznu zabilježen je meč ili predaja koji su mogli promijeniti poredak.');
    }
  }

  return conflicts;
}

function buildPenaltyRestoreMessage(team, logs, event = null) {
  const rows = logs.map(log => {
    const name = getPenaltyTeamName(log.moved_team_id);
    return name + ': stepenica ' + (log.new_step ?? '—')
      + ' pozicija ' + (log.new_position ?? '—')
      + ' → stepenica ' + (log.old_step ?? '—')
      + ' pozicija ' + (log.old_position ?? '—');
  });

  return 'Vraćanjem tima iz kazne vratit će se i timovi koji su automatski pomaknuti zbog te kazne.\n\n'
    + 'Tim iz kazne: ' + (team.name || team.nickname || 'Tim')
    + '\nPovrat tima: Kaznena zona'
    + ' → stepenica ' + (event?.old_step || team.original_step || team.step || '—')
    + ' pozicija ' + (event?.old_position ?? team.position ?? '—')
    + '\n\n'
    + (rows.length ? rows.join('\n') : 'Nema automatski pomaknutih timova za povrat.')
    + '\n\nNastaviti?';
}

async function restorePenaltyWithRebalance(teamId, options = {}) {
  const team = allTeams.find(t => t.id === teamId);
  if(!team) return false;

  const event = await getActivePenaltyEvent(teamId);
  if(!event) {
    showToast('Nema aktivnog zapisnika za ovu kaznu. Potrebna je ručna provjera.', 'error');
    return false;
  }

  const logs = await getPenaltyRebalanceLogs(event, teamId);
  const conflicts = getPenaltyRestoreConflicts(event, logs, options.ignoredChallengeId || null);
  if(conflicts.length) {
    alert('Struktura piramide se promijenila i automatski povrat je zaustavljen.\n\n' + conflicts.join('\n') + '\n\nPotrebna je ručna provjera.');
    return false;
  }

  if(options.confirm !== false && !confirm(buildPenaltyRestoreMessage(team, logs, event))) return false;

  const restoredAt = new Date().toISOString();
  const actor = getPenaltyActor();
  const targetStep = event.old_step || team.original_step || Math.max(...allTeams.filter(t=>!t.penalty).map(t=>t.step));
  const targetPosition = event.old_position ?? team.position ?? null;

  for(const log of logs) {
    const { error } = await sb.from('teams').update({
      step: log.old_step,
      position: log.old_position
    }).eq('id', log.moved_team_id);
    if(error) throw error;
  }

  const teamUpdate = {
    penalty: false,
    step: targetStep,
    position: targetPosition,
    original_step: null
  };
  if(options.updateLastMatch) teamUpdate.last_match_at = restoredAt;

  const { error: teamError } = await sb.from('teams').update(teamUpdate).eq('id', teamId);
  if(teamError) throw teamError;

  if(logs.length) {
    const { error: logsError } = await sb.from('penalty_rebalance_log').update({
      is_restored: true,
      restored_at: restoredAt,
      restored_by: actor
    }).in('id', logs.map(log => log.id));
    if(logsError) throw logsError;
  }

  const { error: eventError } = await sb.from('penalty_events').update({
    is_active: false,
    penalty_removed_at: restoredAt,
    removed_by: actor
  }).eq('id', event.id);
  if(eventError) throw eventError;

  await capturePyramidSnapshot(options.reason || 'Izlazak iz kaznene zone', {
    relatedChallengeId: options.relatedChallengeId || options.ignoredChallengeId || null
  });

  return true;
}

async function applyPenalty(team) {
  if(hasPenaltyBlockingChallenge(team.id)) {
    console.warn('[PENALTY SKIPPED] Team has an active challenge', { teamId: team.id });
    return false;
  }

  const penaltyEvent = await createPenaltyEvent(team);
  const { error: penaltyError } = await sb.from('teams')
    .update({ penalty: true, original_step: team.step })
    .eq('id', team.id);
  if(penaltyError) throw penaltyError;

  // Pomakni nasumični tim SAMO sa stepenica ispod kažnjene prema gore
  // Stepenice IZNAD kažnjene ostaju netaknute!
  const maxStep = Math.max(...allTeams.map(t => t.step));
  const movementLogs = [];
  const penaltyRebalanceLogs = [];
  const movementCreatedAt = new Date().toISOString();
  for(let s = team.step + 1; s <= maxStep; s++) {
    const teamsOnStep = allTeams.filter(t => t.step === s && !t.penalty);
    const available = teamsOnStep.filter(t => !hasPenaltyBlockingChallenge(t.id));
    if(available.length > 0) {
      const lucky = available[Math.floor(Math.random() * available.length)];
      penaltyRebalanceLogs.push({
        penalty_event_id: penaltyEvent.id,
        penalty_team_id: team.id,
        moved_team_id: lucky.id,
        old_step: lucky.step,
        old_position: lucky.position ?? null,
        new_step: s - 1,
        new_position: lucky.position ?? null,
        reason: 'penalty_rebalance',
        created_at: movementCreatedAt
      });
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

  if(penaltyRebalanceLogs.length) {
    const { error } = await sb.from('penalty_rebalance_log').insert(penaltyRebalanceLogs);
    if(error) throw new Error('Ne mogu spremiti penalty_rebalance_log: ' + error.message);
    allMovementLogs = [
      ...penaltyRebalanceLogs.map(log => ({ ...log, affected_team_id: log.penalty_team_id })),
      ...allMovementLogs
    ].slice(0, 20);
  }

  for(const log of penaltyRebalanceLogs) {
    const { error: moveError } = await sb.from('teams')
      .update({ step: log.new_step, position: log.new_position })
      .eq('id', log.moved_team_id);
    if(moveError) throw moveError;
  }

  if(movementLogs.length) {
    const { error } = await sb.from('pyramid_movement_log').insert(movementLogs);
    if(error) console.warn('Ne mogu spremiti pyramid_movement_log:', error.message);
  }

  await capturePyramidSnapshot('Kazna zbog neaktivnosti');

  showToast(team.name + ' je kažnjen zbog neaktivnosti!', 'error');
  // NE zovemo loadAll() ovdje - poziva se izvana
  return true;
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
  try {
    const restored = await restorePenaltyWithRebalance(teamId, { confirm: true });
    if(!restored) return;
    showToast(team.name + ' vraćen iz kazne! ✓', 'success');
    await safeLoadAll('manual'); renderAdmin();
  } catch(err) {
    console.error(err);
    showToast('Povrat iz kazne nije uspio. Provjeri zapisnik kazne.', 'error');
  }
}

async function returnFromPenalty(challengeId, penaltyTeamId) {
  // Tim iz kaznene zone je pobijedio — vraća ga u piramidu
  const team = allTeams.find(t => t.id === penaltyTeamId);
  if(!team) return false;
  return restorePenaltyWithRebalance(penaltyTeamId, {
    confirm: true,
    updateLastMatch: true,
    ignoredChallengeId: challengeId,
    relatedChallengeId: challengeId,
    reason: 'Izlazak iz kaznene zone'
  });
}
