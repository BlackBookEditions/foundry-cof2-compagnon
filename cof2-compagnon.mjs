import { MODULE_ID, SETTINGS } from "./module/config/ego.mjs"
import {
  onPreActivateAction,
  onPostActivateAction,
  onPreUseRecovery,
  onComputeProfileHpPerLevel,
  injectCapacityFields,
  injectProfileFields,
  injectCharacterEgo,
  injectMiniEgo,
  injectPartyEgo,
} from "./module/ego.mjs"
import { onComputeProfileHpPerLevel as onComputeProfileHpPerLevelOverride, injectProfileHpPerLevelField } from "./module/profile.mjs"

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
    targets.ep = {
      id: "ep",
      label: "COF2COMPAGNON.resources.long.ego",
      subtype: "resource",
    }
  }

  // Ajout des catégories martiales
  game.system.CONST.martialTrainingsWeapons.push({
    key: "bola",
    label: "COF2COMPAGNON.config.martialTrainingWeapon.bola",
  })
  game.system.CONST.martialTrainingsWeapons.push({
    key: "lash",
    label: "COF2COMPAGNON.config.martialTrainingWeapon.lash",
  })
  game.system.CONST.martialTrainingsWeapons.push({
    key: "warLash",
    label: "COF2COMPAGNON.config.martialTrainingWeapon.warLash",
  })
  game.system.CONST.martialTrainingsWeapons.push({
    key: "warPick",
    label: "COF2COMPAGNON.config.martialTrainingWeapon.warPick",
  })
  game.system.CONST.martialTrainingsWeapons.push({
    key: "shortSaber",
    label: "COF2COMPAGNON.config.martialTrainingWeapon.shortSaber",
  })
  game.system.CONST.martialTrainingsWeapons.push({
    key: "rightSaber",
    label: "COF2COMPAGNON.config.martialTrainingWeapon.rightSaber",
  })
  game.system.CONST.martialTrainingsWeapons.push({
    key: "blowgun",
    label: "COF2COMPAGNON.config.martialTrainingWeapon.blowgun",
  })
  game.system.CONST.martialTrainingsWeapons.push({
    key: "tripleStaff",
    label: "COF2COMPAGNON.config.martialTrainingWeapon.tripleStaff",
  })

  console.info("COF2 Compagnon | Fin de l'initialisation du module")
})

// Consommation des Points d'Ego + brûlure d'ego (hooks ajoutés au système co2 dans activateAction)
Hooks.on("co2.preActivateAction", onPreActivateAction)
Hooks.on("co2.postActivateAction", onPostActivateAction)

// Récupération psionique PV/PE : le module prend la main sur la dépense de DR (hook ajouté au système co2 dans useRecovery)
Hooks.on("co2.preUseRecovery", onPreUseRecovery)

// PV/niveau du profil psionique = 4 (hook ajouté au système co2 dans _prepareHPMax)
Hooks.on("co2.computeProfileHpPerLevel", onComputeProfileHpPerLevel)

// PV/niveau génériques forcés pour tout profil portant le flag hpPerLevelOverride
// (mécanisme indépendant du psionique, réutilisable pour tout futur profil custom, ex. Primaliste)
Hooks.on("co2.computeProfileHpPerLevel", onComputeProfileHpPerLevelOverride)

// Injection UI : champs psioniques sur la fiche capacité (classe CoCapacitySheet)
Hooks.on("renderCoCapacitySheet", injectCapacityFields)

// Injection UI : case « profil psionique » sur la fiche profil (classe CoProfileSheet)
Hooks.on("renderCoProfileSheet", injectProfileFields)

// Injection UI : champ « PV/niveau forcé » générique sur la fiche profil (classe CoProfileSheet)
Hooks.on("renderCoProfileSheet", injectProfileHpPerLevelField)

// Injection UI : bloc Points d'Ego + symbole * + coût des actions (classe COCharacterSheet)
Hooks.on("renderCOCharacterSheet", injectCharacterEgo)

// Injection UI : bloc Points d'Ego compact (classe COMiniCharacterSheet)
Hooks.on("renderCOMiniCharacterSheet", injectMiniEgo)

// Injection UI : colonne Points d'Ego dans la fiche de groupe (classe COPartySheet)
Hooks.on("renderCOPartySheet", injectPartyEgo)
