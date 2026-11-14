// Translations. The French text is the key: tr('Victoire') returns it as is in French, and its
// English entry below in English. {name} placeholders are filled from tr()'s second argument.
// A text missing from EN falls back to French and is recorded in window.__missingTr.

/** 'fr' or 'en': the language chosen in Réglages, else the system language. */
function LANG() {
  const chosen = typeof S !== 'undefined' ? S.cfg.lang : null;
  if (chosen === 'fr' || chosen === 'en') return chosen;
  return (navigator.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

const LOCALE = () => (LANG() === 'fr' ? 'fr-FR' : 'en-US');

/** Number formatted for the current language (1 064 / 1,064), with d decimals. */
const num = (n, d = 0) => Number(n).toLocaleString(LOCALE(), { minimumFractionDigits: d, maximumFractionDigits: d });

window.__missingTr = new Set();

function tr(fr, vars) {
  let s = fr;
  if (LANG() === 'en') {
    if (EN[fr] !== undefined) s = EN[fr];
    else window.__missingTr.add(fr);
  }
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m)) : s;
}

/** Fixed texts of index.html (side menu, window buttons). */
function applyStaticTexts() {
  document.documentElement.lang = LANG();
  document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = tr(el.dataset.i18n)));
  document.querySelectorAll('[data-i18n-title]').forEach((el) => (el.title = tr(el.dataset.i18nTitle)));
}

const EN = {
  // dates, numbers, generic
  'il y a {n} min': '{n} min ago',
  'il y a {n} h': '{n} h ago',
  'il y a {n} j': '{n} d ago',
  'il y a {n} mois': '{n} mo ago',
  '{n} âmes': '{n} souls',
  'âmes': 'souls',
  'Chargement…': 'Loading…',
  'Actualisation…': 'Refreshing…',
  'Actualiser': 'Refresh',
  'Annuler': 'Cancel',
  'Fermer': 'Close',
  'Réduire': 'Minimize',
  'Agrandir': 'Maximize',
  'Retour': 'Back',
  'Réessayer': 'Retry',
  'Sans nom': 'Untitled',
  'Pas de données': 'No data',
  'Anonyme': 'Anonymous',
  'Joueur {id}': 'Player {id}',
  'Toi': 'You',
  'Victoire': 'Victory',
  'Défaite': 'Defeat',
  'niv. {n}': 'lvl {n}',
  'durée': 'duration',
  'Durée': 'Duration',
  'dégâts': 'damage',
  'soins': 'healing',
  'Trop de requêtes, réessaie dans un moment': 'Too many requests, try again in a moment',
  'Erreur API ({status})': 'API error ({status})',
  "Impossible de joindre l'API Deadlock": 'Could not reach the Deadlock API',
  'Sauvegarde impossible : {e}': 'Could not save: {e}',
  'Steam ID invalide': 'Invalid Steam ID',

  // side menu, footer
  'Profil': 'Profile',
  'En direct': 'Live',
  'Analyse': 'Analysis',
  'Héros': 'Heroes',
  'Réglages': 'Settings',
  'Données publiques': 'Public data',
  'Non officiel · non affilié à Valve': 'Unofficial · not affiliated with Valve',

  // roles, game phases
  'Tireur': 'Marksman',
  'Mystique': 'Mystic',
  'Bagarreur': 'Brawler',
  'Assassin': 'Assassin',
  'Autre': 'Other',
  'Début de partie': 'Early game',
  'Milieu de partie': 'Mid game',
  'Fin de partie': 'Late game',

  // updates
  'Nouvelle version {v} disponible': 'New version {v} available',
  'Mettre à jour': 'Update',
  'Plus tard': 'Later',
  '(vérifié à {time})': '(checked at {time})',
  'Vérification…': 'Checking…',
  '✓ Tu as la dernière version': '✓ You have the latest version',
  'Impossible de vérifier (connexion ?)': 'Could not check (connection?)',
  'Téléchargement de la mise à jour…': 'Downloading the update…',
  'Échec de la mise à jour : {e}': 'Update failed: {e}',

  // match sharing
  "{n} partie(s) envoyée(s) à l'API : elles apparaîtront d'ici quelques minutes": '{n} match(es) sent to the API: they will show up in a few minutes',
  "Envoi refusé par l'API ({status})": 'Upload refused by the API ({status})',
  'Mise à jour depuis Steam limitée à 1 fois par heure : historique en cache affiché': 'Refreshing from Steam is limited to once per hour: showing the cached history',
  'Partager tes parties avec deadlock-api.com ?': 'Share your matches with deadlock-api.com?',
  'Partager': 'Share',
  'Non merci': 'No thanks',
  "Envoie à deadlock-api.com l'identifiant et le code d'accès des parties trouvées dans le cache de Steam sur ce PC (les parties que tu ouvres dans l'historique du jeu). Rien d'autre n'est envoyé : ni ton compte, ni ton pseudo. L'API récupère alors ces parties plus vite ; elles deviennent consultables publiquement comme toutes les parties de l'API.":
    "Sends deadlock-api.com the ID and access code of the matches found in Steam's cache on this PC (the matches you open in the in-game history). Nothing else is sent: not your account, not your name. The API then gets those matches faster; they become publicly viewable like every other match on the API.",

  // settings
  "Langue, compte, partage de données et informations sur l'app.": 'Language, account, data sharing and app information.',
  'Langue': 'Language',
  'Les noms des objets et les descriptions des héros suivent aussi la langue choisie.': 'Item names and hero descriptions also follow the chosen language.',
  'Partage des parties': 'Match sharing',
  'Partager mes parties avec deadlock-api.com': 'Share my matches with deadlock-api.com',
  'Compte Steam': 'Steam account',
  'Compte connecté : {id}': 'Connected account: {id}',
  'Aucun compte connecté.': 'No account connected.',
  'Changer de compte': 'Change account',
  'Partie en direct': 'Live match',
  "Pour voir ta partie en cours, ajoute {opt} aux options de lancement de Deadlock (Steam → clic droit sur Deadlock → Propriétés → Options de lancement). L'app lit alors l'identifiant de la partie dans le journal du jeu, puis sa diffusion spectateur officielle. Elle n'affiche que ce que montre le tableau des scores et ne touche jamais au jeu.":
    "To see your current match, add {opt} to Deadlock's launch options (Steam → right-click Deadlock → Properties → Launch options). The app then reads the match ID from the game's log, then its official spectator broadcast. It only shows what the scoreboard shows and never touches the game.",
  'Version': 'Version',
  'Version installée': 'Installed version',
  'Vérifier les mises à jour': 'Check for updates',
  'À propos': 'About',
  'Application de fan non officielle, non affiliée à Valve Corporation. Deadlock et ses visuels sont la propriété de Valve.':
    'Unofficial fan-made app, not affiliated with Valve Corporation. Deadlock and its artwork are the property of Valve.',
  'Données : {api} (API communautaire publique). Décodage des diffusions : {haste} de blukai (licence MIT). Images des héros et objets servies par deadlock-api.com.':
    'Data: {api} (public community API). Broadcast decoding: {haste} by blukai (MIT license). Hero and item images served by deadlock-api.com.',

  // login
  'Connecte ton profil': 'Connect your profile',
  'Retrouve ton rang, tes stats, tes coéquipiers et ton historique de matchs Deadlock.': 'See your rank, stats, teammates and Deadlock match history.',
  'Code ami Steam, SteamID64 ou lien de profil': 'Steam friend code, SteamID64 or profile link',
  'Charger': 'Load',
  'Code ami : Steam → Amis → Ajouter un ami. Ton profil Steam doit être public.': 'Friend code: Steam → Friends → Add a friend. Your Steam profile must be public.',

  // profile
  'Tu es en partie': "You're in a match",
  'Partie n° {id}': 'Match #{id}',
  'Voir les équipes': 'See the teams',
  'Mon profil': 'My profile',
  'Chargement du profil…': 'Loading profile…',
  'Rang actuel': 'Current rank',
  'Non classé': 'Unranked',
  'Pas de rang récent': 'No recent rank',
  '{n} matchs enregistrés': '{n} recorded matches',
  'Analyser ses stats': 'Analyze stats',
  'Aucun match trouvé. Le profil Steam est peut-être privé.': 'No matches found. The Steam profile may be private.',
  'Aucune partie normale trouvée.': 'No normal matches found.',
  'Matchs': 'Matches',
  '{w}V · {l}D': '{w}W · {l}L',
  'Âmes / min': 'Souls / min',
  'Forme · {n} derniers': 'Form · last {n}',
  'Héros les plus joués': 'Most played heroes',
  '{n} matchs': '{n} matches',
  'Voir le profil': 'View profile',
  'Aucun coéquipier régulier trouvé (au moins 3 matchs dans la même équipe).': 'No regular teammates found (at least 3 matches on the same team).',
  'Voir le détail': 'See details',
  'Voir moins': 'Show less',
  'Voir plus ({n})': 'Show more ({n})',
  'Joue le plus avec': 'Plays most with',
  'Derniers matchs': 'Recent matches',

  // match detail
  'Équipe {n}': 'Team {n}',
  'Alliés': 'Allies',
  'Ennemis': 'Enemies',
  'Retour au profil': 'Back to profile',
  'Chargement de la partie…': 'Loading match…',
  'Partie {id}': 'Match {id}',

  // live
  'La partie la plus regardée en ce moment.': 'The most watched match right now.',
  'Ta partie en cours, avec les rangs de chaque joueur.': "Your current match, with every player's rank.",
  'Revenir à ma partie': 'Back to my match',
  'Voir une partie du top en direct': 'Watch a top match live',
  'Mis à jour à {time}': 'Updated at {time}',
  'actualisation auto toutes les 20 s': 'auto-refresh every 20 s',
  'actualisation auto toutes les minutes': 'auto-refresh every minute',
  'Recherche de la partie…': 'Looking for the match…',
  'Diffusion indisponible': 'Broadcast unavailable',
  "Partie n° {id} détectée, mais Valve ne diffuse pas cette partie en mode spectateur (ça arrive selon le type de partie ou la charge des serveurs), donc les équipes ne peuvent pas être affichées. L'app continue de réessayer en arrière-plan et redemande la diffusion toutes les 10 minutes.":
    "Match #{id} detected, but Valve isn't broadcasting it in spectator mode (this depends on the match type or server load), so the teams can't be shown. The app keeps retrying in the background and requests the broadcast again every 10 minutes.",
  'Partie détectée': 'Match detected',
  'Partie n° {id}. La diffusion officielle démarre généralement une à deux minutes après le début (choix des héros, chargement). Nouvelle tentative automatique toutes les 20 secondes.':
    'Match #{id}. The official broadcast usually starts one to two minutes after the beginning (hero selection, loading). Retrying automatically every 20 seconds.',
  'Aucune partie en cours trouvée': 'No current match found',
  "Pour voir ta partie, ajoute {opt} aux options de lancement de Deadlock (Steam → Propriétés) et rejoins la partie dès le début : l'app y lit l'identifiant de la partie puis sa diffusion spectateur officielle.":
    "To see your match, add {opt} to Deadlock's launch options (Steam → Properties) and join the match from the start: the app reads the match ID there, then its official spectator broadcast.",
  'Source': 'Source',
  'Diffusion officielle': 'Official broadcast',
  'Mode': 'Mode',
  'Spectateurs': 'Spectators',
  'Âmes par équipe': 'Souls per team',

  // analysis
  'KDA': 'KDA',
  'K/D': 'K/D',
  'Kills + assists / match': 'Kills + assists / match',
  'Morts / match': 'Deaths / match',
  'Morts': 'Deaths',
  'Dégâts / min': 'Damage / min',
  'Précision': 'Accuracy',
  'Tirs critiques': 'Crit shots',
  'Last hits / match': 'Last hits / match',
  'Denies / match': 'Denies / match',
  'Dégâts objectifs / min': 'Objective damage / min',
  'Soins / min': 'Healing / min',
  'Combat': 'Combat',
  'Survie': 'Survival',
  'Dégâts': 'Damage',
  'Économie': 'Economy',
  'Objectifs': 'Objectives',
  'Profil comparé à {ref}': 'Profile compared to {ref}',
  'Évolution': 'Trend',
  'plus ancien': 'older',
  'plus récent': 'newer',
  'Haut rang': 'High rank',
  '30 j': '30 d',
  '90 j': '90 d',
  'Tout': 'All',
  'Tous les héros': 'All heroes',
  'Tes statistiques face à celles des joueurs {ref}.': 'Your stats compared to {ref} players.',
  'Ses statistiques face à celles des joueurs {ref}.': 'Their stats compared to {ref} players.',
  'Comparer à': 'Compare to',
  'Période': 'Period',
  'Calcul des statistiques…': 'Computing stats…',
  'Pas assez de matchs sur cette période.': 'Not enough matches in this period.',
  'Médiane {ref}': '{ref} median',
  'Indice de performance': 'Performance index',
  "50 = joueur médian {ref}. Au-dessus, tu fais mieux que la plupart d'entre eux.": '50 = median {ref} player. Above that, you do better than most of them.',
  "50 = joueur médian {ref}. Au-dessus, il/elle fait mieux que la plupart d'entre eux.": '50 = median {ref} player. Above that, they do better than most of them.',
  'Points forts': 'Strengths',
  'À travailler': 'To work on',
  'Distribution {ref} : 5 % = {p5}, médiane = {p50}, 95 % = {p95}': '{ref} distribution: 5% = {p5}, median = {p50}, 95% = {p95}',
  'moins = mieux': 'lower = better',
  'Chargement de l’historique…': 'Loading history…',
  'moyenne sur 10 matchs': '10-match average',
  'un match': 'one match',
  'Moyenne {ref}': '{ref} average',
  'Pas assez de matchs pour tracer une évolution.': 'Not enough matches to draw a trend.',
  'Détail par statistique': 'Stat breakdown',
  'Moyennes par match. Les joueurs {ref} sont ceux des matchs dont le rang moyen est {ref}, sur {days} jours max. Données deadlock-api.com.':
    'Per-match averages. {ref} players are those from matches whose average rank is {ref}, over {days} days max. Data from deadlock-api.com.',
  'Moyenne 10 matchs : {v}': '10-match average: {v}',

  // heroes
  'Aucun héros trouvé.': 'No heroes found.',
  'Chargement des héros…': 'Loading heroes…',
  'Nom': 'Name',
  'Popularité': 'Popularity',
  'Winrate et taux de pick sur les 14 derniers jours, tous rangs confondus.': 'Win rate and pick rate over the last 14 days, all ranks combined.',
  'Rechercher un héros…': 'Search for a hero…',
  'Tous les héros': 'All heroes',
  'Objets populaires': 'Popular items',
  'Chargement des builds…': 'Loading builds…',
  'Aucun build publié pour ce héros.': 'No published builds for this hero.',
  'Ce build ne contient aucun objet.': 'This build has no items.',

  // patch notes
  'Patchs': 'Patches',
  'Notes de patch': 'Patch notes',
  'Dernière mise à jour du jeu. Vérifiée automatiquement toutes les 30 minutes.': "The game's latest update. Checked automatically every 30 minutes.",
  'Impossible de charger les notes de patch : {e}': 'Could not load the patch notes: {e}',
  'Chargement des notes de patch…': 'Loading patch notes…',
  'Aucune note de patch trouvée.': 'No patch notes found.',
  'Publié le {date}': 'Published {date}',
  'notes officielles de Valve (en anglais)': "Valve's official notes",
  'Nouveau patch : {title}': 'New patch: {title}',
};
