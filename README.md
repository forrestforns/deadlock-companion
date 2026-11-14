# Deadlock Companion

Compagnon **non officiel** pour [Deadlock](https://store.steampowered.com/app/1422450/Deadlock/) sur Windows :
statistiques, historique détaillé des parties, builds, analyse face aux meilleurs rangs et partie en direct.

> Application de fan non officielle, **non affiliée à Valve Corporation**. Deadlock et ses visuels sont la propriété de Valve.
> Les données viennent de l'API communautaire [deadlock-api.com](https://deadlock-api.com) (utilisation validée par son équipe).

## Fonctionnalités

- **Profil** : rang, winrate, KDA, âmes/min, forme récente, héros les plus joués, joueurs avec qui tu joues le plus.
- **Historique** : chaque partie est cliquable — les 12 joueurs, leurs pseudos, stats et objets.
- **Profils des autres joueurs** : mêmes données pour tes amis et adversaires.
- **Analyse** : radar et comparaison de tes stats avec les joueurs Oracle, Phantom, Ascendant ou Eternus.
- **Héros** : winrate et popularité, builds de la communauté, objets les plus achetés.
- **En direct** : ta partie en cours avec les deux équipes et le rang de chaque joueur.
- Mises à jour automatiques et signées.

## Installation

Télécharge `Deadlock Companion_x.y.z_x64-setup.exe` dans les [Releases](https://github.com/forrestforns/deadlock-companion/releases/latest) et lance-le.
L'application n'est pas encore signée : Windows peut afficher « Éditeur inconnu » → *Informations complémentaires* → *Exécuter quand même*.

### Partie en direct

Ajoute `-condebug` aux options de lancement de Deadlock (Steam → clic droit sur Deadlock → Propriétés → Options de lancement)
et rejoins la partie dès le début. L'app lit l'identifiant de la partie dans le journal du jeu (`console.log`),
puis la diffusion spectateur officielle de Valve. Elle n'affiche que ce que montre le tableau des scores.

## Anti-triche

L'application **ne touche jamais au jeu** : pas de lecture mémoire, pas d'injection, pas d'automatisation.
Elle lit uniquement l'API publique, le journal texte du jeu (`console.log`) et, si tu l'acceptes, le cache HTTP de Steam.
Seul Valve peut garantir officiellement l'absence de risque.

## Données et vie privée

- Ton identifiant Steam est enregistré uniquement sur ton PC (`%APPDATA%\app.deadlock-companion`).
- **Partage des parties (facultatif, désactivé par défaut)** : si tu l'actives dans *Réglages*, l'app envoie à deadlock-api.com
  l'identifiant et le code des parties trouvées dans le cache de Steam, pour qu'elles apparaissent plus vite. Rien d'autre.
- Aucune police ni ressource n'est chargée depuis Google ; aucune télémétrie.

## Compiler

Prérequis : [Rust](https://rustup.rs), [protoc](https://github.com/protocolbuffers/protobuf/releases)
(dans `tools/protoc/bin/protoc.exe` ou via la variable `PROTOC`), et `cargo install tauri-cli --version "^2"`.

```
cargo tauri build
```

## Publier une nouvelle version

1. Change le numéro de version dans `Cargo.toml` et `tauri.conf.json`.
2. Fais un commit et envoie-le sur `main` (Push origin).
3. GitHub Actions voit la nouvelle version, compile, signe et publie la release (étiquette comprise) ;
   les utilisateurs reçoivent la mise à jour au lancement suivant. Une version déjà publiée est ignorée.

## Crédits

- Données : [deadlock-api.com](https://deadlock-api.com)
- Décodage des diffusions : [Haste](https://github.com/blukai/haste) (MIT), version corrigée dans `vendor/` (voir `vendor/README.txt`)
- Polices : Cinzel, Inter, JetBrains Mono (SIL Open Font License, voir `ui/fonts`)

## Licence

[MIT](LICENSE)
