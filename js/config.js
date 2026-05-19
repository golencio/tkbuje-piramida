// TK Buje Piramida — konfiguracija, Supabase init, globalne varijable

const SUPABASE_URL = 'https://aglbdjyljbzzpddrshno.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnbGJkanlsamJ6enBkZHJzaG5vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NTQxOTcsImV4cCI6MjA5MzIzMDE5N30.NEOJnMJiUHCEGa27xkPf2HM00KEFZC5DjcDpC6t8U6Q';
const APP_URL = 'https://golencio.github.io/tkbuje-piramida/';
// Supabase fetch s pravim timeoutom.
// Važno: Promise timeout sam po sebi nije dovoljan jer originalni fetch može ostati visjeti
// nakon buđenja browser taba. AbortController stvarno prekida HTTP request.
const SUPABASE_REQUEST_TIMEOUT_MS = 12000;

function supabaseFetchWithTimeout(input, init = {}) {
  const controller = new AbortController();
  const originalSignal = init.signal;
  let originalAbortHandler = null;

  if(originalSignal) {
    if(originalSignal.aborted) controller.abort();
    else {
      originalAbortHandler = () => controller.abort();
      originalSignal.addEventListener('abort', originalAbortHandler, { once: true });
    }
  }

  const timeoutId = setTimeout(() => controller.abort(), SUPABASE_REQUEST_TIMEOUT_MS);

  return fetch(input, { ...init, signal: controller.signal })
    .finally(() => {
      clearTimeout(timeoutId);
      if(originalSignal && originalAbortHandler) {
        originalSignal.removeEventListener('abort', originalAbortHandler);
      }
    });
}

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  global: { fetch: supabaseFetchWithTimeout },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

function getStoredAccessToken() {
  try {
    const storageKey = 'sb-aglbdjyljbzzpddrshno-auth-token';
    const raw = localStorage.getItem(storageKey);
    if(!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.access_token || parsed?.currentSession?.access_token || null;
  } catch(err) {
    console.warn('Ne mogu pročitati Supabase session token:', err);
    return null;
  }
}

async function supabaseRestRequest(path, options = {}) {
  const token = getStoredAccessToken();
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: 'Bearer ' + (token || SUPABASE_KEY),
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
    ...(options.headers || {})
  };

  const response = await supabaseFetchWithTimeout(SUPABASE_URL + path, {
    ...options,
    headers
  });

  if(!response.ok) {
    let message = 'Supabase request failed (' + response.status + ')';
    try {
      const body = await response.json();
      message = body.message || body.error || message;
    } catch(err) {
      try {
        const text = await response.text();
        if(text) message = text;
      } catch(_err) {}
    }
    throw new Error(message);
  }

  if(response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

let allTeams = [], allChallenges = [], allPlayers = [], allMembers = [];
let isLoadingAll = false;
let pendingReloadReason = null;
let derivedCache = {
  teamById: new Map(),
  playerByEmail: new Map(),
  membersByTeam: new Map(),
  activeChallengeTeamIds: new Set(),
  cooldownByTeamId: new Map(),
  steps: {}
};
let tabHidden = false;
let currentUser = null, currentPlayer = null, myTeam = null;
let activeResultChallenge = null;
let tournamentPause = { is_paused: false, paused_at: null, pause_reason: null };
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function escapeContactHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizePhoneForLink(phone) {
  return String(phone || '').trim().replace(/[^\d+]/g, '');
}

function getSmsBodySeparator() {
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const isiOS = /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return isiOS ? '&' : '?';
}

function renderCaptainContactButtons(captain, smsText) {
  const phone = normalizePhoneForLink(captain?.phone);
  if(!phone) return '<div class="contact-missing">Telefon nije upisan</div>';

  const safePhone = escapeContactHtml(phone);
  const smsHref = 'sms:' + safePhone + getSmsBodySeparator() + 'body=' + encodeURIComponent(smsText);

  return '<div class="contact-actions">'
    + '<a class="contact-btn call" href="tel:' + safePhone + '">📞 Nazovi</a>'
    + '<a class="contact-btn sms" href="' + escapeContactHtml(smsHref) + '">💬 Pošalji SMS</a>'
    + '</div>';
}
