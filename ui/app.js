// Deadlock Companion UI. All data comes from the public deadlock-api.com API.
const T = window.__TAURI__;
const API = 'https://api.deadlock-api.com/v1';
const STEAM64 = 76561197960265728n;
const view = document.getElementById('view');

const S = {
  cfg: { steamId: '' },
  view: 'profile',
  heroes: [], heroById: {}, items: {}, ranks: [], heroStats: {},
  profiles: {}, // account id -> { loading, err, steam, rank, matches, mates, matesErr, names }
  viewing: null, // account id shown in the profile view (null = mine)
  stack: [], // previously viewed profiles, for "Retour"
  editingId: false, showAll: false,
  hero: null, heroTab: 'builds', builds: {}, buildIdx: 0,
  matchCache: {}, // match id -> { loading, err, info, names }
  match: null, matchFor: null, // match shown, and the player we opened it from
  ana: { tier: 10, period: 90, hero: 0, trend: 'spm' }, // analysis filters
  anaFor: null, // account analysed (null = mine)
  metrics: {}, // metrics url -> { loading, data, err }
  trendPts: [],
  live: null, // { loading, err, match, names, ranks, at }
  liveDemo: false, // show the most watched top match instead of mine
  search: '', sort: 'name',
  hiddenRoles: new Set(), // hero roles unchecked in the Héros filter
};

// ---------- helpers ----------
// Everything from the API (build names, Steam names...) is user-generated: always escape.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const strip = (s) => String(s ?? '').replace(/<[^>]*>/g, '');
const pct = (a, b) => (b ? (100 * a) / b : 0);
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
// match_result = winning team; player_match_outcome is almost always 0 in real data
const isWin = (m) => m.match_result === m.player_team;
const wrClass = (wr) => (wr >= 52 ? 'wr-good' : wr <= 48 ? 'wr-bad' : '');
const TYPES = { marksman: 'Tireur', mystic: 'Mystique', brawler: 'Bagarreur', assassin: 'Assassin' };
const roleName = (r) => (TYPES[r] ? tr(TYPES[r]) : r ? r[0].toUpperCase() + r.slice(1) : tr('Autre'));
const TIERS = ['', 'I', 'II', 'III', 'IV', 'V'];
// builds made in-game keep the game's untranslated category keys
const CATS = { EarlyGame: 'Début de partie', MidGame: 'Milieu de partie', LateGame: 'Fin de partie' };
const catName = (n) => {
  const key = String(n ?? '').match(/^#Citadel_HeroBuilds_(\w+)/)?.[1];
  return key ? (CATS[key] ? tr(CATS[key]) : key) : n || '';
};

async function api(path) {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(r.status === 429 ? tr('Trop de requêtes, réessaie dans un moment') : tr('Erreur API ({status})', { status: r.status }));
  return r.json();
}

/** Accepts a Steam friend code (SteamID3), a SteamID64 or a profile URL containing one. */
function accountId(input) {
  // old SteamID2 format STEAM_X:Y:Z -> account id 2*Z + Y
  const s2 = String(input ?? '').match(/STEAM_\d:([01]):(\d+)/i);
  if (s2) return 2 * Number(s2[2]) + Number(s2[1]);
  const m = String(input ?? '').match(/\d{5,}/);
  if (!m) return null;
  let n = BigInt(m[0]);
  if (n >= STEAM64) n -= STEAM64;
  return n > 0n && n <= 0xffffffffn ? Number(n) : null;
}
console.assert(accountId('STEAM_0:1:14718081') === 29436163 && accountId('76561197989701891') === 29436163
  && accountId('[U:1:29436163]') === 29436163 && accountId('abc') === null, 'accountId');

function ago(sec) {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - sec));
  if (s < 3600) return tr('il y a {n} min', { n: Math.max(1, Math.floor(s / 60)) });
  if (s < 86400) return tr('il y a {n} h', { n: Math.floor(s / 3600) });
  if (s < 86400 * 30) return tr('il y a {n} j', { n: Math.floor(s / 86400) });
  return tr('il y a {n} mois', { n: Math.floor(s / 86400 / 30) });
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 3000);
}

function saveConfig() {
  T.core.invoke('save_config', { data: JSON.stringify(S.cfg) }).catch((e) => toast(tr('Sauvegarde impossible : {e}', { e })));
}

const spinner = (label = tr('Chargement…')) => `<div class="center"><div class="spinner"></div>${esc(label)}</div>`;
const heroImg = (id) => S.heroById[id]?.images?.icon_image_small_webp || '';
const myId = () => accountId(S.cfg.steamId);

function itemTile(id, small = false) {
  const it = S.items[id];
  if (!it) return '';
  const img = it.shop_image_webp || it.image_webp || it.image || '';
  const cost = it.cost ? `<span>${tr('{n} âmes', { n: num(it.cost) })}</span>` : '';
  return `<div class="item ${esc(it.item_slot_type || '')} ${small ? 'sm' : ''}">
    <img loading="lazy" src="${esc(img)}" alt="">
    ${it.item_tier ? `<span class="tier">${TIERS[it.item_tier] || it.item_tier}</span>` : ''}
    <div class="tip"><b>${esc(it.name)}</b>${cost}</div>
  </div>`;
}

const avatarHtml = (st, cls) =>
  st?.avatarfull
    ? `<img class="${cls}" loading="lazy" src="${esc(st.avatarfull)}" alt="">`
    : `<div class="${cls} avatar-ph">${esc((st?.personaname || '?')[0])}</div>`;

// ---------- data ----------
// Signed updates published on GitHub Releases: checked at launch and from Réglages.
// S.updateCheck = { state: 'checking' | 'uptodate' | 'available' | 'error', version, error, at }
async function checkUpdate() {
  S.updateCheck = { state: 'checking' };
  if (S.view === 'settings') render();
  try {
    const update = await T.updater.check();
    S.update = update || null;
    S.updateCheck = update ? { state: 'available', version: update.version, at: Date.now() } : { state: 'uptodate', at: Date.now() };
    if (update) {
      const bar = document.getElementById('update-bar');
      bar.innerHTML = `<span>${tr('Nouvelle version {v} disponible', { v: `<b>${esc(update.version)}</b>` })}</span>
        <button class="btn primary sm" data-action="do-update">${tr('Mettre à jour')}</button>
        <button class="btn ghost sm" data-action="skip-update">${tr('Plus tard')}</button>`;
      bar.hidden = false;
    }
  } catch (e) {
    console.warn('update', e); // offline, or no release published yet
    S.updateCheck = { state: 'error', error: String(e), at: Date.now() };
  }
  if (S.view === 'settings') render();
}

function updateStatusHtml() {
  const u = S.updateCheck;
  const at = u?.at ? ` <span class="muted">${tr('(vérifié à {time})', { time: new Date(u.at).toLocaleTimeString(LOCALE()) })}</span>` : '';
  if (!u || u.state === 'checking') return `<span class="muted">${tr('Vérification…')}</span>`;
  if (u.state === 'uptodate') return `<span class="win">${tr('✓ Tu as la dernière version')}</span>${at}`;
  if (u.state === 'available') {
    return `<span class="gold">${tr('Nouvelle version {v} disponible', { v: `<b>${esc(u.version)}</b>` })}</span>${at}
      <button class="btn primary sm" data-action="do-update">${tr('Mettre à jour')}</button>`;
  }
  return `<span class="loss">${tr('Impossible de vérifier (connexion ?)')}</span>${at}`;
}

async function installUpdate() {
  const bar = document.getElementById('update-bar');
  bar.innerHTML = `<span>${tr('Téléchargement de la mise à jour…')}</span><div class="spinner"></div>`;
  try {
    await S.update.downloadAndInstall();
    await T.process.relaunch(); // on Windows the installer usually closes and restarts the app itself
  } catch (e) {
    bar.innerHTML = `<span class="loss">${tr('Échec de la mise à jour : {e}', { e: esc(String(e)) })}</span>
      <button class="btn ghost sm" data-action="skip-update">${tr('Fermer')}</button>`;
  }
}

async function boot() {
  setTimeout(checkUpdate, 3000);
  T.app.getVersion().then((v) => (S.version = v)).catch(() => {});
  // tells the Rust side the page is alive (it restarts the app if WebView2 died)
  const beat = () => T.core.invoke('heartbeat').catch(() => {});
  beat();
  setInterval(beat, 5000);
  try {
    S.cfg = { ...S.cfg, ...JSON.parse(await T.core.invoke('load_config')) };
  } catch (e) {
    console.warn('config', e);
  }
  S.prevPatchSeen = S.cfg.patchSeen; // last patch read before this launch
  applyStaticTexts();
  render(true);

  const since = Math.floor(Date.now() / 1000) - 14 * 86400;
  // game texts (item names, hero descriptions, ranks) in the app's language
  const gameLang = LANG() === 'fr' ? 'french' : 'english';
  const [heroes, items, ranks, stats] = await Promise.allSettled([
    api(`/assets/heroes?only_active=true&language=${gameLang}`),
    api(`/assets/items?language=${gameLang}`),
    api(`/assets/ranks?language=${gameLang}`),
    api(`/analytics/hero-stats?min_unix_timestamp=${since}`),
  ]);
  if (heroes.status === 'fulfilled') {
    S.heroes = heroes.value.filter((h) => h.player_selectable && !h.disabled).sort((a, b) => a.name.localeCompare(b.name));
    S.heroById = Object.fromEntries(S.heroes.map((h) => [h.id, h]));
  }
  if (items.status === 'fulfilled') S.items = Object.fromEntries(items.value.map((i) => [i.id, i]));
  if (ranks.status === 'fulfilled') S.ranks = ranks.value;
  if (stats.status === 'fulfilled') {
    const agg = {};
    for (const s of stats.value) {
      const a = (agg[s.hero_id] ??= { wins: 0, matches: 0 });
      a.wins += s.wins;
      a.matches += s.matches;
    }
    const games = Object.values(agg).reduce((t, a) => t + a.matches, 0) / 12; // 12 heroes per match
    for (const [id, a] of Object.entries(agg)) S.heroStats[id] = { wr: pct(a.wins, a.matches), pick: pct(a.matches, games) };
  }
  if ([heroes, items].some((r) => r.status === 'rejected')) toast(tr("Impossible de joindre l'API Deadlock"));

  if (myId() != null) {
    loadProfile(myId());
    ingestSteamCache()
      .then((n) => n && toast(tr("{n} partie(s) envoyée(s) à l'API : elles apparaîtront d'ici quelques minutes", { n })))
      .catch((e) => console.warn('ingest', e));
  } else render();
  // live view: every minute, or every 20 s while waiting for the broadcast of a detected match
  setInterval(() => {
    if (S.view === 'live' && !S.live?.loading && (S.live?.pending || Date.now() - (S.live?.at || 0) > 55000)) loadLive();
  }, 20000);
  // profile banner "partie en cours"
  checkCurrentMatch();
  setInterval(checkCurrentMatch, 60000);
  // patch notes: checked at launch and every 30 min, so a new game update shows up by itself
  loadPatches();
  setInterval(loadPatches, 30 * 60000);
}

// Sends the Deadlock match ids + salts found in Steam's cache (matches opened in the in-game history),
// so the API can fetch those matches. Same data as deadlock-api's own ingest tool, without a username.
async function ingestSteamCache() {
  if (S.cfg.shareMatches !== true) return 0; // opt-in only (asked once, changeable in Réglages)
  const salts = (await T.core.invoke('scan_steam_cache').catch(() => [])) || [];
  const key = (s) => `${s.match_id}:${s.metadata_salt ?? ''}:${s.replay_salt ?? ''}`;
  let sent;
  try {
    sent = new Set(JSON.parse(localStorage.getItem('sentSalts') || '[]'));
  } catch {
    sent = new Set();
  }
  const fresh = salts.filter((s) => !sent.has(key(s)));
  for (let i = 0; i < fresh.length; i += 1000) {
    const r = await fetch(`${API}/matches/salts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fresh.slice(i, i + 1000)),
    });
    if (!r.ok) throw new Error(tr("Envoi refusé par l'API ({status})", { status: r.status }));
  }
  fresh.forEach((s) => sent.add(key(s)));
  try {
    localStorage.setItem('sentSalts', JSON.stringify([...sent].slice(-5000)));
  } catch {}
  return fresh.length;
}

async function syncAndRefresh() {
  checkCurrentMatch();
  try {
    const n = await ingestSteamCache();
    if (n) toast(tr("{n} partie(s) envoyée(s) à l'API : elles apparaîtront d'ici quelques minutes", { n }));
  } catch (e) {
    toast(e.message);
  }
  return loadProfile(myId(), true);
}

// The stored history lags behind; force_refetch asks Steam directly but is limited to 1/hour per IP.
async function freshHistory(id) {
  try {
    return await api(`/players/${id}/match-history?force_refetch=true`);
  } catch (e) {
    toast(tr('Mise à jour depuis Steam limitée à 1 fois par heure : historique en cache affiché'));
    return api(`/players/${id}/match-history`);
  }
}

async function loadProfile(id, force = false) {
  const cur = S.profiles[id];
  if (cur?.loading || (cur && !cur.err && !force)) return;
  S.profiles[id] = { ...cur, loading: true, err: null };
  render();
  const [steam, rank, hist, mates] = await Promise.allSettled([
    api(`/players/steam?account_ids=${id}`),
    api(`/players/${id}/rank`),
    force && id === myId() ? freshHistory(id) : api(`/players/${id}/match-history`),
    // not same_party: it needs a public Steam friends list, which many players hide.
    // 3+ shared matches already filters out random matchmaking teammates.
    api(`/players/${id}/mate-stats?min_matches_played=3`),
  ]);
  if (hist.status === 'rejected') {
    S.profiles[id] = { loading: false, err: hist.reason.message };
    return render();
  }
  const p = {
    loading: false,
    steam: steam.status === 'fulfilled' ? [].concat(steam.value)[0] : null,
    rank: rank.status === 'fulfilled' ? rank.value : null,
    matches: hist.value.sort((a, b) => b.start_time - a.start_time),
    mates: mates.status === 'fulfilled' ? mates.value.sort((a, b) => b.matches_played - a.matches_played).slice(0, 12) : [],
    matesErr: mates.status === 'rejected' ? mates.reason.message : null,
    names: {},
  };
  S.profiles[id] = p;
  render();
  if (p.mates.length) {
    try {
      const list = await api(`/players/steam?account_ids=${p.mates.map((m) => m.mate_id).join(',')}`);
      for (const s of [].concat(list)) p.names[s.account_id] = s;
      render();
    } catch (e) {
      console.warn('mate names', e);
    }
  }
}

async function loadMatch(id) {
  if (S.matchCache[id] && !S.matchCache[id].err) return;
  S.matchCache[id] = { loading: true };
  try {
    const md = await api(`/matches/${id}/metadata`);
    const entry = { loading: false, info: md.match_info, names: {} };
    S.matchCache[id] = entry;
    render();
    const ids = entry.info.players.map((p) => p.account_id).filter(Boolean);
    if (ids.length) {
      const list = await api(`/players/steam?account_ids=${ids.join(',')}`);
      for (const s of [].concat(list)) entry.names[s.account_id] = s;
    }
  } catch (e) {
    S.matchCache[id] = { loading: false, err: e.message };
  }
  render();
}

async function loadBuilds(id) {
  if (S.builds[id]) return;
  S.builds[id] = { loading: true };
  try {
    S.builds[id] = { list: await api(`/builds?hero_id=${id}&limit=20&sort_by=favorites&only_latest=true`) };
  } catch (e) {
    S.builds[id] = { error: e.message };
  }
  if (S.view === 'hero' && S.hero === id) render();
}

// ---------- views ----------
function render(animate = false) {
  let html = { profile: renderProfile, heroes: renderHeroes, hero: renderHero, match: renderMatch, stats: renderStats, live: renderLive, patch: renderPatch, settings: renderSettings }[S.view]();
  // ask once about sharing, on the user's own profile
  if (S.view === 'profile' && S.viewing == null && !S.editingId && myId() != null && S.cfg.shareMatches === undefined) {
    html = shareBanner() + html;
  }
  if (S.view === 'profile' && S.viewing == null && !S.editingId && S.currentMatch) {
    html = `<div class="card ornate live-banner"><span class="dot-live"></span>
      <div><b>${tr('Tu es en partie')}</b><small>${tr('Partie n° {id}', { id: `<span class="mono">${S.currentMatch}</span>` })}</small></div>
      <button class="btn primary sm" data-view="live">${tr('Voir les équipes')}</button></div>` + html;
  }
  view.innerHTML = `<div class="${animate ? 'fade' : ''}">${html}</div>`;
  if (animate) view.scrollTop = 0;
  document.querySelectorAll('.nav').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === S.view
      || (S.view === 'hero' && b.dataset.view === 'heroes')
      || (S.view === 'match' && b.dataset.view === 'profile')));
}

const DISCLAIMER = () => tr('Application de fan non officielle, non affiliée à Valve Corporation. Deadlock et ses visuels sont la propriété de Valve.');
const SHARE_TEXT = () => tr("Envoie à deadlock-api.com l'identifiant et le code d'accès des parties trouvées dans le cache de Steam sur ce PC (les parties que tu ouvres dans l'historique du jeu). Rien d'autre n'est envoyé : ni ton compte, ni ton pseudo. L'API récupère alors ces parties plus vite ; elles deviennent consultables publiquement comme toutes les parties de l'API.");

function shareBanner() {
  return `<div class="card ornate share-banner">
    <div><b>${tr('Partager tes parties avec deadlock-api.com ?')}</b><p>${SHARE_TEXT()}</p></div>
    <div class="share-actions"><button class="btn primary sm" data-action="share-yes">${tr('Partager')}</button>
      <button class="btn ghost sm" data-action="share-no">${tr('Non merci')}</button></div>
  </div>`;
}

function renderSettings() {
  const id = myId();
  const langSeg = [['fr', 'Français'], ['en', 'English']]
    .map(([k, l]) => `<button data-lang="${k}" class="${LANG() === k ? 'on' : ''}">${l}</button>`)
    .join('');
  return `<h1 class="page">${tr('Réglages')}</h1>
    <p class="sub">${tr("Langue, compte, partage de données et informations sur l'app.")}</p>
    <div class="section-title">${tr('Langue')}</div>
    <div class="card setting"><div class="seg">${langSeg}</div>
      <p class="muted">${tr('Les noms des objets et les descriptions des héros suivent aussi la langue choisie.')}</p></div>
    <div class="section-title">${tr('Partage des parties')}</div>
    <div class="card setting"><label class="toggle"><input type="checkbox" id="share-toggle" ${S.cfg.shareMatches === true ? 'checked' : ''}>
      ${tr('Partager mes parties avec deadlock-api.com')}</label><p class="muted">${SHARE_TEXT()}</p></div>
    <div class="section-title">${tr('Compte Steam')}</div>
    <div class="card setting"><div>${id != null ? tr('Compte connecté : {id}', { id: `<span class="mono">${id}</span>` }) : tr('Aucun compte connecté.')}</div>
      <button class="btn sm" data-action="settings-change-id">${tr('Changer de compte')}</button></div>
    <div class="section-title">${tr('Partie en direct')}</div>
    <div class="card setting"><p class="muted">${tr("Pour voir ta partie en cours, ajoute {opt} aux options de lancement de Deadlock (Steam → clic droit sur Deadlock → Propriétés → Options de lancement). L'app lit alors l'identifiant de la partie dans le journal du jeu, puis sa diffusion spectateur officielle. Elle n'affiche que ce que montre le tableau des scores et ne touche jamais au jeu.", { opt: '<b>-condebug</b>' })}</p></div>
    <div class="section-title">${tr('Version')}</div>
    <div class="card setting version-card">
      <div class="version-row"><span class="muted">${tr('Version installée')}</span><span class="version-num mono">${esc(S.version || '…')}</span></div>
      <div class="version-row">${updateStatusHtml()}</div>
      <button class="btn sm" data-action="check-update" ${S.updateCheck?.state === 'checking' ? 'disabled' : ''}>${tr('Vérifier les mises à jour')}</button>
    </div>
    <div class="section-title">${tr('À propos')}</div>
    <div class="card setting about"><p>${DISCLAIMER()}</p>
      <p class="muted">${tr('Données : {api} (API communautaire publique). Décodage des diffusions : {haste} de blukai (licence MIT). Images des héros et objets servies par deadlock-api.com.', { api: '<b>deadlock-api.com</b>', haste: '<b>Haste</b>' })}</p></div>`;
}

function onboarding() {
  return `<div class="card ornate onboard">
    <div class="crest"><svg viewBox="0 0 24 24"><path d="M12 1l11 11-11 11L1 12z"/><path d="M12 5.5l6.5 6.5-6.5 6.5L5.5 12z"/><path d="M12 9v6M9 12h6"/></svg></div>
    <h2>${tr('Connecte ton profil')}</h2>
    <p>${tr('Retrouve ton rang, tes stats, tes coéquipiers et ton historique de matchs Deadlock.')}</p>
    <form data-form="steam">
      <input class="input" name="sid" autofocus placeholder="${tr('Code ami Steam, SteamID64 ou lien de profil')}" value="${esc(S.cfg.steamId)}">
      <button class="btn primary">${tr('Charger')}</button>
    </form>
    <div class="hint">${tr('Code ami : Steam → Amis → Ajouter un ami. Ton profil Steam doit être public.')}</div>
    <div class="hint">${DISCLAIMER()}</div>
    ${S.editingId && myId() != null ? `<button class="btn ghost sm" style="margin-top:14px" data-action="cancel-id">${tr('Annuler')}</button>` : ''}
  </div>`;
}

function renderProfile() {
  const mine = myId();
  if ((mine == null && S.viewing == null) || S.editingId) return onboarding();
  const id = S.viewing ?? mine;
  const isMine = id === mine;
  const back = isMine ? '' : `<button class="back" data-action="back-profile">← ${S.stack.length ? tr('Retour') : tr('Mon profil')}</button>`;
  const p = S.profiles[id];
  if (!p || (p.loading && !p.matches)) return back + spinner(tr('Chargement du profil…'));
  if (p.err) {
    return `${back}<h1 class="page">${tr('Profil')}</h1><div class="error">${esc(p.err)}</div>
      <div style="margin-top:14px;display:flex;gap:8px"><button class="btn" data-action="refresh">${tr('Réessayer')}</button>
      ${isMine ? `<button class="btn ghost" data-action="change-id">${tr('Changer de compte')}</button>` : ''}</div>`;
  }

  const m = p.matches;
  const st = p.steam;
  const r = p.rank;
  const tier = r && r.rank > 0 ? S.ranks.find((t) => t.tier === r.rank) : null;
  const rankImg = tier ? tier.images?.[`large_subrank${r.subrank}_webp`] || tier.images?.large_webp : '';
  const rankHtml = tier
    ? `<div class="rank"><div><div class="rank-name">${esc(tier.name)} ${r.subrank || ''}</div><small>${tr('Rang actuel')}</small></div><img src="${esc(rankImg)}" alt=""></div>`
    : `<div class="rank"><div><div class="rank-name">${tr('Non classé')}</div><small>${tr('Pas de rang récent')}</small></div></div>`;

  // backdrop: art of the player's most played hero
  const counts = {};
  for (const x of m) if (x.game_mode === 1) counts[x.hero_id] = (counts[x.hero_id] || 0) + 1;
  const favId = Object.keys(counts).sort((x, y) => counts[y] - counts[x])[0];
  const favBg = S.heroById[favId]?.images?.background_image_webp;
  const head = `${back}<div class="card ornate profile-head">
    ${favBg ? `<img class="head-bg" src="${esc(favBg)}" alt="">` : ''}
    ${avatarHtml(st, 'avatar')}
    <div>
      <div class="profile-name">${esc(st?.personaname || tr('Joueur {id}', { id }))}</div>
      <div class="profile-meta"><span>${tr('{n} matchs enregistrés', { n: m.length })}</span>${st?.countrycode ? `<span>${esc(st.countrycode)}</span>` : ''}<span class="mono">ID ${id}</span></div>
    </div>
    ${rankHtml}
    <div class="head-actions">
      <button class="icon-btn" data-action="analyze" title="${tr('Analyser ses stats')}"><svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg></button>
      <button class="icon-btn" data-action="refresh" title="${tr('Actualiser')}"><svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg></button>
      ${isMine ? `<button class="icon-btn" data-action="change-id" title="${tr('Changer de compte')}"><svg viewBox="0 0 24 24"><path d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7"/></svg></button>` : ''}
    </div>
  </div>`;
  if (p.loading) return head + spinner(tr('Actualisation…'));
  if (!m.length) return head + `<div class="center">${tr('Aucun match trouvé. Le profil Steam est peut-être privé.')}</div>`;

  // stats on normal matches only: Street Brawl (game_mode 4) gives ~3x the souls/min and skews everything
  const nm = m.filter((x) => x.game_mode === 1);
  if (!nm.length) return head + `<div class="center">${tr('Aucune partie normale trouvée.')}</div>`;
  const n = nm.length;
  const wins = nm.filter(isWin).length;
  const sum = (f) => nm.reduce((t, x) => t + f(x), 0);
  const k = sum((x) => x.player_kills), d = sum((x) => x.player_deaths), a = sum((x) => x.player_assists);
  const spm = sum((x) => x.net_worth) / Math.max(1, sum((x) => x.match_duration_s) / 60);
  const recent = nm.slice(0, 20);
  const tiles = `<div class="tiles">
    <div class="card ornate tile"><div class="label">${tr('Matchs')}</div><div class="value">${n}</div></div>
    <div class="card ornate tile"><div class="label">Winrate</div><div class="value ${wrClass(pct(wins, n))}">${pct(wins, n).toFixed(1)}%</div><small class="muted">${tr('{w}V · {l}D', { w: wins, l: n - wins })}</small></div>
    <div class="card ornate tile"><div class="label">KDA</div><div class="value">${((k + a) / Math.max(1, d)).toFixed(2)}</div><small class="muted">${(k / n).toFixed(1)} / ${(d / n).toFixed(1)} / ${(a / n).toFixed(1)}</small></div>
    <div class="card ornate tile"><div class="label">${tr('Âmes / min')}</div><div class="value">${num(Math.round(spm))}</div></div>
    <div class="card ornate tile"><div class="label">${tr('Forme · {n} derniers', { n: recent.length })}</div>
      <div class="value">${pct(recent.filter(isWin).length, recent.length).toFixed(0)}%</div>
      <div class="form-dots">${recent.slice().reverse().map((x) => `<i class="${isWin(x) ? 'w' : ''}"></i>`).join('')}</div></div>
  </div>`;

  const per = {};
  for (const x of nm) {
    const e = (per[x.hero_id] ??= { g: 0, w: 0 });
    e.g++;
    e.w += isWin(x);
  }
  const top = Object.entries(per).sort((x, y) => y[1].g - x[1].g).slice(0, 8);
  const topHtml = `<div class="section-title">${tr('Héros les plus joués')}</div><div class="top-heroes">${top
    .map(([hid, e]) => {
      const wr = pct(e.w, e.g);
      return `<div class="card top-hero" data-hero="${hid}">
        <img loading="lazy" src="${esc(heroImg(hid))}" alt="">
        <div><div class="n">${esc(S.heroById[hid]?.name || `#${hid}`)}</div>
          <div class="s">${tr('{n} matchs', { n: e.g })} · <span class="${wrClass(wr)}">${wr.toFixed(0)}%</span></div>
          <div class="bar"><i style="width:${wr}%"></i></div></div>
      </div>`;
    })
    .join('')}</div>`;

  const mates = p.mates.length
    ? `<div class="top-heroes">${p.mates
        .map((mt) => {
          const s = p.names[mt.mate_id];
          const wr = pct(mt.wins, mt.matches_played);
          return `<div class="card top-hero" data-player="${mt.mate_id}" title="${tr('Voir le profil')}">
            ${avatarHtml(s, 'mate-av')}
            <div><div class="n">${esc(s?.personaname || tr('Joueur {id}', { id: mt.mate_id }))}</div>
              <div class="s">${tr('{n} matchs', { n: mt.matches_played })} · <span class="${wrClass(wr)}">${wr.toFixed(0)}%</span></div>
              <div class="bar"><i style="width:${wr}%"></i></div></div>
          </div>`;
        })
        .join('')}</div>`
    : `<div class="muted">${p.matesErr ? esc(p.matesErr) : tr('Aucun coéquipier régulier trouvé (au moins 3 matchs dans la même équipe).')}</div>`;

  const shown = m.slice(0, S.showAll ? 200 : 25);
  const rows = shown
    .map((x) => {
      const w = isWin(x);
      return `<div class="match ${w ? '' : 'l'}" data-match="${x.match_id}" title="${tr('Voir le détail')}">
        <img loading="lazy" src="${esc(heroImg(x.hero_id))}" alt="">
        <div><div class="hn">${esc(S.heroById[x.hero_id]?.name || `#${x.hero_id}`)}</div><small class="muted">${ago(x.start_time)}</small></div>
        <div class="res ${w ? 'win' : 'loss'}">${w ? tr('Victoire') : tr('Défaite')}${x.game_mode === 4 ? '<span class="mode-tag">Street Brawl</span>' : ''}</div>
        <div class="kda">${x.player_kills} / <b>${x.player_deaths}</b> / ${x.player_assists}</div>
        <div class="cell mono">${(x.net_worth / 1000).toFixed(1)}k<small>${tr('âmes')}</small></div>
        <div class="cell mono">${fmt(x.match_duration_s)}<small>${tr('durée')}</small></div>
        <div class="cell mono">${x.last_hits}<small>last hits</small></div>
        <div class="cell mono">${x.denies}<small>denies</small></div>
      </div>`;
    })
    .join('');
  const more = m.length > 25 ? `<button class="btn sm more" data-action="more">${S.showAll ? tr('Voir moins') : tr('Voir plus ({n})', { n: Math.min(200, m.length) })}</button>` : '';
  return head + tiles
    + `<div class="section-title">${tr('Joue le plus avec')}</div>${mates}`
    + topHtml
    + `<div class="section-title">${tr('Derniers matchs')}</div><div class="matches">${rows}</div>${more}`;
}

const TEAMS = ['Amber Hand', 'Sapphire Flame'];

// Teams seen from the reference player's side (allies first); the game's names when they're not in it.
function sides(ref) {
  const info = (t) => {
    if (ref == null) return { name: TEAMS[t] || tr('Équipe {n}', { n: t + 1 }), cls: `t${t}` };
    return t === ref ? { name: tr('Alliés'), cls: 'ally' } : { name: tr('Ennemis'), cls: 'enemy' };
  };
  return { order: ref === 1 ? [1, 0] : [0, 1], info };
}

function badgeHtml(badge) {
  // badge = tier * 10 + subrank
  const tier = S.ranks.find((t) => t.tier === Math.floor((badge || 0) / 10));
  if (!badge || !tier) return '';
  const sub = badge % 10;
  const img = tier.images?.[`large_subrank${sub}_webp`] || tier.images?.large_webp;
  return `<span class="badge"><img src="${esc(img)}" alt="">${esc(tier.name)} ${sub || ''}</span>`;
}

function renderMatch() {
  const back = `<button class="back" data-action="back-match">← ${tr('Retour au profil')}</button>`;
  const c = S.matchCache[S.match];
  if (!c || c.loading) return back + spinner(tr('Chargement de la partie…'));
  if (c.err) return `${back}<div class="error">${esc(c.err)}</div>`;
  const mi = c.info;
  const me = mi.players.find((p) => p.account_id === S.matchFor);
  const won = me ? me.team === mi.winning_team : null;
  const title = won == null ? tr('Partie {id}', { id: mi.match_id }) : won ? tr('Victoire') : tr('Défaite');
  const maxDmg = Math.max(1, ...mi.players.map((p) => p.stats?.at(-1)?.player_damage || 0));
  const sd = sides(me?.team ?? null);

  const team = (t) => {
    const players = mi.players.filter((p) => p.team === t).sort((a, b) => b.net_worth - a.net_worth);
    const k = players.reduce((s, p) => s + p.kills, 0);
    const souls = players.reduce((s, p) => s + p.net_worth, 0);
    const rows = players
      .map((p) => {
        const st = p.stats?.at(-1) || {};
        const s = c.names[p.account_id];
        const name = p.account_id ? s?.personaname || tr('Joueur {id}', { id: p.account_id }) : tr('Anonyme');
        // final build: shop items still owned at the end
        const items = (p.items || [])
          .filter((i) => !i.sold_time_s && S.items[i.item_id]?.type === 'upgrade')
          .map((i) => itemTile(i.item_id, true))
          .join('');
        return `<div class="mp ${p.account_id === S.matchFor ? 'me' : ''}">
          <img class="mp-hero" loading="lazy" src="${esc(heroImg(p.hero_id))}" alt="" title="${esc(S.heroById[p.hero_id]?.name || '')}">
          <div class="mp-name">${p.account_id
            ? `<button class="link" data-player="${p.account_id}">${esc(name)}</button>`
            : `<span class="muted">${name}</span>`}
            <small>${esc(S.heroById[p.hero_id]?.name || '')} · ${tr('niv. {n}', { n: p.level })}</small></div>
          <div class="kda">${p.kills} / <b>${p.deaths}</b> / ${p.assists}</div>
          <div class="cell mono">${(p.net_worth / 1000).toFixed(1)}k<small>${tr('âmes')}</small></div>
          <div class="cell mono">${((st.player_damage || 0) / 1000).toFixed(1)}k<small>${tr('dégâts')}</small>
            <div class="bar dmg"><i style="width:${pct(st.player_damage || 0, maxDmg)}%"></i></div></div>
          <div class="cell mono">${((st.player_healing || 0) / 1000).toFixed(1)}k<small>${tr('soins')}</small></div>
          <div class="cell mono">${p.last_hits}<small>LH / ${p.denies} den.</small></div>
          <div class="mp-items">${items}</div>
        </div>`;
      })
      .join('');
    const win = t === mi.winning_team;
    return `<div class="team ${sd.info(t).cls} ${win ? 'w' : 'l'}">
      <div class="team-head"><span class="team-name">${sd.info(t).name}</span>
        <span class="res ${win ? 'win' : 'loss'}">${win ? tr('Victoire') : tr('Défaite')}</span>
        <span class="muted mono">${k} kills · ${(souls / 1000).toFixed(1)}k ${tr('âmes')}</span>
        ${badgeHtml(mi[`average_badge_team${t}`])}</div>
      ${rows}</div>`;
  };

  return `${back}
    <div class="match-head card ornate ${won === false ? 'l' : won ? 'w' : ''}">
      ${me && S.heroById[me.hero_id]?.images?.background_image_webp
        ? `<img class="mh-bg" src="${esc(S.heroById[me.hero_id].images.background_image_webp)}" alt="">` : ''}
      <div><h1 class="page">${title}</h1>
        <div class="muted">${ago(mi.start_time)} · ${fmt(mi.duration_s)} · <span class="mono">#${mi.match_id}</span></div></div>
    </div>
    ${sd.order.map(team).join('')}`;
}

// ---------- live match ----------
// Own match: id from the game's console log (-condebug), players from Valve's spectator broadcast.
// Returns null while the broadcast can't be read (it only starts a little after the match begins).
async function liveFromBroadcast(mid) {
  // live/url asks the API to spectate the match, which is what makes Valve start the broadcast.
  // It is limited to 6 requests/hour per IP: ask once, then again every 10 min while there's no broadcast.
  const now = Date.now();
  if (S.liveUrl?.mid !== mid) S.liveUrl = { mid, since: now, asked: 0 };
  const L = S.liveUrl;
  try {
    if (!L.asked || ((!L.url || L.failing) && now - L.asked > 10 * 60000)) {
      L.asked = now;
      L.url = (await api(`/matches/${mid}/live/url`)).broadcast_url;
    }
    const broadcast_url = L.url;
    const sb = await T.core.invoke('live_players', { url: broadcast_url });
    const souls = [0, 1].map((t) => sb.players.filter((p) => p.team === t).reduce((s, p) => s + p.net_worth, 0));
    L.failing = false;
    return { match_id: mid, players: sb.players, duration_s: sb.game_time, net_worth_team_0: souls[0], net_worth_team_1: souls[1], scoreboard: true };
  } catch (e) {
    console.warn('broadcast', e);
    L.failing = true;
    return null;
  }
}

/** Current online match id from the game log (null if none); also drives the profile banner. */
async function checkCurrentMatch() {
  const mid = await T.core.invoke('current_match').catch(() => null);
  if (mid !== S.currentMatch) {
    S.currentMatch = mid;
    if (S.view === 'profile') render();
  }
  return mid;
}

async function loadLive() {
  const id = myId();
  if (id == null || S.live?.loading) return; // one search at a time (live/url quota)
  S.live = { ...S.live, loading: true, err: null };
  if (S.view === 'live') render();
  try {
    const mid = S.liveDemo ? null : await checkCurrentMatch();
    let match = mid ? await liveFromBroadcast(mid) : null;
    // no match in the game log: fall back to the API's "Watch" list (or the demo match)
    if (!mid) {
      const list = await api(S.liveDemo ? '/matches/active' : `/matches/active?account_id=${id}`);
      match = S.liveDemo ? [...list].sort((a, b) => b.spectators - a.spectators)[0] : list[0];
    }
    // match found in the log but its broadcast hasn't started yet: retried automatically
    const live = { match, pending: !match && mid ? mid : null, at: Date.now(), names: {}, ranks: {} };
    if (match) {
      const ids = match.players.map((p) => p.account_id).filter(Boolean).join(',');
      const [names, ranks] = await Promise.allSettled([api(`/players/steam?account_ids=${ids}`), api(`/players/rank?account_ids=${ids}`)]);
      if (names.status === 'fulfilled') for (const s of [].concat(names.value)) live.names[s.account_id] = s;
      if (ranks.status === 'fulfilled') for (const r of [].concat(ranks.value)) live.ranks[r.account_id] = r.badge;
    }
    S.live = live;
  } catch (e) {
    S.live = { err: e.message };
  }
  if (S.view === 'live') render();
}

function renderLive() {
  if (myId() == null) return onboarding();
  if (!S.live) loadLive();
  const L = S.live || { loading: true };
  const head = `<h1 class="page">${tr('En direct')}</h1>
    <p class="sub">${S.liveDemo ? tr('La partie la plus regardée en ce moment.') : tr('Ta partie en cours, avec les rangs de chaque joueur.')}</p>
    <div class="live-actions">
      <button class="btn sm" data-action="live-refresh">${tr('Actualiser')}</button>
      <button class="btn sm ghost" data-action="live-demo">${S.liveDemo ? `← ${tr('Revenir à ma partie')}` : tr('Voir une partie du top en direct')}</button>
      ${L.at ? `<span class="muted">${tr('Mis à jour à {time}', { time: new Date(L.at).toLocaleTimeString(LOCALE()) })} · ${L.pending ? tr('actualisation auto toutes les 20 s') : tr('actualisation auto toutes les minutes')}</span>` : ''}
    </div>`;
  if (L.loading && !L.match && !L.pending) return head + spinner(tr('Recherche de la partie…'));
  if (L.err) return head + `<div class="error">${esc(L.err)}</div>`;
  const m = L.match;
  if (!m && L.pending) {
    const waited = S.liveUrl?.mid === L.pending ? Date.now() - S.liveUrl.since : 0;
    const idHtml = `<span class="mono">${L.pending}</span>`;
    // after 3 min without a broadcast, say so plainly instead of "starting…" forever
    if (waited > 3 * 60000) {
      return head + `<div class="card ornate onboard live-empty">
        <h2>${tr('Diffusion indisponible')}</h2>
        <p>${tr("Partie n° {id} détectée, mais Valve ne diffuse pas cette partie en mode spectateur (ça arrive selon le type de partie ou la charge des serveurs), donc les équipes ne peuvent pas être affichées. L'app continue de réessayer en arrière-plan et redemande la diffusion toutes les 10 minutes.", { id: idHtml })}</p>
      </div>`;
    }
    return head + `<div class="card ornate onboard live-empty">
      <div class="spinner" style="margin:0 auto 18px"></div>
      <h2>${tr('Partie détectée')}</h2>
      <p>${tr('Partie n° {id}. La diffusion officielle démarre généralement une à deux minutes après le début (choix des héros, chargement). Nouvelle tentative automatique toutes les 20 secondes.', { id: idHtml })}</p>
    </div>`;
  }
  if (!m) {
    return head + `<div class="card ornate onboard live-empty">
      <h2>${tr('Aucune partie en cours trouvée')}</h2>
      <p>${tr("Pour voir ta partie, ajoute {opt} aux options de lancement de Deadlock (Steam → Propriétés) et rejoins la partie dès le début : l'app y lit l'identifiant de la partie puis sa diffusion spectateur officielle.", { opt: '<b>-condebug</b>' })}</p>
    </div>`;
  }
  const me = myId();
  const souls = [m.net_worth_team_0 || 0, m.net_worth_team_1 || 0];
  const total = Math.max(1, souls[0] + souls[1]);
  const sd = sides(m.players.find((p) => p.account_id === me)?.team ?? null);
  const team = (t) => {
    const rows = m.players
      .filter((p) => p.team === t)
      .map((p) => {
        const s = L.names[p.account_id];
        const name = s?.personaname || p.name || (p.account_id ? tr('Joueur {id}', { id: p.account_id }) : tr('Anonyme'));
        const stats = m.scoreboard
          ? `<div class="lp-stats mono"><span>${p.kills} / <b>${p.deaths}</b> / ${p.assists}</span><span>${(p.net_worth / 1000).toFixed(1)}k</span><span>${tr('niv. {n}', { n: p.level })}</span></div>`
          : '';
        return `<div class="lp ${p.account_id === me ? 'me' : ''}">
          <img class="h" src="${esc(heroImg(p.hero_id))}" alt="" title="${esc(S.heroById[p.hero_id]?.name || '')}">
          <div class="nm">${p.account_id ? `<button class="link" data-player="${p.account_id}">${esc(name)}</button>` : `<span class="muted">${esc(name)}</span>`}
            <small>${esc(S.heroById[p.hero_id]?.name || '')}</small></div>
          ${stats}
          ${badgeHtml(L.ranks[p.account_id]) || `<span class="badge">${tr('Non classé')}</span>`}
        </div>`;
      })
      .join('');
    return `<div class="team ${sd.info(t).cls}"><div class="team-head"><span class="team-name">${sd.info(t).name}</span>
      <span class="muted mono">${(souls[t] / 1000).toFixed(1)}k ${tr('âmes')}</span></div>${rows}</div>`;
  };
  return head + `<div class="card ornate live-head">
      <div><div class="label">${tr('Durée')}</div><div class="value mono">${fmt(m.duration_s || Math.max(0, Math.floor(L.at / 1000) - (m.start_time || 0)))}</div></div>
      ${m.scoreboard
        ? `<div><div class="label">${tr('Source')}</div><div class="value">${tr('Diffusion officielle')}</div></div><div></div>`
        : `<div><div class="label">${tr('Mode')}</div><div class="value">${esc(m.match_mode_parsed || '')}</div></div>
           <div><div class="label">${tr('Spectateurs')}</div><div class="value mono">${m.spectators ?? 0}</div></div>`}
      <div class="souls"><div class="label">${tr('Âmes par équipe')}</div>
        <div class="souls-bar">${sd.order.map((t) => `<i class="${sd.info(t).cls}" style="width:${pct(souls[t], total)}%"></i>`).join('')}</div>
        <div class="souls-num mono">${sd.order.map((t) => `<span>${sd.info(t).name} ${(souls[t] / 1000).toFixed(1)}k</span>`).join('')}</div></div>
    </div>
    <div class="live-teams">${sd.order.map(team).join('')}</div>`;
}

// ---------- analysis (you vs higher ranks) ----------
// Series colours validated for dark mode + colour blindness (dataviz validator): you = bronze, reference = blue.
const ME = '#b08637';
const REF = '#4a7cc4';
const TIER_CHOICES = [8, 9, 10, 11]; // Oracle, Phantom, Ascendant, Eternus
const PCTS = [1, 5, 10, 25, 50, 75, 90, 95, 99];
const METRICS = [
  { k: 'kda', label: 'KDA', d: 2, axis: 'Combat' },
  { k: 'kd', label: 'K/D', d: 2 },
  { k: 'kills_plus_assists', label: 'Kills + assists / match', d: 1 },
  { k: 'deaths', label: 'Morts / match', d: 1, low: true, axis: 'Survie' },
  { k: 'player_damage_per_min', label: 'Dégâts / min', d: 0, axis: 'Dégâts' },
  { k: 'accuracy', label: 'Précision', pct: true, axis: 'Précision' },
  { k: 'crit_shot_rate', label: 'Tirs critiques', pct: true },
  { k: 'net_worth_per_min', label: 'Âmes / min', d: 0, axis: 'Économie' },
  { k: 'last_hits', label: 'Last hits / match', d: 0 },
  { k: 'denies', label: 'Denies / match', d: 1 },
  { k: 'boss_damage_per_min', label: 'Dégâts objectifs / min', d: 0, axis: 'Objectifs' },
  { k: 'healing_per_min', label: 'Soins / min', d: 0 },
];
const fmtM = (m, v) => (m.pct ? `${(v * 100).toFixed(1)}%` : num(v, m.d));

/** Where value v sits (1-99) in a distribution given as API percentiles. */
function pctOf(dist, v) {
  const pts = PCTS.map((p) => [p, dist[`percentile${p}`]]);
  if (v <= pts[0][1]) return 1;
  if (v >= pts.at(-1)[1]) return 99;
  for (let i = 0; i < pts.length - 1; i++) {
    const [pa, a] = pts[i];
    const [pb, b] = pts[i + 1];
    if (v >= a && v <= b) return b === a ? (pa + pb) / 2 : pa + ((pb - pa) * (v - a)) / (b - a);
  }
  return 50;
}
console.assert(pctOf({ percentile1: 0, percentile5: 1, percentile10: 2, percentile25: 3, percentile50: 4, percentile75: 5, percentile90: 6, percentile95: 7, percentile99: 8 }, 4.5) === 62.5, 'pctOf');

function metricsUrl(id) {
  const day = Math.floor(Date.now() / 86400000) * 86400; // day-rounded so the url (cache key) is stable
  // the API defaults to the last 30 days, so "Tout" must send 0 explicitly
  const since = S.ana.period ? day - S.ana.period * 86400 : 0;
  const hero = S.ana.hero ? `&hero_ids=${S.ana.hero}` : '';
  if (id != null) return `/analytics/player-stats/metrics?account_ids=${id}&min_unix_timestamp=${since}${hero}`;
  // reference capped to 90 days: current patches, and keeps the query fast
  return `/analytics/player-stats/metrics?min_average_badge=${S.ana.tier * 10 + 1}&min_unix_timestamp=${since || day - 90 * 86400}${hero}`;
}

function useMetrics(url) {
  if (!S.metrics[url]) {
    S.metrics[url] = { loading: true };
    api(url)
      .then((data) => (S.metrics[url] = { data }))
      .catch((e) => (S.metrics[url] = { err: e.message }))
      .finally(() => S.view === 'stats' && render());
  }
  return S.metrics[url];
}

function radarSvg(axes, refName) {
  const C = 170, R = 112, n = axes.length;
  const pt = (i, r) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [C + Math.cos(a) * r, C + Math.sin(a) * r];
  };
  const poly = (f) => axes.map((_, i) => pt(i, f(i)).map((v) => v.toFixed(1)).join(',')).join(' ');
  const rings = [25, 50, 75, 100].map((s) => `<polygon points="${poly(() => (R * s) / 100)}" class="ring"/>`).join('');
  const spokes = axes.map((_, i) => `<line x1="${C}" y1="${C}" x2="${pt(i, R)[0]}" y2="${pt(i, R)[1]}" class="ring"/>`).join('');
  const labels = axes
    .map((a, i) => {
      const [x, y] = pt(i, R + 26);
      const anchor = Math.abs(x - C) < 8 ? 'middle' : x > C ? 'start' : 'end';
      return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="lbl">${esc(a.label)}</text>
        <text x="${x}" y="${y + 14}" text-anchor="${anchor}" class="val ${a.score >= 50 ? 'up' : 'down'}">${Math.round(a.score)} ${a.score >= 50 ? '▲' : '▼'}</text>`;
    })
    .join('');
  const dots = axes
    .map((a, i) => {
      const [x, y] = pt(i, (R * a.score) / 100);
      return `<circle cx="${x}" cy="${y}" r="4.5" fill="${ME}" stroke="#121814" stroke-width="2"><title>${esc(a.label)} : ${Math.round(a.score)} / 100</title></circle>`;
    })
    .join('');
  return `<svg class="radar" viewBox="-40 -6 420 356" role="img" aria-label="${tr('Profil comparé à {ref}', { ref: esc(refName) })}">
    ${rings}${spokes}
    <polygon points="${poly(() => R * 0.5)}" fill="${REF}" fill-opacity=".10"/>
    <polygon points="${poly((i) => (R * axes[i].score) / 100)}" fill="${ME}" fill-opacity=".22" stroke="${ME}" stroke-width="2" stroke-linejoin="round"/>
    <!-- reference outline drawn over your shape, so it stays visible where you are below it -->
    <polygon points="${poly(() => R * 0.5)}" fill="none" stroke="${REF}" stroke-width="2" stroke-dasharray="5 4"/>
    ${dots}${labels}
  </svg>`;
}

const TRENDS = {
  spm: { label: 'Âmes / min', f: (x) => x.net_worth / Math.max(1, x.match_duration_s / 60), ref: 'net_worth_per_min', d: 0 },
  kda: { label: 'KDA', f: (x) => (x.player_kills + x.player_assists) / Math.max(1, x.player_deaths), ref: 'kda', d: 2 },
  deaths: { label: 'Morts', f: (x) => x.player_deaths, ref: 'deaths', d: 1 },
};
const TW = 820, TH = 240, TL = 46, TR = 18, TT = 14, TB = 28; // trend chart geometry (viewBox units)

function trendSvg(matches, refVal, refName) {
  const t = TRENDS[S.ana.trend];
  const vals = matches.map(t.f);
  const roll = vals.map((_, i) => {
    const w = vals.slice(Math.max(0, i - 9), i + 1);
    return w.reduce((s, v) => s + v, 0) / w.length;
  });
  const max = Math.max(...vals, refVal ?? 0) * 1.12 || 1;
  const n = vals.length;
  const step = n > 1 ? (TW - TL - TR) / (n - 1) : 0;
  const X = (i) => TL + i * step;
  const Y = (v) => TT + (TH - TT - TB) * (1 - v / max);
  S.trendPts = matches.map((m, i) => ({ m, v: vals[i], r: roll[i], x: X(i), y: Y(roll[i]) }));

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const v = max * f;
      return `<line x1="${TL}" x2="${TW - TR}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/>
        <text x="${TL - 8}" y="${Y(v) + 4}" text-anchor="end" class="axis">${v.toLocaleString(LOCALE(), { maximumFractionDigits: t.d ? 1 : 0 })}</text>`;
    })
    .join('');
  const line = roll.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  const dots = vals.map((v, i) => `<circle cx="${X(i)}" cy="${Y(v)}" r="4" fill="${ME}" fill-opacity=".35"/>`).join('');
  const ref = refVal != null
    ? `<line x1="${TL}" x2="${TW - TR}" y1="${Y(refVal)}" y2="${Y(refVal)}" stroke="${REF}" stroke-width="2" stroke-dasharray="6 5"/>
       <text x="${TW - TR}" y="${Y(refVal) - 7}" text-anchor="end" class="ref-lbl">${esc(refName)} · ${refVal.toLocaleString(LOCALE(), { maximumFractionDigits: t.d })}</text>`
    : '';
  return `<svg class="trend-svg" viewBox="0 0 ${TW} ${TH}" role="img" aria-label="${tr('Évolution')} ${esc(tr(t.label))}">
    ${grid}${ref}${dots}
    <path d="${line}" fill="none" stroke="${ME}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    <line id="trend-x" class="crosshair" y1="${TT}" y2="${TH - TB}" x1="-10" x2="-10"/>
    <circle id="trend-dot" r="6" fill="${ME}" stroke="#121814" stroke-width="2" cx="-10" cy="-10"/>
    <text x="${TL}" y="${TH - 8}" class="axis">← ${tr('plus ancien')}</text>
    <text x="${TW - TR}" y="${TH - 8}" text-anchor="end" class="axis">${tr('plus récent')} →</text>
  </svg>`;
}

function renderStats() {
  const mine = myId();
  const id = S.anaFor ?? mine;
  if (id == null) return onboarding();
  const p = S.profiles[id];
  if (!p) loadProfile(id);
  const who = id === mine ? tr('Toi') : p?.steam?.personaname || tr('Joueur {id}', { id });
  const tier = S.ranks.find((t) => t.tier === S.ana.tier);
  const refName = `${tier?.name || tr('Haut rang')}+`;

  const tierSeg = TIER_CHOICES.map((t) => {
    const r = S.ranks.find((x) => x.tier === t);
    return `<button data-tier="${t}" class="${S.ana.tier === t ? 'on' : ''}">${r?.images?.small_webp || r?.images?.large_webp ? `<img src="${esc(r.images.small_webp || r.images.large_webp)}" alt="">` : ''}${esc(r?.name || t)}</button>`;
  }).join('');
  const periodSeg = [[30, tr('30 j')], [90, tr('90 j')], [0, tr('Tout')]].map(([v, l]) => `<button data-period="${v}" class="${S.ana.period === v ? 'on' : ''}">${l}</button>`).join('');
  const heroOpts = `<option value="0">${tr('Tous les héros')}</option>` + S.heroes.map((h) => `<option value="${h.id}" ${S.ana.hero === h.id ? 'selected' : ''}>${esc(h.name)}</option>`).join('');
  const back = id !== mine ? `<button class="back" data-action="back-stats">← ${tr('Retour au profil')}</button>` : '';
  const head = `${back}<h1 class="page">${tr('Analyse')}${id !== mine ? ` · ${esc(who)}` : ''}</h1>
    <p class="sub">${id === mine ? tr('Tes statistiques face à celles des joueurs {ref}.', { ref: esc(refName) }) : tr('Ses statistiques face à celles des joueurs {ref}.', { ref: esc(refName) })}</p>
    <div class="card ana-filters">
      <div class="f"><small>${tr('Comparer à')}</small><div class="seg">${tierSeg}</div></div>
      <div class="f"><small>${tr('Période')}</small><div class="seg">${periodSeg}</div></div>
      <div class="f"><small>${tr('Héros')}</small><select class="input" id="ana-hero">${heroOpts}</select></div>
    </div>`;

  const me = useMetrics(metricsUrl(id));
  const ref = useMetrics(metricsUrl(null));
  if (me.loading || ref.loading) return head + spinner(tr('Calcul des statistiques…'));
  if (me.err || ref.err) return head + `<div class="error">${esc(me.err || ref.err)}</div>`;
  const M = me.data || {};
  const B = ref.data || {};
  const avail = METRICS.filter((m) => Number.isFinite(M[m.k]?.avg) && Number.isFinite(B[m.k]?.percentile50));
  if (!avail.length) return head + `<div class="center">${tr('Pas assez de matchs sur cette période.')}</div>`;

  // everything is compared to the reference MEDIAN, like the radar (50 = median): its average can sit
  // on the other side of you (skewed stats like objective damage) and contradict the radar
  const scored = avail.map((m) => {
    const pc = pctOf(B[m.k], M[m.k].avg);
    const med = B[m.k].percentile50;
    const delta = pct(M[m.k].avg - med, med);
    return { ...m, label: tr(m.label), me: M[m.k].avg, ref: med, dist: B[m.k], score: m.low ? 100 - pc : pc, good: m.low ? delta <= 0 : delta >= 0, delta };
  });
  const axes = scored.filter((m) => m.axis).map((m) => ({ label: tr(m.axis), score: m.score }));
  const index = axes.reduce((s, a) => s + a.score, 0) / Math.max(1, axes.length);
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const row = (m) => `<div class="sw-row"><span>${esc(m.label)}</span><div class="bar"><i style="width:${m.score}%"></i></div><b class="mono">${Math.round(m.score)}</b></div>`;

  const top = `<div class="ana-top">
    <div class="card ornate radar-card">
      <div class="legend"><span><i class="sw" style="background:${ME}"></i>${esc(who)}</span><span><i class="sw dash" style="border-color:${REF}"></i>${tr('Médiane {ref}', { ref: esc(refName) })}</span></div>
      ${radarSvg(axes, refName)}
    </div>
    <div class="card ornate summary">
      <div class="idx-row">
        <div><div class="label">${tr('Indice de performance')}</div><div class="index mono">${Math.round(index)}</div>
          <div class="muted idx-note">${id === mine
            ? tr("50 = joueur médian {ref}. Au-dessus, tu fais mieux que la plupart d'entre eux.", { ref: esc(refName) })
            : tr("50 = joueur médian {ref}. Au-dessus, il/elle fait mieux que la plupart d'entre eux.", { ref: esc(refName) })}</div></div>
        ${tier?.images?.large_webp ? `<img class="idx-badge" src="${esc(tier.images.large_webp)}" alt="">` : ''}
      </div>
      <div class="sw-title win">▲ ${tr('Points forts')}</div>${sorted.slice(0, 3).map(row).join('')}
      <div class="sw-title loss">▼ ${tr('À travailler')}</div>${sorted.slice(-3).reverse().map(row).join('')}
    </div>
  </div>`;

  const cards = scored
    .map((m) => {
      const lo = Math.min(m.dist.percentile5, m.me), hi = Math.max(m.dist.percentile95, m.me);
      const pos = (v) => (hi > lo ? (100 * (v - lo)) / (hi - lo) : 50);
      return `<div class="card metric">
        <div class="m-head"><span class="m-label">${esc(m.label)}</span>
          <span class="delta ${m.good ? 'good' : 'bad'}">${m.good ? '▲' : '▼'} ${m.delta > 0 ? '+' : ''}${m.delta.toFixed(0)}%</span></div>
        <div class="m-vals"><span class="m-me"><i class="sw" style="background:${ME}"></i>${fmtM(m, m.me)}</span>
          <span class="m-ref"><i class="sw dash" style="border-color:${REF}"></i>${esc(refName)} ${fmtM(m, m.ref)}</span></div>
        <div class="strip" title="${tr('Distribution {ref} : 5 % = {p5}, médiane = {p50}, 95 % = {p95}', { ref: esc(refName), p5: fmtM(m, m.dist.percentile5), p50: fmtM(m, m.dist.percentile50), p95: fmtM(m, m.dist.percentile95) })}">
          <span class="range" style="left:${pos(m.dist.percentile5)}%;right:${100 - pos(m.dist.percentile95)}%"></span>
          <span class="iqr" style="left:${pos(m.dist.percentile25)}%;right:${100 - pos(m.dist.percentile75)}%"></span>
          <span class="med" style="left:${pos(m.dist.percentile50)}%"></span>
          <span class="mine" style="left:${pos(m.me)}%" title="${esc(who)} : ${fmtM(m, m.me)}"></span>
        </div>
        <div class="strip-scale"><span>${fmtM(m, lo)}</span><span>${m.low ? tr('moins = mieux') : ''}</span><span>${fmtM(m, hi)}</span></div>
      </div>`;
    })
    .join('');

  // trend from match history, same filters
  let trend = spinner(tr('Chargement de l’historique…'));
  if (p?.matches) {
    const day = Math.floor(Date.now() / 1000);
    const list = p.matches
      // game_mode 1 = normal; the API metrics also exclude Street Brawl (mode 4), whose souls/min are ~3x higher
      .filter((x) => x.game_mode === 1 && (!S.ana.hero || x.hero_id === S.ana.hero) && (!S.ana.period || x.start_time >= day - S.ana.period * 86400))
      .slice(0, 40)
      .reverse();
    const t = TRENDS[S.ana.trend];
    const seg = Object.entries(TRENDS).map(([k, v]) => `<button data-trend="${k}" class="${S.ana.trend === k ? 'on' : ''}">${tr(v.label)}</button>`).join('');
    trend = `<div class="card ornate trend-card">
      <div class="trend-head"><div class="seg">${seg}</div>
        <div class="legend"><span><i class="sw" style="background:${ME}"></i>${esc(who)} · ${tr('moyenne sur 10 matchs')}</span>
          <span><i class="dot" style="background:${ME}"></i>${tr('un match')}</span>
          <span><i class="sw dash" style="border-color:${REF}"></i>${tr('Médiane {ref}', { ref: esc(refName) })}</span></div></div>
      ${list.length > 1
        ? `<div class="trend-plot">${trendSvg(list, B[t.ref]?.percentile50, refName)}<div id="trend-tip" hidden></div></div>`
        : `<div class="center">${tr('Pas assez de matchs pour tracer une évolution.')}</div>`}
    </div>`;
  }

  return head + top
    + `<div class="section-title">${tr('Détail par statistique')}</div><div class="metric-grid">${cards}</div>`
    + `<div class="section-title">${tr('Évolution')} · ${tr(TRENDS[S.ana.trend].label)}</div>${trend}`
    + `<p class="foot-note">${tr('Moyennes par match. Les joueurs {ref} sont ceux des matchs dont le rang moyen est {ref}, sur {days} jours max. Données deadlock-api.com.', { ref: esc(refName), days: S.ana.period || 90 })}</p>`;
}

// one checkbox per role present in the hero list, with its hero count
function roleFilter() {
  const counts = {};
  for (const h of S.heroes) counts[h.hero_type || ''] = (counts[h.hero_type || ''] || 0) + 1;
  return Object.keys(counts)
    .sort((a, b) => roleName(a).localeCompare(roleName(b)))
    .map((t) => `<label class="role-chip ${S.hiddenRoles.has(t) ? '' : 'on'}">
      <input type="checkbox" data-role="${esc(t)}" ${S.hiddenRoles.has(t) ? '' : 'checked'}>
      ${esc(roleName(t))} <span class="mono">${counts[t]}</span></label>`)
    .join('');
}

function heroGrid() {
  const q = S.search.trim().toLowerCase();
  const stat = (h) => S.heroStats[h.id] || { wr: 0, pick: 0 };
  const list = S.heroes.filter((h) => h.name.toLowerCase().includes(q) && !S.hiddenRoles.has(h.hero_type || ''));
  if (S.sort === 'wr') list.sort((a, b) => stat(b).wr - stat(a).wr);
  if (S.sort === 'pick') list.sort((a, b) => stat(b).pick - stat(a).pick);
  if (!list.length) return `<div class="muted">${tr('Aucun héros trouvé.')}</div>`;
  return list
    .map((h) => {
      const s = S.heroStats[h.id];
      return `<div class="hero-card" data-hero="${h.id}">
        <img loading="lazy" src="${esc(h.images?.icon_hero_card_webp || h.images?.icon_hero_card)}" alt="">
        <div class="shade"></div>
        ${h.hero_type ? `<span class="type-tag">${esc(roleName(h.hero_type))}</span>` : ''}
        <div class="info"><div class="name">${esc(h.name)}</div>
          ${s ? `<div class="stats"><span class="${wrClass(s.wr)}">${s.wr.toFixed(1)}% WR</span><span>${s.pick.toFixed(1)}% pick</span></div>` : ''}
        </div>
      </div>`;
    })
    .join('');
}

function renderHeroes() {
  if (!S.heroes.length) return spinner(tr('Chargement des héros…'));
  const seg = [['name', tr('Nom')], ['wr', 'Winrate'], ['pick', tr('Popularité')]]
    .map(([k, l]) => `<button data-sort="${k}" class="${S.sort === k ? 'on' : ''}">${l}</button>`)
    .join('');
  return `<h1 class="page">${tr('Héros')}</h1>
    <p class="sub">${tr('Winrate et taux de pick sur les 14 derniers jours, tous rangs confondus.')}</p>
    <div class="toolbar"><input class="input" id="search" placeholder="${tr('Rechercher un héros…')}" value="${esc(S.search)}"><div class="seg">${seg}</div></div>
    <div class="role-filter">${roleFilter()}</div>
    <div class="hero-grid" id="grid">${heroGrid()}</div>`;
}

function renderHero() {
  const h = S.heroById[S.hero];
  if (!h) return spinner();
  const s = S.heroStats[h.id];
  const img = h.images || {};
  const banner = `<button class="back" data-action="back">← ${tr('Tous les héros')}</button>
    <div class="hero-banner">
      ${img.background_image_webp ? `<img class="bg" src="${esc(img.background_image_webp)}" alt="">` : ''}
      <img class="portrait" src="${esc(img.icon_hero_card_webp)}" alt="" style="-webkit-mask-image:linear-gradient(90deg,transparent,#000 35%)">
      <div class="content">
        <div class="nametxt">${esc(h.name)}</div>
        ${h.description?.role ? `<div class="role">${esc(strip(h.description.role))}</div>` : ''}
        ${h.description?.playstyle ? `<div class="play">${esc(strip(h.description.playstyle))}</div>` : ''}
        <div class="chips">
          ${s ? `<span class="chip ${wrClass(s.wr)}">${s.wr.toFixed(1)}% WR</span><span class="chip">${s.pick.toFixed(1)}% pick</span>` : ''}
          ${h.hero_type ? `<span class="chip">${esc(roleName(h.hero_type))}</span>` : ''}
          ${h.gun_tag ? `<span class="chip">${esc(h.gun_tag)}</span>` : ''}
        </div>
      </div>
    </div>`;
  const tabs = `<div class="tabs">${[['builds', 'Builds'], ['popular', tr('Objets populaires')]]
    .map(([k, l]) => `<button data-tab="${k}" class="${S.heroTab === k ? 'on' : ''}">${l}</button>`)
    .join('')}</div>`;

  let body = '';
  if (S.heroTab === 'builds') {
    loadBuilds(h.id);
    const b = S.builds[h.id];
    if (!b || b.loading) body = spinner(tr('Chargement des builds…'));
    else if (b.error) body = `<div class="error">${esc(b.error)}</div>`;
    else if (!b.list.length) body = `<div class="center">${tr('Aucun build publié pour ce héros.')}</div>`;
    else {
      const idx = Math.min(S.buildIdx, b.list.length - 1);
      const list = b.list
        .map((w, i) => `<button class="build-item ${i === idx ? 'on' : ''}" data-build="${i}">
          <div class="t">${esc(w.hero_build.name || tr('Sans nom'))}</div>
          <div class="m"><span>★ ${num(w.num_favorites || 0)}</span><span>${w.hero_build.last_updated_timestamp ? ago(w.hero_build.last_updated_timestamp) : ''}</span></div>
        </button>`)
        .join('');
      const hb = b.list[idx].hero_build;
      const cats = (hb.details?.mod_categories || [])
        .filter((c) => c.mods?.length)
        .map((c) => `<div class="cat"><div class="cat-name">${esc(catName(c.name))}</div>
          <div class="items">${c.mods.map((md) => itemTile(md.ability_id)).join('')}</div></div>`)
        .join('');
      body = `<div class="builds"><div class="build-list">${list}</div>
        <div class="card ornate build-view"><h3>${esc(hb.name || tr('Sans nom'))}</h3>
          ${hb.description ? `<div class="desc">${esc(strip(hb.description))}</div>` : ''}
          ${cats || `<div class="muted" style="margin-top:14px">${tr('Ce build ne contient aucun objet.')}</div>`}
        </div></div>`;
    }
  } else {
    const pop = h.popular_items || {};
    const phase = (key, label) => {
      const rows = (pop[key] || [])
        .slice()
        .sort((a, b) => b.pick_pct - a.pick_pct)
        .slice(0, 8)
        .filter((x) => S.items[x.item_id])
        .map((x) => `<div class="pop-row">${itemTile(x.item_id)}<div class="nm">${esc(S.items[x.item_id].name)}</div>
          <div class="pct">${x.pick_pct.toFixed(0)}%<small>pick</small></div>
          <div class="pct ${wrClass(x.winrate_pct)}">${x.winrate_pct.toFixed(1)}%<small>winrate</small></div></div>`)
        .join('');
      return `<div class="card ornate phase"><h4>${label}</h4>${rows || `<div class="muted">${tr('Pas de données')}</div>`}</div>`;
    };
    body = `<div class="phases">${phase('early_game', tr('Début de partie'))}${phase('mid_game', tr('Milieu de partie'))}${phase('late_game', tr('Fin de partie'))}</div>`;
  }
  return banner + tabs + body;
}

// ---------- patch notes ----------
// Valve's Steam announcements: the patch notes are tagged "patchnotes", big patches are "... Update".
const isPatch = (n) => (n.tags || []).includes('patchnotes') || /update/i.test(n.title || '');

/** Steam BBCode -> HTML. Everything is escaped first, then only known tags become HTML. */
function bbcode(src) {
  const img = (u) => (/^https:\/\/[\w.-]+\.steamstatic\.com\/[\w./-]+$/.test(u) ? `<img loading="lazy" src="${u}" alt="">` : '');
  const TAGS = { p: 'p', b: 'strong', i: 'em', u: 'u', h1: 'h3', h2: 'h3', h3: 'h4', list: 'ul', olist: 'ol' };
  const BLOCK = '(?:p|h3|h4|ul|ol|li|hr)';
  return esc(src)
    .replace(/\{STEAM_CLAN_(?:LOC_)?IMAGE\}/g, 'https://clan.akamai.steamstatic.com/images')
    .replace(/\[img(?: src=&quot;([^\]]*?)&quot;)?\]([^[]*)\[\/img\]/gi, (_, a, b) => img((a || b).trim()))
    .replace(/\[(\/?)(p|b|i|u|h1|h2|h3|list|olist)\]/gi, (_, c, t) => `<${c}${TAGS[t.toLowerCase()]}>`)
    .replace(/\[\*\]/g, '<li>')
    .replace(/\[hr\](?:\[\/hr\])?/gi, '<hr>')
    .replace(/\[br\]/gi, '<br>')
    .replace(/\[\/?(?:url|quote|code|spoiler|strike|noparse|table|tr|td|th|expand|previewyoutube|video)(?:=[^\]]*)?\]/gi, '')
    .replace(/\n/g, '<br>')
    .replace(new RegExp(`(<\\/?${BLOCK}>)(?:<br>)+`, 'g'), '$1')
    .replace(new RegExp(`(?:<br>)+(<\\/?${BLOCK}>)`, 'g'), '$1');
}
console.assert(
  bbcode('[h3][b]Hi[/b][/h3][p]- a <x>\n- b[/p]\n[img]{STEAM_CLAN_IMAGE}/1/a.png[/img][img]javascript:x[/img]')
    === '<h4><strong>Hi</strong></h4><p>- a &lt;x&gt;<br>- b</p><img loading="lazy" src="https://clan.akamai.steamstatic.com/images/1/a.png" alt="">',
  'bbcode',
);

async function loadPatches() {
  if (S.patches?.loading) return;
  S.patches = { ...S.patches, loading: true, err: null };
  try {
    const r = await T.core.invoke('patch_notes');
    const list = (r?.appnews?.newsitems || []).filter(isPatch);
    S.patches = { list };
    const latest = list[0];
    if (latest && latest.gid !== S.cfg.patchSeen && S.view !== 'patch') {
      document.getElementById('patch-dot').hidden = false;
      if (S.cfg.patchSeen) toast(tr('Nouveau patch : {title}', { title: latest.title }));
    }
  } catch (e) {
    S.patches = { ...S.patches, loading: false, err: String(e) }; // keeps the last list if a refresh fails
    setTimeout(loadPatches, 2 * 60000); // offline at launch, etc.: don't wait 30 min
  }
  if (S.view === 'patch') render();
}

function renderPatch() {
  const P = S.patches || { loading: true };
  const head = `<h1 class="page">${tr('Notes de patch')}</h1>
    <p class="sub">${tr('Le dernier patch du jeu et les précédents. Vérifiés automatiquement toutes les 30 minutes.')}</p>`;
  if (!P.list) return head + (P.err ? `<div class="error">${tr('Impossible de charger les notes de patch : {e}', { e: esc(P.err) })}</div>` : spinner(tr('Chargement des notes de patch…')));
  if (!P.list.length) return head + `<div class="center">${tr('Aucune note de patch trouvée.')}</div>`;
  // opened: the latest patch is now seen
  document.getElementById('patch-dot').hidden = true;
  if (S.cfg.patchSeen !== P.list[0].gid) {
    S.cfg.patchSeen = P.list[0].gid;
    saveConfig();
  }
  // patches released since the last visit before this launch are tagged "Nouveau"
  const seenDate = P.list.find((x) => x.gid === S.prevPatchSeen)?.date;
  const day = (n, month) => new Date(n.date * 1000).toLocaleDateString(LOCALE(), { day: 'numeric', month, year: 'numeric' });
  const idx = Math.min(S.patchIdx || 0, P.list.length - 1);
  const list = P.list
    .map((x, i) => `<button class="build-item ${i === idx ? 'on' : ''}" data-patch="${i}">
      <div class="t">${esc(x.title)}</div>
      <div class="m"><span>${day(x, 'short')}</span>${i === 0 ? `<span class="gold">${tr('Dernier patch')}</span>` : ''}${seenDate && x.date > seenDate ? `<span class="win">${tr('Nouveau')}</span>` : ''}</div>
    </button>`)
    .join('');
  const n = P.list[idx];
  return head + `<div class="builds"><div class="build-list patch-list">${list}</div>
    <div class="card ornate">
      <div class="patch-head"><h2>${esc(n.title)}</h2>
        <span class="muted">${tr('Publié le {date}', { date: day(n, 'long') })} · ${ago(n.date)} · ${tr('notes officielles de Valve (en anglais)')}</span></div>
      <div class="patch-body">${bbcode(n.contents)}</div>
    </div></div>`;
}

// ---------- events ----------
function openHero(id) {
  S.hero = Number(id);
  S.view = 'hero';
  S.buildIdx = 0;
  render(true);
}

function openPlayer(id) {
  id = Number(id);
  const current = S.viewing ?? myId();
  if (current != null && current !== id) S.stack.push(current);
  S.viewing = id === myId() ? null : id;
  S.view = 'profile';
  S.showAll = false;
  render(true);
  loadProfile(id);
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-win],[data-view],[data-hero],[data-player],[data-match],[data-sort],[data-tab],[data-build],[data-patch],[data-tier],[data-period],[data-trend],[data-lang],[data-action]');
  if (!t) return;
  const d = t.dataset;
  if (d.win) return T.window.getCurrentWindow()[d.win]();
  if (d.view) {
    S.view = d.view;
    if (d.view === 'profile') {
      S.viewing = null;
      S.stack = [];
    }
    if (d.view === 'stats') S.anaFor = null;
    return render(true);
  }
  if (d.lang) {
    if (d.lang === LANG()) return;
    S.cfg.lang = d.lang;
    // reload (once saved) so every text, number format and the game data (item names...) switch language
    return T.core.invoke('save_config', { data: JSON.stringify(S.cfg) }).finally(() => location.reload());
  }
  if (d.tier || d.period || d.trend) {
    if (d.tier) S.ana.tier = Number(d.tier);
    if (d.period) S.ana.period = Number(d.period);
    if (d.trend) S.ana.trend = d.trend;
    return render();
  }
  if (d.hero) return openHero(d.hero);
  if (d.player) return openPlayer(d.player);
  if (d.match) {
    S.match = Number(d.match);
    S.matchFor = S.viewing ?? myId();
    S.view = 'match';
    render(true);
    return loadMatch(S.match);
  }
  if (d.sort) {
    S.sort = d.sort;
    return render();
  }
  if (d.tab) {
    S.heroTab = d.tab;
    return render();
  }
  if (d.build) {
    S.buildIdx = Number(d.build);
    return render();
  }
  if (d.patch) {
    S.patchIdx = Number(d.patch);
    render();
    view.scrollTop = 0;
    return;
  }
  switch (d.action) {
    case 'refresh': return S.viewing == null ? syncAndRefresh() : loadProfile(S.viewing, true);
    case 'change-id': S.editingId = true; return render();
    case 'do-update': return installUpdate();
    case 'check-update': return checkUpdate();
    case 'skip-update': document.getElementById('update-bar').hidden = true; return;
    case 'settings-change-id': S.view = 'profile'; S.viewing = null; S.editingId = true; return render(true);
    case 'share-yes':
    case 'share-no':
      S.cfg.shareMatches = d.action === 'share-yes';
      saveConfig();
      render();
      return S.cfg.shareMatches && syncAndRefresh();
    case 'cancel-id': S.editingId = false; return render();
    case 'more': S.showAll = !S.showAll; return render();
    case 'back': S.view = 'heroes'; return render(true);
    case 'back-match': S.view = 'profile'; return render(true);
    case 'back-stats': S.view = 'profile'; return render(true);
    case 'live-refresh': return loadLive();
    case 'live-demo': S.liveDemo = !S.liveDemo; S.live = null; return loadLive();
    case 'analyze': {
      const id = S.viewing ?? myId();
      S.anaFor = id === myId() ? null : id;
      S.view = 'stats';
      return render(true);
    }
    case 'back-profile': {
      const prev = S.stack.pop();
      S.viewing = prev == null || prev === myId() ? null : prev;
      S.showAll = false;
      return render(true);
    }
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.dataset.form !== 'steam') return;
  e.preventDefault();
  const v = e.target.sid.value.trim();
  const id = accountId(v);
  if (id == null) return toast(tr('Steam ID invalide'));
  S.cfg.steamId = v;
  S.editingId = false;
  S.viewing = null;
  S.stack = [];
  saveConfig();
  loadProfile(id, true);
});

document.addEventListener('change', (e) => {
  if (e.target.dataset?.role !== undefined) {
    const role = e.target.dataset.role;
    if (e.target.checked) S.hiddenRoles.delete(role);
    else S.hiddenRoles.add(role);
    e.target.closest('.role-chip').classList.toggle('on', e.target.checked);
    document.getElementById('grid').innerHTML = heroGrid();
    return;
  }
  if (e.target.id === 'share-toggle') {
    S.cfg.shareMatches = e.target.checked;
    saveConfig();
    if (S.cfg.shareMatches) syncAndRefresh();
    return;
  }
  if (e.target.id !== 'ana-hero') return;
  S.ana.hero = Number(e.target.value);
  render();
});

// trend chart hover: crosshair + tooltip on the nearest match
document.addEventListener('mousemove', (e) => {
  const plot = e.target.closest?.('.trend-plot');
  const tip = document.getElementById('trend-tip');
  if (!tip) return;
  if (!plot || !S.trendPts.length) {
    tip.hidden = true;
    return;
  }
  const r = plot.getBoundingClientRect();
  const vx = ((e.clientX - r.left) / r.width) * TW;
  const p = S.trendPts.reduce((best, q) => (Math.abs(q.x - vx) < Math.abs(best.x - vx) ? q : best));
  const t = TRENDS[S.ana.trend];
  const x = plot.querySelector('#trend-x');
  x.setAttribute('x1', p.x);
  x.setAttribute('x2', p.x);
  const dot = plot.querySelector('#trend-dot');
  dot.setAttribute('cx', p.x);
  dot.setAttribute('cy', p.y);
  const w = isWin(p.m);
  tip.innerHTML = `<b>${esc(S.heroById[p.m.hero_id]?.name || '')}</b> <span class="${w ? 'win' : 'loss'}">${w ? tr('Victoire') : tr('Défaite')}</span>
    <div class="muted">${ago(p.m.start_time)}</div>
    <div>${esc(tr(t.label))} : <b class="mono">${p.v.toLocaleString(LOCALE(), { maximumFractionDigits: t.d })}</b></div>
    <div class="muted">${tr('Moyenne 10 matchs : {v}', { v: `<span class="mono">${p.r.toLocaleString(LOCALE(), { maximumFractionDigits: t.d })}</span>` })}</div>`;
  tip.hidden = false;
  const px = (p.x / TW) * r.width;
  tip.style.left = `${Math.min(r.width - 200, Math.max(0, px + 14))}px`;
  tip.style.top = '8px';
});

document.addEventListener('input', (e) => {
  if (e.target.id !== 'search') return;
  S.search = e.target.value;
  document.getElementById('grid').innerHTML = heroGrid();
});

boot();
