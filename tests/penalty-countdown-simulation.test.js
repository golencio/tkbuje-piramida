const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const oldMatchAt = '2026-07-16T10:00:00.000Z';
const confirmedAt = '2026-07-29T10:00:00.000Z';
const databaseTeams = [{
  id: 'team-a',
  name: 'Tim A',
  step: 3,
  position: 1,
  penalty: false,
  created_at: '2026-06-01T10:00:00.000Z',
  last_match_at: oldMatchAt,
  inactivity_penalty_warning_sent_at: '2026-07-28T10:00:00.000Z'
}];
const cachedTeams = structuredClone(databaseTeams);

const context = {
  console,
  Date,
  Math,
  Set,
  Promise,
  setTimeout: () => 0,
  clearTimeout: () => {},
  document: { addEventListener: () => {} },
  allTeams: cachedTeams,
  allChallenges: [],
  tournamentPause: { is_paused: false },
  currentPlayer: { email: 'admin@example.test', is_admin: true },
  currentUser: { email: 'admin@example.test' },
  DAY_MS: 24 * 60 * 60 * 1000,
  HOUR_MS: 60 * 60 * 1000,
  getPauseTimerNow: () => new Date(confirmedAt),
  sb: {
    rpc: async (name, params) => {
      assert.equal(name, 'set_confirmed_match_activity');
      const updated = databaseTeams.filter(team => params.p_team_ids.includes(team.id));
      updated.forEach(team => Object.assign(team, {
        last_match_at: params.p_confirmed_at,
        inactivity_penalty_warning_sent_at: null
      }));
      return {
        data: updated.map(team => ({ team_id: team.id, last_match_at: team.last_match_at })),
        error: null
      };
    }
  },
  confirm: () => true,
  showToast: () => {},
  capturePyramidSnapshot: async () => true
};

vm.createContext(context);
vm.runInContext(fs.readFileSync('js/results.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('js/pyramid.js', 'utf8'), context);

(async () => {
  // Simulira administratorsku potvrdu: stari datum zamjenjuje se vremenom potvrde.
  await vm.runInContext(`updateConfirmedMatchActivity(['team-a'], '${confirmedAt}')`, context);
  assert.equal(databaseTeams[0].last_match_at, confirmedAt);
  assert.equal(databaseTeams[0].inactivity_penalty_warning_sent_at, null);

  // Simulira loadAll(): cache se ponovno puni vrijednostima pročitanima iz baze.
  cachedTeams.splice(0, cachedTeams.length, ...structuredClone(databaseTeams));

  const result = vm.runInContext(`(() => {
    const team = allTeams[0];
    const now = new Date('${confirmedAt}');
    const today = getTeamPenaltyActivityInfo(team, now);
    const tomorrow = getTeamPenaltyActivityInfo(team, new Date(now.getTime() + DAY_MS));
    const html = renderTeamStatusBadges(team, { cooldownByTeamId: new Map() }, {});
    return { today, tomorrow, html };
  })()`, context);

  assert.equal(result.today.daysInactive, 0);
  assert.equal(result.today.daysLeft, 15);
  assert.equal(result.tomorrow.daysInactive, 1);
  assert.equal(result.tomorrow.daysLeft, 14);
  assert.ok(result.html.includes('Kazna za 15 dana'));
  assert.ok(!result.html.includes('12 dana'));

  const activeChallengeHtml = vm.runInContext(`(() => {
    allChallenges.push({ id:'active', challenger_id:'team-a', challenged_id:'team-b', status:'accepted' });
    return renderTeamStatusBadges(allTeams[0], { cooldownByTeamId: new Map() }, {});
  })()`, context);
  assert.ok(activeChallengeHtml.includes('Aktivno'));
  assert.ok(!activeChallengeHtml.includes('Kazna za'));

  const exemptHtml = vm.runInContext(`(() => {
    allChallenges.length = 0;
    allTeams[0].step = 2;
    return renderTeamStatusBadges(allTeams[0], { cooldownByTeamId: new Map() }, {});
  })()`, context);
  assert.equal(exemptHtml, '');

  console.log('Penalty countdown simulation passed (database update, reload, 15/14-day display, active/exempt states).');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
