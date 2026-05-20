// TK Buje Piramida — slanje/prihvat izazova, odabir igrača

// ---- PLAYER SELECTION ----
let pendingChallengeData = null;
let selectedPlayers = new Set();
let selectionMode = null; // 'challenge' or 'accept'
let pendingAcceptId = null;

function openSelectPlayers(teamId, members, challengedId) {
  pendingChallengeData = { teamId, challengedId };
  selectedPlayers = new Set();
  selectionMode = 'challenge';
  renderPlayerSelection(members);
  openModal('modal-select-players');
}

function openSelectPlayersAccept(teamId, members, challengeId) {
  pendingAcceptId = challengeId;
  selectedPlayers = new Set();
  selectionMode = 'accept';
  renderPlayerSelection(members);
  document.getElementById('confirm-players-btn').textContent = 'Potvrdi i prihvati izazov';
  openModal('modal-select-players');
}

function renderPlayerSelection(members) {
  const list = document.getElementById('select-players-list');
  list.innerHTML = members.map(m => {
    const player = allPlayers.find(p=>p.email===m.player_email);
    const isCap = m.player_email === myTeam?.captain_email;
    return `<div style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem;background:var(--bg3);border-radius:10px;margin-bottom:0.5rem;cursor:pointer;border:1.5px solid var(--border);transition:all 0.2s;" 
      id="player-sel-${m.player_email.replace(/[@.]/g,'_')}"
      onclick="togglePlayerSelect('${m.player_email}', this)">
      <div style="width:20px;height:20px;border-radius:50%;border:2px solid var(--border2);display:flex;align-items:center;justify-content:center;font-size:0.7rem;" id="check-${m.player_email.replace(/[@.]/g,'_')}"></div>
      <span style="font-weight:${isCap?'600':'400'};color:${isCap?'var(--orange)':'var(--text2)'};">${player?.name||m.player_email} ${isCap?'👑':''}</span>
    </div>`;
  }).join('');
  document.getElementById('confirm-players-btn').textContent = 'Potvrdi i pošalji izazov';
}

function togglePlayerSelect(email, el) {
  if(selectedPlayers.has(email)) {
    selectedPlayers.delete(email);
    el.style.borderColor = 'var(--border)';
    el.style.background = 'var(--bg3)';
    document.getElementById('check-'+email.replace(/[@.]/g,'_')).textContent = '';
    document.getElementById('check-'+email.replace(/[@.]/g,'_')).style.borderColor = 'var(--border2)';
    document.getElementById('check-'+email.replace(/[@.]/g,'_')).style.background = '';
  } else {
    if(selectedPlayers.size >= 2) { showToast('Možeš odabrati samo 2 igrača!','error'); return; }
    selectedPlayers.add(email);
    el.style.borderColor = 'var(--orange)';
    el.style.background = 'var(--orange-glow)';
    document.getElementById('check-'+email.replace(/[@.]/g,'_')).textContent = '✓';
    document.getElementById('check-'+email.replace(/[@.]/g,'_')).style.borderColor = 'var(--orange)';
    document.getElementById('check-'+email.replace(/[@.]/g,'_')).style.background = 'var(--orange)';
    document.getElementById('check-'+email.replace(/[@.]/g,'_')).style.color = 'white';
  }
}

async function confirmPlayerSelection() {
  if(selectedPlayers.size !== 2) { showToast('Moraš odabrati točno 2 igrača!','error'); return; }
  const [p1, p2] = [...selectedPlayers];

  if(selectionMode === 'challenge') {
    const challenged = allTeams.find(t=>t.id===pendingChallengeData.challengedId);
    const rematchBlockReason = getRematchBlockReason(myTeam.id, pendingChallengeData.challengedId);
    if(rematchBlockReason) { showToast(rematchBlockReason, 'error'); closeModal('modal-select-players'); return; }

    if(!confirm('Izazvati tim "'+challenged?.name+'"?')) return;
    const responseExpires = new Date(Date.now() + 3*24*60*60*1000).toISOString();
    const { error } = await sb.from('challenges').insert({
      challenger_id: myTeam.id,
      challenged_id: pendingChallengeData.challengedId,
      status: 'pending',
      response_expires_at: responseExpires,
      challenger_player1: p1,
      challenger_player2: p2
    });
    if(error) { showToast('Greška: '+error.message,'error'); return; }
    await sendChallengeEmail(pendingChallengeData.challengedId, myTeam.name);
    closeModal('modal-select-players');
    await safeLoadAll('manual');
    showFairPlayPopup(pendingChallengeData.challengedId);
    return;
  } else {
    const matchExpires = new Date(Date.now() + 6*24*60*60*1000).toISOString();
    const { error } = await sb.from('challenges').update({
      status: 'accepted',
      match_expires_at: matchExpires,
      challenged_player1: p1,
      challenged_player2: p2
    }).eq('id', pendingAcceptId);
    if(error) { showToast('Greška: '+error.message,'error'); return; }
    showToast('Izazov prihvaćen! Imate 6 dana za meč.','success');
  }

  closeModal('modal-select-players');
  await safeLoadAll('manual');
}

// ---- EMAIL NOTIFICATION ----
async function sendChallengeEmail(challengedTeamId, challengerName) {
  try {
    const challenged = allTeams.find(t=>t.id===challengedTeamId);
    if(!challenged) return;
    const captain = allPlayers.find(p=>p.email===challenged.captain_email);
    if(!captain) return;

    await fetch('https://aglbdjyljbzzpddrshno.supabase.co/functions/v1/send-challenge-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnbGJkanlsamJ6enBkZHJzaG5vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NTQxOTcsImV4cCI6MjA5MzIzMDE5N30.NEOJnMJiUHCEGa27xkPf2HM00KEFZC5DjcDpC6t8U6Q',
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnbGJkanlsamJ6enBkZHJzaG5vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NTQxOTcsImV4cCI6MjA5MzIzMDE5N30.NEOJnMJiUHCEGa27xkPf2HM00KEFZC5DjcDpC6t8U6Q'
      },
      body: JSON.stringify({
        to: captain.email,
        challengerName: challengerName,
        challengedName: challenged.name
      })
    });
  } catch(e) {
    console.error('Email greška:', e);
  }
}

async function sendAcceptedEmail(challengerTeamId, challengedName) {
  try {
    const challenger = allTeams.find(t=>t.id===challengerTeamId);
    if(!challenger) return;
    const captain = allPlayers.find(p=>p.email===challenger.captain_email);
    if(!captain) return;

    await fetch('https://aglbdjyljbzzpddrshno.supabase.co/functions/v1/send-challenge-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnbGJkanlsamJ6enBkZHJzaG5vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NTQxOTcsImV4cCI6MjA5MzIzMDE5N30.NEOJnMJiUHCEGa27xkPf2HM00KEFZC5DjcDpC6t8U6Q',
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnbGJkanlsamJ6enBkZHJzaG5vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NTQxOTcsImV4cCI6MjA5MzIzMDE5N30.NEOJnMJiUHCEGa27xkPf2HM00KEFZC5DjcDpC6t8U6Q'
      },
      body: JSON.stringify({
        to: captain.email,
        type: 'accepted',
        challengerName: challenger.name,
        challengedName: challengedName
      })
    });
  } catch(e) {
    console.error('Email greška:', e);
  }
}

// ---- SEND CHALLENGE ----
async function sendChallenge(challengedId) {
  if(!myTeam) { showToast('Nisi član nijednog tima!', 'error'); return; }
  if(myTeam.captain_email !== currentPlayer.email) {
    showToast('Samo kapetan može slati izazove!', 'error'); return;
  }
  const challenged = allTeams.find(t=>t.id===challengedId);
  if(!challenged) return;

  // Provjeri cooldown
  const threeDaysAgo = new Date(Date.now() - 3*24*60*60*1000);
  const inCooldown = allChallenges.some(c =>
    c.challenged_id === challengedId &&
    c.status === 'declined' &&
    new Date(c.updated_at) > threeDaysAgo
  );
  if(inCooldown) { showToast('Tim je u zaštitnom roku — ne može biti izazvan!', 'error'); return; }

  const rematchBlockReason = getRematchBlockReason(myTeam.id, challengedId);
  if(rematchBlockReason) { showToast(rematchBlockReason, 'error'); return; }

  // Koristi cache umjesto novog Supabase selecta u click-pathu.
  const myMembers = getCachedTeamMembers(myTeam.id);
  
  if(myMembers && myMembers.length === 3) {
    // Odaberi 2 igrača koji igraju
    openSelectPlayers(myTeam.id, myMembers, challengedId);
    return;
  }

  // Tim ima 2 igrača - automatski igraju oba
  const player1 = myMembers?.[0]?.player_email || null;
  const player2 = myMembers?.[1]?.player_email || null;

  if(!confirm('Izazvati tim "'+challenged.name+'"?')) return;

  const responseExpires = new Date(Date.now() + 3*24*60*60*1000).toISOString();
  const { error } = await sb.from('challenges').insert({
    challenger_id: myTeam.id,
    challenged_id: challengedId,
    status: 'pending',
    response_expires_at: responseExpires,
    challenger_player1: player1,
    challenger_player2: player2
  });
  if(error) { showToast('Greška: '+error.message, 'error'); return; }
  await sendChallengeEmail(challengedId, myTeam.name);
  await safeLoadAll('manual');
  showFairPlayPopup(challengedId);
}


// ---- FER PLAY POPUP ----
function showFairPlayPopup(challengedId) {
  const challenged = allTeams.find(t => t.id === challengedId);
  const challengedName = challenged?.name || challenged?.nickname || 'tim';
  const captain = allPlayers.find(p => p.email === challenged?.captain_email);
  const captainName = captain?.name || challenged?.captain_email || '—';
  const contactHTML = renderCaptainContactButtons(captain, 'Bok, želimo dogovoriti termin izazova u TK Buje Piramidi.');

  const content = document.getElementById('fairplay-content');
  if(!content) return;

  content.innerHTML =
    '<div class="fairplay-icon">🤝</div>'
    + '<div class="fairplay-title">Izazov poslan!</div>'
    + '<div class="fairplay-sub">Tim <strong>' + challengedName + '</strong> je izazvan</div>'
    + '<div class="fairplay-card">'
      + '<div class="fairplay-card-header">🤝 Fer play naputak</div>'
      + '<div class="fairplay-card-body">'
        + 'Dobra praksa: nakon što pošalješ izazov, javi se kapetanu protivnika pozivom ili porukom. '
        + 'Daj im šansu da odgovore na vrijeme — <strong>nije svaki igrač svaki dan na aplikaciji!</strong>'
      + '</div>'
      + '<div class="fairplay-captain">👑 Kapetan: <strong>' + captainName + '</strong></div>'
      + '<div class="fairplay-contact">' + contactHTML + '</div>'
    + '</div>'
    + '<button class="fairplay-btn" onclick="closeModal(\'modal-fairplay\')">Razumijem, javit ću se! 👍</button>';

  openModal('modal-fairplay');
}

// ---- RENDER CHALLENGES ----

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getChallengeTeamPlayersDisplay(team) {
  if(!team) return 'Nepoznat tim';
  let members = [];
  try {
    members = getCachedTeamMembers(team.id) || [];
  } catch(e) {
    members = (allMembers || []).filter(m => m.team_id === team.id);
  }
  const names = members
    .map(m => {
      const player = (allPlayers || []).find(p => p.email === m.player_email);
      return player?.name || m.player_email || '';
    })
    .filter(Boolean);
  return names.length ? names.join(' / ') : (team.name || team.nickname || 'Nepoznat tim');
}

function getChallengeTeamPlayersList(team) {
  if(!team) return [];
  let members = [];
  try {
    members = getCachedTeamMembers(team.id) || [];
  } catch(e) {
    members = (allMembers || []).filter(m => m.team_id === team.id);
  }
  return members
    .map(m => {
      const player = (allPlayers || []).find(p => p.email === m.player_email);
      return player?.name || m.player_email || '';
    })
    .filter(Boolean);
}

function formatChallengeDateTime(value, mode = 'datetime') {
  if(!value) return '—';
  const d = new Date(value);
  if(isNaN(d.getTime())) return '—';
  if(mode === 'date') return d.toLocaleDateString('hr-HR');
  if(mode === 'time') return d.toLocaleTimeString('hr-HR', { hour:'2-digit', minute:'2-digit' });
  return d.toLocaleDateString('hr-HR') + ' u ' + d.toLocaleTimeString('hr-HR', { hour:'2-digit', minute:'2-digit' });
}

function toDatetimeLocalInput(value) {
  if(!value) return '';
  const d = new Date(value);
  if(isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function datetimeLocalToIso(value) {
  if(!value) return null;
  const d = new Date(value);
  if(isNaN(d.getTime())) return null;
  return d.toISOString();
}

function statusLabelHr(status) {
  return ({
    pending:'Na čekanju',
    accepted:'Prihvaćeno',
    pending_result:'Čeka potvrdu rezultata',
    completed:'Završeno / potvrđeno',
    declined:'Odbijeno',
    cancelled:'Otkazano',
    surrendered:'Predaja'
  })[status] || status || '—';
}

function buildChallengeTeamCard(team, role, c) {
  const members = getChallengeTeamPlayersList(team);
  const safeNickname = escapeHtml(team?.nickname || team?.name || 'Tim');
  const safeMeta = escapeHtml('Stepenica ' + (team?.step ?? '—') + ' · Pozicija ' + (team?.position ?? '—'));
  const isMine = myTeam && team?.id === myTeam.id;
  const isWinner = c?.result_winner_id && c.result_winner_id === team?.id;
  const isChallenger = role === 'challenger';
  const memberHtml = members.length
    ? members.map(n => `<div class="challenge-vs-member">${escapeHtml(n)}</div>`).join('')
    : '<div class="challenge-vs-member muted">Nema članova</div>';

  return `
    <div class="challenge-vs-team ${isMine ? 'mine' : ''} ${isWinner ? 'winner' : ''} ${isChallenger ? 'challenger' : 'challenged'}">
      ${isWinner ? '<div class="challenge-vs-crown">🏆</div>' : ''}
      <div class="challenge-vs-role">${isChallenger ? 'Izazivač' : 'Izazvani'}</div>
      <div class="challenge-vs-name">${safeNickname}</div>
      <div class="challenge-vs-meta">${safeMeta}</div>
      <div class="challenge-vs-members">${memberHtml}</div>
    </div>`;
}

async function renderChallenges() {
  const container = document.getElementById('challenges-container');
  if(!allChallenges.length) { container.innerHTML='<div class="empty">Nema izazova.</div>'; return; }

  const now = new Date();

  // Expire pending challenges - koristimo for...of da čekamo svaki upit
  for(const c of allChallenges) {
    if(c.status==='pending' && new Date(c.response_expires_at) < now) {
      await handleExpired(c);
    }
  }

  const html = allChallenges.map((c,i) => {
    const challenger = allTeams.find(t=>t.id===c.challenger_id);
    const challenged = allTeams.find(t=>t.id===c.challenged_id);
    if(!challenger||!challenged) return '';

    const isMyChallenge = myTeam && (c.challenger_id===myTeam.id||c.challenged_id===myTeam.id);
    const isChallenged = myTeam && c.challenged_id===myTeam.id;
    const iAmCaptain = myTeam?.captain_email === currentPlayer?.email;

    const expires = c.status==='pending' ? new Date(c.response_expires_at) : c.match_expires_at ? new Date(c.match_expires_at) : null;
    let timerInfo = { label:'Rok', value:'—', urgent:false };
    if(expires && ['pending','accepted'].includes(c.status)) {
      const timerBase = c.status === 'accepted' ? getPauseTimerNow() : now;
      const remaining = formatRemainingTime(expires, timerBase);
      const pausedText = c.status === 'accepted' && tournamentPause?.is_paused ? ' ⏸' : '';
      timerInfo = {
        label: c.status==='pending' ? 'Rok za odgovor' : 'Rok za meč' + pausedText,
        value: remaining.text,
        urgent: remaining.diff < DAY_MS
      };
    }

    const hasSchedule = c.status === 'accepted' && c.scheduled_at;
    const scheduleText = hasSchedule ? formatChallengeDateTime(c.scheduled_at) : (c.status === 'accepted' ? 'Termin još nije zakazan' : '—');

    const statusMap = { pending:'s-pending', accepted:'s-accepted', completed:'s-completed', declined:'s-declined', cancelled:'s-declined', surrendered:'s-declined', pending_result:'s-pending' };
    const statusLabel = { pending:'Na čekanju', accepted:'Prihvaćeno', completed:'Završeno', declined:'Odbijeno', cancelled:'Otkazano', surrendered:'Predaja', pending_result:'Čeka potvrdu' };

    const challengerName = escapeHtml(challenger.nickname || challenger.name || 'Izazivač');
    const challengedName = escapeHtml(challenged.nickname || challenged.name || 'Izazvani');

    let confirmationText = '';
    if(c.status === 'pending') {
      confirmationText = `<span class="challenge-vs-warn">Čeka odgovor: ${challengedName}</span>`;
    } else if(c.status === 'accepted') {
      confirmationText = `<span class="challenge-vs-ok">✓ ${challengerName}</span><span class="challenge-vs-ok">✓ ${challengedName}</span>`;
    } else if(c.status === 'pending_result') {
      confirmationText = `<span class="challenge-vs-warn">Čeka potvrdu rezultata</span>`;
    } else if(c.status === 'completed') {
      confirmationText = `<span class="challenge-vs-ok">Meč završen</span>`;
    } else {
      confirmationText = `<span class="challenge-vs-muted">${escapeHtml(statusLabel[c.status] || c.status)}</span>`;
    }

    let resultRows = '';
    if(['completed','pending_result','surrendered'].includes(c.status)) {
      const winner = allTeams.find(t=>t.id===c.result_winner_id);
      resultRows = `
        <div class="challenge-vs-info-row">
          <div class="challenge-vs-info-label">🏆 Pobjednik</div>
          <div class="challenge-vs-info-value accent">${escapeHtml(winner?.nickname || winner?.name || '—')}</div>
        </div>
        ${c.result_score ? `<div class="challenge-vs-info-row">
          <div class="challenge-vs-info-label">🎾 Rezultat</div>
          <div class="challenge-vs-info-value">${escapeHtml(c.result_score)}</div>
        </div>` : ''}`;
    }

    let actions = '';
    if(c.status==='pending' && isChallenged && iAmCaptain) {
      actions = `
        <button class="btn-accept" onclick="respondChallenge('${c.id}','accepted')">✓ Prihvati</button>
        <button class="btn-decline" onclick="respondChallenge('${c.id}','declined')">✕ Odbij</button>`;
    }
    if(c.status==='accepted' && isMyChallenge) {
      actions = `<button class="btn-accept" onclick="openResultModal('${c.id}')">📝 Unesi rezultat</button>`;
    }
    if(currentPlayer?.is_admin) {
      actions += `<button class="admin-small-btn" onclick="openEditChallenge('${c.id}')">⚙ Admin uredi</button>`;
    }

    return `<div class="challenge-card challenge-vs-box" style="animation-delay:${i*0.05}s;${!isMyChallenge?'opacity:0.72;':''}">
      <div class="challenge-vs-top">
        <span class="status-pill ${statusMap[c.status]||'s-pending'}">${statusLabel[c.status]||escapeHtml(c.status)}</span>
        <span class="challenge-vs-id">#${escapeHtml(c.id).slice(0,8)}</span>
      </div>

      <div class="challenge-vs-layout">
        <div class="challenge-vs-pair">
          ${buildChallengeTeamCard(challenger, 'challenger', c)}
          <div class="challenge-vs-label">VS</div>
          ${buildChallengeTeamCard(challenged, 'challenged', c)}
        </div>

        <div class="challenge-vs-info">
          <div class="challenge-vs-info-row">
            <div class="challenge-vs-info-label">🛡️ Potvrde</div>
            <div class="challenge-vs-info-value challenge-vs-confirm">${confirmationText}</div>
          </div>
          <div class="challenge-vs-info-row">
            <div class="challenge-vs-info-label">📅 Termin meča</div>
            <div class="challenge-vs-info-value ${hasSchedule ? 'accent' : 'muted'}">${escapeHtml(scheduleText)}</div>
          </div>
          <div class="challenge-vs-info-row">
            <div class="challenge-vs-info-label">⏱️ ${escapeHtml(timerInfo.label)}</div>
            <div class="challenge-vs-info-value ${timerInfo.urgent ? 'danger' : 'accent'}">${escapeHtml(timerInfo.value)}</div>
          </div>
          <div class="challenge-vs-info-row">
            <div class="challenge-vs-info-label">✉️ Poslano</div>
            <div class="challenge-vs-info-value">${formatChallengeDateTime(c.created_at)}</div>
          </div>
          ${resultRows}
        </div>
      </div>

      ${actions ? `<div class="challenge-actions challenge-vs-actions">${actions}</div>` : ''}
    </div>`;
  }).join('');

  container.innerHTML = html || '<div class="empty">Nema izazova.</div>';
}

// ---- RESPOND TO CHALLENGE ----
async function respondChallenge(challengeId, response) {
  const challenge = allChallenges.find(c=>c.id===challengeId);
  if(!challenge) return;

  if(response==='declined') {
    // Nađi zadnji completed izazov između ova dva tima
    const lastCompleted2 = allChallenges
      .filter(x =>
        x.challenger_id === challenge.challenger_id &&
        x.challenged_id === challenge.challenged_id &&
        x.status === 'completed'
      )
      .sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0];

    const afterDate2 = lastCompleted2 ? new Date(lastCompleted2.created_at) : new Date(0);
    const prevRejections2 = allChallenges.filter(x =>
      x.challenger_id === challenge.challenger_id &&
      x.challenged_id === challenge.challenged_id &&
      x.status === 'declined' &&
      x.id !== challengeId &&
      new Date(x.created_at) > afterDate2
    ).length;
    const totalRejections = prevRejections2 + 1;

    if(totalRejections >= 2) {
      if(!confirm('Ovo je drugo odbijanje! Timovi će automatski zamijeniti mjesta. Nastavi?')) return;
      await swapTeams(challenge.challenger_id, challenge.challenged_id);
      await sb.from('challenges').update({ status:'completed', result_winner_id:challenge.challenger_id, rejection_count:totalRejections }).eq('id',challengeId);
      showToast('Izazivač je pobijedio zbog dvostrukog odbijanja! Timovi su zamijenili mjesta! 🔄', 'success');
    } else {
      await sb.from('challenges').update({ status:'declined', rejection_count:totalRejections }).eq('id',challengeId);
      showToast('Izazov odbijen (1/2). Tim može izazvati ponovo.', '');
    }
  } else {
    // Prihvaćeno — koristi cache umjesto novog Supabase selecta u click-pathu.
    const myMembers = getCachedTeamMembers(myTeam.id);
    
    if(myMembers && myMembers.length === 3) {
      // Odaberi 2 igrača koji igraju
      openSelectPlayersAccept(myTeam.id, myMembers, challengeId);
      return;
    }

    // Tim ima 2 igrača - automatski igraju oba
    const matchExpires = new Date(Date.now() + 6*24*60*60*1000).toISOString();
    await sb.from('challenges').update({
      status:'accepted',
      match_expires_at: matchExpires,
      challenged_player1: myMembers?.[0]?.player_email || null,
      challenged_player2: myMembers?.[1]?.player_email || null
    }).eq('id',challengeId);
    showToast('Izazov prihvaćen! Imate 6 dana za meč.', 'success');
    await sendAcceptedEmail(challenge.challenger_id, myTeam.name);
  }
  await safeLoadAll('manual');
}

// ---- HANDLE EXPIRED ----
async function handleExpired(challenge) {
  // Broji odbijanja samo NAKON zadnje zamjene mjesta između ova dva tima
  const lastCompleted = allChallenges
    .filter(x =>
      x.challenger_id === challenge.challenger_id &&
      x.challenged_id === challenge.challenged_id &&
      x.status === 'completed'
    )
    .sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0];

  const afterDate = lastCompleted ? new Date(lastCompleted.created_at) : new Date(0);
  const prevRejections = allChallenges.filter(x =>
    x.challenger_id === challenge.challenger_id &&
    x.challenged_id === challenge.challenged_id &&
    x.status === 'declined' &&
    x.id !== challenge.id &&
    new Date(x.created_at) > afterDate
  ).length;

  const totalRejections = prevRejections + 1;

  if(totalRejections >= 2) {
    await swapTeams(challenge.challenger_id, challenge.challenged_id);
    await sb.from('challenges').update({
      status: 'completed',
      result_winner_id: challenge.challenger_id,
      rejection_count: totalRejections,
      updated_at: new Date().toISOString()
    }).eq('id', challenge.id);
    showToast('Rok istekao — timovi zamijenili mjesta! 🔄', 'success');
  } else {
    await sb.from('challenges').update({
      status: 'declined',
      rejection_count: totalRejections,
      updated_at: new Date().toISOString()
    }).eq('id', challenge.id);
  }
}
