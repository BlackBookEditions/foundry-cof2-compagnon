import { MODULE_ID, SETTINGS, FLAGS, EGO_RECOVERY_FORMULA, PSIONIC_HP_PER_LEVEL } from "./config/ego.mjs"

/**
 * Logique des Points d'Ego (PE) pour le profil Psionique.
 *
 * Principe : un pouvoir psionique est une capacité marquée du flag `isPsionic` et qui n'est PAS un sort (`system.properties.spell` à false). 
 * Le cœur de co2 ne dépense donc aucun PM pour ces capacités et n'applique aucun surcoût d'armure. 
 * Le module branche sa logique PE via les hooks `co2.preActivateAction` / `co2.postActivateAction` / `co2.postUseRecovery` ajoutés au système, et injecte son UI via les hooks de rendu des fiches.
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
 * Hook `co2.preActivateAction` : valide la disponibilité des PE avant d'activer un pouvoir psi.
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
 * Hook `co2.postActivateAction` : déduit les PE après une activation réussie d'un pouvoir psi, et applique la brûlure d'ego (PV sacrifiés) si elle a été acceptée en phase pré.
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
 * Hook `co2.preUseRecovery` : pour un personnage psionique, prend en charge la récupération liée à un DR
 * en proposant une fenêtre unique de choix PV / PE (le système co2 saute alors son propre dialogue de soin).
 * Enregistre le travail dans la garde asynchrone fournie par co2 ; la promesse résout sur `true` = pris en main.
 */
export function onPreUseRecovery(actor, { isFullRest, guard } = {}) {
  if (!isPsionicEnabled() || !isPsionicCharacter(actor)) return
  guard?.(handlePsiRecovery(actor, isFullRest))
}

/**
 * Fenêtre de récupération psionique : dépense d'un seul DR pour récupérer, au choix du joueur, des PV
 * et/ou des PE (deux cases à cocher). Le soin PV réutilise la formule du système (`getRecoveryHealFormula`),
 * les PE regagnent 1d4° (valeur max du dé sur un repos complet).
 * @param {Actor} actor
 * @param {boolean} isFullRest
 * @returns {Promise<boolean>} Toujours `true` : la récupération d'un psi est intégralement gérée ici.
 */
export async function handlePsiRecovery(actor, isFullRest) {
  const rp = actor.system?.resources?.recovery
  if (!rp || rp.value <= 0) {
    ui.notifications.warn(game.i18n.localize("CO.notif.warningNoMoreRecoveryPoints"))
    return true
  }

  const egoMax = computeEgoMax(actor)
  const egoCurrent = getEgoValue(actor)
  const hp = actor.system?.attributes?.hp
  const pvNeeded = hp ? hp.value < hp.max : false
  const peNeeded = egoCurrent < egoMax

  if (!pvNeeded && !peNeeded) {
    ui.notifications.info(game.i18n.localize("COF2COMPAGNON.dialogs.recover.nothing"))
    return true
  }

  // PV et PE sont librement cochables. Coût : 1 DR par ressource, SAUF récupérer les deux avec le
  // « contrôle du métabolisme » qui ne coûte alors qu'un seul DR (au lieu de 2). Le nombre de DR
  // dépensés ne peut jamais dépasser les DR disponibles (R).
  const R = rp.value
  // Coût en DR pour un état donné.
  const recoveryCost = (pv, pe, meta) => (pv && pe ? (meta ? 1 : 2) : pv || pe ? 1 : 0)
  // Le métabolisme n'a d'effet (remise) que si les deux ressources peuvent être récupérées.
  const metaAvailable = pvNeeded && peNeeded
  // État de départ : aucune case cochée (coût 0), le joueur choisit ce qu'il récupère.
  const drLine = game.i18n
    .format("COF2COMPAGNON.dialogs.recover.drLine", { spent: "%SPENT%", available: R })
    .replace("%SPENT%", `<span class="dr-spent">0</span>`)

  const choice = await foundry.applications.api.DialogV2.wait({
    // La classe "co" place le dialogue dans le contexte CSS du système → checkbox stylées comme les siennes
    classes: ["co", "cof2-recover-dialog"],
    window: { title: game.i18n.localize(isFullRest ? "CO.ui.fullRest" : "CO.ui.fastRest") },
    content: `
      <p>${game.i18n.localize("COF2COMPAGNON.dialogs.recover.hint")}</p>
      <div class="form-group">
        <label><input type="checkbox" name="pv" ${pvNeeded ? "" : 'class="disabled"'} /> ${game.i18n.localize("COF2COMPAGNON.dialogs.recover.pv")}</label>
      </div>
      <div class="form-group">
        <label><input type="checkbox" name="pe" ${peNeeded ? "" : 'class="disabled"'} /> ${game.i18n.localize("COF2COMPAGNON.dialogs.recover.pe")}</label>
      </div>
      <div class="form-group">
        <label data-tooltip="${game.i18n.localize("COF2COMPAGNON.dialogs.recover.metabolismHint")}" data-tooltip-direction="UP"><input type="checkbox" name="metabolism" ${metaAvailable ? "" : 'class="disabled"'} /> ${game.i18n.localize("COF2COMPAGNON.dialogs.recover.metabolism")}</label>
      </div>
      <p class="dr-cost">${drLine}</p>`,
    buttons: [
      {
        action: "confirm",
        label: game.i18n.localize("COF2COMPAGNON.dialogs.recover.confirm"),
        default: true,
        callback: (event, button) => ({
          pv: button.form.elements.pv.checked,
          pe: button.form.elements.pe.checked,
          meta: button.form.elements.metabolism.checked,
        }),
      },
      { action: "cancel", label: game.i18n.localize("COF2COMPAGNON.dialogs.recover.cancel"), callback: () => null },
    ],
    render: (event, dialog) => {
      const root = dialog.element
      const pvEl = root.querySelector('input[name="pv"]')
      const peEl = root.querySelector('input[name="pe"]')
      const metaEl = root.querySelector('input[name="metabolism"]')
      const spentEl = root.querySelector(".dr-spent")
      // Cases indisponibles marquées via la classe "disabled" (convention du système co) et non
      // l'attribut HTML → on s'appuie sur les besoins connus plutôt que sur la propriété DOM.
      const state = () => ({
        pv: !!(pvNeeded && pvEl && pvEl.checked),
        pe: !!(peNeeded && peEl && peEl.checked),
        meta: !!(metaAvailable && metaEl && metaEl.checked),
      })
      const refresh = () => {
        const s = state()
        if (spentEl) spentEl.textContent = String(recoveryCost(s.pv, s.pe, s.meta))
      }
      const onChange = (ev) => {
        const target = ev?.target
        const s = state()
        // Le coût ne peut pas dépasser les DR disponibles : on annule le changement fautif.
        if (recoveryCost(s.pv, s.pe, s.meta) > R) {
          if (target === metaEl) {
            // Décocher le métabolisme rend PV+PE inabordable → on lâche la ressource PE.
            if (peNeeded && peEl) peEl.checked = false
          } else if (target && target.checked) {
            target.checked = false
          }
          ui.notifications.warn(game.i18n.localize("COF2COMPAGNON.dialogs.recover.notEnoughDr"))
        }
        refresh()
      }
      ;[pvEl, peEl, metaEl].forEach((el) => el?.addEventListener("change", onChange))
      refresh()
    },
    rejectClose: false,
    modal: true,
  })
  if (!choice || (!choice.pv && !choice.pe)) return true

  // Soin des PV : réutilise la formule du système (dé de récupération + demi-niveau + modificateurs).
  if (choice.pv && typeof actor.rollHeal === "function") {
    const level = Math.round((actor.system.attributes?.level ?? 1) / 2)
    const formula = actor.system?.getRecoveryHealFormula?.(isFullRest) ?? `${actor.system?.hd} + ${level}`
    await actor.rollHeal(null, {
      actionName: game.i18n.localize(isFullRest ? "CO.ui.fullRest" : "CO.ui.fastRest"),
      healFormula: formula,
      targetType: "self",
      targets: [actor],
    })
  }

  // Récupération des PE : 1d4° (valeur max du dé sur un repos complet). On reprend le mécanisme des PV :
  // un message public indiquant les PE récupérés + un message chuchoté au MJ (comme applyHeal pour les PV).
  if (choice.pe) {
    const formula = evolvingEgoFormula(actor)
    const roll = isFullRest ? await new Roll(formula).evaluate({ maximize: true }) : await new Roll(formula).roll()
    const recovered = roll.total
    const restName = game.i18n.localize(isFullRest ? "CO.ui.fullRest" : "CO.ui.fastRest")
    const CoChat = game.system?.api?.CoChat

    // Message public : carte calquée sur la carte de soin des PV (même structure header/destinataire/total/dé)
    if (CoChat) {
      await new CoChat(actor)
        .withTemplate("modules/cof2-compagnon/templates/chat/ego-recovery-card.hbs")
        .withData({ flavor: restName, total: recovered, formula: roll.formula, tooltip: await roll.getTooltip(), actorImg: actor.img, actorName: actor.name })
        .withRolls([roll])
        .withOptions({ speaker: ChatMessage.getSpeaker({ actor }) })
        .create()
    } else {
      await roll.toMessage({ flavor: restName, speaker: ChatMessage.getSpeaker({ actor }) })
    }

    // Message chuchoté au MJ (parité avec le soin des PV : CoChat + template message-card, exposé par le système)
    if (CoChat) {
      const gmMessage = game.i18n.format("COF2COMPAGNON.chat.egoRecoveredGm", { actorName: actor.name, amount: recovered, source: restName })
      await new CoChat(actor)
        .withTemplate(game.system.CONST.TEMPLATE.MESSAGE)
        .withData({ message: gmMessage })
        .withWhisper(ChatMessage.getWhisperRecipients("GM").map((u) => u.id))
        .create()
    }

    await actor.setFlag(MODULE_ID, FLAGS.ego, { value: Math.min(egoCurrent + recovered, egoMax) })
  }

  // 1 DR par ressource, sauf PV + PE avec le contrôle du métabolisme (1 DR au lieu de 2).
  const spent = recoveryCost(choice.pv, choice.pe, choice.meta)
  await actor.update({ "system.resources.recovery.value": Math.max(rp.value - spent, 0) })
  return true
}

/**
 * Hook `co2.computeProfileHpPerLevel` : force les PV/niveau à 4 pour un profil marqué psionique (la famille reste libre pour le dé de récupération et l'accès aux voies de prestige).
 * @param {Actor} actor
 * @param {{ profile: Item, value: number }} data Objet mutable : modifier `value` pour surcharger.
 */
export function onComputeProfileHpPerLevel(actor, data) {
  if (!isPsionicEnabled()) return
  if (data?.profile?.getFlag?.(MODULE_ID, FLAGS.isPsionic) === true) {
    data.value = PSIONIC_HP_PER_LEVEL
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

  // Case « sans coût en Ego » ajoutée aux propriétés de chaque action (si pouvoir psi),
  // intégrée dans la rangée des autres propriétés (après « Ne consomme pas de charges »).
  if (!isPsi) return
  const noEgo = item.getFlag(MODULE_ID, FLAGS.noEgoCost) ?? {}
  element.querySelectorAll('.tab.action.item[data-item-type="action"]').forEach((tab) => {
    const idx = tab.dataset.itemId
    if (tab.querySelector(".cof2-noego")) return
    const legend = Array.from(tab.querySelectorAll("fieldset legend")).find((l) => /propri/i.test(l.textContent))
    const fieldset = legend?.closest("fieldset")
    if (!fieldset) return
    const checked = noEgo[idx] === true ? "checked" : ""
    // En mode lecture (fiche verrouillée), rendre la case non cochable comme les autres propriétés (classe .disabled du système)
    const disabled = application.isPlayMode === true ? 'class="disabled"' : ""
    const label = `<label class="cof2-noego"><input type="checkbox" name="flags.${MODULE_ID}.noEgoCost.${idx}" ${checked} ${disabled} data-dtype="Boolean" /> ${game.i18n.localize("COF2COMPAGNON.capacity.noEgoCost")}</label>`
    const target = fieldset.querySelector(".flexrow") ?? fieldset
    target.insertAdjacentHTML("beforeend", label)
  })
}

/**
 * Hook `renderCoProfileSheet` : injecte la case « Profil psionique » dans la fiche profil,
 * et force l'affichage du champ « Vigueur par niveau » à PSIONIC_HP_PER_LEVEL quand la case est cochée
 * (le champ affiche sinon les PV de la famille — cf. le hook `onComputeProfileHpPerLevel` côté calcul).
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

  // Affichage : un profil psionique a toujours 4 PV/niveau, quelle que soit la famille.
  if (isPsi) {
    const pvLabel = game.i18n.localize("CO.ui.pvLevel")
    const pvGroup = Array.from(fieldset.querySelectorAll(".form-group")).find((g) => g.querySelector("label")?.textContent.trim() === pvLabel)
    const pvInput = pvGroup?.querySelector("input")
    if (pvInput) pvInput.value = PSIONIC_HP_PER_LEVEL
  }
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
