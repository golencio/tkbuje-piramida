// TK Buje Piramida — admin panel, upravljanje timovima i izazovima

// ---- ADMIN ----
let activeAdminTab = 'overview';
const pendingPyramidMatchInserts = new Set();

function adminTeamName(team) {
  if(!team) return '?';
  return team.name || team.nickname || teamDisplayName(team);
}

function adminChallengeTeams(c) {
  return {
    challenger: allTeams.find(t=>t.id===c.challenger_id),
    challenged: allTeams.find(t=>t.id===c.challenged_id),
    winner: allTeams.find(t=>t.id===c.result_winner_id)
  };
}

function getPendingResults() {
  return allChallenges.filter(c=>c.status==='pending_result');
}

async function adminRefreshMatches() {
  if(!currentPlayer?.is_admin) return;
  const btn = document.getElementById('admin-refresh-btn');
  if(btn) {
    btn.disabled = true;
    btn.textContent = 'Osvježavam...';
  }
  try {
    await safeLoadAll('admin-manual');
  } finally {
    if(btn) {
      btn.disabled = false;
      btn.textContent = 'Osvježi';
    }
  }
}

async function insertPyramidMatchIfMissing(challenge, adminEmail) {
  console.log('[PYRAMID -> MATCHES] START', { challengeId: challenge?.id });

  if(!challenge?.id) {
    console.error('[PYRAMID -> MATCHES] INSERT_ERROR', { message: 'Missing challenge id' });
    return { status: 'error' };
  }

  if(pendingPyramidMatchInserts.has(challenge.id)) {
    console.log('[PYRAMID -> MATCHES] ALREADY_EXISTS', { challengeId: challenge.id, reason: 'insert_in_progress' });
    return { status: 'exists' };
  }

  const winnerIsChallenger = challenge.result_winner_id === challenge.challenger_id;
  const winnerIsChallenged = challenge.result_winner_id === challenge.challenged_id;

  if(!winnerIsChallenger && !winnerIsChallenged) {
    console.error('[PYRAMID -> MATCHES] INSERT_ERROR', {
      challengeId: challenge.id,
      message: 'result_winner_id does not match challenger_id or challenged_id'
    });
    return { status: 'error' };
  }

  pendingPyramidMatchInserts.add(challenge.id);

  try {
    const { data: existing, error: existingError } = await sb
      .from('matches')
      .select('id')
      .eq('pyramid_challenge_id', challenge.id)
      .limit(1);

    if(existingError) {
      console.error('[PYRAMID -> MATCHES] INSERT_ERROR', existingError);
      return { status: 'error' };
    }

    if(existing?.length) {
      console.log('[PYRAMID -> MATCHES] ALREADY_EXISTS', { challengeId: challenge.id, matchId: existing[0].id });
      return { status: 'exists' };
    }

    const { data: latestMatch, error: matchNumberError } = await sb
      .from('matches')
      .select('match_number')
      .order('match_number', { ascending: false })
      .limit(1);

    if(matchNumberError) {
      console.error('[PYRAMID -> MATCHES] INSERT_ERROR', matchNumberError);
      return { status: 'error' };
    }

    const nextMatchNumber = Number(latestMatch?.[0]?.match_number || 0) + 1;
    const now = new Date().toISOString();
    const insertData = winnerIsChallenger ? {
      match_number: nextMatchNumber,
      created_by_email: adminEmail || challenge.challenger_player1,
      status: 'Potvrđeno',
      winner1_email: challenge.challenger_player1,
      winner2_email: challenge.challenger_player2,
      loser1_email: challenge.challenged_player1,
      loser2_email: challenge.challenged_player2,
      notes: challenge.result_score,
      potvrdio_admin: adminEmail || null,
      vrijeme_potvrde: now,
      created_at: now,
      source: 'pyramid',
      pyramid_challenge_id: challenge.id
    } : {
      match_number: nextMatchNumber,
      created_by_email: adminEmail || challenge.challenged_player1,
      status: 'Potvrđeno',
      winner1_email: challenge.challenged_player1,
      winner2_email: challenge.challenged_player2,
      loser1_email: challenge.challenger_player1,
      loser2_email: challenge.challenger_player2,
      notes: challenge.result_score,
      potvrdio_admin: adminEmail || null,
      vrijeme_potvrde: now,
      created_at: now,
      source: 'pyramid',
      pyramid_challenge_id: challenge.id
    };

    console.log('[PYRAMID -> MATCHES] INSERT_DATA', insertData);

    const { error: insertError } = await sb.from('matches').insert(insertData);

    if(insertError) {
      console.error('[PYRAMID -> MATCHES] INSERT_ERROR', insertError);
      return { status: 'error' };
    }

    console.log('[PYRAMID -> MATCHES] INSERT_SUCCESS', { challengeId: challenge.id });
    return { status: 'inserted' };
  } finally {
    pendingPyramidMatchInserts.delete(challenge.id);
  }
}

function getExpiredMatches() {
  const matchTimerNow = getPauseTimerNow();
  return allChallenges.filter(c=>
    c.status==='accepted' &&
    c.match_expires_at &&
    new Date(c.match_expires_at) < matchTimerNow
  );
}

function getCooldownList() {
  const now = new Date();
  const threeDaysAgo = new Date(Date.now() - 3*24*60*60*1000);
  return allChallenges.filter(c =>
    c.status === 'declined' && new Date(c.updated_at) > threeDaysAgo
  ).map(c => {
    const team = allTeams.find(t=>t.id===c.challenged_id);
    const cooldownEnd = new Date(new Date(c.updated_at).getTime() + 3*24*60*60*1000);
    const hoursLeft = Math.ceil((cooldownEnd - now) / 3600000);
    return { team, challengeId: c.id, hoursLeft };
  }).filter(x=>x.team);
}

function getRankingChangeLog(limit = 8) {
  const items = [];

  allChallenges
    .filter(c => ['completed','surrendered'].includes(c.status) && c.result_winner_id)
    .forEach(c => {
      const { challenger, challenged, winner } = adminChallengeTeams(c);
      const winnerIsChallenger = c.result_winner_id === c.challenger_id;
      const changed = winnerIsChallenger || c.status === 'surrendered' || Number(c.rejection_count || 0) >= 2;
      if(!changed) return;

      let reason = 'Meč';
      let detail = 'Promjena nakon potvrđenog rezultata';
      let icon = '↕';
      let tone = 'green';

      if(Number(c.rejection_count || 0) >= 2 && !c.result_score) {
        reason = 'Drugo odbijanje';
        detail = 'Izazvani tim odbio je drugi put, pa je izazivač preuzeo mjesto';
        icon = '⚠';
        tone = 'gold';
      } else if(c.status === 'surrendered') {
        reason = 'Predaja';
        detail = 'Promjena zbog predaje / isteka roka';
        icon = '🏳';
        tone = 'red';
      } else if(winnerIsChallenger) {
        reason = 'Meč';
        detail = 'Izazivač je pobijedio i zamijenio mjesto s izazvanim timom';
        icon = '↑';
        tone = 'green';
      }

      items.push({
        id: c.id,
        created: new Date(c.updated_at || c.created_at),
        icon,
        tone,
        reason,
        team: adminTeamName(winner),
        fromTo: `${adminTeamName(challenger)} vs ${adminTeamName(challenged)}`,
        detail: c.result_score ? `${detail} · ${c.result_score}` : detail
      });
    });

  allTeams.filter(t=>t.penalty).forEach(t => {
    items.push({
      id: 'penalty-'+t.id,
      created: new Date(t.updated_at || t.last_match_at || t.created_at || Date.now()),
      icon: '⚠',
      tone: 'red',
      reason: 'Kazna zbog neaktivnosti',
      team: adminTeamName(t),
      fromTo: `Stepenica ${t.original_step || t.step} → Kazna`,
      detail: 'Tim je trenutno u kaznenoj zoni zbog neaktivnosti'
    });
  });

  return items
    .sort((a,b)=>b.created-a.created)
    .slice(0, limit);
}

function adminMetricCard(label, value, sub, tone='orange') {
  return `<div class="admin-metric-card ${tone}">
    <div class="admin-metric-label">${label}</div>
    <div class="admin-metric-value">${value}</div>
    <div class="admin-metric-sub">${sub}</div>
  </div>`;
}

function renderAdminPendingResults(pendingResults = getPendingResults(), compact = false) {
  if(!pendingResults.length) return '<div class="admin-empty-small">Nema mečeva za potvrdu ✓</div>';
  const list = compact ? pendingResults.slice(0,2) : pendingResults;
  return list.map(c => {
    const { challenger, challenged, winner } = adminChallengeTeams(c);
    const playedAt = c.updated_at ? new Date(c.updated_at).toLocaleString('hr-HR') : '';
    return `<div class="admin-action-row important">
      <div class="admin-row-icon">⏳</div>
      <div class="admin-row-main">
        <div class="admin-row-title">${adminTeamName(challenger)} <span>vs</span> ${adminTeamName(challenged)}</div>
        <div class="admin-row-meta">Pobjednik: <strong>${adminTeamName(winner)}</strong> · Rezultat: ${c.result_score || '—'}${playedAt ? ' · '+playedAt : ''}</div>
      </div>
      <div class="admin-row-actions">
        <button class="btn-accept" onclick="adminConfirmResult('${c.id}')">✓ Potvrdi</button>
        <button class="btn-decline" onclick="adminRejectResult('${c.id}')">✕ Odbij</button>
      </div>
    </div>`;
  }).join('') + (compact && pendingResults.length > 2 ? `<button class="admin-link-btn" onclick="showAdminTab('confirmations')">Prikaži sve (${pendingResults.length}) →</button>` : '');
}

function renderAdminChangeLog(items = getRankingChangeLog(), compact = false) {
  if(!items.length) return '<div class="admin-empty-small">Nema evidentiranih promjena poretka.</div>';
  const list = compact ? items.slice(0,4) : items;
  return list.map(item => `<div class="admin-change-row ${item.tone}">
    <div class="admin-change-icon">${item.icon}</div>
    <div class="admin-row-main">
      <div class="admin-row-title">${item.team}</div>
      <div class="admin-row-meta"><strong>${item.reason}</strong> · ${item.fromTo}</div>
      <div class="admin-row-meta">${item.detail}</div>
    </div>
    <div class="admin-change-time">${item.created.toLocaleDateString('hr-HR')}<br>${item.created.toLocaleTimeString('hr-HR',{hour:'2-digit',minute:'2-digit'})}</div>
  </div>`).join('') + (compact && items.length > 4 ? `<button class="admin-link-btn" onclick="showAdminTab('history')">Pogledaj sve promjene →</button>` : '');
}

function showAdminTab(tab) {
  activeAdminTab = tab;
  renderAdmin();
}

function renderAdmin() {
  if(!currentPlayer?.is_admin) {
    document.getElementById('admin-container').innerHTML='<div class="empty">⛔ Nemaš admin ovlasti.</div>';
    return;
  }

  const pendingResults = getPendingResults();
  const completedChallenges = allChallenges.filter(c=>['completed','surrendered'].includes(c.status)).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  const expiredMatches = getExpiredMatches();
  const pendingChallenges = allChallenges.filter(c=>c.status==='pending');
  const cooldownList = getCooldownList();
  const rankingChanges = getRankingChangeLog(20);
  const pauseStartedText = tournamentPause?.paused_at ? new Date(tournamentPause.paused_at).toLocaleString('hr-HR') : '—';
  const pauseReasonText = tournamentPause?.pause_reason ? tournamentPause.pause_reason : 'nije upisan';
  const teamsInPenalty = allTeams.filter(t=>t.penalty).length;
  const activeChallengesCount = allChallenges.filter(c=>['pending','accepted','pending_result'].includes(c.status)).length;

  const tabs = [
    ['overview','Pregled'],
    ['confirmations','Potvrde'],
    ['changes','Promjene poretka'],
    ['challenges','Izazovi i rokovi'],
    ['teams','Timovi'],
    ['history','Svi mečevi']
  ];

  const tabButtons = tabs.map(([id,label]) =>
    `<button class="admin-tab ${activeAdminTab===id?'active':''}" onclick="showAdminTab('${id}')">${label}</button>`
  ).join('');

  let body = '';

  if(activeAdminTab === 'overview') {
    body = `
      <div class="admin-metrics-grid">
        ${adminMetricCard('Mečevi za potvrdu', pendingResults.length, pendingResults.length ? 'Traži admin odluku' : 'Sve riješeno', pendingResults.length ? 'orange' : 'green')}
        ${adminMetricCard('Promjene poretka', rankingChanges.length, 'Meč / odbijanje / kazna', rankingChanges.length ? 'red' : 'blue')}
        ${adminMetricCard('Aktivni izazovi', activeChallengesCount, `${pendingChallenges.length} na čekanju · ${expiredMatches.length} isteklo`, expiredMatches.length ? 'red' : 'blue')}
        ${adminMetricCard('Status turnira', tournamentPause?.is_paused ? 'PAUZA' : 'AKTIVAN', tournamentPause?.is_paused ? pauseReasonText : 'Vrijeme teče normalno', tournamentPause?.is_paused ? 'gold' : 'green')}
      </div>

      <div class="admin-two-col">
        <div class="admin-panel-card">
          <div class="admin-panel-head"><span>Mečevi za potvrdu</span><button onclick="showAdminTab('confirmations')">Pogledaj sve →</button></div>
          ${renderAdminPendingResults(pendingResults, true)}
        </div>
        <div class="admin-panel-card">
          <div class="admin-panel-head"><span>Zadnje promjene u poretku</span><button onclick="showAdminTab('changes')">Pogledaj sve →</button></div>
          ${renderAdminChangeLog(rankingChanges, true)}
        </div>
      </div>

      <div class="admin-panel-card">
        <div class="admin-panel-head"><span>Brze akcije</span></div>
        <div class="admin-quick-grid">
          ${tournamentPause?.is_paused
            ? `<button class="admin-quick-card" onclick="adminResumeTournament()"><strong>▶ Nastavi turnir</strong><span>Pokreni odbrojavanja</span></button>`
            : `<button class="admin-quick-card" onclick="adminPauseTournament()"><strong>⏸ Pauziraj turnir</strong><span>Zaustavi rokove i kazne</span></button>`}
          <button class="admin-quick-card" onclick="showAdminTab('teams')"><strong>➕ Dodaj novi tim</strong><span>Dodaj tim na piramidu</span></button>
          <button class="admin-quick-card" onclick="showAdminTab('challenges')"><strong>⚔️ Rokovi i izazovi</strong><span>Istekli rokovi, zaštita, prihvaćanja</span></button>
          <button class="admin-quick-card" onclick="showAdminTab('history')"><strong>🎾 Povijest mečeva</strong><span>Uredi odigrane mečeve</span></button>
        </div>
      </div>`;
  }

  if(activeAdminTab === 'confirmations') {
    body = `<div class="admin-panel-card"><div class="admin-panel-head"><span>📝 Mečevi za potvrdu (${pendingResults.length})</span></div>${renderAdminPendingResults(pendingResults, false)}</div>`;
  }

  if(activeAdminTab === 'changes') {
    body = `<div class="admin-panel-card"><div class="admin-panel-head"><span>🔁 Promjene u poretku</span></div>${renderAdminChangeLog(rankingChanges, false)}<div class="admin-note">Napomena: promjene su izvedene iz postojećih izazova i trenutnog stanja kaznene zone. Za apsolutnu povijest svakog pomaka kasnije možemo dodati posebnu Supabase tablicu <strong>pyramid_events</strong>.</div></div>`;
  }

  if(activeAdminTab === 'challenges') {
    body = `
      <div class="admin-panel-card" style="border-color:${tournamentPause?.is_paused?'rgba(245,158,11,0.5)':'var(--border)'};">
        <div class="admin-panel-head"><span>⏸ Vrijeme turnira</span></div>
        <div class="admin-soft-box">
          ${tournamentPause?.is_paused
            ? `<strong style="color:var(--gold);">Turnir je zaustavljen</strong><br><span>Od: ${pauseStartedText} · Razlog: ${pauseReasonText}</span><br><button class="btn-accept" onclick="adminResumeTournament()">▶ Nastavi vrijeme turnira</button>`
            : `<span>Vrijeme turnira trenutno teče normalno.</span><br><button class="btn-decline" onclick="adminPauseTournament()">⏸ Zaustavi vrijeme turnira</button>`}
        </div>
      </div>

      <div class="admin-panel-card">
        <div class="admin-panel-head"><span>⏰ Istekli mečevi (${expiredMatches.length})</span></div>
        ${expiredMatches.length ? expiredMatches.map(c => {
          const { challenger, challenged } = adminChallengeTeams(c);
          const expiredDate = new Date(c.match_expires_at).toLocaleDateString('hr-HR');
          return '<div class="admin-action-row">'
            + '<div class="admin-row-icon red">⏰</div>'
            + '<div class="admin-row-main"><div class="admin-row-title">' + adminTeamName(challenger) + ' <span>vs</span> ' + adminTeamName(challenged) + '</div><div class="admin-row-meta">Rok istekao: ' + expiredDate + '</div></div>'
            + '<div class="admin-row-actions"><button class="btn-decline" onclick="adminSurrender(\'' + c.id + '\',\'' + c.challenger_id + '\')">Predaja: ' + adminTeamName(challenger) + '</button><button class="btn-decline" onclick="adminSurrender(\'' + c.id + '\',\'' + c.challenged_id + '\')">Predaja: ' + adminTeamName(challenged) + '</button><input type="number" id="extend-days-' + c.id + '" placeholder="dana" min="1" max="14" class="admin-small-input"/><button class="admin-small-btn" onclick="adminExtendDeadline(\'' + c.id + '\')">Produži</button></div>'
            + '</div>';
        }).join('') : '<div class="admin-empty-small">Nema isteklih mečeva ✓</div>'}
      </div>

      <div class="admin-panel-card">
        <div class="admin-panel-head"><span>⚔️ Izazovi na čekanju (${pendingChallenges.length})</span></div>
        ${pendingChallenges.length ? pendingChallenges.map(c => {
          const { challenger, challenged } = adminChallengeTeams(c);
          const expires = new Date(c.response_expires_at);
          const diff = expires - new Date();
          const hours = Math.max(0, Math.floor(diff/3600000));
          return '<div class="admin-action-row">'
            + '<div class="admin-row-icon">⚔️</div>'
            + '<div class="admin-row-main"><div class="admin-row-title">' + adminTeamName(challenger) + ' <span>vs</span> ' + adminTeamName(challenged) + '</div><div class="admin-row-meta">Rok: ' + hours + 'h · Odbijanja: ' + (c.rejection_count || 0) + '/1</div></div>'
            + '<div class="admin-row-actions"><button class="btn-accept" onclick="adminAcceptChallenge(\'' + c.id + '\')">✓ Prihvati</button><button class="btn-decline" onclick="adminDeclineChallenge(\'' + c.id + '\')">✕ Odbij</button></div>'
            + '</div>';
        }).join('') : '<div class="admin-empty-small">Nema izazova na čekanju</div>'}
      </div>

      <div class="admin-panel-card">
        <div class="admin-panel-head"><span>🛡 Timovi u zaštitnom roku (${cooldownList.length})</span></div>
        ${cooldownList.length ? cooldownList.map(({team, challengeId, hoursLeft}) =>
          '<div class="admin-action-row"><div class="admin-row-icon gold">🛡</div><div class="admin-row-main"><div class="admin-row-title">' + adminTeamName(team) + '</div><div class="admin-row-meta">Zaštita još ' + hoursLeft + 'h</div></div><div class="admin-row-actions"><button class="admin-small-btn" onclick="adminRemoveCooldown(\'' + challengeId + '\')">Ukloni zaštitu</button></div></div>'
        ).join('') : '<div class="admin-empty-small">Nema timova u zaštitnom roku ✓</div>'}
      </div>`;
  }

  if(activeAdminTab === 'teams') {
    body = `
      <div class="admin-two-col wide-left">
        <div class="admin-panel-card">
          <div class="admin-panel-head"><span>➕ Dodaj Tim</span></div>
          <div class="admin-form-grid">
            <div class="form-group"><label>Naziv tima *</label><input type="text" id="new-team-name" placeholder="npr. Tim Goleš"/></div>
            <div class="form-group"><label>Stepenica <span style="color:var(--text3);font-weight:400">(prazno = automatski)</span></label><input type="number" id="new-team-step" placeholder="auto" min="1"/></div>
          </div>
          <div class="form-group"><label>Kapetan *</label><div class="ps-wrap"><input type="text" class="ps-input" id="search-captain" placeholder="Pretraži igrača..." oninput="psFilter('captain')" onfocus="psOpen('captain')" autocomplete="off"/><div class="ps-dropdown" id="drop-captain"></div></div><div class="ps-badge" id="badge-captain"><span id="badge-captain-name"></span><button class="ps-clear" onclick="psClear('captain')">×</button></div><input type="hidden" id="new-team-captain"/></div>
          <div class="admin-form-grid">
            <div class="form-group"><label>Član 2 <span style="color:var(--text3);font-weight:400">(opcionalno)</span></label><div class="ps-wrap"><input type="text" class="ps-input" id="search-member2" placeholder="Pretraži igrača..." oninput="psFilter('member2')" onfocus="psOpen('member2')" autocomplete="off"/><div class="ps-dropdown" id="drop-member2"></div></div><div class="ps-badge" id="badge-member2"><span id="badge-member2-name"></span><button class="ps-clear" onclick="psClear('member2')">×</button></div><input type="hidden" id="new-team-member2"/></div>
            <div class="form-group"><label>Član 3 <span style="color:var(--text3);font-weight:400">(opcionalno)</span></label><div class="ps-wrap"><input type="text" class="ps-input" id="search-member3" placeholder="Pretraži igrača..." oninput="psFilter('member3')" onfocus="psOpen('member3')" autocomplete="off"/><div class="ps-dropdown" id="drop-member3"></div></div><div class="ps-badge" id="badge-member3"><span id="badge-member3-name"></span><button class="ps-clear" onclick="psClear('member3')">×</button></div><input type="hidden" id="new-team-member3"/></div>
          </div>
          <button class="btn-primary" id="add-team-btn" onclick="addTeam()">+ Dodaj Tim</button>
        </div>
        <div class="admin-panel-card">
          <div class="admin-panel-head"><span>Sažetak</span></div>
          ${adminMetricCard('Ukupno timova', allTeams.length, `${allTeams.length - teamsInPenalty} u piramidi · ${teamsInPenalty} u kazni`, 'blue')}
        </div>
      </div>
      <div class="admin-panel-card">
        <div class="admin-panel-head"><span>👥 Upravljanje Timovima (${allTeams.length})</span></div>
        <div class="admin-team-list">
          ${allTeams.map(t => {
            const captain = allPlayers.find(p=>p.email===t.captain_email);
            return `<div class="admin-team-row">
              <div><div class="admin-row-title">${adminTeamName(t)}</div><div class="admin-row-meta">Stepenica ${t.step}${t.penalty ? ' · Kazna' : ''} · 👑 ${captain?.name||t.captain_email}</div></div>
              <div class="admin-row-actions"><button class="admin-small-btn" onclick="openEditTeam('${t.id}')">✏️ Edit</button><button class="admin-small-btn" onclick="openAddMember('${t.id}')">+ Član</button>${t.step > 2 && !t.penalty ? `<button class="admin-danger-small" onclick="adminSimulatePenalty('${t.id}')">⚠️ Kazna</button>` : ''}${t.penalty ? `<button class="admin-success-small" onclick="adminRemovePenalty('${t.id}')">↩ Izvadi</button>` : ''}<button class="admin-trash" onclick="deleteTeam('${t.id}','${adminTeamName(t).replace(/'/g, "\\'")}')">🗑</button></div>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="admin-panel-card">
        <div class="admin-panel-head"><span>🔄 Vraćanje odluke</span></div>
        <div class="form-group"><label>Izazov</label><select id="revert-challenge-select"><option value="">— odaberi —</option>${allChallenges.filter(c=>['declined','accepted'].includes(c.status)).map(c=>{ const { challenger, challenged } = adminChallengeTeams(c); return `<option value="${c.id}">${adminTeamName(challenger)} vs ${adminTeamName(challenged)} (${c.status})</option>`; }).join('')}</select></div>
        <button class="btn-primary" onclick="revertDecision()" style="background:var(--bg3);border:1px solid var(--border2);color:var(--text2);">↩ Vrati na čekanje</button>
      </div>`;
  }

  if(activeAdminTab === 'history') {
    body = `<div class="admin-panel-card"><div class="admin-panel-head"><span>🎾 Svi odigrani mečevi (${completedChallenges.length})</span></div>${completedChallenges.length ? completedChallenges.map(c => { const { challenger, challenged, winner } = adminChallengeTeams(c); const isSurrender = c.status === 'surrendered'; return '<div class="admin-action-row"><div class="admin-row-icon">🎾</div><div class="admin-row-main"><div class="admin-row-title">' + adminTeamName(challenger) + ' <span>vs</span> ' + adminTeamName(challenged) + '</div><div class="admin-row-meta">🏆 ' + adminTeamName(winner) + ' · ' + (c.result_score||'—') + (isSurrender?' · predaja':'') + ' · ' + new Date(c.created_at).toLocaleDateString('hr-HR') + '</div></div><div class="admin-row-actions"><button class="admin-small-btn" onclick="openEditChallenge(\'' + c.id + '\')">✏️ Uredi</button></div></div>'; }).join('') : '<div class="admin-empty-small">Nema odigranih mečeva.</div>'}</div>`;
  }

  document.getElementById('admin-container').innerHTML = `
    <div class="admin-modern">
      <div class="admin-topline">
        <div>
          <div class="admin-title">Admin pregled</div>
          <div class="admin-subtitle">Brze odluke, promjene poretka i najvažnije akcije bez beskonačnog skrolanja.</div>
        </div>
        <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;justify-content:flex-end;">
          <button class="admin-small-btn" id="admin-refresh-btn" onclick="adminRefreshMatches()">Osvježi</button>
          <div class="admin-status-pill ${tournamentPause?.is_paused?'paused':'active'}">${tournamentPause?.is_paused?'⏸ PAUZA':'● AKTIVAN'}</div>
        </div>
      </div>
      <div class="admin-tabs">${tabButtons}</div>
      ${body}
    </div>`;
}

let editChallengeId = null;

function openEditChallenge(id) {
  editChallengeId = id;
  const c = allChallenges.find(x=>x.id===id);
  if(!c) return;

  const t1 = allTeams.find(t=>t.id===c.challenger_id);
  const t2 = allTeams.find(t=>t.id===c.challenged_id);
  const challengerLabel = adminTeamName(t1);
  const challengedLabel = adminTeamName(t2);

  document.getElementById('edit-ch-summary').innerHTML =
    '<strong>' + escapeHtml(challengerLabel) + '</strong> vs <strong>' + escapeHtml(challengedLabel) + '</strong><br>' +
    'Trenutni status: <strong>' + escapeHtml(statusLabelHr(c.status)) + '</strong><br>' +
    'Poslano: ' + escapeHtml(formatChallengeDateTime(c.created_at));

  document.getElementById('edit-ch-winner').innerHTML =
    '<option value="">— bez pobjednika —</option>'
    + '<option value="'+c.challenger_id+'">'+escapeHtml(challengerLabel)+'</option>'
    + '<option value="'+c.challenged_id+'">'+escapeHtml(challengedLabel)+'</option>';
  document.getElementById('edit-ch-winner').value = c.result_winner_id || '';
  document.getElementById('edit-ch-score').value = c.result_score || '';
  document.getElementById('edit-ch-status').value = c.status || 'pending';
  document.getElementById('edit-ch-scheduled-at').value = toDatetimeLocalInput(c.scheduled_at);
  document.getElementById('edit-ch-response-expires').value = toDatetimeLocalInput(c.response_expires_at);
  document.getElementById('edit-ch-match-expires').value = toDatetimeLocalInput(c.match_expires_at);
  openModal('modal-edit-challenge');
}

async function saveEditChallenge() {
  const c = allChallenges.find(x=>x.id===editChallengeId);
  if(!c) return;

  const winnerId = document.getElementById('edit-ch-winner').value || null;
  const score = document.getElementById('edit-ch-score').value.trim() || null;
  const status = document.getElementById('edit-ch-status').value;
  const scheduledAt = datetimeLocalToIso(document.getElementById('edit-ch-scheduled-at').value);
  const responseExpiresAt = datetimeLocalToIso(document.getElementById('edit-ch-response-expires').value);
  const matchExpiresAt = datetimeLocalToIso(document.getElementById('edit-ch-match-expires').value);

  const btn = document.getElementById('save-edit-challenge-btn');
  btn.disabled=true; btn.textContent='Spremam...';

  const update = {
    status,
    result_winner_id: winnerId,
    result_score: score,
    scheduled_at: scheduledAt,
    response_expires_at: responseExpiresAt,
    match_expires_at: matchExpiresAt,
    updated_at: new Date().toISOString()
  };

  if(status === 'accepted' && !update.match_expires_at) {
    update.match_expires_at = new Date(Date.now() + 6*24*60*60*1000).toISOString();
  }
  if(status === 'pending' && !update.response_expires_at) {
    update.response_expires_at = new Date(Date.now() + 3*24*60*60*1000).toISOString();
  }
  if(['pending','accepted','declined','cancelled'].includes(status) && !score) {
    update.result_score = null;
    if(!['completed','pending_result','surrendered'].includes(status)) update.result_winner_id = null;
  }

  try {
    console.log('[SAVE CHALLENGE] SAVE_START', { challengeId: editChallengeId });
    await supabaseRestRequest('/rest/v1/challenges?id=eq.' + encodeURIComponent(editChallengeId), {
      method: 'PATCH',
      body: JSON.stringify(update)
    });
    console.log('[SAVE CHALLENGE] SAVE_SUCCESS', { challengeId: editChallengeId });
    Object.assign(c, update);
    showToast('Izazov ažuriran! ✓', 'success');
    closeModal('modal-edit-challenge');
    await renderChallenges();
    if(document.getElementById('sec-admin')?.classList.contains('active')) renderAdmin();
  } catch(err) {
    console.error('[SAVE CHALLENGE] SAVE_ERROR', err);
    showToast('Spremanje nije uspjelo. Provjeri internet i pokušaj ponovno.', 'error');
  } finally {
    console.log('[SAVE CHALLENGE] SAVE_FINALLY', { challengeId: editChallengeId });
    btn.disabled=false; btn.textContent='💾 Spremi promjene';
  }
}

async function deleteChallengeAdmin() {
  const c = allChallenges.find(x=>x.id===editChallengeId);
  if(!c) return;
  const { challenger, challenged } = adminChallengeTeams(c);
  if(!confirm('Obrisati izazov/meč: ' + adminTeamName(challenger) + ' vs ' + adminTeamName(challenged) + '?\n\nOvo briše zapis iz tablice challenges. Ako je taj meč već promijenio poredak, poredak se neće automatski vratiti.')) return;

  const { error } = await sb.from('challenges').delete().eq('id', editChallengeId);
  if(error) { showToast('Greška: '+error.message,'error'); return; }

  showToast('Izazov obrisan. 🗑', 'success');
  closeModal('modal-edit-challenge');
  await safeLoadAll('manual');
  await renderChallenges();
  if(document.getElementById('sec-admin')?.classList.contains('active')) renderAdmin();
}

async function adminAcceptChallenge(challengeId) {
  const matchExpires = new Date(Date.now() + 6*24*60*60*1000).toISOString();
  const {error} = await sb.from('challenges').update({
    status: 'accepted',
    match_expires_at: matchExpires
  }).eq('id', challengeId);
  if(error) { showToast('Greška: '+error.message,'error'); return; }
  showToast('Izazov prihvaćen! Tim ima 6 dana za meč.','success');
  await safeLoadAll('manual'); renderAdmin();
}

async function adminDeclineChallenge(challengeId) {
  const c = allChallenges.find(x=>x.id===challengeId);
  if(!c) return;

  // Nađi zadnji completed izazov između ova dva tima (zamjena mjesta)
  const lastCompleted = allChallenges
    .filter(x =>
      x.challenger_id === c.challenger_id &&
      x.challenged_id === c.challenged_id &&
      x.status === 'completed'
    )
    .sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0];

  // Broji odbijanja samo NAKON zadnje zamjene mjesta
  const afterDate = lastCompleted ? new Date(lastCompleted.created_at) : new Date(0);
  const prevRejections = allChallenges.filter(x =>
    x.challenger_id === c.challenger_id &&
    x.challenged_id === c.challenged_id &&
    x.status === 'declined' &&
    x.id !== c.id &&
    new Date(x.created_at) > afterDate
  ).length;

  const totalRejections = prevRejections + 1;

  if(totalRejections >= 2) {
    if(!confirm('Ovo je drugo odbijanje od zadnje zamjene — timovi će zamijeniti mjesta. Nastavi?')) return;
    await swapTeams(c.challenger_id, c.challenged_id);
    await sb.from('challenges').update({ status:'completed', result_winner_id:c.challenger_id, rejection_count:totalRejections }).eq('id',challengeId);
    showToast('Izazivač pobijedio zbog dvostrukog odbijanja! Timovi su zamijenili mjesta! 🔄','success');
  } else {
    await sb.from('challenges').update({ status:'declined', rejection_count:totalRejections }).eq('id',challengeId);
    showToast('Izazov odbijen (1/2). Izazivač može poslati još jedan izazov.','');
  }
  await safeLoadAll('manual'); renderAdmin();
}

async function adminSurrender(challengeId, surrenderId) {
  const c = allChallenges.find(x=>x.id===challengeId);
  const surrenderTeam = allTeams.find(t=>t.id===surrenderId);
  if(!confirm('Evidentirati predaju tima "'+surrenderTeam?.name+'"? Timovi će zamijeniti mjesta. Meč se NE upisuje u ljestvicu.')) return;

  // Tim koji je predao ide na nižu stepenicu — zamjena mjesta
  const winnerId = surrenderId === c.challenger_id ? c.challenged_id : c.challenger_id;
  await swapTeams(winnerId, surrenderId); // winner dobiva višu poziciju

  await sb.from('challenges').update({
    status: 'surrendered',
    result_winner_id: winnerId,
    updated_at: new Date().toISOString()
  }).eq('id', challengeId);
  showToast('Predaja evidentirana. Timovi su zamijenili mjesta. 🔄','success');
  await safeLoadAll('manual'); renderAdmin();
}

async function adminExtendDeadline(challengeId) {
  const days = parseInt(document.getElementById('extend-days-'+challengeId)?.value);
  if(!days || days < 1 || days > 14) { showToast('Unesi broj dana (1-14)!','error'); return; }
  const c = allChallenges.find(x=>x.id===challengeId);
  const newExpiry = new Date(Math.max(new Date(), new Date(c.match_expires_at)) + days*24*60*60*1000).toISOString();
  const { error } = await sb.from('challenges').update({
    match_expires_at: newExpiry,
    updated_at: new Date().toISOString()
  }).eq('id', challengeId);
  if(error) { showToast('Greška: '+error.message,'error'); return; }
  showToast('Rok produžen za '+days+' dana! 📅','success');
  await safeLoadAll('manual'); renderAdmin();
}

async function adminConfirmResult(challengeId) {
  const c = allChallenges.find(x=>x.id===challengeId);
  if(!c) return;

  const challenger = allTeams.find(t=>t.id===c.challenger_id);
  const challenged = allTeams.find(t=>t.id===c.challenged_id);

  if(c.result_winner_id === c.challenger_id) {
    // Izazivač pobijedio
    if(challenger?.penalty) {
      // Iz kaznene zone — vrati u piramidu
      await returnFromPenalty(challengeId, c.challenger_id);
    } else {
      await swapTeams(c.challenger_id, c.challenged_id);
    }
  } else {
    // Izazvani pobijedio — sve ostaje, samo ažuriraj last_match_at
    if(challenger?.penalty) {
      // Kažnjeni ostaje u kazni, poraženi ostaje gdje jest
      await sb.from('teams').update({ last_match_at: new Date().toISOString() }).eq('id', c.challenger_id);
    }
  }

  // Ažuriraj last_match_at za oba tima
  await sb.from('teams').update({ last_match_at: new Date().toISOString() }).eq('id', c.challenger_id);
  await sb.from('teams').update({ last_match_at: new Date().toISOString() }).eq('id', c.challenged_id);

  const completedAt = new Date().toISOString();
  const { error } = await sb.from('challenges').update({ status:'completed', updated_at:completedAt }).eq('id',challengeId);
  if(error) { showToast('Greška: '+error.message,'error'); return; }

  const completedChallenge = { ...c, status: 'completed', updated_at: completedAt };
  const matchInsertResult = await insertPyramidMatchIfMissing(completedChallenge, currentUser?.email || currentPlayer?.email || null);
  if(matchInsertResult.status === 'error') {
    showToast('Rezultat potvrđen, ali upis u matches nije napravljen. Provjeri konzolu/Supabase.', 'error');
    await safeLoadAll('manual'); renderAdmin();
    return;
  }

  showToast('Rezultat potvrđen! ✓','success');
  await safeLoadAll('manual'); renderAdmin();
}

async function adminRejectResult(challengeId) {
  await sb.from('challenges').update({ status:'accepted', result_winner_id:null, result_score:null }).eq('id',challengeId);
  showToast('Rezultat odbijen, meč ostaje aktivan.','');
  await safeLoadAll('manual'); renderAdmin();
}

async function revertDecision() {
  const id = document.getElementById('revert-challenge-select').value;
  if(!id) { showToast('Odaberi izazov!','error'); return; }
  await sb.from('challenges').update({ status:'pending', rejection_count:0 }).eq('id',id);
  showToast('Izazov vraćen na čekanje. ↩','success');
  await safeLoadAll('manual'); renderAdmin();
}

// ---- ADD TEAM ----
// ---- PLAYER SEARCH HELPERS ----
const PS_FIELDS = ['captain','member2','member3'];

function psOpen(field) {
  psFilter(field);
  document.getElementById('drop-'+field).classList.add('open');
}

function psFilter(field) {
  const query = document.getElementById('search-'+field)?.value.toLowerCase() || '';
  const selectedEmails = PS_FIELDS
    .filter(f=>f!==field)
    .map(f=>document.getElementById('new-team-'+f)?.value)
    .filter(Boolean);

  const filtered = allPlayers.filter(p =>
    p.name.toLowerCase().includes(query) && !selectedEmails.includes(p.email)
  );

  const drop = document.getElementById('drop-'+field);
  drop.innerHTML = filtered.length
    ? filtered.map(p=>`<div class="ps-option" onclick="psSelect('${field}','${p.email}','${p.name.replace(/'/g,"\'")}')"> ${p.name}</div>`).join('')
    : '<div style="padding:0.6rem 0.9rem;color:var(--text3);font-size:0.82rem;">Nema rezultata</div>';
  drop.classList.add('open');
}

function psSelect(field, email, name) {
  document.getElementById('new-team-'+field).value = email;
  document.getElementById('search-'+field).value = '';
  document.getElementById('search-'+field).style.display = 'none';
  document.getElementById('drop-'+field).classList.remove('open');
  document.getElementById('badge-'+field+'-name').textContent = name;
  document.getElementById('badge-'+field).classList.add('show');
}

function psClear(field) {
  document.getElementById('new-team-'+field).value = '';
  document.getElementById('search-'+field).value = '';
  document.getElementById('search-'+field).style.display = 'block';
  document.getElementById('badge-'+field).classList.remove('show');
  document.getElementById('drop-'+field).classList.remove('open');
}

function psResetAll() {
  PS_FIELDS.forEach(f => psClear(f));
}

// Modal member search
function psOpenModal() {
  psFilterModal();
  document.getElementById('drop-add-member').classList.add('open');
}

function psFilterModal() {
  const query = document.getElementById('search-add-member')?.value.toLowerCase() || '';
  const filtered = allPlayers.filter(p => p.name.toLowerCase().includes(query));
  const drop = document.getElementById('drop-add-member');
  if(!drop) return;
  drop.innerHTML = filtered.length
    ? filtered.map(p=>`<div class="ps-option" onclick="psSelectModal('${p.email}','${p.name.replace(/'/g,"\'")}')"> ${p.name}</div>`).join('')
    : '<div style="padding:0.6rem 0.9rem;color:var(--text3);font-size:0.82rem;">Nema rezultata</div>';
  drop.classList.add('open');
}

function psSelectModal(email, name) {
  document.getElementById('add-member-player').value = email;
  document.getElementById('search-add-member').value = '';
  document.getElementById('search-add-member').style.display = 'none';
  document.getElementById('drop-add-member').classList.remove('open');
  document.getElementById('badge-add-member-name').textContent = name;
  document.getElementById('badge-add-member').classList.add('show');
}

function psClearModal() {
  document.getElementById('add-member-player').value = '';
  document.getElementById('search-add-member').value = '';
  document.getElementById('search-add-member').style.display = 'block';
  document.getElementById('badge-add-member').classList.remove('show');
}

document.addEventListener('click', e => {
  if(!e.target.closest('.ps-wrap')) {
    document.querySelectorAll('.ps-dropdown').forEach(d=>d.classList.remove('open'));
  }
});

function updateMemberOptions() {
  // Ažuriraj member selectove da ne mogu odabrati isti email kao kapetan
  const captain = document.getElementById('new-team-captain').value;
  ['new-team-member2','new-team-member3'].forEach(id => {
    const sel = document.getElementById(id);
    if(!sel) return;
    Array.from(sel.options).forEach(opt => {
      opt.disabled = opt.value && opt.value === captain;
    });
  });
}

async function addTeam() {
  const name = document.getElementById('new-team-name').value.trim();
  const captain = document.getElementById('new-team-captain').value;
  const member2 = document.getElementById('new-team-member2').value;
  const member3 = document.getElementById('new-team-member3').value;
  // captain je sada hidden input
  const stepInput = document.getElementById('new-team-step').value;

  if(!name||!captain) { showToast('Unesi naziv i kapetana!','error'); return; }

  // Provjeri duplikate
  const members = [captain, member2, member3].filter(Boolean);
  if(new Set(members).size !== members.length) { showToast('Isti igrač ne može biti dva puta u timu!','error'); return; }

  // Provjeri jesu li igrači već u nekom timu
  for(const email of members) {
    const { data: existing } = await sb.from('team_members').select('team_id').eq('player_email',email).single();
    if(existing) {
      const player = allPlayers.find(p=>p.email===email);
      showToast((player?.name||email)+' je već u drugom timu!','error');
      return;
    }
  }

  // Automatski odabir stepenice
  const maxStep = allTeams.length ? Math.max(...allTeams.map(t=>t.step)) : 0;
  const step = stepInput ? parseInt(stepInput) : maxStep + 1;
  const posInStep = allTeams.filter(t=>t.step===step).length + 1;

  const btn = document.getElementById('add-team-btn');
  btn.disabled=true; btn.textContent='Dodajem...';

  const { data: team, error } = await sb.from('teams').insert({
    name, nickname: name, captain_email: captain, step, position: posInStep
  }).select().single();

  if(error) { btn.disabled=false; btn.textContent='+ Dodaj Tim'; showToast('Greška: '+error.message,'error'); return; }

  // Dodaj sve članove
  const memberInserts = members.map(email => ({ team_id: team.id, player_email: email }));
  await sb.from('team_members').insert(memberInserts);

  btn.disabled=false; btn.textContent='+ Dodaj Tim';
  // Reset forme
  document.getElementById('new-team-name').value = '';
  document.getElementById('new-team-step').value = '';
  psResetAll();
  showToast(name+' dodan! ✓','success');
  await safeLoadAll('manual'); renderAdmin();
}

// ---- EDIT TEAM ----
let editTeamId = null;

async function openEditTeam(teamId) {
  editTeamId = teamId;
  const team = allTeams.find(t=>t.id===teamId);
  if(!team) return;

  const members = allMembers.filter(m => m.team_id === teamId);
  const membersSorted = getSortedTeamMembers(teamId, team.captain_email, members || []);
  const memberEmails = membersSorted.map(m=>m.player_email);

  // Buildaj prikaz članova s opcijom uklanjanja
  const membersHTML = memberEmails.map(email => {
    const player = allPlayers.find(p=>p.email===email);
    const isCaptain = email === team.captain_email;
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:0.5rem 0.75rem;background:var(--bg3);border-radius:8px;margin-bottom:0.4rem;">
      <span style="font-size:0.88rem;font-weight:${isCaptain?'600':'400'};color:${isCaptain?'var(--orange)':'var(--text2)'};">
        ${player?.name||email} ${isCaptain?'👑':''}
      </span>
      ${!isCaptain?`<button onclick="removeMember('${teamId}','${email}')" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:0.9rem;" onmouseover="this.style.color='var(--red)'" onmouseout="this.style.color='var(--text3)'">✕</button>`:''}
    </div>`;
  }).join('');

  document.getElementById('team-modal-content').innerHTML = `
    <div class="modal-title">Uredi Tim</div>
    <div class="form-group">
      <label>Naziv tima *</label>
      <input type="text" id="edit-team-name" value="${team.name}"/>
    </div>
    <div class="form-group">
      <label>Stepenica</label>
      <input type="number" id="edit-team-step" value="${team.step}" min="1"/>
      <input type="hidden" id="edit-team-position" value="${team.position}"/>
    </div>
    <div class="form-group">
      <label>Novi kapetan</label>
      <div class="ps-wrap">
        <input type="text" class="ps-input" id="search-edit-captain" placeholder="Pretraži novog kapetana..." oninput="psFilterEdit()" onfocus="psOpenEdit()" autocomplete="off"/>
        <div class="ps-dropdown" id="drop-edit-captain"></div>
      </div>
      <div class="ps-badge" id="badge-edit-captain">
        <span id="badge-edit-captain-name"></span>
        <button class="ps-clear" onclick="psClearEdit()">×</button>
      </div>
      <input type="hidden" id="edit-team-captain"/>
      <div style="font-size:0.72rem;color:var(--text3);margin-top:0.3rem;">Trenutni kapetan: <strong style="color:var(--orange);">${allPlayers.find(p=>p.email===team.captain_email)?.name||team.captain_email}</strong></div>
    </div>

    <div style="font-size:0.72rem;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin:1rem 0 0.5rem;">Trenutni članovi</div>
    ${membersHTML}
    ${memberEmails.length < 3 ? `
    <div style="margin-top:0.75rem;">
      <div style="font-size:0.72rem;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:0.5rem;">Dodaj novog člana</div>
      <div class="ps-wrap">
        <input type="text" class="ps-input" id="search-add-member" placeholder="Pretraži igrača..." oninput="psFilterModal()" onfocus="psOpenModal()" autocomplete="off"/>
        <div class="ps-dropdown" id="drop-add-member"></div>
      </div>
      <div class="ps-badge" id="badge-add-member">
        <span id="badge-add-member-name"></span>
        <button class="ps-clear" onclick="psClearModal()">×</button>
      </div>
      <input type="hidden" id="add-member-player"/>
      <button class="btn-primary" onclick="addMemberFromEdit('${teamId}')" style="margin-top:0.5rem;background:var(--bg3);border:1px solid var(--border2);color:var(--text2);">+ Dodaj člana</button>
    </div>` : '<div style="font-size:0.78rem;color:var(--text3);margin-top:0.5rem;">Tim ima maksimalno 3 člana.</div>'}

    <button class="btn-primary" onclick="saveEditTeam()" style="margin-top:1.25rem;">💾 Spremi promjene</button>`;

  openModal('modal-team');
}

function psOpenEdit() {
  psFilterEdit();
  document.getElementById('drop-edit-captain').classList.add('open');
}

function psFilterEdit() {
  const q = document.getElementById('search-edit-captain')?.value.toLowerCase()||'';
  const filtered = allPlayers.filter(p=>p.name.toLowerCase().includes(q));
  const drop = document.getElementById('drop-edit-captain');
  if(!drop) return;
  drop.innerHTML = filtered.length
    ? filtered.map(p=>`<div class="ps-option" onclick="psSelectEdit('${p.email}','${p.name.replace(/'/g,"\'")}')"> ${p.name}</div>`).join('')
    : '<div style="padding:0.6rem 0.9rem;color:var(--text3);font-size:0.82rem;">Nema rezultata</div>';
  drop.classList.add('open');
}

function psSelectEdit(email, name) {
  document.getElementById('edit-team-captain').value = email;
  document.getElementById('search-edit-captain').value = '';
  document.getElementById('search-edit-captain').style.display = 'none';
  document.getElementById('drop-edit-captain').classList.remove('open');
  document.getElementById('badge-edit-captain-name').textContent = name;
  document.getElementById('badge-edit-captain').classList.add('show');
}

function psClearEdit() {
  document.getElementById('edit-team-captain').value = '';
  document.getElementById('search-edit-captain').value = '';
  document.getElementById('search-edit-captain').style.display = 'block';
  document.getElementById('badge-edit-captain').classList.remove('show');
}

async function saveEditTeam() {
  const name = document.getElementById('edit-team-name').value.trim();
  const step = parseInt(document.getElementById('edit-team-step').value);
  const position = parseInt(document.getElementById('edit-team-position').value);
  const newCaptain = document.getElementById('edit-team-captain').value;
  const btn = Array.from(document.querySelectorAll('#modal-team button')).find(b => (b.getAttribute('onclick') || '').includes('saveEditTeam'));

  if(!Number.isFinite(step) || step < 1 || !Number.isFinite(position)) {
    showToast('Provjeri stepenicu i poziciju.','error');
    return;
  }

  const updates = { name, nickname: name, step, position };
  if(newCaptain) updates.captain_email = newCaptain;

  if(btn) { btn.disabled = true; btn.textContent = 'Spremam...'; }

  try {
    console.log('[SAVE TEAM] SAVE_START', { teamId: editTeamId });
    await supabaseRestRequest('/rest/v1/teams?id=eq.' + encodeURIComponent(editTeamId), {
      method: 'PATCH',
      body: JSON.stringify(updates)
    });
    console.log('[SAVE TEAM] SAVE_SUCCESS', { teamId: editTeamId });
    const team = allTeams.find(t => t.id === editTeamId);
    if(team) Object.assign(team, updates);
    buildDerivedCaches();
    showToast('Tim ažuriran! ✓','success');
    closeModal('modal-team');
    renderPyramid();
    renderAdmin();
  } catch(err) {
    console.error('[SAVE TEAM] SAVE_ERROR', err);
    showToast('Spremanje nije uspjelo. Provjeri internet i pokušaj ponovno.', 'error');
  } finally {
    console.log('[SAVE TEAM] SAVE_FINALLY', { teamId: editTeamId });
    if(btn) { btn.disabled = false; btn.textContent = '💾 Spremi promjene'; }
  }
}

async function removeMember(teamId, email) {
  const team = allTeams.find(t=>t.id===teamId);
  if(email === team?.captain_email) { showToast('Ne možeš ukloniti kapetana!','error'); return; }
  if(!confirm('Ukloniti igrača iz tima?')) return;
  const { error } = await sb.from('team_members').delete().eq('team_id',teamId).eq('player_email',email);
  if(error) { showToast('Greška','error'); return; }
  showToast('Član uklonjen.','');
  await safeLoadAll('manual');
  openEditTeam(teamId); // Osvježi modal
}

// ---- ADD MEMBER ----
let addMemberTeamId = null;
function openAddMember(teamId) {
  addMemberTeamId = teamId;
  const team = allTeams.find(t=>t.id===teamId);
  const content = `
    <div class="modal-title">Dodaj Člana — ${team?.name}</div>
    <div class="form-group">
      <label>Igrač</label>
      <div class="ps-wrap">
        <input type="text" class="ps-input" id="search-add-member" placeholder="Pretraži igrača..." oninput="psFilterModal()" onfocus="psOpenModal()" autocomplete="off"/>
        <div class="ps-dropdown" id="drop-add-member"></div>
      </div>
      <div class="ps-badge" id="badge-add-member"><span id="badge-add-member-name"></span><button class="ps-clear" onclick="psClearModal()">×</button></div>
      <input type="hidden" id="add-member-player"/>
    </div>
    <button class="btn-primary" onclick="addMember()">+ Dodaj</button>`;
  document.getElementById('team-modal-content').innerHTML = content;
  openModal('modal-team');
}

async function addMemberFromEdit(teamId) {
  addMemberTeamId = teamId;
  await addMember(true);
}

async function addMember(fromEdit=false) {
  const email = document.getElementById('add-member-player').value;
  if(!email) { showToast('Odaberi igrača!','error'); return; }
  if(!addMemberTeamId) { showToast('Greška: tim nije odabran!','error'); return; }

  // Provjeri je li već u nekom timu (ignoriraj NULL team_id)
  const { data: allTM } = await sb.from('team_members').select('team_id').eq('player_email', email);
  const realMemberships = (allTM||[]).filter(x => x.team_id !== null);
  if(realMemberships.length > 0) { showToast('Igrač je već u timu!','error'); return; }

  // Provjeri max 3 člana
  const { data: members } = await sb.from('team_members').select('*').eq('team_id', addMemberTeamId);
  if(members && members.length >= 3) { showToast('Tim već ima maksimalno 3 člana!','error'); return; }

  // Obriši eventualne NULL zapise za ovog igrača
  await sb.from('team_members').delete().eq('player_email', email).is('team_id', null);

  const { error } = await sb.from('team_members').insert({ team_id: addMemberTeamId, player_email: email });
  if(error) { showToast('Greška: '+error.message,'error'); return; }
  showToast('Član dodan! ✓','success');
  await safeLoadAll('manual');
  if(fromEdit) {
    openEditTeam(addMemberTeamId);
  } else {
    closeModal('modal-team');
    renderAdmin();
  }
}

async function deleteTeam(id, name) {
  if(!confirm('Obrisati tim "'+name+'"?')) return;
  await sb.from('team_members').delete().eq('team_id',id);
  await sb.from('teams').delete().eq('id',id);
  showToast(name+' obrisan.','');
  await safeLoadAll('manual'); renderAdmin();
}
