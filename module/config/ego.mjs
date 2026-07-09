/**
 * Constantes du module cof2-compagnon (profil Psionique / Points d'Ego).
 */

/** Identifiant du module (namespace des flags et des réglages). */
export const MODULE_ID = "cof2-compagnon"

/** Clés des réglages enregistrés via game.settings. */
export const SETTINGS = {
  /** Active l'affichage et la gestion du psionique / des Points d'Ego. */
  allowPsionic: "allowPsionic",
}

/** Clés des flags posés par le module. */
export const FLAGS = {
  // Sur une capacité (item)
  isPsionic: "isPsionic", // Boolean : la capacité est un pouvoir psionique
  egoCost: "egoCost", // Number  : coût en PE (si absent → rang de la capacité)
  noEgoCost: "noEgoCost", // { [indiceAction]: Boolean } : action sans coût en PE
  // Sur un profil (item) : réutilise la clé isPsionic (document différent)
  // Sur un personnage (actor)
  ego: "ego", // { value: Number } : Points d'Ego courants
}

/** Récupération des PE : 1d4 évolutif (1d4°) par DR dépensé ; valeur max du dé sur repos complet. */
export const EGO_RECOVERY_FORMULA = "1d4°"

/** PV/niveau forcés pour un profil psionique (aligne l'affichage sur le calcul du hook). */
export const PSIONIC_HP_PER_LEVEL = 4

/** Slug de la capacité « Contrôle du métabolisme » (le DR dépensé pour les PE rend aussi des PV). */
export const METABOLISM_SLUG = "controle-du-metabolisme"
