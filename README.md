<h2> Module <em>Chroniques Oubliées Fantasy 2e édition : Compagnon</em> pour Foundry Virtual TableTop</h2>

Module Compagnon pour le système **Chroniques Oubliées 2** qui ajoute le profil **Psionique** et la gestion des **Points d'Ego (PE)** sans modifier le système.

<p align="center">
    <img alt="Foundry Version 14 support" src="https://img.shields.io/badge/Foundry-v14-informational">
    <img alt="GitHub release (latest by date)" src="https://img.shields.io/github/v/release/BlackBookEditions/foundry-cof2-compagnon"> 
    <img alt="GitHub last commit" src="https://img.shields.io/github/last-commit/BlackBookEditions/foundry-cof2-compagnon">
    <img alt="GitHub Release Date" src="https://img.shields.io/github/release-date/BlackBookEditions/foundry-cof2-compagnon?label=latest%20release" /> 
</p>

## Comment installer le module ?
Il faut installer le module depuis son manifeste. 
Depuis l'accueil, dans l'onglet Modules :
- Installer un module 
- Saisir l'url du manifeste : https://github.com/BlackBookEditions/foundry-cof2-compagnon/releases/download/1.0.0/module.json

## Activation dans le monde

Tout est conditionné à l'option du module **« Autoriser psionique et points d'ego »** (décochée par défaut). Tant qu'elle est décochée, rien de psionique n'apparaît ni n'est traité.

Le bloc Points d'Ego d'un personnage n'est visible que si ce réglage est coché **et** que le personnage connaît au moins un pouvoir psionique.

## Concept

Un pouvoir psionique est une **capacité** marquée _Pouvoir psionique_ dont la propriété _Sort_ est laissée à **non**. Le cœur de CO2 ne dépense alors aucun mana et n'applique aucun surcoût d'armure (conforme aux règles).
Le module gère les PE en parallèle.

## Fonctionnalités

- Ressource Points d'Ego (sidebar, mini-fiche, colonne dans la fiche de groupe).
- Marquage des capacités (pouvoir psionique + coût en Ego, ou _sans coût_ par action).
- Symbole `*` sur les pouvoirs psi dans les voies et coût « (X PE) » sur les actions.
- Consommation des PE à l'activation, avec **brûlure d'ego** (PV sacrifiés si PE insuffisants).
- Récupération des PE au repos (1d4° par DR, maximum du dé sur repos complet), gestion de **Contrôle du métabolisme** (le DR rend aussi des PV).
- Marquage _Profil psionique_ sur la fiche profil.
- **Cible de modifier « ep »** : proposée dans le menu des modificateurs (Points d'Ego) et prise en compte dans le calcul du maximum de PE.
- **Points de vigueur 4** : un profil marqué psionique impose 4 PV/niveau, quelle que soit la famille choisie (la famille reste libre pour le dé de récupération et les voies de prestige).

## Technique

- **Stockage** : valeur courante en flag d'acteur (`flags.cof2-compagnon.ego.value`) ; maximum calculé à la volée = `Volonté + nombre de pouvoirs psi appris`.
- **Consommation / récupération** via les hooks `co.preActivateAction`, `co.postActivateAction`, `co.postUseRecovery`.
- **UI** injectée par hooks de rendu (aucune classe du système n'est surchargée → composable).

## Contributeurs
- Ce module a été réalisé par Kristov
- Avec la participation de Caloup.

## Mentions Légales
© Black Book Éditions, 2025. Chroniques Oubliées Fantasy est une marque déposée par Black Book Éditions. Tous droits réservés.
Le texte et les images sont la propriété de Black Book Éditions.

## Communauté
Rejoignez-nous sur le serveur <a href="https://discord.com/invite/pPSDNJk">Discord francophone dédié à Foundry Virtual Tabletop</a>
Nous serons ravis d'avoir vos retours sur le module, des signalements de bug, des idées d'amélioration, ou simplement des encouragements !

## Licences
- Le code HTML, CSS et Javascript de ce projet est placé sous <a href="https://choosealicense.com/licenses/gpl-3.0/">licence GNU General Public License v3.0</a>
- Le support de Foundry VTT est couvert par la licence suivante : <a href="https://foundryvtt.com/article/license/">Accord de licence limitée pour le développement de modules du 17/02/2021</a>.