import { MODULE_ID, SETTINGS, FLAGS, EGO_RECOVERY_FORMULA, METABOLISM_SLUG } from "./config/ego.mjs"

/**
 * Logique des Points d'Ego (PE) pour le profil Psionique.
 *
 * Principe : un pouvoir psionique est une capacité marquée du flag `isPsionic` et qui n'est PAS un sort (`system.properties.spell` à false). 
 * Le cœur de co2 ne dépense donc aucun PM pour ces capacités et n'applique aucun surcoût d'armure. 
 * Le module branche sa logique PE via les hooks `co.preActivateAction` / `co.postActivateAction` / `co.postUseRecovery` ajoutés au système, et injecte son UI via les hooks de rendu des fiches.
 *
 * Stockage : la valeur courante des PE est un flag d'acteur (`flags.cof2-compagnon.ego.value`).
 * Le maximum est calculé à la volée (VOL + nombre de pouvoirs psi appris).
 */

// État transitoire entre pré- et post-activation pour la brûlure d'ego (clé = actor.id).
const pendingEgoBurn = new Map()

// #region Helpers d'état

/** @returns {boolean} true si le réglage « Autoriser psionique » est activé (défensif : peut être appelé tôt). */
export function isPsionicEnabled() {
  try {
    return game.settings.get(MODULE_ID, SETTINGS.allowPsionic) === true
  } catch (e) {
    return false
  }
}

/** @returns {boolean} true si l'item est une capacité marquée comme pouvoir psionique. */
export function isPsionicCapacity(item) {
  return item?.type === "capacity" && item.getFlag(MODULE_ID, FLAGS.isPsionic) === true
}

/** @returns {Item[]} Les pouvoirs psioniques appris par l'acteur. */
export function learnedPsionicCapacities(actor) {
  return actor.items.filter((i) => i.type === "capacity" && i.system.learned && i.getFlag(MODULE_ID, FLAGS.isPsionic) === true)
}

/**
 * Un personnage est « psionique » dès qu'il connaît au moins un pouvoir psi.
 * Couvre le profil Psionique comme tout profil ayant choisi une voie de psionique.
 * @returns {boolean}
 */
export function isPsionicCharacter(actor) {
  return learnedPsionicCapacities(actor).length > 0
}

/** @returns {boolean} true si l'acteur connaît la capacité « Contrôle du métabolisme ». */
export function hasMetabolismControl(actor) {
  return actor.items.some((i) => i.type === "capacity" && i.system.learned && i.system?.slug === METABOLISM_SLUG)
}

/**
 * Maximum de PE : VOL + nombre de pouvoirs psi appris (+ modifiers ciblant « ep » s'il en existe).
 * @returns {number}
 */
export function computeEgoMax(actor) {
  const vol = actor.system?.abilities?.vol?.value ?? 0
  let total = vol + learnedPsionicCapacities(actor).length
  try {
    const sys = actor.system
    if (sys?.computeTotalModifiersByTarget && sys?.resourceModifiers) {
      const mod = sys.computeTotalModifiersByTarget(sys.resourceModifiers, "ep")
      if (Number.isFinite(mod?.total)) total += mod.total
    }
  } catch (e) {
    /* pas de modifiers ep : on ignore */
  }
  return total
}

/**
 * Valeur courante de PE. En l'absence de flag (personnage neuf), on considère les PE pleins.
 * @returns {number}
 */
export function getEgoValue(actor) {
  const ego = actor.getFlag(MODULE_ID, FLAGS.ego)
  return Number.isFinite(ego?.value) ? ego.value : computeEgoMax(actor)
}

/**
 * Info-bulle détaillée du maximum de PE, construite comme celle du Mana : un détail des
 * contributeurs (Volonté + nombre de pouvoirs psi + modifiers ep) via `Utils.getTooltip`,
 * au même format `nom : valeur<br />` que les ressources du système.
 * @returns {string} HTML d'info-bulle.
 */
export function egoTooltip(actor) {
  const Utils = game.system?.api?.helpers?.Utils
  if (!Utils?.getTooltip) return game.i18n.localize("COF2COMPAGNON.resources.tooltip.ego")

  const vol = actor.system?.abilities?.vol?.value ?? 0
  const nbPsi = learnedPsionicCapacities(actor).length
  let tooltip = Utils.getTooltip(game.i18n.localize("CO.abilities.long.vol"), vol)
  tooltip = tooltip.concat(Utils.getTooltip(game.i18n.localize("COF2COMPAGNON.resources.tooltip.nbPsi"), nbPsi))

  try {
    const sys = actor.system
    if (sys?.computeTotalModifiersByTarget && sys?.resourceModifiers) {
      const mod = sys.computeTotalModifiersByTarget(sys.resourceModifiers, "ep")
      if (mod?.tooltip) tooltip = tooltip.concat(mod.tooltip)
    }
  } catch (e) {
    /* pas de modifiers ep */
  }
  return tooltip
}

/**
 * Coût en PE d'une action psionique : flag `egoCost` si défini, sinon le rang de la capacité.
 * Renvoie 0 si l'action porte le flag `noEgoCost`. Applique la concentration accrue (-2) si action d'attaque + shiftKey.
 * @returns {number}
 */
export function getEgoCost(item, action, { shiftKey = false, indice } = {}) {
  const noEgo = item.getFlag(MODULE_ID, FLAGS.noEgoCost)
  if (noEgo && noEgo[indice] === true) return 0
  let cost = item.getFlag(MODULE_ID, FLAGS.egoCost)
  if (!Number.isFinite(cost)) cost = item.system?.rank ?? 1
  if (action?.isActionTypeAttack && shiftKey) cost -= 2
  return Math.max(cost, 0)
}

/** Formule du dé de récupération évolutif (1d4°) résolue selon le niveau de l'acteur. */
function evolvingEgoFormula(actor) {
  try {
    const Utils = game.system?.api?.helpers?.Utils
    const f = Utils?.evaluateCoModifierWithDiceValue?.(actor, EGO_RECOVERY_FORMULA, null)
    if (typeof f === "string" && f.length) return f
  } catch (e) {
    /* repli sur d4 */
  }
  return "1d4"
}

// #endregion

// #region Hooks de consommation / récupération

/**
 * Hook `co.preActivateAction` : valide la disponibilité des PE avant d'activer un pouvoir psi.
 * Enregistre une garde asynchrone (`guard`) ; si les PE sont insuffisants, propose la brûlure d'ego. La garde résout sur false pour annuler l'activation.
 */
export function onPreActivateAction(actor, { item, indice, state, shiftKey, guard } = {}) {
  if (!isPsionicEnabled()) return
  if (!state || !isPsionicCapacity(item)) return

  const action = item.system?.actions?.[indice]
  const cost = getEgoCost(item, action, { shiftKey, indice })
  if (cost <= 0) return
  if (getEgoValue(actor) >= cost) return

  // PE insuffisants → garde asynchrone proposant la brûlure d'ego
  guard?.(askEgoBurn(actor, item, cost))
}

/** Dialogue de brûlure d'ego ; mémorise le nombre de PE manquants pour la phase post. */
async function askEgoBurn(actor, item, cost) {
  const missing = cost - getEgoValue(actor)
  const proceed = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize("COF2COMPAGNON.dialogs.egoBurn.title") },
    content: game.i18n.format("COF2COMPAGNON.dialogs.egoBurn.content", { needed: missing, capacity: item.name }),
    rejectClose: false,
    modal: true,
  })
  if (!proceed) return false
  pendingEgoBurn.set(actor.id, { missing })
  return true
}

/**
 * Hook `co.postActivateAction` : déduit les PE après une activation réussie d'un pouvoir psi, et applique la brûlure d'ego (PV sacrifiés) si elle a été acceptée en phase pré.
 */
export async function onPostActivateAction(actor, { item, indice, state, shiftKey, success } = {}) {
  const burn = pendingEgoBurn.get(actor.id)
  pendingEgoBurn.delete(actor.id)

  if (!isPsionicEnabled()) return
  if (!state || !success || !isPsionicCapacity(item)) return

  const action = item.system?.actions?.[indice]
  const cost = getEgoCost(item, action, { shiftKey, indice })
  if (cost <= 0) return

  const next = Math.max(getEgoValue(actor) - cost, 0)
  await actor.setFlag(MODULE_ID, FLAGS.ego, { value: next })

  // Brûlure d'ego : PV sacrifiés pour les PE manquants (missing × dé de récupération du profil)
  if (burn && burn.missing > 0) {
    const hd = actor.system?.hd
    if (hd) {
      const burnRoll = await new Roll(`${burn.missing}${hd}`).roll()
      await burnRoll.toMessage({
        flavor: game.i18n.format("COF2COMPAGNON.notif.egoBurn", { name: actor.name, capacity: item.name }),
        speaker: ChatMessage.getSpeaker({ actor }),
      })
      const newHP = Math.max((actor.system.attributes?.hp?.value ?? 0) - burnRoll.total, 0)
      await actor.update({ "system.attributes.hp.value": newHP })
    }
  }
}

/**
 * Hook `co.postUseRecovery` : propose de dépenser un DR pour récupérer des PE.
 * 1 DR → 1d4° PE (valeur max du dé sur un repos complet). Un DR ainsi dépensé ne rend pas de PV — sauf si l'acteur possède « Contrôle du métabolisme », auquel cas il récupère aussi des PV.
 */
export async function onPostUseRecovery(actor, { isFullRest } = {}) {
  if (!isPsionicEnabled() || !isPsionicCharacter(actor)) return

  const max = computeEgoMax(actor)
  const current = getEgoValue(actor)
  if (current >= max) return

  const rp = actor.system?.resources?.recovery
  if (!rp || rp.value <= 0) return

  const proceed = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize("COF2COMPAGNON.dialogs.recoverEgo.title") },
    content: game.i18n.localize("COF2COMPAGNON.dialogs.recoverEgo.content"),
    rejectClose: false,
    modal: true,
  })
  if (!proceed) return

  const formula = evolvingEgoFormula(actor)
  let recovered
  if (isFullRest) {
    const roll = await new Roll(formula).evaluate({ maximize: true }) // résultat maximal automatique
    recovered = roll.total
  } else {
    const roll = await new Roll(formula).roll()
    await roll.toMessage({
      flavor: game.i18n.localize("COF2COMPAGNON.dialogs.recoverEgo.title"),
      speaker: ChatMessage.getSpeaker({ actor }),
    })
    recovered = roll.total
  }

  const next = Math.min(current + recovered, max)
  await actor.setFlag(MODULE_ID, FLAGS.ego, { value: next })
  await actor.update({ "system.resources.recovery.value": Math.max(rp.value - 1, 0) })

  // Contrôle du métabolisme : le DR dépensé pour les PE permet aussi de récupérer des PV
  if (hasMetabolismControl(actor) && typeof actor.rollHeal === "function") {
    const hd = actor.system?.hd
    if (hd) {
      const level = Math.round((actor.system.attributes?.level ?? 1) / 2)
      await actor.rollHeal(null, {
        actionName: game.i18n.localize("COF2COMPAGNON.dialogs.recoverEgo.metabolism"),
        healFormula: `${hd} + ${level}`,
        targetType: "self",
        targets: [actor],
      })
    }
  }
}

/**
 * Hook `co.computeProfileHpPerLevel` : force les PV/niveau à 4 pour un profil marqué psionique (la famille reste libre pour le dé de récupération et l'accès aux voies de prestige).
 * @param {Actor} actor
 * @param {{ profile: Item, value: number }} data Objet mutable : modifier `value` pour surcharger.
 */
export function onComputeProfileHpPerLevel(actor, data) {
  if (!isPsionicEnabled()) return
  if (data?.profile?.getFlag?.(MODULE_ID, FLAGS.isPsionic) === true) {
    data.value = 4
  }
}

// #endregion

// #region Injection UI

/**
 * Hook `renderCoCapacitySheet` : injecte les champs « Psionique » (isPsionic + coût en Ego) après le fieldset des sorts, et une case « sans coût en Ego » par action. Stockés en flags.
 */
export function injectCapacityFields(application, element) {
  if (!isPsionicEnabled()) return
  const item = application.document
  if (item?.type !== "capacity") return
  if (element.querySelector(".cof2-psionique")) return

  const anchor = element.querySelector("fieldset.spell") ?? element.querySelector("section.panel-right")
  if (!anchor) return

  const isPsi = item.getFlag(MODULE_ID, FLAGS.isPsionic) === true
  const egoCost = item.getFlag(MODULE_ID, FLAGS.egoCost)
  const rank = item.system?.rank ?? 1

  const egoCostField = isPsi
    ? `<div class="form-group">
        <label>${game.i18n.localize("COF2COMPAGNON.capacity.egoCost")}</label>
        <div class="form-fields">
          <input type="number" name="flags.${MODULE_ID}.egoCost" value="${Number.isFinite(egoCost) ? egoCost : ""}" placeholder="${rank}" min="0" step="1" data-dtype="Number" />
        </div>
      </div>`
    : ""

  const html = `
    <fieldset class="cof2-psionique">
      <legend>${game.i18n.localize("COF2COMPAGNON.capacity.psionique")}</legend>
      <div class="form-group">
        <label>${game.i18n.localize("COF2COMPAGNON.capacity.isPsionic")}</label>
        <div class="form-fields">
          <input type="checkbox" name="flags.${MODULE_ID}.isPsionic" ${isPsi ? "checked" : ""} data-dtype="Boolean" />
        </div>
      </div>
      ${egoCostField}
    </fieldset>`

  anchor.insertAdjacentHTML("afterend", html)

  // Case « sans coût en Ego » dans le fieldset Propriétés de chaque action (si pouvoir psi)
  if (!isPsi) return
  const noEgo = item.getFlag(MODULE_ID, FLAGS.noEgoCost) ?? {}
  element.querySelectorAll('.tab.action.item[data-item-type="action"]').forEach((tab) => {
    const idx = tab.dataset.itemId
    if (tab.querySelector(".cof2-noego")) return
    const legend = Array.from(tab.querySelectorAll("fieldset legend")).find((l) => /propri/i.test(l.textContent))
    const fieldset = legend?.closest("fieldset")
    if (!fieldset) return
    const checked = noEgo[idx] === true ? "checked" : ""
    fieldset.insertAdjacentHTML(
      "beforeend",
      `<div class="form-group cof2-noego">
        <label><input type="checkbox" name="flags.${MODULE_ID}.noEgoCost.${idx}" ${checked} data-dtype="Boolean" /> ${game.i18n.localize("COF2COMPAGNON.capacity.noEgoCost")}</label>
      </div>`,
    )
  })
}

/**
 * Hook `renderCoProfileSheet` : injecte la case « Profil psionique » dans la fiche profil.
 */
export function injectProfileFields(application, element) {
  if (!isPsionicEnabled()) return
  const item = application.document
  if (item?.type !== "profile") return
  if (element.querySelector(".cof2-profile-psi")) return

  const fieldset = element.querySelector("fieldset.infoInitial")
  if (!fieldset) return

  const isPsi = item.getFlag(MODULE_ID, FLAGS.isPsionic) === true
  fieldset.insertAdjacentHTML(
    "beforeend",
    `<div class="form-group cof2-profile-psi">
      <label>${game.i18n.localize("COF2COMPAGNON.profile.isPsionic")}</label>
      <div class="form-fields"><input type="checkbox" name="flags.${MODULE_ID}.isPsionic" ${isPsi ? "checked" : ""} data-dtype="Boolean" /></div>
    </div>`,
  )
}

/** Construit le HTML du bloc Points d'Ego pour une sidebar. */
function egoSectionHtml(actor, { mini = false, viewLimited = false } = {}) {
  const max = computeEgoMax(actor)
  const value = Math.min(getEgoValue(actor), max)
  const longLabel = game.i18n.localize("COF2COMPAGNON.resources.long.ego")
  const mediumLabel = game.i18n.localize("COF2COMPAGNON.resources.medium.ego")
  const tooltip = egoTooltip(actor)

  const points = viewLimited
    ? `<i class="fas fa-fw fa-brain"></i>??`
    : `<i class="fas fa-fw fa-brain"></i>
       <input class="current" name="flags.${MODULE_ID}.ego.value" value="${value}" type="number" data-dtype="Number" placeholder="0" />
       <span class="slash">/</span>
       <span class="max" data-tooltip="${tooltip}">${max}</span>`

  if (mini) {
    return `<div class="sidebar-section resource-section mini-section cof2-ego-section">
      <div class="sidebar-section-header"><div class="resource-points labelled-field">${points}</div></div>
    </div>`
  }
  return `<div class="sidebar-section resource-section cof2-ego-section">
    <div class="sidebar-section-header">
      <div class="sidebar-label"><h4 data-tooltip="${longLabel}">${mediumLabel}</h4></div>
      <div class="resource-points labelled-field">${points}</div>
    </div>
  </div>`
}

/** Insère le bloc Ego après le bloc de mana d'une sidebar, sinon à la fin. */
function insertAfterMana(container, html) {
  const manaSection = Array.from(container.querySelectorAll(".resource-section")).find((s) => s.querySelector('input[name="system.resources.mana.value"]'))
  if (manaSection) manaSection.insertAdjacentHTML("afterend", html)
  else container.insertAdjacentHTML("beforeend", html)
}

/**
 * Hook `renderCOCharacterSheet` : bloc Ego dans la sidebar + symbole « * » sur les pouvoirs psi (onglet voies) + coût en PE affiché sur les actions psioniques.
 */
export function injectCharacterEgo(application, element, context) {
  if (!isPsionicEnabled()) return
  const actor = application.document
  if (actor?.type !== "character" || !isPsionicCharacter(actor)) return

  // 1. Bloc Points d'Ego dans la sidebar
  const sidebar = element.querySelector(".sheet-sidebar .scrollable")
  if (sidebar && !sidebar.querySelector(".cof2-ego-section")) {
    insertAfterMana(sidebar, egoSectionHtml(actor, { viewLimited: context?.viewLimited === true }))
  }

  // 2. Symbole « * » sur les pouvoirs psi dans l'onglet voies
  element.querySelectorAll('li.item[data-item-type="capacity"]').forEach((li) => {
    const capacity = actor.items.get(li.dataset.itemId)
    if (!isPsionicCapacity(capacity)) return
    const h4 = li.querySelector(".item-name h4")
    if (h4 && !h4.dataset.cof2Psi) {
      h4.dataset.cof2Psi = "1"
      h4.insertAdjacentText("beforeend", " *")
    }
  })

  // 3. Coût en PE sur les actions psioniques de l'onglet principal
  element.querySelectorAll("li.action[data-item-uuid]").forEach((li) => {
    let capacity
    try {
      capacity = actor.items.get(foundry.utils.parseUuid(li.dataset.itemUuid)?.id)
    } catch (e) {
      capacity = null
    }
    if (!isPsionicCapacity(capacity)) return
    const h4 = li.querySelector(".actionRow h4")
    if (!h4 || h4.dataset.cof2Ego) return
    const indice = Number(li.dataset.indice)
    const cost = getEgoCost(capacity, capacity.system?.actions?.[indice], { indice })
    h4.dataset.cof2Ego = "1"
    h4.insertAdjacentHTML("beforeend", ` <span class="cof2-ego-cost"> - *(${cost} PE)</span>`)
  })
}

/** Hook `renderCOMiniCharacterSheet` : bloc Ego compact dans la mini-fiche. */
export function injectMiniEgo(application, element) {
  if (!isPsionicEnabled()) return
  const actor = application.document
  if (actor?.type !== "character" || !isPsionicCharacter(actor)) return

  const sidebar = element.querySelector(".mini-sidebar")
  if (!sidebar || sidebar.querySelector(".cof2-ego-section")) return
  insertAfterMana(sidebar, egoSectionHtml(actor, { mini: true }))
}

/** Hook `renderCOPartySheet` : colonne Points d'Ego dans le tableau de groupe. */
export function injectPartyEgo(application, element) {
  if (!isPsionicEnabled()) return
  const table = element.querySelector("table")
  if (!table || table.querySelector(".cof2-ego-col")) return

  // En-tête : après la dernière colonne de ressource (mana)
  const headerRow = table.querySelector("thead tr")
  const manaTh = Array.from(headerRow?.querySelectorAll("th.col-resource") ?? []).pop()
  if (manaTh) {
    const th = document.createElement("th")
    th.className = "col-resource cof2-ego-col"
    th.textContent = game.i18n.localize("COF2COMPAGNON.resources.short.ego")
    manaTh.insertAdjacentElement("afterend", th)
  }

  // Cellules par personnage
  table.querySelectorAll("tbody tr").forEach((tr) => {
    const actorId = tr.querySelector("a[data-actor-id]")?.dataset.actorId
    const actor = actorId ? game.actors.get(actorId) : null
    const td = document.createElement("td")
    td.className = "col-resource cof2-ego-cell"
    if (actor && isPsionicCharacter(actor)) {
      const max = computeEgoMax(actor)
      td.textContent = `${Math.min(getEgoValue(actor), max)} / ${max}`
    } else {
      td.textContent = "—"
    }
    const manaTd = Array.from(tr.querySelectorAll("td.col-resource")).pop()
    if (manaTd) manaTd.insertAdjacentElement("afterend", td)
  })
}

// #endregion
