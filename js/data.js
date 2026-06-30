// TK Buje Piramida — učitavanje podataka, cache, pauza turnira

// ---- PAUZA TURNIRA ----
function normalizePauseState(row) {
  return {
    is_paused: row?.is_paused === true,
    paused_at: row?.paused_at || null,
    pause_reason: row?.pause_reason || ''
  };
}

async function getTournamentPause() {
  const { data, error } = await sb
    .from('tournament_settings')
    .select('is_paused,paused_at,pause_reason')
    .eq('setting_key', 'main')
    .maybeSingle();

  if(error) {
    console.warn('tournament_settings nije dostupna:', error.message);
    return { is_paused: false, paused_at: null, pause_reason: '' };
  }
  return normalizePauseState(data);
}

function getPauseTimerNow() {
  return tournamentPause?.is_paused && tournamentPause.paused_at
    ? new Date(tournamentPause.paused_at)
    : new Date();
}

function formatRemainingTime(expiresAt, baseDate = getPauseTimerNow()) {
  const diff = new Date(expiresAt) - baseDate;
  const safeDiff = Math.max(0, diff);
  const hours = Math.floor(safeDiff / HOUR_MS);
  const days = Math.floor(hours / 24);
  return { diff, safeDiff, hours, days, text: (days > 0 ? days + 'd ' : '') + (hours % 24) + 'h' };
}

function renderPauseBanner() {
  let banner = document.getElementById('pause-banner');
  const main = document.querySelector('main');
  if(!banner && main) {
    banner = document.createElement('div');
    banner.id = 'pause-banner';
    main.parentNode.insertBefore(banner, main);
  }
  if(!banner) return;

  if(!tournamentPause?.is_paused) {
    banner.style.display = 'none';
    banner.innerHTML = '';
    return;
  }

  const pausedAt = tournamentPause.paused_at
    ? new Date(tournamentPause.paused_at).toLocaleString('hr-HR')
    : '';
  const reason = tournamentPause.pause_reason ? ' · Razlog: ' + tournamentPause.pause_reason : '';
  banner.style.display = 'block';
  banner.innerHTML = '<div style="max-width:1100px;margin:0 auto;padding:0.75rem 1.25rem;">'
    + '<div style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:var(--gold);border-radius:12px;padding:0.85rem 1rem;font-size:0.88rem;font-weight:600;">'
    + '⏸ Turnir je zaustavljen od ' + pausedAt + reason + '<br>'
    + '<span style="font-size:0.78rem;color:var(--text2);font-weight:400;">Rok meča i odbrojavanje do kazne zbog neaktivnosti trenutno ne teku.</span>'
    + '</div></div>';
}

async function setTournamentPauseState(isPaused, reason = '') {
  const payload = {
    setting_key: 'main',
    is_paused: isPaused,
    paused_at: isPaused ? new Date().toISOString() : null,
    pause_reason: isPaused ? reason : null,
    updated_at: new Date().toISOString()
  };
  const { error } = await sb.from('tournament_settings').upsert(payload, { onConflict: 'setting_key' });
  if(error) throw error;
}

async function adminPauseTournament() {
  if(!currentPlayer?.is_admin) return;
  const reason = prompt('Razlog za zaustavljanje turnira? (npr. kiša)', tournamentPause.pause_reason || 'kiša');
  if(reason === null) return;
  try {
    await setTournamentPauseState(true, reason.trim());
    showToast('Vrijeme turnira je zaustavljeno. ⏸', 'success');
    await safeLoadAll('manual');
    renderAdmin();
  } catch(err) {
    console.error(err);
    showToast('Ne mogu zaustaviti vrijeme. Provjeri tablicu tournament_settings.', 'error');
  }
}

async function adminResumeTournament() {
  if(!currentPlayer?.is_admin || !tournamentPause?.is_paused || !tournamentPause.paused_at) return;
  if(!confirm('Nastaviti vrijeme turnira? Aktivni rokovi će se produžiti za trajanje pauze.')) return;

  const pauseStarted = new Date(tournamentPause.paused_at);
  const pauseMs = Math.max(0, Date.now() - pauseStarted.getTime());

  try {
    const activeAccepted = allChallenges.filter(c => c.status === 'accepted' && c.match_expires_at);
    for(const c of activeAccepted) {
      const newExpiry = new Date(new Date(c.match_expires_at).getTime() + pauseMs).toISOString();
      await sb.from('challenges').update({ match_expires_at: newExpiry }).eq('id', c.id);
    }

    const teamsToShift = allTeams.filter(t => !t.penalty && t.step > 1);
    for(const t of teamsToShift) {
      const base = t.last_match_at ? new Date(t.last_match_at) : new Date(t.created_at);
      const newLastMatch = new Date(base.getTime() + pauseMs).toISOString();
      await sb.from('teams').update({ last_match_at: newLastMatch }).eq('id', t.id);
    }

    await setTournamentPauseState(false);
    showToast('Vrijeme turnira je nastavljeno. ▶', 'success');
    await safeLoadAll('manual');
    renderAdmin();
  } catch(err) {
    console.error(err);
    showToast('Ne mogu nastaviti vrijeme. Provjeri Supabase tablice.', 'error');
  }
}

async function loadMovementLogs() {
  const { data: penaltyLogs, error: penaltyError } = await sb
    .from('penalty_rebalance_log')
    .select('*')
    .order('created_at', { ascending:false })
    .limit(20);

  if(!penaltyError) {
    return (penaltyLogs || []).map(log => ({
      ...log,
      affected_team_id: log.penalty_team_id,
      reason: log.reason || 'penalty_rebalance'
    }));
  }

  const { data, error } = await sb
    .from('pyramid_movement_log')
    .select('*')
    .eq('reason', 'penalty_zone_rebalance')
    .order('created_at', { ascending:false })
    .limit(20);

  if(error) {
    console.warn('pyramid_movement_log nije dostupna:', error.message);
    return [];
  }
  return data || [];
}

async function loadPyramidSnapshots() {
  const { data, error } = await sb
    .from('pyramid_snapshots')
    .select('*')
    .order('created_at', { ascending:false })
    .limit(100);

  if(error) {
    console.warn('pyramid_snapshots nije dostupna:', error.message);
    return [];
  }
  return data || [];
}

function buildPyramidSnapshotFromTeams(teams = allTeams) {
  return [...(teams || [])]
    .map(t => ({
      team_id: t.id,
      team_name: t.name || t.nickname || '',
      step: t.penalty ? 0 : Number(t.step),
      position: t.position == null ? null : Number(t.position),
      penalty: t.penalty === true,
      original_step: t.original_step == null ? null : Number(t.original_step)
    }))
    .sort((a, b) =>
      Number(a.step) - Number(b.step) ||
      Number(a.position || 0) - Number(b.position || 0) ||
      String(a.team_name || '').localeCompare(String(b.team_name || ''), 'hr')
    );
}

function getSnapshotLayoutKey(snapshot) {
  return JSON.stringify((snapshot || []).map(t => ({
    team_id: t.team_id,
    step: Number(t.step),
    position: t.position == null ? null : Number(t.position),
    penalty: t.penalty === true
  })));
}

async function capturePyramidSnapshot(reason, options = {}) {
  try {
    const { data: teams, error: teamsError } = await sb
      .from('teams')
      .select('id,name,nickname,step,position,penalty,original_step')
      .order('step')
      .order('position');
    if(teamsError) throw teamsError;

    const snapshot = buildPyramidSnapshotFromTeams(teams || []);
    const { data: latestRows, error: latestError } = await sb
      .from('pyramid_snapshots')
      .select('snapshot')
      .order('created_at', { ascending:false })
      .limit(1);
    if(latestError) console.warn('Ne mogu pročitati zadnji snapshot za usporedbu:', latestError.message);
    const latest = latestRows?.[0]?.snapshot || allPyramidSnapshots[0]?.snapshot || null;
    if(latest && getSnapshotLayoutKey(latest) === getSnapshotLayoutKey(snapshot)) return false;

    const payload = {
      reason,
      created_by: options.createdBy || currentPlayer?.email || currentUser?.email || 'system',
      related_challenge_id: options.relatedChallengeId || null,
      related_match_id: options.relatedMatchId || null,
      snapshot
    };
    const { error } = await sb.from('pyramid_snapshots').insert(payload);
    if(error) throw error;
    allPyramidSnapshots = [{ id: 'local-' + Date.now(), created_at: new Date().toISOString(), ...payload }, ...allPyramidSnapshots].slice(0, 100);
    return true;
  } catch(err) {
    console.warn('Snapshot piramide nije spremljen:', err.message || err);
    return false;
  }
}

// ---- LOAD DATA ----
async function loadAll(options = {}) {
  if(isLoadingAll) return false;
  isLoadingAll = true;
  const runId = ++loadAllRunId;
  try {
    const shouldCheckPenalties = options.checkPenalties === true;
    const [{ data: teams }, { data: challenges }, { data: players }, { data: members }, pauseState, movementLogs, pyramidSnapshots] = await Promise.all([
      sb.from('teams').select('*').order('step').order('position'),
      sb.from('challenges').select('*').order('created_at', {ascending:false}),
      sb.from('players').select('*').eq('active', true),
      sb.from('team_members').select('*'),
      getTournamentPause(),
      loadMovementLogs(),
      loadPyramidSnapshots()
    ]);
    // Ako se u međuvremenu pokrenuo noviji loadAll, ovaj stari rezultat ignoriramo.
    if(runId !== loadAllRunId) return false;

    allTeams = teams || [];
    allChallenges = challenges || [];
    allPlayers = players || [];
    allMembers = members || [];
    allMovementLogs = movementLogs || [];
    allPyramidSnapshots = pyramidSnapshots || [];
    buildDerivedCaches();
    tournamentPause = pauseState || { is_paused: false, paused_at: null, pause_reason: '' };
    renderPauseBanner();

    // Nađi moj tim
    if(currentPlayer) {
      const { data: myMembership } = await sb.from('team_members').select('team_id').eq('player_email', currentPlayer.email).single();
      if(myMembership) myTeam = allTeams.find(t=>t.id===myMembership.team_id) || null;
    }

    updateNotifBadge();

    if(shouldCheckPenalties) await checkPenalties();

    renderPyramid();
    await renderChallenges();
    renderStatistics();
    maybeShowAppWorkflowPopups();

    if(document.getElementById('sec-admin')?.classList.contains('active')) renderAdmin();
    return true;
  } catch(err) {
    console.error('loadAll greška:', err);
    return false;
  } finally {
    isLoadingAll = false;
  }
}


function buildDerivedCaches() {
  const teamById = new Map(allTeams.map(t => [t.id, t]));
  const playerByEmail = new Map(allPlayers.map(p => [p.email, p]));
  const membersByTeam = new Map();
  const steps = {};
  const activeChallengeTeamIds = new Set();
  const cooldownByTeamId = new Map();
  const threeDaysAgo = new Date(Date.now() - 3 * DAY_MS);

  allMembers.forEach(member => {
    if(!membersByTeam.has(member.team_id)) membersByTeam.set(member.team_id, []);
    membersByTeam.get(member.team_id).push(member);
  });

  allTeams.forEach(team => {
    const step = team.penalty ? 0 : team.step;
    if(!steps[step]) steps[step] = [];
    steps[step].push(team);
  });

  Object.values(steps).forEach(list => {
    list.sort((a, b) => (Number(a.position || 0) - Number(b.position || 0)) || String(a.name || '').localeCompare(String(b.name || ''), 'hr'));
  });

  allChallenges.forEach(challenge => {
    if(['pending','accepted','pending_result'].includes(challenge.status)) {
      activeChallengeTeamIds.add(challenge.challenger_id);
      activeChallengeTeamIds.add(challenge.challenged_id);
    }

    if(challenge.status === 'declined' && new Date(challenge.updated_at) > threeDaysAgo) {
      const cooldownEnd = new Date(new Date(challenge.updated_at).getTime() + 3 * DAY_MS);
      const existing = cooldownByTeamId.get(challenge.challenged_id);
      if(!existing || cooldownEnd > existing.cooldownEnd) {
        cooldownByTeamId.set(challenge.challenged_id, { challenge, cooldownEnd });
      }
    }
  });

  derivedCache = { teamById, playerByEmail, membersByTeam, activeChallengeTeamIds, cooldownByTeamId, steps };
}


function getSortedTeamMembers(teamId, captainEmail, membersList = allMembers) {
  return [...(membersList || []).filter(m => m.team_id === teamId)].sort((a, b) => {
    const aCaptain = a.player_email === captainEmail;
    const bCaptain = b.player_email === captainEmail;
    if (aCaptain && !bCaptain) return -1;
    if (!aCaptain && bCaptain) return 1;
    const aPlayer = allPlayers.find(p => p.email === a.player_email);
    const bPlayer = allPlayers.find(p => p.email === b.player_email);
    return (aPlayer?.name || a.player_email).localeCompare(bPlayer?.name || b.player_email, 'hr');
  });
}

function isPlayedCompletedChallenge(challenge) {
  return challenge.status === 'completed' &&
    !!challenge.result_winner_id &&
    !!challenge.result_score;
}

function getRematchBlockReason(challengerId, challengedId) {
  const completedBetweenTeams = allChallenges
    .filter(c =>
      c.status === 'completed' &&
      c.result_winner_id &&
      c.result_score &&
      (
        (c.challenger_id === challengerId && c.challenged_id === challengedId) ||
        (c.challenger_id === challengedId && c.challenged_id === challengerId)
      )
    )
    .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));

  const lastMatch = completedBetweenTeams[0];
  if(!lastMatch || lastMatch.result_winner_id !== challengedId) return '';

  const lastMatchDate = new Date(lastMatch.updated_at || lastMatch.created_at);
  const challengedPlayedAnotherMatch = allChallenges.some(c => {
    if(c.status !== 'completed') return false;
    if(!c.result_score) return false;
    if(c.id === lastMatch.id) return false;
    if(new Date(c.updated_at || c.created_at) <= lastMatchDate) return false;
    if(c.challenger_id !== challengedId && c.challenged_id !== challengedId) return false;

    const opponentId = c.challenger_id === challengedId ? c.challenged_id : c.challenger_id;
    return opponentId !== challengerId;
  });

  return challengedPlayedAnotherMatch
    ? ''
    : 'Ne možete ponovno izazvati ovaj tim dok oni ne odigraju barem jedan meč protiv drugog protivnika.';
}

function updateNotifBadge() {
  if(!myTeam) return;
  const pending = allChallenges.filter(c =>
    c.challenged_id === myTeam.id && c.status === 'pending'
  ).length;
  const badge = document.getElementById('notif-badge');
  if(pending > 0) { badge.style.display='inline-flex'; badge.textContent=pending; }
  else { badge.style.display='none'; }
}
