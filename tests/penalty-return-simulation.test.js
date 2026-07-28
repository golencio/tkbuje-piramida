const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const teams = [
  { id: 'A', name: 'Tim A', penalty: true, step: 3, position: 1, original_step: 3, last_match_at: null },
  { id: 'B', name: 'Tim B', penalty: false, step: 4, position: 1 },
  { id: 'C', name: 'Tim C', penalty: false, step: 4, position: 2 },
  { id: 'D', name: 'Tim D', penalty: false, step: 2, position: 1 }
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
const originalOtherSlots = teams.filter(team => team.id !== 'A')
  .map(({ id, penalty, step, position }) => ({ id, penalty, step, position }));
const snapshots = [];
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
  sb: { from: makeQuery },
  confirm: () => true,
  showToast: () => {},
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
vm.runInContext(fs.readFileSync('js/results.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('js/admin.js', 'utf8'), context);
context.renderAdmin = () => {};
context.insertPyramidMatchIfMissing = async challenge => {
  savedMatch = structuredClone(challenge);
  return { status: 'inserted' };
};

(async () => {
  await vm.runInContext("adminConfirmResult('match-1')", context);

  const restored = teams.find(team => team.id === 'A');
  assert.equal(restored.penalty, false);
  assert.equal(restored.step, 5);
  assert.equal(restored.position, 1, 'nepostojeća 5. stepenica mora se otvoriti pozicijom 1');
  assert.equal(restored.original_step, null);
  assert.ok(restored.last_match_at);
  assert.deepEqual(
    teams.filter(team => team.id !== 'A').map(({ id, penalty, step, position }) => ({ id, penalty, step, position })),
    originalOtherSlots,
    'ostali timovi ne smiju promijeniti stepenicu ni poziciju'
  );
  assert.equal(penaltyEvents[0].is_active, false);
  assert.ok(penaltyEvents[0].penalty_removed_at);
  assert.equal(challenges[0].status, 'completed');
  assert.equal(savedMatch.status, 'completed');
  assert.equal(snapshots.at(-1).teams.find(team => team.id === 'A').step, 5);

  assert.equal(vm.runInContext('getFirstAvailablePosition([{position:1},{position:3}])', context), 2);
  assert.equal(vm.runInContext('getFirstAvailablePosition([])', context), 1);
  console.log('Penalty return simulation passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
