# Éverlune

Exploration paisible en monde ouvert, à la première personne, en vraie 3D « texel splatting » (pixel art en 3D).
Site 100 % statique : Three.js (r170, inclus dans `vendor/`) + shaders GLSL maison, sans backend ni étape de build.

## Lancer en local

```sh
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

Il faut passer par un serveur : les modules ES ne se chargent pas en `file://`.

## Déployer sur GitHub Pages

Settings → Pages → *Deploy from a branch* → `main` / `(root)`. Le fichier `.nojekyll` est déjà présent.
Sur iPhone : ouvrir l'URL dans Safari → Partager → *Sur l'écran d'accueil* pour jouer en plein écran.

## Contrôles

| | Ordinateur | iPhone |
|---|---|---|
| Marcher | WASD / ZQSD (position physique) / flèches | pouce gauche (joystick) |
| Regarder | souris (clic pour capturer) | glisser à droite |
| Courir | Maj | bouton 🏃 |
| Menu | Échap / M | bouton ☰ |

## Architecture

```
src/
  main.js              boucle, état, sauvegarde
  config.js            constantes, préréglages de qualité, localStorage
  noise.js             simplex seedé, fbm, RNG déterministe
  render/texel.js      ★ système de matériaux texel-splatting (terrain, objets, herbe, eau)
  render/sky.js        ciel, nuages pixelisés, cycle jour/nuit
  render/shadows.js    ombre solaire (passe de profondeur, alignée sur sa grille)
  render/fireflies.js  lucioles nocturnes
  world/worldgen.js    relief, rivières, chemins, humidité, forêts (fonctions pures de la graine)
  world/terrain.js     maillages terrain (2 niveaux de détail + jupes), eau, brins d'herbe
  world/vegetation.js  arbres, buissons, rochers, fleurs, champignons
  world/structures.js  lieux à découvrir : arches, ruines, cercles de pierres, cabanes, monolithes, kiosques
  world/chunks.js      streaming des chunks de 32 m autour du joueur
  player/player.js     déplacement FPS, pentes, marches, collisions
  player/input.js      clavier/souris + joystick tactile
  ui/ui.js             écran titre, menu, notifications
  audio/audio.js       paysage sonore 100 % procédural (Web Audio)
```

### Le son

Aucun fichier audio : tout est synthétisé en direct avec la Web Audio API.
Vent (plus fort en altitude, étouffé en forêt et à l'intérieur), bruissement des feuilles, ruisseaux et vagues
spatialisés selon la direction de l'eau, pas selon le sol (herbe, feuilles, terre, sable, pierre, bois, eau),
oiseaux le jour (chœur du matin), grillons, grenouilles et chouette la nuit, réverbération, et une musique
générative très douce. Volume et musique réglables dans le menu. Sur iOS 17+, le son joue même en mode silencieux.

### Le rendu texel

Chaque fragment est ramené sur une grille de texels fixée dans le monde (8 texels/m pour le sol, 4/m pour la roche,
sur le plan qui fait face à la normale). La normale, les poids de matériaux et l'ombre sont réévalués **au centre du texel**
(via les dérivées écran), si bien que chaque texel reçoit une seule couleur et une seule valeur de lumière.
Les frontières herbe/terre/sable/roche sont tirées par texel avec du bruit, ce qui donne des bords pixelisés irréguliers.
Au loin, quand un texel devient plus petit qu'un pixel, le motif se fond vers la couleur moyenne pour éviter le scintillement.

Aucune texture image : tout est généré, de façon déterministe, à partir de la graine du monde.
