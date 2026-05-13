// TK Buje Piramida — auto-refresh, init

// ---- SAFE REFRESH / INIT v4 ----
let isRefreshing = false;
let refreshTimer = null;
let lastSuccessfulRefresh = Date.now();
let refreshFailures = 0;
let appWasHidden = false;
