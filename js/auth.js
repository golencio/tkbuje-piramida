// TK Buje Piramida — autentikacija, navigacija, modali

// ---- TOAST ----
function showToast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  setTimeout(() => t.className = 'toast', 3200);
}

// ---- AUTH ----
async function sendMagicLink() {
  const email = document.getElementById('magic-email').value.trim();
  if(!email) { 
    document.getElementById('magic-email').style.borderColor = 'var(--red)';
    return; 
  }
  const btn = document.getElementById('magic-btn');
  btn.textContent = 'Šaljem...';
  btn.disabled = true;

  const { error } = await sb.auth.signInWithOtp({
    email: email,
    options: { emailRedirectTo: APP_URL }
  });

  btn.disabled = false;
  btn.textContent = 'Pošalji magic link';

  if(error) {
    alert('Greška: ' + error.message);
    return;
  }
  document.getElementById('magic-sent').style.display = 'block';
  document.getElementById('magic-email').value = '';
}

async function loginWithGoogle() {
  const { error } = await sb.auth.signInWithOAuth({ provider:'google', options:{ redirectTo: APP_URL }});
  if(error) showToast('Greška: '+error.message, 'error');
}

async function logout() {
  await sb.auth.signOut();
  location.reload();
}

async function handleAuth() {
  const { data:{ session }} = await sb.auth.getSession();
  if(!session) { document.getElementById('login-screen').classList.add('show'); return false; }
  currentUser = session.user;

  const { data: player } = await sb.from('players').select('*').eq('email', currentUser.email).single();

  if(!player) {
    document.getElementById('login-screen').classList.add('show');
    document.getElementById('login-screen').querySelector('.login-box').innerHTML = `
      <div class="login-logo">TK <span>Buje</span></div>
      <div style="margin-top:1.5rem;">
        <div style="font-size:2.5rem;">🚫</div>
        <h3 style="font-size:1rem;font-weight:700;color:var(--text);margin:0.75rem 0 0.5rem;">Nisi registrirani član</h3>
        <p style="font-size:0.8rem;color:var(--text3);margin-bottom:1.5rem;">${currentUser.email}</p>
        <button class="btn-google" onclick="logout()">← Odjava</button>
      </div>`;
    return false;
  }

  currentPlayer = player;
  const initials = player.name.split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase();
  document.getElementById('user-initials').textContent = initials;
  document.getElementById('user-badge').style.display = 'flex';
  document.getElementById('mob-initials').textContent = initials;
  document.getElementById('mob-name').textContent = player.name;
  document.getElementById('mob-user').style.display = 'flex';
  document.getElementById('login-screen').classList.remove('show');
  if(player.is_admin) {
    document.getElementById('admin-btn').style.display = 'inline-flex';
    document.getElementById('admin-btn').classList.add('on');
    document.getElementById('mob-admin').style.display = 'block';
  }
  return true;
}

// ---- NAV ----
function showSection(id, btn) {
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b=>b.classList.remove('active'));
  document.getElementById('sec-'+id).classList.add('active');
  if(btn) btn.classList.add('active');
  if(id==='admin') renderAdmin();
  if(id==='statistika') renderStatistics();
  if(id==='piramida') {
    // Kad se korisnik vrati na Piramidu, ponovno pokaži aktualni workflow popup.
    shownIncomingChallengeId = null;
    shownWorkflowPopupId = null;
    maybeShowAppWorkflowPopups();
  }
}

function toggleMenu() {
  document.getElementById('mobile-menu').classList.toggle('open');
  document.getElementById('hamburger').classList.toggle('open');
}

function mobileNav(id) {
  document.querySelectorAll('.mobile-menu button').forEach(b=>b.classList.remove('active'));
  document.getElementById('mob-'+id)?.classList.add('active');
  showSection(id, document.getElementById('nav-'+id));
  document.getElementById('mobile-menu').classList.remove('open');
  document.getElementById('hamburger').classList.remove('open');
}

function switchTab(id, btn) {
  const modal = btn.closest('.modal');
  modal.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
  modal.querySelectorAll('.modal-tab').forEach(b=>b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  btn.classList.add('active');
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', e => {
    if(e.target === o && !o.classList.contains('locked')) o.classList.remove('open');
  });
});
