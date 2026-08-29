const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const state = { inserts: 0, updates: 0, updatePayloads: [], swaps: 0, toasts: [] };

function queryResult(data = null, error = null) {
  const query = {
    update(payload) { state.updates += 1; state.updatePayloads.push(payload); return query; },
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
  testState: state,
  showToast: (message, tone) => state.toasts.push({ message, tone }),
  confirm: () => true,
  swapTeams: async () => { state.swaps += 1; },
  getPyramidContext: () => ({ maxStep: 5 }),
  getRematchBlockReason: () => '',
  getCachedTeamMembers: () => [],
  getSortedTeamMembers: () => [],
  isPlayedCompletedChallenge: challenge => challenge.status === 'completed' &&
    !!challenge.result_winner_id && !!challenge.result_score,
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
const statsSource = fs.readFileSync('js/stats.js', 'utf8').split('function setStatsMode')[0];
vm.runInContext(statsSource, context);

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
      { id:'challenger', name:'Izazivač', captain_email:'captain@example.test', step:4, position:1 },
      { id:'challenged', name:'Izazvani', captain_email:'other@example.test', step:3, position:2 }
    );
    allChallenges.push({
      id:'challenge-1', challenger_id:'challenger', challenged_id:'challenged',
      status:'pending', created_at:'2026-08-28T22:00:00.000Z',
      response_expires_at:'2026-08-31T22:00:00.000Z'
    });
    myTeam = allTeams[1];
    currentPlayer = { email:'other@example.test', is_admin:false };
    swapTeams = async (winnerId, loserId) => {
      const winner = allTeams.find(team => team.id === winnerId);
      const loser = allTeams.find(team => team.id === loserId);
      const winnerPlace = { step:winner.step, position:winner.position };
      winner.step = loser.step; winner.position = loser.position;
      loser.step = winnerPlace.step; loser.position = winnerPlace.position;
      testState.swaps += 1;
    };
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

  // Prihvaćanje unutar tri dana ostaje normalno dostupno.
  state.updates = 0;
  state.updatePayloads = [];
  await vm.runInContext(`respondChallenge('challenge-1','accepted',new Date('2026-08-31T21:59:59.999Z'))`, context);
  assert.equal(state.updatePayloads.at(-1).status, 'accepted');
  vm.runInContext(`allChallenges[0].status = 'pending'`, context);

  // Ručno odbijanje radi neposredno prije granice, ali je blokirano od 1. 9.
  state.updates = 0;
  state.updatePayloads = [];
  await vm.runInContext(`respondChallenge('challenge-1','declined',new Date('2026-08-31T21:59:59.999Z'))`, context);
  assert.equal(state.updates, 1);
  await vm.runInContext(`respondChallenge('challenge-1','declined',new Date('2026-08-31T22:00:00.000Z'))`, context);
  assert.equal(state.updates, 1);
  assert.match(state.toasts.at(-1).message, /nije moguće odbiti/i);

  // Rok koji istječe neposredno prije 1. 9. koristi staro pravilo odbijanja.
  state.updates = 0;
  state.updatePayloads = [];
  vm.runInContext(`Object.assign(allChallenges[0], { status:'pending', response_expires_at:'2026-08-31T21:59:59.999Z', result_winner_id:null, result_score:null })`, context);
  await vm.runInContext(`handleExpired(allChallenges[0],new Date('2026-08-31T21:59:59.999Z'))`, context);
  assert.equal(state.updates, 1);
  assert.equal(state.updatePayloads.at(-1).status, 'declined');
  assert.equal(state.swaps, 0);

  // Izazov je poslan prije 1. 9., ali rok mu istječe točno na granici novog
  // pravila: zatvara se pobjedom izazivača i zamjenom položaja.
  state.updates = 0;
  state.updatePayloads = [];
  vm.runInContext(`Object.assign(allChallenges[0], { status:'pending', created_at:'2026-08-28T22:00:00.000Z', response_expires_at:'2026-08-31T22:00:00.000Z', result_winner_id:null, result_score:null })`, context);
  await vm.runInContext(`handleExpired(allChallenges[0],new Date('2026-08-31T22:00:00.000Z'))`, context);
  const automaticLoss = vm.runInContext(`({ challenge:{...allChallenges[0]}, teams:allTeams.map(team => ({...team})), applies:usesAutomaticNoResponseLoss(allChallenges[0]) })`, context);
  assert.equal(automaticLoss.applies, true);
  assert.equal(automaticLoss.challenge.status, 'completed');
  assert.equal(automaticLoss.challenge.result_winner_id, 'challenger');
  assert.match(automaticLoss.challenge.result_score, /W\.O\..*istek roka/i);
  assert.equal(automaticLoss.teams.find(team => team.id === 'challenger').step, 3);
  assert.equal(automaticLoss.teams.find(team => team.id === 'challenged').step, 4);
  assert.equal(state.swaps, 1);

  // Postojeća statistika obrađuje W.O. kao pobjedu/poraz i pripadajuće bodove.
  const stats = JSON.parse(JSON.stringify(vm.runInContext(`buildTeamStats().map(item => ({
    id:item.team.id, wins:item.wins, losses:item.losses, matches:item.matches,
    points:item.points, successfulChallenges:item.successfulChallenges
  }))`, context)));
  const winnerStats = stats.find(item => item.id === 'challenger');
  const loserStats = stats.find(item => item.id === 'challenged');
  assert.deepEqual(winnerStats, { id:'challenger', wins:1, losses:0, matches:1, points:5, successfulChallenges:1 });
  assert.deepEqual(loserStats, { id:'challenged', wins:0, losses:1, matches:1, points:1, successfulChallenges:0 });

  // Isti automatski poraz vrijedi i za rok nakon 1. 9.
  vm.runInContext(`Object.assign(allChallenges[0], { status:'pending', created_at:'2026-08-30T10:00:00.000Z', response_expires_at:'2026-09-02T10:00:00.000Z', result_winner_id:null, result_score:null })`, context);
  await vm.runInContext(`handleExpired(allChallenges[0],new Date('2026-09-02T10:00:00.000Z'))`, context);
  assert.equal(vm.runInContext(`allChallenges[0].status`, context), 'completed');
  assert.equal(vm.runInContext(`allChallenges[0].result_winner_id`, context), 'challenger');

  state.updates = 0;
  const swapsBeforeBlockedAdminDecline = state.swaps;
  await vm.runInContext(`adminDeclineChallenge('challenge-1',new Date('2026-08-31T22:00:00.000Z'))`, context);
  assert.equal(state.updates, 0);
  assert.equal(state.swaps, swapsBeforeBlockedAdminDecline);

  vm.runInContext(`allChallenges[0].status = 'pending'`, context);
  const actions = vm.runInContext(`({
    before:getChallengeActionsHTML(allChallenges[0], { now:new Date('2026-08-31T21:59:59.999Z') }),
    after:getChallengeActionsHTML(allChallenges[0], { now:new Date('2026-08-31T22:00:00.000Z') })
  })`, context);
  assert.match(actions.before, /Odbij/);
  assert.doesNotMatch(actions.after, /Odbij/);
  assert.match(actions.after, /Prihvati/);

  const postTournamentActions = vm.runInContext(`(() => {
    const challenge = allChallenges[0];
    challenge.status = 'pending';
    const pending = getChallengeActionsHTML(challenge, { now:new Date('2026-09-14T22:00:00.000Z') });
    challenge.status = 'accepted';
    const accepted = getChallengeActionsHTML(challenge, { now:new Date('2026-09-16T10:00:00.000Z') });
    return { pending, accepted };
  })()`, context);
  assert.match(postTournamentActions.pending, /Prihvati/);
  assert.doesNotMatch(postTournamentActions.pending, /Odbij/);
  assert.match(postTournamentActions.accepted, /Unesi rezultat/);

  console.log('Tournament boundary rules passed (Europe/Zagreb, expiry auto-loss, stats and post-tournament completion).');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
