# cof2-compagnon

Module compagnon pour le système **Chroniques Oubliées 2** qui ajoute le profil **Psionique** et la gestion des **Points d'Ego (PE)** sans modifier le système.

## Activation

Tout est conditionné au réglage monde **« Autoriser psionique et points d'ego »** (décoché par défaut). Tant qu'il est décoché, rien de psionique n'apparaît ni n'est traité.

Le bloc Points d'Ego d'un personnage n'est visible que si ce réglage est coché **et** que le personnage connaît au moins un pouvoir psionique.

## Concept

Un pouvoir psionique est une **capacité** marquée *Pouvoir psionique* dont la propriété *Sort* est laissée à **non**. Le cœur de co2 ne dépense alors aucun mana et n'applique aucun surcoût d'armure (conforme aux règles). Le module gère les PE en parallèle :

- **Stockage** : valeur courante en flag d'acteur (`flags.cof2-compagnon.ego.value`) ; maximum   calculé à la volée = `Volonté + nombre de pouvoirs psi appris`.
- **Consommation / récupération** via les hooks `co.preActivateAction`,   `co.postActivateAction`, `co.postUseRecovery`.
- **UI** injectée par hooks de rendu (aucune classe du système n'est surchargée → composable).

## Fonctionnalités

- Ressource Points d'Ego (sidebar, mini-fiche, colonne dans la fiche de groupe).
- Marquage des capacités (pouvoir psionique + coût en Ego, ou *sans coût* par action).
- Symbole `*` sur les pouvoirs psi dans les voies et coût « (X PE) » sur les actions.
- Consommation des PE à l'activation, avec **brûlure d'ego** (PV sacrifiés si PE insuffisants).
- Récupération des PE au repos (1d4° par DR, maximum du dé sur repos complet), gestion de **Contrôle du métabolisme** (le DR rend aussi des PV).
- Marquage *Profil psionique* sur la fiche profil.
- **Cible de modifier « ep »** : proposée dans le menu des modificateurs (Points d'Ego) et prise en compte dans le calcul du maximum de PE.
- **Points de vigueur 4** : un profil marqué psionique impose 4 PV/niveau, quelle que soit la famille choisie (la famille reste libre pour le dé de récupération et les voies de prestige).

## Build

```bash
npm install
npm run compile   # style/cof2-compagnon.less -> cof2-compagnon.css
```

