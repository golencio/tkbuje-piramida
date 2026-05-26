// TK Buje Piramida — statistika i ljestvica

// ---- STATISTIKA ----
let activeStatsMode = 'points';

function teamDisplayName(team) {
  // Statistika namjerno NE koristi ime/nadimak tima.
  // Imena timova ostaju samo na karticama u piramidi, a statistika uvijek prikazuje igrače.
  if(!team) return 'Nepoznati igrači';
  const members = getSortedTeamMembers(team.id, team.captain_email);
  const names = members.map(m => {
    const p = allPlayers.find(x => x.email === m.player_email);
    return p?.name || m.player_email;
  });
  return names.length ? names.join(' / ') : 'Igrači bez imena';
}

function buildTeamStats() {
  const stats = {};

  allTeams.forEach(team => {
    stats[team.id] = {
      team,
      name: teamDisplayName(team),
      points: 0,
      matches: 0,
      wins: 0,
      losses: 0,
      challengesSent: 0,
      successfulChallenges: 0,
      defenses: 0,
      successfulDefenses: 0,
      surrenders: 0,
      declined: 0,
      form: []
    };
  });

  const relevant = allChallenges
    .filter(c => ['completed','surrendered'].includes(c.status) && c.result_winner_id)
    .sort((a,b) => new Date(a.updated_at || a.created_at) - new Date(b.updated_at || b.created_at));

  relevant.forEach(c => {
    const challengerId = c.challenger_id;
    const challengedId = c.challenged_id;
    const winnerId = c.result_winner_id;
    const loserId = winnerId === challengerId ? challengedId : challengerId;
    const isSurrender = c.status === 'surrendered';

    if(stats[challengerId]) {
      stats[challengerId].challengesSent += 1;
      stats[challengerId].matches += 1;
      stats[challengerId].form.push(winnerId === challengerId ? 'W' : 'L');
    }
    if(stats[challengedId]) {
      stats[challengedId].defenses += 1;
      stats[challengedId].matches += 1;
      stats[challengedId].form.push(winnerId === challengedId ? 'W' : 'L');
    }

    if(stats[winnerId]) stats[winnerId].wins += 1;
    if(stats[loserId]) stats[loserId].losses += 1;

    if(isSurrender) {
      if(stats[loserId]) stats[loserId].surrenders += 1;
      return;
    }

    if(stats[winnerId]) stats[winnerId].points += 3;
    if(stats[loserId]) stats[loserId].points += 1;

    if(winnerId === challengerId && stats[challengerId]) {
      stats[challengerId].successfulChallenges += 1;
      stats[challengerId].points += 2;
    }
    if(winnerId === challengedId && stats[challengedId]) {
      stats[challengedId].successfulDefenses += 1;
      stats[challengedId].points += 1;
    }
  });

  allChallenges.filter(c => c.status === 'declined').forEach(c => {
    if(stats[c.challenged_id]) stats[c.challenged_id].declined += 1;
  });

  // Lagana kazna u statistici za predaje i odbijanja, ali samo kao testni bodovni model.
  Object.values(stats).forEach(s => {
    s.points -= (s.surrenders * 2);
    s.points -= (s.declined * 1);
    s.winRate = s.matches ? Math.round((s.wins / s.matches) * 100) : 0;
    s.form = s.form.slice(-5);
  });

  return Object.values(stats);
}

function setStatsMode(mode) {
  activeStatsMode = mode;
  renderStatistics();
}

function renderForm(form) {
  if(!form || !form.length) return '<span class="form-empty">—</span>';
  return form.map(x => '<span class="form-pill ' + (x === 'W' ? 'form-win' : 'form-loss') + '">' + x + '</span>').join('');
}

function renderStatsRows(rows, mainMetric) {
  if(!rows.length) return '<div class="empty">Još nema statistike.</div>';
  return `
    <table class="stats-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Par</th>
          <th>Bodovi</th>
          <th>Mečevi</th>
          <th>P / I</th>
          <th>Izazovi</th>
          <th>Obrane</th>
          <th>Forma</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((s, i) => `
          <tr>
            <td style="color:var(--text3);font-weight:800;">${i + 1}</td>
            <td><div class="stats-team">${s.name}</div><div style="font-size:0.7rem;color:var(--text3);">Stepenica ${s.team.penalty ? 'kazna' : s.team.step}</div></td>
            <td><span class="stats-points">${s.points}</span></td>
            <td>${s.matches}</td>
            <td>${s.wins} / ${s.losses}<br><span style="font-size:0.7rem;color:var(--text3);">${s.winRate}%</span></td>
            <td>${s.successfulChallenges}/${s.challengesSent}</td>
            <td>${s.successfulDefenses}/${s.defenses}</td>
            <td>${renderForm(s.form)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
}

function renderStatistics() {
  const container = document.getElementById('stats-container');
  if(!container) return;

  const stats = buildTeamStats();
  const totalCompleted = allChallenges.filter(c => c.status === 'completed').length;
  const totalPending = allChallenges.filter(c => ['pending','accepted','pending_result'].includes(c.status)).length;
  const totalSurrendered = allChallenges.filter(c => c.status === 'surrendered').length;
  const activeTeams = stats.filter(s => s.matches > 0).length;
  const totalChallenges = allChallenges.length;
  const topPoints = [...stats].sort((a,b) => b.points - a.points || b.wins - a.wins || b.matches - a.matches).slice(0, 5);
  const topActive = [...stats].sort((a,b) => b.matches - a.matches || b.points - a.points).slice(0, 5);

  const sorters = {
    points: (a,b) => b.points - a.points || b.wins - a.wins || b.matches - a.matches,
    active: (a,b) => b.matches - a.matches || b.points - a.points,
    challengers: (a,b) => b.successfulChallenges - a.successfulChallenges || b.challengesSent - a.challengesSent,
    defenders: (a,b) => b.successfulDefenses - a.successfulDefenses || b.defenses - a.defenses,
    form: (a,b) => b.winRate - a.winRate || b.wins - a.wins,
    fairplay: (a,b) => (a.surrenders + a.declined) - (b.surrenders + b.declined) || b.matches - a.matches
  };

  const titles = {
    points: '🏆 Bodovna ljestvica',
    active: '🎾 Najaktivniji parovi',
    challengers: '⚔️ Najuspješniji izazivači',
    defenders: '🛡️ Najbolji branitelji',
    form: '🔥 Najbolja forma',
    fairplay: '🤝 Fair play pregled'
  };

  const rows = [...stats].sort(sorters[activeStatsMode] || sorters.points);

  const leaderHtml = topPoints.length ? topPoints.map((s, i) => `
    <div class="stats-leader-row">
      <div class="stats-rank ${i === 0 ? 'gold' : ''}">${i === 0 ? '👑' : i + 1}</div>
      <div>
        <div class="stats-team">${s.name}</div>
        <div style="font-size:0.74rem;color:var(--text3);">${s.wins} pobjeda · ${s.losses} poraza · ${s.matches} mečeva · ${s.winRate}%</div>
      </div>
      <div class="stats-metric"><strong>${s.points}</strong><span>bodova</span></div>
    </div>
  `).join('') : '<div class="empty">Još nema završenih mečeva.</div>';

  const activeHtml = topActive.length ? topActive.map((s, i) => `
  <div style="display:flex;justify-content:space-between;gap:1rem;padding:0.58rem 0;border-bottom:1px solid var(--border);">
    <div>
      <strong style="color:var(--text);">${i + 1}. ${s.name}</strong>
      <div style="font-size:0.72rem;color:var(--text3);">Forma ${renderForm(s.form)}</div>
    </div>
    <div style="text-align:right;color:var(--orange);font-weight:900;">
      ${s.matches}
      <div style="font-size:0.68rem;color:var(--text3);font-weight:500;">mečeva</div>
    </div>
  </div>
`).join('') : '<div class="empty">Još nema aktivnosti.</div>';

  container.innerHTML = `
    <div class="stats-hero">
      <div class="stats-score-card">
        <div class="stats-hero-title">🏆 Top parovi po bodovima</div>
        <div class="stats-hero-sub">Testni dashboard: bodovi prikazuju aktivnost, formu i uspješnost izazova. Piramida ostaje službeni poredak.</div>
        ${leaderHtml}
      </div>
      <div class="stats-score-card">
        <div class="stats-hero-title">🎾 Najaktivniji</div>
        <div class="stats-hero-sub">Parovi koji najviše guraju turnir naprijed.</div>
        ${activeHtml}
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-mini"><div class="stat-mini-icon">🏆</div><div class="stat-mini-label">Završeni mečevi</div><div class="stat-mini-value">${totalCompleted}</div></div>
      <div class="stat-mini"><div class="stat-mini-icon">⚔️</div><div class="stat-mini-label">Ukupno izazova</div><div class="stat-mini-value">${totalChallenges}</div></div>
      <div class="stat-mini"><div class="stat-mini-icon">⏳</div><div class="stat-mini-label">Aktivni izazovi</div><div class="stat-mini-value">${totalPending}</div></div>
      <div class="stat-mini"><div class="stat-mini-icon">🔥</div><div class="stat-mini-label">Aktivni timovi</div><div class="stat-mini-value">${activeTeams}</div></div>
    </div>

    <div class="admin-box">
      <div class="admin-box-header">📌 Testni model bodovanja</div>
      <div class="admin-box-body" style="font-size:0.84rem;color:var(--text2);line-height:1.7;">
        Pobjeda = <strong style="color:var(--green);">3</strong>, poraz = <strong>1</strong>, pobjeda kao izazivač = <strong style="color:var(--orange);">+2</strong>, uspješna obrana = <strong style="color:var(--blue);">+1</strong>, predaja = <strong style="color:var(--red);">-2</strong>, odbijanje = <strong style="color:var(--red);">-1</strong>.
      </div>
    </div>

    <div class="stats-tabs">
      <button class="stats-tab ${activeStatsMode==='points'?'active':''}" onclick="setStatsMode('points')">🏆 Bodovi</button>
      <button class="stats-tab ${activeStatsMode==='active'?'active':''}" onclick="setStatsMode('active')">🎾 Aktivnost</button>
      <button class="stats-tab ${activeStatsMode==='challengers'?'active':''}" onclick="setStatsMode('challengers')">⚔️ Izazivači</button>
      <button class="stats-tab ${activeStatsMode==='defenders'?'active':''}" onclick="setStatsMode('defenders')">🛡️ Branitelji</button>
      <button class="stats-tab ${activeStatsMode==='form'?'active':''}" onclick="setStatsMode('form')">🔥 Forma</button>
      <button class="stats-tab ${activeStatsMode==='fairplay'?'active':''}" onclick="setStatsMode('fairplay')">🤝 Fair play</button>
    </div>

    <div class="admin-box stats-panel">
      <div class="admin-box-header">${titles[activeStatsMode] || titles.points}</div>
      <div class="admin-box-body" style="overflow-x:auto;padding-top:0.5rem;">
        ${renderStatsRows(rows, activeStatsMode)}
      </div>
    </div>
  `;
}

let loadAllRunId = 0;

function isUserBusy() {
  const active = document.activeElement;
  const typing = active && ['INPUT','SELECT','TEXTAREA'].includes(active.tagName);
  const modalOpen = !!document.querySelector('.modal-overlay.open');
  const adminOpen = document.getElementById('sec-admin')?.classList.contains('active');
  return typing || modalOpen || adminOpen;
}

function getCachedTeamMembers(teamId) {
  const team = derivedCache.teamById.get(teamId) || allTeams.find(t => t.id === teamId);
  const cachedMembers = derivedCache.membersByTeam.get(teamId);
  return getSortedTeamMembers(teamId, team?.captain_email, cachedMembers || allMembers);
}

async function safeLoadAll(reason = 'auto') {
  if(isRefreshing || isLoadingAll) {
    pendingReloadReason = reason;
    return false;
  }
  if(!currentPlayer) return false;

  // Automatski refresh ne smije prekidati klik, modal, unos ili admin uređivanje.
  if(['interval','focus'].includes(reason) && isUserBusy()) return false;
  if(reason === 'visible') {
    const active = document.activeElement;
    const typing = active && ['INPUT','SELECT','TEXTAREA'].includes(active.tagName);
    const modalOpen = !!document.querySelector('.modal-overlay.open');
    if(typing || modalOpen) return false;
  }

  if(!navigator.onLine) {
    showToast('Nema internet veze. Pokušat ću ponovno kad se veza vrati.', 'error');
    return false;
  }

  isRefreshing = true;
  console.log('[REFRESH MATCHES] START', { reason });
  try {
    const didLoad = await loadAll({ checkPenalties: reason === 'init' });
    if(didLoad) {
      lastSuccessfulRefresh = Date.now();
      refreshFailures = 0;
      console.log('[REFRESH MATCHES] SUCCESS', { reason });
    } else {
      console.error('[REFRESH MATCHES] ERROR', { reason, message: 'loadAll returned false' });
    }
    return didLoad;
  } catch (error) {
    refreshFailures++;
    console.error('[REFRESH MATCHES] ERROR', { reason, error });
    console.error('Greška kod osvježavanja aplikacije (' + reason + '):', error);
    if(error?.name === 'AbortError') {
      showToast('Veza je zaspala. Pokušaj još jednom.', 'error');
      return false;
    }
    if(refreshFailures >= 2) {
      showToast('Veza je spora. Pokušavam ponovo...', 'error');
      refreshFailures = 0;
    } else {
      showToast('Veza se prekinula. Pokušavam ponovno...', 'error');
    }
    return false;
  } finally {
    isRefreshing = false;
    if(pendingReloadReason && currentPlayer) {
      const queuedReason = pendingReloadReason;
      pendingReloadReason = null;
      setTimeout(() => safeLoadAll(queuedReason), 80);
    }
  }
}

function startRefreshTimer() {
  if(refreshTimer) clearInterval(refreshTimer);
  if(document.visibilityState !== 'visible') return;

  refreshTimer = setInterval(() => {
    if(document.visibilityState === 'visible') safeLoadAll('interval');
  }, 120000);
}

function stopRefreshTimer() {
  if(refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function setupAutoRefresh() {
  startRefreshTimer();

  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'hidden') {
      appWasHidden = true;
      stopRefreshTimer();
      return;
    }

    if(appWasHidden) {
      appWasHidden = false;
      console.log('[TKB] tab visible again - refreshing data');
      startRefreshTimer();
      shownIncomingChallengeId = null;
      shownWorkflowPopupId = null;
      safeLoadAll('visible').then(didLoad => {
        if(!didLoad) maybeShowAppWorkflowPopups();
      });
    }
  });

  window.addEventListener('online', () => {
    showToast('Veza uspostavljena! Osvježavam...', 'success');
    safeLoadAll('online');
  });

  window.addEventListener('error', (event) => {
    console.error('JavaScript greška:', event.error || event.message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('Neuhvaćena promise greška:', event.reason);
  });
}

async function init() {
  const ok = await handleAuth();
  if(ok) {
    await safeLoadAll('init');
    restoreActiveTab();
  }
  sb.auth.onAuthStateChange(async (event) => {
    if(event==='SIGNED_IN') {
      const ok=await handleAuth();
      if(ok) {
        await safeLoadAll('signed-in');
        restoreActiveTab();
      }
    }
  });

  setupAutoRefresh();
}

init();
