const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const state = { inserts: 0, updates: 0, swaps: 0, toasts: [] };

function queryResult(data = null, error = null) {
  const query = {
    update() { state.updates += 1; return query; },
    insert() { state.inserts += 1; return Promise.resolve({ data, error }); },
    eq() { return query; },
    is() { return query; },
    gt() { return query; },
    lt() { return query; },
    select() { return query; },
    then(resolve, reject) { return Promise.resolve({ data, error }).then(resolve, reject); }
  };
  return query;
}

const fakeSb = { from: () => queryResult() };
const context = {
  console,
  Intl,
  Date,
  Math,
  Set,
  Promise,
  setTimeout: () => 0,
  clearTimeout: () => {},
  fetch: async () => ({ ok: true }),
  localStorage: { getItem: () => null },
  navigator: { userAgent: '', platform: '', maxTouchPoints: 0 },
  supabase: { createClient: () => fakeSb },
  showToast: (message, tone) => state.toasts.push({ message, tone }),
  confirm: () => true,
  swapTeams: async () => { state.swaps += 1; },
  getPyramidContext: () => ({ maxStep: 5 }),
  getRematchBlockReason: () => '',
  getCachedTeamMembers: () => [],
  safeLoadAll: async () => {},
  sendAcceptedEmail: async () => {},
  openSelectPlayersAccept: () => {},
  openModal: () => {},
  closeModal: () => {},
  document: { getElementById: () => null, addEventListener: () => {} }
};

vm.createContext(context);
vm.runInContext(fs.readFileSync('js/config.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('js/challenges.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('js/admin.js', 'utf8'), context);

(async () => {
  // Europe/Zagreb je na oba turnirska datuma u CEST-u (UTC+2).
  const boundaries = vm.runInContext(`(() => ({
    rejectionBefore: areChallengeRejectionsDisabled(new Date('2026-08-31T21:59:59.999Z')),
    rejectionAt: areChallengeRejectionsDisabled(new Date('2026-08-31T22:00:00.000Z')),
    challengeBefore: areNewChallengesDisabled(new Date('2026-09-14T21:59:59.999Z')),
    challengeAt: areNewChallengesDisabled(new Date('2026-09-14T22:00:00.000Z')),
    winterMidnight: getZagrebDateKey(new Date('2026-01-14T23:00:00.000Z')),
    summerMidnight: getZagrebDateKey(new Date('2026-06-14T22:00:00.000Z'))
  }))()`, context);
  assert.equal(boundaries.rejectionBefore, false);
  assert.equal(boundaries.rejectionAt, true);
  assert.equal(boundaries.challengeBefore, false);
  assert.equal(boundaries.challengeAt, true);
  assert.equal(boundaries.winterMidnight, 20260115); // CET, UTC+1
  assert.equal(boundaries.summerMidnight, 20260615); // CEST, UTC+2

  vm.runInContext(`
    allTeams.push(
      { id:'challenger', name:'Izazivač', captain_email:'captain@example.test', step:4 },
      { id:'challenged', name:'Izazvani', captain_email:'other@example.test', step:3 }
    );
    allChallenges.push({
      id:'challenge-1', challenger_id:'challenger', challenged_id:'challenged',
      status:'pending', created_at:'2026-08-30T10:00:00.000Z'
    });
    myTeam = allTeams[1];
    currentPlayer = { email:'other@example.test', is_admin:false };
  `, context);

  state.inserts = 0;
  const openResult = await vm.runInContext(`createPendingChallenge({
    challengerId:'challenger', challengedId:'challenged',
    now:new Date('2026-09-14T21:59:59.999Z')
  })`, context);
  assert.equal(openResult.error, null);
  assert.equal(state.inserts, 1);

  const closedResult = await vm.runInContext(`createPendingChallenge({
    challengerId:'challenger', challengedId:'challenged',
    now:new Date('2026-09-14T22:00:00.000Z')
  })`, context);
  assert.match(closedResult.error.message, /novi izazovi više nisu dopušteni/i);
  assert.equal(state.inserts, 1);

  state.updates = 0;
  await vm.runInContext(`respondChallenge('challenge-1','declined',new Date('2026-08-31T21:59:59.999Z'))`, context);
  assert.equal(state.updates, 1);
  await vm.runInContext(`respondChallenge('challenge-1','declined',new Date('2026-08-31T22:00:00.000Z'))`, context);
  assert.equal(state.updates, 1);
  assert.match(state.toasts.at(-1).message, /nije moguće odbiti/i);

  state.updates = 0;
  await vm.runInContext(`handleExpired(allChallenges[0],new Date('2026-08-31T21:59:59.999Z'))`, context);
  assert.equal(state.updates, 1);
  await vm.runInContext(`handleExpired(allChallenges[0],new Date('2026-08-31T22:00:00.000Z'))`, context);
  assert.equal(state.updates, 1);
  assert.equal(state.swaps, 0);

  state.updates = 0;
  await vm.runInContext(`adminDeclineChallenge('challenge-1',new Date('2026-08-31T22:00:00.000Z'))`, context);
  assert.equal(state.updates, 0);
  assert.equal(state.swaps, 0);

  const actions = vm.runInContext(`({
    before:getChallengeActionsHTML(allChallenges[0], { now:new Date('2026-08-31T21:59:59.999Z') }),
    after:getChallengeActionsHTML(allChallenges[0], { now:new Date('2026-08-31T22:00:00.000Z') })
  })`, context);
  assert.match(actions.before, /Odbij/);
  assert.doesNotMatch(actions.after, /Odbij/);
  assert.match(actions.after, /Prihvati/);

  const postTournamentActions = vm.runInContext(`(() => {
    const challenge = allChallenges[0];
    const pending = getChallengeActionsHTML(challenge, { now:new Date('2026-09-14T22:00:00.000Z') });
    challenge.status = 'accepted';
    const accepted = getChallengeActionsHTML(challenge, { now:new Date('2026-09-16T10:00:00.000Z') });
    return { pending, accepted };
  })()`, context);
  assert.match(postTournamentActions.pending, /Prihvati/);
  assert.doesNotMatch(postTournamentActions.pending, /Odbij/);
  assert.match(postTournamentActions.accepted, /Unesi rezultat/);

  console.log('Tournament boundary rules passed (Europe/Zagreb, cutoffs and post-tournament completion actions).');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
