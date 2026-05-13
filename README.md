# TK Buje — Piramida Turnira

Web aplikacija za upravljanje piramida turnira TK Buje. Izgrađena na Supabase backendu, hostana na GitHub Pages.

## Struktura projekta

```
tk-buje-piramida/
│
├── index.html          — skeleton stranice, linkovi na CSS i JS
│
├── css/
│   ├── base.css        — varijable, reset, header, navigacija
│   ├── pyramid.css     — stepenice, team kartice
│   ├── challenges.css  — izazov kartice, VS prikaz
│   ├── modals.css      — modalni prozori, forme, toast, profil
│   ├── admin.css       — admin panel
│   └── stats.css       — statistika i ljestvica
│
└── js/
    ├── config.js       — Supabase init, konstante, globalne varijable
    ├── auth.js         — prijava, odjava, navigacija, modali
    ├── data.js         — učitavanje podataka, cache, pauza turnira
    ├── pyramid.js      — renderiranje piramide i team kartica
    ├── challenges.js   — slanje/prihvat izazova, odabir igrača
    ├── workflow.js     — popup-i za termin, rezultat i admin potvrdu
    ├── results.js      — unos rezultata, zamjena mjesta, kazne
    ├── admin.js        — admin panel, upravljanje timovima i izazovima
    ├── stats.js        — statistika i ljestvica
    └── refresh.js      — auto-refresh i inicijalizacija
```

> **Napomena o redoslijedu JS datoteka**: `config.js` mora biti prvi jer definira
> `sb` (Supabase klijent) i globalne varijable koje koriste sve ostale datoteke.

---

## Postavljanje na GitHub Pages

### 1. Kreiraj repozitorij

1. Idi na [github.com/new](https://github.com/new)
2. Naziv: `tkbuje-piramida` (ili po želji)
3. Vidljivost: **Public** (GitHub Pages je besplatan za public repozitorije)
4. Klikni **Create repository**

### 2. Uploadi datoteke

**Opcija A — kroz GitHub sučelje (bez Git-a):**

1. U repozitoriju klikni **Add file → Upload files**
2. Uploadaj `index.html`
3. Kreiraj mapu `css/`: klikni **Add file → Create new file**, upiši `css/base.css` — GitHub će automatski kreirati mapu
4. Ponovi za svaku CSS datoteku (`css/pyramid.css`, `css/challenges.css`, itd.)
5. Ponovi za sve JS datoteke u `js/` mapi

**Opcija B — Git naredbe (brže):**

```bash
git init
git add .
git commit -m "Inicijalni upload — modularna struktura"
git remote add origin https://github.com/TVOJ_USERNAME/tkbuje-piramida.git
git push -u origin main
```

### 3. Uključi GitHub Pages

1. U repozitoriju idi na **Settings → Pages**
2. Pod **Source** odaberi: `Deploy from a branch`
3. Branch: `main`, folder: `/ (root)`
4. Klikni **Save**

Nakon 1-2 minute aplikacija je dostupna na:
```
https://TVOJ_USERNAME.github.io/tkbuje-piramida/
```

### 4. Ažuriraj APP_URL u config.js

U datoteci `js/config.js` promijeni:
```javascript
const APP_URL = 'https://TVOJ_USERNAME.github.io/tkbuje-piramida';
```
Ovo je potrebno za ispravno preusmjeravanje nakon Google OAuth prijave.

---

## Ažuriranje aplikacije

Svaka promjena u repozitoriju automatski se objavi na GitHub Pages unutar ~1 minute.

- Izmijeniš li `js/admin.js` — samo tu datoteku uploadaj/commiti
- Izmijeniš li stilove — samo odgovarajuću CSS datoteku
- Browser korisnika preuzima novu verziju pri sljedećem posjetu

---

## Supabase konfiguracija

Ključevi se nalaze u `js/config.js`. Trenutni projekt koristi:
- **URL**: `https://aglbdjyljbzzpddrshno.supabase.co`
- **Anon key**: definiran u `config.js`

Za promjenu Supabase projekta izmijeni samo `js/config.js`.
