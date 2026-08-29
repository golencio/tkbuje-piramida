const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let databaseWrites = 0;
let emailRequests = 0;

const context = {
  console,
  Date,
  Math,
  Set,
  Promise,
  setTimeout: () => 0,
  clearTimeout: () => {},
  allTeams: [{
    id: 'team-a',
    name: 'Tim A',
    captain_email: 'captain@example.test',
    step: 4,
    penalty: false,
    created_at: '2026-08-01T00:00:00.000Z',
    last_match_at: '2026-08-17T00:00:00.000Z',
    inactivity_penalty_warning_sent_at: null
  }],
  allPlayers: [{ email: 'captain@example.test' }],
  allChallenges: [],
  tournamentPause: { is_paused: false },
  DAY_MS: 24 * 60 * 60 * 1000,
  HOUR_MS: 60 * 60 * 1000,
  SUPABASE_KEY: 'test-key',
  getPauseTimerNow: () => new Date('2026-08-29T12:00:00.000Z'),
  fetch: async () => {
    emailRequests += 1;
    return { ok: true };
  },
  sb: {
    from: () => {
      databaseWrites += 1;
      throw new Error('Upozorenje ne smije rezervirati zapis dok je email isključen.');
    }
  }
};

vm.createContext(context);
vm.runInContext(fs.readFileSync('js/results.js', 'utf8'), context);

(async () => {
  await vm.runInContext('checkInactivityPenaltyWarnings()', context);
  assert.equal(emailRequests, 0);
  assert.equal(databaseWrites, 0);
  console.log('Inactivity email guard passed (no false challenge email, no warning claim).');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
