// TK Buje Piramida — renderiranje piramide i team kartica

// ---- RENDER PYRAMID ----
function getStepStyles() {
  return [
    { bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.5)',  color: '#f59e0b' },
    { bg: 'rgba(255,107,43,0.06)',  border: 'rgba(255,107,43,0.4)',  color: '#ff6b2b' },
    { bg: 'rgba(34,197,94,0.05)',   border: 'rgba(34,197,94,0.35)',  color: '#22c55e' },
    { bg: 'rgba(59,130,246,0.04)',  border: 'rgba(59,130,246,0.35)', color: '#3b82f6' },
    { bg: 'rgba(148,163,184,0.03)', border: 'rgba(148,163,184,0.3)', color: '#94a3b8' }
  ];
}

function getPyramidContext() {
  const steps = derivedCache.steps || {};
  const stepKeys = Object.keys(steps).map(Number);
  const maxStep = stepKeys.length ? Math.max(...stepKeys) : 1;
  const myStepEffective = myTeam?.penalty ? 0 : myTeam?.step;

  return {
    steps,
    maxStep,
    stepStyles: getStepStyles(),
    busyTeams: derivedCache.activeChallengeTeamIds || new Set(),
    cooldownByTeamId: derivedCache.cooldownByTeamId || new Map(),
    myStepEffective
  };
}

function getTeamMembersHTML(team, options = {}) {
  const members = getCachedTeamMembers(team.id);
  const isTopStep = Number(team.step) === 1 && !team.penalty;

  return members.map(m => {
    const p = derivedCache.playerByEmail.get(m.player_email) || allPlayers.find(x => x.email === m.player_email);
    const isCap = m.player_email === team.captain_email;
    const nameDisplay = options.uppercase === false ? (p?.name || m.player_email) : (p?.name || m.player_email).toUpperCase();
    const capColor = isTopStep ? 'var(--gold)' : 'var(--text)';
    const color = isCap ? capColor : 'var(--text2)';
    const weight = isCap ? '700' : '500';
    const crown = options.showCaptainIcon && isCap ? '👑 ' : '';
    const size = options.fontSize || '0.65rem';
    return '<div class="team-member-name" style="font-size:' + size + ';font-weight:' + weight + ';color:' + color + ';">' + crown + nameDisplay + '</div>';
  }).join('');
}

function renderChallengeButton(team) {
  return '<button class="challenge-btn" onclick="event.stopPropagation();sendChallenge(\'' + team.id + '\')">⚔️ Izazovi</button>';
}


// ---- PHASE 2 UI HELPERS ----
function getTeamDisplayTitle(team) {
  return team?.name || team?.nickname || 'Tim';
}

function getTeamInitials(team) {
  const members = getCachedTeamMembers(team.id)
    .map(m => derivedCache.playerByEmail.get(m.player_email)?.name || m.player_email)
    .filter(Boolean);
  const source = members.length ? members.join(' ') : getTeamDisplayTitle(team);
  return source
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part[0])
    .join('')
    .substring(0, 2)
    .toUpperCase() || 'TK';
}

function getTeamRecord(teamId) {
  const matches = allChallenges.filter(c =>
    ['completed','surrendered'].includes(c.status) &&
    (c.challenger_id === teamId || c.challenged_id === teamId)
  );
  const wins = matches.filter(c => c.result_winner_id === teamId).length;
  const losses = matches.length - wins;
  const winRate = matches.length ? Math.round((wins / matches.length) * 100) : 0;
  return { matches: matches.length, wins, losses, winRate };
}

function getTeamCardTone(team, flags = {}) {
  if(team?.penalty) return 'danger';
  if(flags.isMyTeam) return 'mine';
  if(flags.canChallenge) return 'challenge';
  if(flags.hasPendingChallenge) return 'busy';
  if(Number(team?.step) === 1) return 'champion';
  return 'default';
}

function renderTeamMiniStats(team, flags = {}) {
  const record = getTeamRecord(team.id);
  const stepLabel = team.penalty ? 'Kazna' : 'S' + team.step;
  const matchLabel = record.matches ? record.wins + '-' + record.losses : '0-0';
  return '<div class="team-mini-stats">'
    + '<span>' + stepLabel + '</span>'
    + '<span>' + matchLabel + '</span>'
    + (flags.hasPendingChallenge ? '<span>Live</span>' : '<span>' + record.winRate + '%</span>')
    + '</div>';
}

function renderTeamStatusBadges(team, context, flags) {
  let html = '';

  if(flags.canChallenge) html += renderChallengeButton(team);
  if(flags.isMyTeam) html += '<div class="team-badge team-badge-me">MOJ TIM</div>';
  if(flags.hasPendingChallenge) html += '<div class="team-badge team-badge-pending">⏳ Aktivan izazov</div>';

  const cooldown = context.cooldownByTeamId.get(team.id);
  if(cooldown && !flags.isMyTeam) {
    const hoursLeft = Math.max(0, Math.ceil((cooldown.cooldownEnd - new Date()) / HOUR_MS));
    html += '<div class="team-badge team-badge-danger">🛡 Zaštita još ' + hoursLeft + 'h</div>';
  }

  if(!team.penalty && team.step > 2) {
    const lastMatch = team.last_match_at ? new Date(team.last_match_at) : new Date(team.created_at);
    const timerNow = getPauseTimerNow();
    const daysInactive = Math.floor((timerNow - lastMatch) / DAY_MS);
    const daysLeft = 15 - daysInactive;
    const pausePrefix = tournamentPause?.is_paused ? '⏸ ' : '';

    if(daysLeft <= 0) html += '<div class="team-badge team-badge-danger">' + pausePrefix + '⚠️ Kazna!</div>';
    else if(daysLeft <= 5) html += '<div class="team-badge team-badge-danger">' + pausePrefix + '⚠️ Kazna za ' + daysLeft + ' dan(a)</div>';
    else html += '<div class="team-badge team-badge-muted">' + pausePrefix + '📅 ' + daysLeft + ' dana do kazne</div>';
  }

  return html;
}

function renderTeamCard(team, context) {
  const isMyTeam = myTeam?.id === team.id;
  const inCooldown = context.cooldownByTeamId.has(team.id);
  const rematchBlockReason = myTeam ? getRematchBlockReason(myTeam.id, team.id) : '';
  const tStepEffective = team.penalty ? 0 : team.step;
  const isAboveEffective = myTeam && (
    (!myTeam.penalty && tStepEffective === context.myStepEffective - 1) ||
    (myTeam.penalty && tStepEffective === context.maxStep)
  );
  const hasPendingChallenge = context.busyTeams.has(team.id);
  const canChallenge = !isMyTeam && isAboveEffective && myTeam &&
    !context.busyTeams.has(myTeam.id) && !hasPendingChallenge && !inCooldown &&
    myTeam.captain_email === currentPlayer?.email && !rematchBlockReason;

  const flags = { isMyTeam, hasPendingChallenge, canChallenge };
  let cardClass = 'team-card';
  if(isMyTeam) cardClass += ' my-team';
  if(canChallenge) cardClass += ' can-challenge';
  if(hasPendingChallenge && !isMyTeam) cardClass += ' has-challenge';

  // Krune na karticama su maknute da kartice ostanu čišće i kompaktnije.
  const crownHTML = '';
  const titleHTML = getTeamDisplayTitle(team)
    ? '<div class="team-card-title">' + getTeamDisplayTitle(team) + '</div>'
    : '';
  const badgesHTML = renderTeamStatusBadges(team, context, flags);

  return '<div class="' + cardClass + '" onclick="openTeam(\'' + team.id + '\')">'
    + crownHTML
    + titleHTML
    + '<div class="team-members">' + getTeamMembersHTML(team) + '</div>'
    + (badgesHTML ? '<div class="team-card-badges">' + badgesHTML + '</div>' : '')
    + '</div>';
}

function renderPenaltyCard(team) {
  const isMyTeam = myTeam?.id === team.id;
  let cardClass = 'team-card has-challenge penalty-card';
  if(isMyTeam) cardClass += ' my-team';
  const titleHTML = getTeamDisplayTitle(team)
    ? '<div class="team-card-title" style="color:var(--text);">' + getTeamDisplayTitle(team) + '</div>'
    : '';
  return '<div class="' + cardClass + '" onclick="openTeam(\'' + team.id + '\')" style="border-color:var(--red);">'
    + titleHTML
    + '<div class="team-members">' + getTeamMembersHTML(team, { uppercase:false, showCaptainIcon:true, fontSize:'0.72rem' }) + '</div>'
    + '<div class="team-card-badges"><div class="team-badge team-badge-danger">⚠️ Kaznena zona</div>'
    + (isMyTeam ? '<div class="team-badge team-badge-me">MOJ TIM</div>' : '')
    + '</div></div>';
}

function renderPyramidStep(stepNumber, teams, context) {
  const style = context.stepStyles[stepNumber - 1] || context.stepStyles[context.stepStyles.length - 1];
  const stepLabelText = stepNumber === 1 ? '🏆 Stepenica 1' : 'Stepenica ' + stepNumber;
  return '<div class="pyramid-step" style="background:' + style.bg + ';border:3px solid ' + style.border + ';box-shadow:0 0 18px ' + style.border + ';border-radius:24px;padding:1rem 1.25rem;">'
    + '<div class="step-label" style="color:' + style.color + ';">' + stepLabelText + '</div>'
    + '<div class="step-teams">' + teams.map(t => renderTeamCard(t, context)).join('') + '</div>'
    + '</div>';
}

function renderPenaltyStep(teams) {
  if(!teams?.length) return '';
  return '<div class="pyramid-step" style="background:rgba(239,68,68,0.05);border:3px solid rgba(239,68,68,0.5);">'
    + '<div class="step-label" style="color:var(--red);">⚠️ Kaznena zona</div>'
    + '<div class="step-teams">' + teams.map(renderPenaltyCard).join('') + '</div>'
    + '</div>';
}

function renderPyramid() {
  const container = document.getElementById('pyramid-container');
  if(!container) return;
  if(!allTeams.length) { container.innerHTML='<div class="empty">Nema timova u piramidi.</div>'; return; }

  const context = getPyramidContext();
  let html = '';
  for(let s = 1; s <= context.maxStep; s++) {
    html += renderPyramidStep(s, context.steps[s] || [], context);
  }
  html += renderPenaltyStep(context.steps[0]);

  container.innerHTML = '<div class="pyramid-wrap">' + html + '</div>';
}


function canCurrentUserChallengeTeam(team) {
  if(!team || !myTeam || !currentPlayer) return false;
  if(myTeam.id === team.id) return false;
  if(myTeam.captain_email !== currentPlayer.email) return false;

  const context = getPyramidContext();
  const inCooldown = context.cooldownByTeamId.has(team.id);
  const rematchBlockReason = getRematchBlockReason(myTeam.id, team.id);
  const targetStep = team.penalty ? 0 : team.step;
  const canReachStep = (!myTeam.penalty && targetStep === context.myStepEffective - 1) ||
    (myTeam.penalty && targetStep === context.maxStep);

  return canReachStep &&
    !context.busyTeams.has(myTeam.id) &&
    !context.busyTeams.has(team.id) &&
    !inCooldown &&
    !rematchBlockReason;
}

function challengeFromTeamModal(teamId) {
  closeModal('modal-team');
  setTimeout(() => sendChallenge(teamId), 80);
}

function openTeam(teamId) {
  const team = derivedCache.teamById.get(teamId) || allTeams.find(t=>t.id===teamId);
  if(!team) return;
  const membersSorted = getCachedTeamMembers(teamId);
  const record = getTeamRecord(teamId);
  const statusText = team.penalty ? '⚠️ Kaznena zona' : 'Stepenica ' + team.step + ' · Pozicija ' + (team.position || '-');

  let memberList = '';
  membersSorted.forEach(m => {
    const player = derivedCache.playerByEmail.get(m.player_email) || allPlayers.find(p=>p.email===m.player_email);
    const isCaptain = m.player_email === team.captain_email;
    memberList += '<div class="profile-member-row">'
      + '<div class="profile-member-avatar">' + ((player?.name || m.player_email).substring(0,2).toUpperCase()) + '</div>'
      + '<div class="profile-member-main"><strong>' + (player?.name||m.player_email) + '</strong><span>' + m.player_email + '</span></div>'
      + (isCaptain ? '<span class="captain-tag">Kapetan</span>' : '')
      + '</div>';
  });

  const allTeamMatches = allChallenges.filter(c=>
    ['completed','surrendered'].includes(c.status) &&
    (c.challenger_id===teamId||c.challenged_id===teamId)
  ).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));

  let matchesHTML = '';
  if(allTeamMatches.length) {
    allTeamMatches.forEach(c => {
      const isWin = c.result_winner_id === teamId;
      const opponentId = c.challenger_id===teamId ? c.challenged_id : c.challenger_id;
      const opponent = derivedCache.teamById.get(opponentId) || allTeams.find(t=>t.id===opponentId);
      const isSurrender = c.status === 'surrendered';
      matchesHTML += '<div class="profile-match-row ' + (isWin ? 'win' : 'loss') + '">'
        + '<div><strong>' + (isWin ? '↑ Pobjeda' : '↓ Poraz') + '</strong><span>vs ' + adminTeamName(opponent) + (isSurrender ? ' · predaja' : '') + '</span></div>'
        + '<div class="profile-match-score"><strong>' + (c.result_score || '—') + '</strong><span>' + new Date(c.created_at).toLocaleDateString('hr-HR') + '</span></div>'
        + '</div>';
    });
  } else {
    matchesHTML = '<div class="empty" style="padding:1rem;">Nema odigranih mečeva.</div>';
  }

  const winRateLabel = record.matches ? record.winRate + '%' : '—';
  const title = getTeamDisplayTitle(team);
  const captain = derivedCache.playerByEmail.get(team.captain_email) || allPlayers.find(p=>p.email===team.captain_email);
  const contactHTML = renderCaptainContactButtons(captain, 'Bok, javljam se vezano uz TK Buje Piramidu.');

  document.getElementById('team-modal-content').innerHTML =
    '<div class="team-profile-hero ' + (team.penalty ? 'danger' : '') + '">'
      + '<div class="team-profile-avatar">' + getTeamInitials(team) + '</div>'
      + '<div class="team-profile-main">'
        + '<div class="team-profile-kicker">' + statusText + '</div>'
        + '<div class="team-profile-title">' + title + '</div>'
        + '<div class="team-profile-sub">' + membersSorted.length + ' igrača · ' + record.matches + ' mečeva</div>'
      + '</div>'
    + '</div>'
    + '<div class="profile-stats-grid">'
      + '<div class="profile-stat-card green"><strong>' + record.wins + '</strong><span>Pobjede</span></div>'
      + '<div class="profile-stat-card red"><strong>' + record.losses + '</strong><span>Porazi</span></div>'
      + '<div class="profile-stat-card orange"><strong>' + winRateLabel + '</strong><span>Uspješnost</span></div>'
    + '</div>'
    + '<div class="captain-contact-card">'
      + '<div class="captain-contact-label">Kontakt kapetana</div>'
      + contactHTML
    + '</div>'
    + (canCurrentUserChallengeTeam(team) ? '<button class="modal-challenge-btn" onclick="challengeFromTeamModal(\'' + team.id + '\')">⚔️ Izazovi ovaj tim</button>' : '')
    + '<div class="modal-tabs profile-tabs" style="margin-top:1rem;">'
      + '<button class="modal-tab active" onclick="switchTab(\'team-tab-clanovi\',this)">👥 Članovi</button>'
      + '<button class="modal-tab" onclick="switchTab(\'team-tab-mecevi\',this)">🎾 Mečevi ('+allTeamMatches.length+')</button>'
    + '</div>'
    + '<div class="tab-content active" id="team-tab-clanovi"><div class="profile-card-list">'+(memberList||'<div class="empty" style="padding:1rem;">Nema članova</div>')+'</div></div>'
    + '<div class="tab-content" id="team-tab-mecevi"><div class="profile-card-list">'+matchesHTML+'</div></div>';
  openModal('modal-team');
}
