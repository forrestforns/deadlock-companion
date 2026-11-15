# Deadlock Companion

Compagnon **non officiel** pour [Deadlock](https://store.steampowered.com/app/1422450/Deadlock/) sur Windows :
statistiques, historique détaillé des parties, analyse face aux meilleurs rangs, amis et comparaisons, partie en direct,
méta des héros, classement et notes de patch. En **français** et en **anglais**.

> Application de fan non officielle, **non affiliée à Valve Corporation**. Deadlock et ses visuels sont la propriété de Valve.
> Les données viennent de l'API communautaire [deadlock-api.com](https://deadlock-api.com) (utilisation validée par son équipe).

## Fonctionnalités

- **Profil** : rang, winrate, KDA, âmes/min, forme récente, héros les plus joués, joueurs avec qui tu joues le plus,
  et courbe d'**évolution du rang** sur les parties classées.
- **Historique** : chaque partie est cliquable — les 12 joueurs, leurs pseudos, stats et objets.
- **Profils des autres joueurs** : mêmes données pour n'importe quel joueur.
- **Amis** : ta liste d'amis avec leur rang, ajout par code ami, depuis un profil ou parmi tes coéquipiers réguliers.
- **Comparaison** : toi contre un ami, côte à côte — matchs, record de kills, plus longue série, indice de performance,
  attributs, puis le détail catégorie par catégorie (combat, survie, dégâts, précision, économie, objectifs).
- **Analyse** : radar et comparaison de tes stats avec les joueurs Oracle, Phantom, Ascendant ou Eternus
  (note de 0 à 100 = ta position parmi eux, la médiane du rang valant 50).
- **Héros** : winrate et popularité **par rang**, builds de la communauté, objets populaires,
  **matchups** (fort contre / faible contre) et **tes stats** sur chaque héros.
- **En direct** : ta partie en cours, les deux équipes, le rang de chaque joueur et un **repérage** :
  nombre de parties et winrate de chaque joueur sur son héros, et sa forme récente.
- **Classement** : les meilleurs joueurs par région, au total ou par héros.
- **Notes de patch** : le dernier patch officiel et les précédents, vérifiés toutes les 30 minutes ;
  les patchs sortis depuis ta dernière visite sont marqués « Nouveau ».
- **Windows** : icône dans la zone de notification, lancement au démarrage (facultatif),
  notification quand un patch sort.
- Mises à jour automatiques et signées.

## Installation

### ⬇️ [Télécharger Deadlock Companion pour Windows](https://github.com/forrestforns/deadlock-companion/releases/latest/download/DeadlockCompanion-setup.exe)

1. Clique sur le lien ci-dessus : il télécharge directement l'installateur (`DeadlockCompanion-setup.exe`, environ 2 Mo).
   *Les archives « Source code » de la page Releases contiennent le code source, pas l'application.*
2. Lance le fichier. Si Windows affiche « Windows a protégé votre ordinateur » : **Informations complémentaires** → **Exécuter quand même**
   (l'app n'est pas encore signée par un certificat Windows). Ne télécharge l'app **que depuis ce dépôt**.
3. L'app s'installe et s'ouvre ; elle est ensuite dans le menu Démarrer et se met à jour toute seule.

**Fermer la fenêtre** garde l'app dans la zone de notification, à côté de l'horloge (réglable dans *Réglages → Windows*).
Pour la quitter complètement : clic droit sur son icône → **Quitter**.

### Partie en direct

Ajoute `-condebug` aux options de lancement de Deadlock (Steam → clic droit sur Deadlock → Propriétés → Options de lancement)
et rejoins la partie dès le début. L'app lit l'identifiant de la partie dans le journal du jeu (`console.log`),
puis la diffusion spectateur officielle de Valve. Elle n'affiche que ce que montre le tableau des scores.

## Anti-triche

L'application **ne touche jamais au jeu** : pas de lecture mémoire, pas d'injection, pas d'automatisation, pas d'overlay en jeu.
Elle lit uniquement l'API publique, le journal texte du jeu (`console.log`) et, si tu l'acceptes, le cache HTTP de Steam.
Elle n'affiche jamais d'information cachée (positions, sorts, objets ennemis en direct).
Seul Valve peut garantir officiellement l'absence de risque.

## Données et vie privée

- Ton identifiant Steam, ta liste d'amis et tes réglages sont enregistrés uniquement sur ton PC (`%APPDATA%\app.deadlock-companion`).
- **Partage des parties (facultatif, désactivé par défaut)** : si tu l'actives dans *Réglages*, l'app envoie à deadlock-api.com
  l'identifiant et le code des parties trouvées dans le cache de Steam, pour qu'elles apparaissent plus vite. Rien d'autre.
- Les notes de patch viennent de l'API publique des actualités Steam.
- Aucune police ni ressource n'est chargée depuis Google ; aucune télémétrie.

## Sécurité

- Les mises à jour sont **signées** : l'app refuse toute mise à jour qui ne vient pas de ce dépôt.
- La fenêtre n'affiche que l'app elle-même (pas de navigation vers d'autres sites, pas de script externe),
  et tout texte venu de l'API est neutralisé avant affichage.
- La partie en direct ne lit que les serveurs de diffusion de Valve.
- Une faille ? Ouvre une *issue* sur ce dépôt (sans détails exploitables) ou contacte l'auteur.

## Compiler

Prérequis : [Rust](https://rustup.rs), [protoc](https://github.com/protocolbuffers/protobuf/releases)
(dans `tools/protoc/bin/protoc.exe` ou via la variable `PROTOC`), et Node.js pour la CLI Tauri.

```
npx @tauri-apps/cli@2.12.4 build
```

Tests : `cargo test`.

## Publier une nouvelle version

1. Change le numéro de version dans `Cargo.toml` et `tauri.conf.json`.
2. Fais un commit et envoie-le sur `main` (Push origin).
3. GitHub Actions voit la nouvelle version, compile, signe et publie la release (étiquette comprise) ;
   les utilisateurs reçoivent la mise à jour au lancement suivant. Une version déjà publiée est ignorée.
   La clé de signature n'est donnée qu'à l'étape qui signe, et les actions utilisées sont figées sur une version précise.

## Crédits

- Données : [deadlock-api.com](https://deadlock-api.com), actualités Steam pour les notes de patch
- Décodage des diffusions : [Haste](https://github.com/blukai/haste) (MIT), version corrigée dans `vendor/` (voir `vendor/README.txt`)
- Polices : Cinzel, Inter, JetBrains Mono (SIL Open Font License, voir `ui/fonts`)

## Licence

[MIT](LICENSE)
