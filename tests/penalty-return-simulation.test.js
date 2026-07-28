const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const resultsSource = fs.readFileSync('js/results.js', 'utf8');
const adminSource = fs.readFileSync('js/admin.js', 'utf8');
const pyramidSource = fs.readFileSync('js/pyramid.js', 'utf8');

function teamSlots(teams, excludedId = null) {
  return teams
    .filter(team => team.id !== excludedId)
    .map(({ id, penalty, step, position }) => ({ id, penalty, step, position }));
}

async function runScenario({ fifthStepTeams = [], rpcError = null }) {
  const teams = [
    { id: 'A', name: 'Tim A', penalty: true, step: 3, position: 1, original_step: 3, last_match_at: null },
    { id: 'B', name: 'Tim B', penalty: false, step: 4, position: 1 },
    { id: 'C', name: 'Tim C', penalty: false, step: 4, position: 2 },
    { id: 'D', name: 'Tim D', penalty: false, step: 2, position: 1 },
    ...structuredClone(fifthStepTeams)
  ];
  const challenges = [{
    id: 'match-1',
    challenger_id: 'A',
    challenged_id: 'B',
    result_winner_id: 'A',
    result_score: '6:3 6:4',
    status: 'pending_result'
  }];
  const penaltyEvents = [{ id: 'penalty-1', team_id: 'A', is_active: true, penalty_started_at: new Date().toISOString() }];
  const originalOtherSlots = teamSlots(teams, 'A');
  const snapshots = [];
  const toasts = [];
  let savedMatch = null;

  function makeQuery(table) {
    const state = { operation: 'select', filters: [], inFilter: null, payload: null };
    const execute = () => {
      let rows = table === 'teams' ? teams : table === 'challenges' ? challenges : penaltyEvents;
      rows = rows.filter(row => state.filters.every(([key, value]) => row[key] === value));
      if(state.inFilter) rows = rows.filter(row => state.inFilter[1].includes(row[state.inFilter[0]]));
      if(state.operation === 'update') rows.forEach(row => Object.assign(row, state.payload));
      return { data: state.operation === 'select' ? structuredClone(rows) : null, error: null };
    };
    const query = {
      select() { state.operation = 'select'; return query; },
      update(payload) { state.operation = 'update'; state.payload = payload; return query; },
      insert() { return Promise.resolve({ data: null, error: null }); },
      eq(key, value) { state.filters.push([key, value]); return query; },
      in(key, values) { state.inFilter = [key, values]; return query; },
      order() { return query; },
      limit() { return query; },
      single() { const result = execute(); return Promise.resolve({ data: result.data?.[0] || null, error: result.error }); },
      maybeSingle() { const result = execute(); return Promise.resolve({ data: result.data?.[0] || null, error: result.error }); },
      then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); }
    };
    return query;
  }

  const sb = {
    from: makeQuery,
    rpc: async (name, params) => {
      if(name === 'set_confirmed_match_activity') {
        const updated = teams.filter(team => params.p_team_ids.includes(team.id));
        updated.forEach(team => Object.assign(team, {
          last_match_at: params.p_confirmed_at,
          inactivity_penalty_warning_sent_at: null
        }));
        return {
          data: updated.map(team => ({ team_id: team.id, last_match_at: team.last_match_at })),
          error: null
        };
      }

      assert.equal(name, 'return_from_penalty_after_win');
      if(rpcError) return { data: null, error: { message: rpcError } };

      const team = teams.find(candidate => candidate.id === params.p_team_id && candidate.penalty === true);
      const event = penaltyEvents.find(candidate => candidate.team_id === params.p_team_id && candidate.is_active === true);
      if(!team || !event) return { data: null, error: { message: 'Nema aktivnog zapisa kazne.' } };

      const occupied = new Set(teams
        .filter(candidate => candidate.id !== team.id && !candidate.penalty && candidate.step === 5)
        .map(candidate => Number(candidate.position)));
      let position = 1;
      while(occupied.has(position)) position++;

      // Mock predstavlja jednu atomsku SQL transakciju: validacije se dovrše
      // prije nego što se promijene tim i događaj kazne.
      Object.assign(team, {
        penalty: false,
        step: 5,
        position,
        original_step: null,
        last_match_at: params.p_last_match_at,
        inactivity_penalty_warning_sent_at: null
      });
      Object.assign(event, {
        is_active: false,
        penalty_removed_at: new Date().toISOString(),
        removed_by: params.p_removed_by
      });
      return { data: { team_id: team.id, step: 5, position, penalty_event_id: event.id }, error: null };
    }
  };

  const context = {
    console,
    Date,
    Math,
    Set,
    Promise,
    setTimeout: () => 0,
    clearTimeout: () => {},
    document: { addEventListener: () => {} },
    allTeams: teams,
    allChallenges: challenges,
    currentPlayer: { email: 'admin@example.test', is_admin: true },
    currentUser: { email: 'admin@example.test' },
    tournamentPause: { is_paused: false },
    sb,
    confirm: () => true,
    showToast: message => toasts.push(message),
    safeLoadAll: async () => true,
    renderAdmin: () => {},
    capturePyramidSnapshot: async (reason, metadata) => {
      snapshots.push({ reason, metadata, teams: structuredClone(teams) });
      return true;
    },
    DAY_MS: 24 * 60 * 60 * 1000,
    getPauseTimerNow: () => new Date()
  };
  vm.createContext(context);
  vm.runInContext(resultsSource, context);
  vm.runInContext(adminSource, context);
  vm.runInContext(pyramidSource, context);
  context.renderAdmin = () => {};
  context.insertPyramidMatchIfMissing = async challenge => {
    savedMatch = structuredClone(challenge);
    return { status: 'inserted' };
  };

  await vm.runInContext("adminConfirmResult('match-1')", context);
  const countdown = vm.runInContext(`(() => {
    const team = allTeams.find(candidate => candidate.id === 'A');
    const baseDate = new Date(team.last_match_at);
    const info = getTeamPenaltyActivityInfo(team, baseDate);
    const html = renderTeamStatusBadges(team, { cooldownByTeamId: new Map() }, {});
    return { daysLeft: info.daysLeft, daysInactive: info.daysInactive, html };
  })()`, context);
  return { teams, challenges, penaltyEvents, originalOtherSlots, snapshots, toasts, savedMatch, countdown };
}

function assertSuccessfulReturn(result, expectedPosition) {
  const restored = result.teams.find(team => team.id === 'A');
  assert.equal(restored.penalty, false);
  assert.equal(restored.step, 5);
  assert.equal(restored.position, expectedPosition);
  assert.equal(restored.original_step, null);
  assert.ok(restored.last_match_at);
  assert.deepEqual(teamSlots(result.teams, 'A'), result.originalOtherSlots, 'ostali timovi ne smiju promijeniti stepenicu ni poziciju');
  assert.equal(result.penaltyEvents[0].is_active, false);
  assert.ok(result.penaltyEvents[0].penalty_removed_at);
  assert.equal(result.challenges[0].status, 'completed');
  assert.equal(result.savedMatch.status, 'completed');
  assert.equal(result.snapshots.at(-1).teams.find(team => team.id === 'A').step, 5);
  assert.equal(result.countdown.daysInactive, 0);
  assert.equal(result.countdown.daysLeft, 15);
  assert.ok(result.countdown.html.includes('Kazna za 15 dana'));

  const positions = result.teams
    .filter(team => !team.penalty && team.step === 5)
    .map(team => team.position);
  assert.equal(new Set(positions).size, positions.length, 'pozicije na 5. stepenici moraju biti jedinstvene');
}

(async () => {
  const reopenedFifthStep = await runScenario({ fifthStepTeams: [] });
  assertSuccessfulReturn(reopenedFifthStep, 1);

  const existingFifthStep = await runScenario({
    fifthStepTeams: [
      { id: 'E', name: 'Tim E', penalty: false, step: 5, position: 1 },
      { id: 'F', name: 'Tim F', penalty: false, step: 5, position: 3 }
    ]
  });
  assertSuccessfulReturn(existingFifthStep, 2);

  const failedReturn = await runScenario({ rpcError: 'simulirana Supabase greška' });
  assert.equal(failedReturn.teams.find(team => team.id === 'A').penalty, true);
  assert.equal(failedReturn.penaltyEvents[0].is_active, true);
  assert.equal(failedReturn.challenges[0].status, 'pending_result');
  assert.equal(failedReturn.savedMatch, null);
  assert.ok(failedReturn.toasts.some(message => message.includes('Supabase nije dovršio automatski povratak')));

  console.log('Penalty return simulations passed (missing step 5, existing step 5, atomic failure).');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
