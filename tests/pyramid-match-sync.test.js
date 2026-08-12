const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const adminSource = fs.readFileSync('js/admin.js', 'utf8');
const DAY_MS = 24 * 60 * 60 * 1000;

function makeChallenge(overrides = {}) {
  return {
    id: 'challenge-1',
    challenger_id: 'team-winner',
    challenged_id: 'team-loser',
    result_winner_id: 'team-winner',
    result_score: '7 : 5, 2 : 6, 6 : 3',
    status: 'pending_result',
    challenger_player1: 'winner1@example.test',
    challenger_player2: 'winner2@example.test',
    challenged_player1: 'loser1@example.test',
    challenged_player2: 'loser2@example.test',
    created_at: '2026-08-06T20:59:24.000Z',
    scheduled_at: '2026-08-09T18:30:00.000Z',
    updated_at: '2026-08-10T10:21:10.000Z',
    ...overrides
  };
}

function createHarness({ challenge = makeChallenge(), matches = [] } = {}) {
  const databaseMatches = structuredClone(matches);
  const challenges = [structuredClone(challenge)];
  const patches = [];
  const toasts = [];
  const inputs = {
    'edit-ch-winner': { value: challenge.result_winner_id || '' },
    'edit-ch-score': { value: challenge.result_score || '' },
    'edit-ch-status': { value: 'completed' },
    'edit-ch-scheduled-at': { value: '' },
    'edit-ch-response-expires': { value: '' },
    'edit-ch-match-expires': { value: '' },
    'save-edit-challenge-btn': { disabled: false, textContent: '' },
    'sec-admin': { classList: { contains: () => false } }
  };

  function makeQuery(table) {
    const state = { operation: 'select', payload: null, filters: [], lower: [], upper: [], limit: null };
    const execute = () => {
      let rows = table === 'matches' ? databaseMatches : challenges;
      rows = rows.filter(row => state.filters.every(([key, value]) => row[key] === value));
      rows = rows.filter(row => state.lower.every(([key, value]) => row[key] >= value));
      rows = rows.filter(row => state.upper.every(([key, value]) => row[key] <= value));
      if(state.limit !== null) rows = rows.slice(0, state.limit);
      if(state.operation === 'insert') {
        const inserted = { id: `match-${databaseMatches.length + 1}`, match_number: databaseMatches.length + 1, ...state.payload };
        databaseMatches.push(inserted);
        return { data: [structuredClone(inserted)], error: null };
      }
      if(state.operation === 'update') rows.forEach(row => Object.assign(row, state.payload));
      return { data: structuredClone(rows), error: null };
    };
    const query = {
      select() { state.operation = 'select'; return query; },
      insert(payload) { state.operation = 'insert'; state.payload = payload; return query; },
      update(payload) { state.operation = 'update'; state.payload = payload; return query; },
      eq(key, value) { state.filters.push([key, value]); return query; },
      gte(key, value) { state.lower.push([key, value]); return query; },
      lte(key, value) { state.upper.push([key, value]); return query; },
      limit(value) { state.limit = value; return query; },
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
    DAY_MS,
    allTeams: [
      { id: 'team-winner', name: 'Winner' },
      { id: 'team-loser', name: 'Loser' }
    ],
    allChallenges: challenges,
    currentUser: { email: 'admin@example.test' },
    currentPlayer: { email: 'admin@example.test', is_admin: true },
    completingResultChallengeIds: new Set(),
    sb: { from: makeQuery },
    document: { getElementById: id => inputs[id] || null, addEventListener: () => {} },
    supabaseRestRequest: async (path, options) => patches.push({ path, options }),
    datetimeLocalToIso: value => value || null,
    showToast: (message, type) => toasts.push({ message, type }),
    closeModal: () => {},
    renderChallenges: async () => {},
    renderAdmin: () => {},
    safeLoadAll: async () => true,
    updateConfirmedMatchActivity: async () => {},
    swapTeams: async () => {},
    returnFromPenalty: async () => true
  };
  vm.createContext(context);
  vm.runInContext(adminSource, context);
  context.renderAdmin = () => {};
  return { context, databaseMatches, challenges, patches, toasts, inputs };
}

(async () => {
  // Test 1: standardna admin potvrda koristi zajednički sync i stvara pyramid zapis.
  const standard = createHarness({ challenge: makeChallenge({ result_winner_id: 'team-loser' }) });
  await vm.runInContext("adminConfirmResult('challenge-1')", standard.context);
  assert.equal(standard.databaseMatches.length, 1);
  assert.equal(standard.databaseMatches[0].source, 'pyramid');
  assert.equal(standard.databaseMatches[0].pyramid_challenge_id, 'challenge-1');

  // Test 2: Admin uređivanje izazova nakon uspješnog PATCH-a radi isti insert.
  const adminEdit = createHarness({ challenge: makeChallenge({ status: 'accepted' }) });
  vm.runInContext("editChallengeId = 'challenge-1'", adminEdit.context);
  await vm.runInContext('saveEditChallenge()', adminEdit.context);
  assert.equal(adminEdit.patches.length, 1);
  assert.equal(adminEdit.databaseMatches.length, 1);
  assert.equal(adminEdit.databaseMatches[0].source, 'pyramid');
  assert.equal(adminEdit.databaseMatches[0].pyramid_challenge_id, 'challenge-1');

  // Test 3: ponovno spremanje completed challengea ostaje idempotentno.
  await vm.runInContext('saveEditChallenge()', adminEdit.context);
  assert.equal(adminEdit.databaseMatches.length, 1);

  // Test 4: sadržajno isti ručni Parići zapis zaustavlja novi insert.
  const duplicate = createHarness({
    challenge: makeChallenge({ status: 'accepted' }),
    matches: [{
      id: 'manual-match',
      source: 'parici',
      winner1_email: 'winner2@example.test',
      winner2_email: 'winner1@example.test',
      loser1_email: 'loser2@example.test',
      loser2_email: 'loser1@example.test',
      notes: '7:5,2:6,6:3',
      created_at: '2026-08-10T08:59:34.000Z',
      vrijeme_potvrde: '2026-08-10T10:21:22.000Z',
      pyramid_challenge_id: null
    }]
  });
  vm.runInContext("editChallengeId = 'challenge-1'", duplicate.context);
  await vm.runInContext('saveEditChallenge()', duplicate.context);
  assert.equal(duplicate.databaseMatches.length, 1);
  assert.ok(duplicate.toasts.some(toast => toast.message.includes('mogući isti meč')));

  console.log('Pyramid match sync tests passed (standard, admin edit, idempotency, manual duplicate).');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
