import { MODULE_ID } from "./config/ego.mjs"
import { PROFILE_FLAGS } from "./config/profile.mjs"

/**
 * Surcharge générique des PV/niveau d'un profil, indépendante du psionique / des Points d'Ego
 * (cf. module/ego.mjs pour le cas spécifique "profil psionique"). Permet à un profil custom
 * (ex. Primaliste, family="mage") de gagner un nombre de PV/niveau différent de celui de sa
 * famille système, sans toucher à la famille (magie, dé de récupération, voies de prestige
 * restent ceux de la famille choisie). Aucun réglage à activer : le flag n'a d'effet que si le
 * MJ le renseigne explicitement sur la fiche du profil.
 */

/** @returns {number|null} La surcharge PV/niveau posée sur ce profil, ou null si absente/invalide. */
export function getHpPerLevelOverride(profile) {
  const value = profile?.getFlag?.(MODULE_ID, PROFILE_FLAGS.hpPerLevelOverride)
  return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Hook `co2.computeProfileHpPerLevel` : applique la surcharge générique si le profil porte le
 * flag `hpPerLevelOverride`. Enregistré EN PLUS du hook psionique — les deux mécanismes sont
 * indépendants et coexistent via Hooks.callAll.
 * @param {Actor} actor
 * @param {{ profile: Item, value: number }} data Objet mutable : modifier `value` pour surcharger.
 */
export function onComputeProfileHpPerLevel(actor, data) {
  const override = getHpPerLevelOverride(data?.profile)
  if (override === null) return
  data.value = override
}

/**
 * Hook `renderCoProfileSheet` : injecte un champ numérique "PV/niveau forcé" dans le fieldset
 * des informations initiales de la fiche profil, et réécrit l'affichage (lecture seule) du champ
 * PV/niveau en cohérence si une surcharge est active.
 */
export function injectProfileHpPerLevelField(application, element) {
  const item = application.document
  if (item?.type !== "profile") return
  if (element.querySelector(".cof2-hp-override")) return

  const fieldset = element.querySelector("fieldset.infoInitial")
  if (!fieldset) return

  const raw = item.getFlag(MODULE_ID, PROFILE_FLAGS.hpPerLevelOverride)
  const value = Number.isFinite(raw) && raw > 0 ? raw : ""

  fieldset.insertAdjacentHTML(
    "beforeend",
    `<div class="form-group cof2-hp-override">
      <label>${game.i18n.localize("COF2COMPAGNON.profile.hpPerLevelOverride")}</label>
      <div class="form-fields">
        <input type="number" name="flags.${MODULE_ID}.${PROFILE_FLAGS.hpPerLevelOverride}" value="${value}" min="0" step="1" placeholder="—" data-dtype="Number" data-tooltip="${game.i18n.localize("COF2COMPAGNON.profile.hpPerLevelOverrideHint")}" />
      </div>
    </div>`,
  )

  const override = getHpPerLevelOverride(item)
  if (override !== null) {
    const pvLabel = game.i18n.localize("CO.ui.pvLevel")
    const pvGroup = Array.from(fieldset.querySelectorAll(".form-group")).find((g) => g.querySelector("label")?.textContent.trim() === pvLabel)
    const pvInput = pvGroup?.querySelector("input")
    if (pvInput) pvInput.value = override
  }
}
