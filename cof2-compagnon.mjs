import { MODULE_ID, SETTINGS } from "./module/config/ego.mjs"
import {
  onPreActivateAction,
  onPostActivateAction,
  onPostUseRecovery,
  onComputeProfileHpPerLevel,
  injectCapacityFields,
  injectProfileFields,
  injectCharacterEgo,
  injectMiniEgo,
  injectPartyEgo,
} from "./module/ego.mjs"

Hooks.once("init", () => {
  console.info("COF2 Compagnon | Initialisation du module...")

  // Réglage maître : tant qu'il est décoché, aucun affichage ni traitement psionique / ego.
  game.settings.register(MODULE_ID, SETTINGS.allowPsionic, {
    name: "COF2COMPAGNON.settings.allowPsionic.name",
    hint: "COF2COMPAGNON.settings.allowPsionic.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: true,
  })

  // Ajoute la cible de modificateur « ep » (Points d'Ego) — possible car le cœur ne fige plus MODIFIERS_TARGET.
  const targets = game.system?.CONST?.MODIFIERS_TARGET
  if (targets && !targets.ep) {
    targets.ep = { id: "ep", label: "COF2COMPAGNON.resources.long.ego", subtype: "resource" }
  }

  console.info("COF2 Compagnon | Fin de l'initialisation du module")
})

// Consommation des Points d'Ego + brûlure d'ego (hooks ajoutés au système co2 dans activateAction)
Hooks.on("co.preActivateAction", onPreActivateAction)
Hooks.on("co.postActivateAction", onPostActivateAction)

// Récupération des Points d'Ego (hook ajouté au système co2 dans useRecovery)
Hooks.on("co.postUseRecovery", onPostUseRecovery)

// PV/niveau du profil psionique = 4 (hook ajouté au système co2 dans _prepareHPMax)
Hooks.on("co.computeProfileHpPerLevel", onComputeProfileHpPerLevel)

// Injection UI : champs psioniques sur la fiche capacité (classe CoCapacitySheet)
Hooks.on("renderCoCapacitySheet", injectCapacityFields)

// Injection UI : case « profil psionique » sur la fiche profil (classe CoProfileSheet)
Hooks.on("renderCoProfileSheet", injectProfileFields)

// Injection UI : bloc Points d'Ego + symbole * + coût des actions (classe COCharacterSheet)
Hooks.on("renderCOCharacterSheet", injectCharacterEgo)

// Injection UI : bloc Points d'Ego compact (classe COMiniCharacterSheet)
Hooks.on("renderCOMiniCharacterSheet", injectMiniEgo)

// Injection UI : colonne Points d'Ego dans la fiche de groupe (classe COPartySheet)
Hooks.on("renderCOPartySheet", injectPartyEgo)
