/**
 * Le gabarit d'appel d'un outil MCP et son analyseur PARTAGÉ (#501, décision C de CDU du 15/10/2026 ; lettres Q1 B et Q7 A
 * du chef du 17/10/2026).
 *
 * Chaque outil du catalogue porte `_meta["eu.sirenic/appel"]` : ce qu'un client a besoin de savoir pour appeler l'API REST
 * à la place de l'outil (méthode, chemin gabarit, paramètres de requête et leur encodage, `Accept`, rendu). Le gabarit est
 * PRODUIT par le relevé (scripts/mcp-routes-outils.ts, dans src/mcp/routes-outils.ts), jamais écrit à la main ; le serveur
 * hébergé compare la requête de chaque rappel à celle du gabarit (`memeRequete`) et envoie celle du gabarit ; le paquet
 * public `sirenic-mcp` (lot 2) construit ses appels avec CE module, recopié tel quel, et tests/fixtures/mcp-appel-vecteurs.json
 * est joué des deux côtés : un écart entre les deux rougit des deux côtés.
 *
 * Module PUR et SANS IMPORT (il se recopie sans rien emporter) : aucune lecture, aucun réseau, aucune dépendance ; seules
 * les fonctions globales du langage (`encodeURIComponent`, `URLSearchParams`).
 *
 * Forme d'un gabarit (liste fermée, tout autre champ ou valeur le rend invalide) :
 *   - `methode` : `GET` (mesure du 17/10/2026 : les 116 outils appellent en GET, sans corps) ;
 *   - `chemin` : segments littéraux et `{argument}` (un segment entier ; l'argument de l'outil du même nom, encodé par
 *     `encodeURIComponent`) ;
 *   - `requete` (facultatif) : nom → encodage, dans l'ordre d'envoi ; le nom est celui de l'argument ET du paramètre ;
 *     un argument absent (`undefined` ou `null`) n'est pas envoyé ;
 *       `texte` : la valeur (texte, nombre ou booléen) telle quelle, vide comprise ; `si-non-vide` : de même, mais un texte
 *       vide n'est pas envoyé ; `virgules` / `point-virgule` : une liste jointe par « , » ou « ; » ; `json` : la valeur en
 *       JSON ; `si-vrai` : `true` envoyé seulement quand l'argument vaut `true` ;
 *     la requête s'écrit comme `URLSearchParams` l'écrit ;
 *   - `accept` et `rendu` : le rendu d'une réponse 200 et son `Accept`, liés (`ACCEPT_PAR_RENDU`).
 */

/** La clé du `_meta` d'un outil qui porte son gabarit d'appel. */
export const CLE_META_APPEL = "eu.sirenic/appel";

/** Les encodages d'un paramètre de requête : liste FERMÉE. */
export const ENCODAGES_REQUETE = ["texte", "si-non-vide", "virgules", "point-virgule", "json", "si-vrai"] as const;
export type EncodageRequete = (typeof ENCODAGES_REQUETE)[number];

/** Le rendu d'une réponse 200 et l'`Accept` qui le demande : liste FERMÉE. */
export const ACCEPT_PAR_RENDU = {
  json: "application/json",
  pdf: "application/pdf",
  "json-ou-pdf": "application/json, application/pdf",
  markdown: "text/markdown",
} as const;
export type RenduAppel = keyof typeof ACCEPT_PAR_RENDU;

/** Le gabarit d'appel d'un outil (`_meta["eu.sirenic/appel"]`). */
export interface AppelOutil {
  methode: "GET";
  chemin: string;
  requete?: Readonly<Record<string, EncodageRequete>>;
  accept: (typeof ACCEPT_PAR_RENDU)[RenduAppel];
  rendu: RenduAppel;
}

/** Une requête HTTP sans corps : méthode, chemin AVEC sa requête, `Accept`. */
export interface RequeteAppel {
  methode: string;
  chemin: string;
  accept: string;
}

/**
 * Les refus nommés de l'analyseur, liste FERMÉE :
 *   - `gabarit_invalide` : le gabarit est absent ou hors de la forme fermée, ou il ne donne pas de requête pour ces
 *     arguments (un argument qu'il place au chemin est absent, une valeur ne se plie pas à son encodage de requête) ;
 *   - `argument_invalide` : un argument de chemin vaut le texte vide, « . » ou « .. », ou n'est ni un texte ni un nombre ;
 *     la faute est celle de l'appelant, non celle du gabarit (m1 de la relecture du 18/10/2026, décision A du chef : un
 *     segment de point déplacerait l'appel sur une autre route, un segment vide aussi).
 * Un gabarit faux l'emporte sur un argument invalide : le refus dit d'abord la faute de Sirenic.
 */
export const REFUS_APPEL = ["gabarit_invalide", "argument_invalide"] as const;

/** Le refus nommé d'une requête que l'analyseur ne donne pas ; `raison` dit pourquoi (des noms d'arguments, jamais leurs
 *  valeurs). */
export interface RefusGabarit {
  refus: (typeof REFUS_APPEL)[number];
  raison: string;
}

const CHAMPS_DU_GABARIT = new Set(["methode", "chemin", "requete", "accept", "rendu"]);
const NOM_ARGUMENT = /^[a-z][a-z0-9_]*$/;
const SEGMENT_LITTERAL = /^[A-Za-z0-9._~-]+$/;
const PLACE_ARGUMENT = /^\{([a-z][a-z0-9_]*)\}$/;

function estObjet(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function estScalaire(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));
}

/** Ce qui rend un gabarit invalide, ou `null` s'il est de la forme fermée. */
export function defautDuGabarit(gabarit: unknown): string | null {
  if (!estObjet(gabarit)) return "gabarit absent ou qui n'est pas un objet";
  for (const champ of Object.keys(gabarit)) if (!CHAMPS_DU_GABARIT.has(champ)) return `champ inconnu : ${champ}`;
  if (gabarit.methode !== "GET") return `méthode non reconnue : ${String(gabarit.methode)}`;
  const { chemin, requete, accept, rendu } = gabarit;
  if (typeof chemin !== "string" || !chemin.startsWith("/v1/")) return "chemin absent ou hors de /v1/";
  const places = new Set<string>();
  for (const segment of chemin.slice(1).split("/")) {
    const place = PLACE_ARGUMENT.exec(segment);
    if (place) {
      if (places.has(place[1]!)) return `argument placé deux fois au chemin : ${place[1]}`;
      places.add(place[1]!);
    } else if (!SEGMENT_LITTERAL.test(segment) || segment === "." || segment === "..") return `segment inconnu : « ${segment} »`;
  }
  if (requete !== undefined) {
    if (!estObjet(requete)) return "requête qui n'est pas un objet";
    for (const [nom, encodage] of Object.entries(requete)) {
      if (!NOM_ARGUMENT.test(nom)) return `paramètre de requête mal nommé : ${nom}`;
      if (places.has(nom)) return `argument placé au chemin et en requête : ${nom}`;
      if (!(ENCODAGES_REQUETE as readonly unknown[]).includes(encodage)) return `encodage inconnu : ${nom} (${String(encodage)})`;
    }
  }
  if (typeof rendu !== "string" || !Object.hasOwn(ACCEPT_PAR_RENDU, rendu)) return `rendu inconnu : ${String(rendu)}`;
  if (accept !== ACCEPT_PAR_RENDU[rendu as RenduAppel]) return `Accept ${String(accept)} pour le rendu ${rendu}`;
  return null;
}

/** La valeur d'un paramètre de requête, `undefined` s'il n'est pas envoyé, ou la raison d'un refus. */
function valeurDeRequete(nom: string, encodage: EncodageRequete, v: unknown): { valeur?: string } | { raison: string } {
  if (v === undefined || v === null) return {};
  switch (encodage) {
    case "texte":
    case "si-non-vide":
      if (!estScalaire(v)) return { raison: `${nom} : encodage ${encodage} d'une valeur qui n'est pas un texte, un nombre ou un booléen` };
      return encodage === "si-non-vide" && String(v) === "" ? {} : { valeur: String(v) };
    case "virgules":
    case "point-virgule":
      if (!Array.isArray(v) || !v.every(estScalaire)) return { raison: `${nom} : encodage ${encodage} d'une valeur qui n'est pas une liste de textes` };
      return { valeur: v.map(String).join(encodage === "virgules" ? "," : ";") };
    case "json": {
      const json = JSON.stringify(v) as string | undefined;
      return json === undefined ? { raison: `${nom} : valeur sans écriture JSON` } : { valeur: json };
    }
    case "si-vrai":
      if (typeof v !== "boolean") return { raison: `${nom} : encodage si-vrai d'une valeur qui n'est pas un booléen` };
      return v ? { valeur: "true" } : {};
  }
}

/**
 * La requête que le gabarit donne pour les arguments d'un appel d'outil, ou un refus nommé (`REFUS_APPEL`) :
 * `gabarit_invalide` pour un gabarit hors de la forme fermée, un argument de chemin absent ou une valeur qui ne se plie pas
 * à son encodage de requête ; `argument_invalide` pour un argument de chemin vide, qui vaut « . » ou « .. » (un segment de
 * point déplacerait l'appel sur une autre route), ou qui n'est pas un texte ou un nombre ; le premier l'emporte. Les
 * arguments que le gabarit ne nomme pas (paiement, clé) sont ignorés.
 */
export function requeteDeLOutil(gabarit: unknown, args: Readonly<Record<string, unknown>>): RequeteAppel | RefusGabarit {
  const defaut = defautDuGabarit(gabarit);
  if (defaut !== null) return { refus: "gabarit_invalide", raison: defaut };
  const g = gabarit as unknown as AppelOutil;
  const segments: string[] = [];
  // La faute d'un argument de chemin attend la fin de la lecture : une faute du gabarit, plus loin, l'emporte.
  let fauteArgument: string | undefined;
  for (const segment of g.chemin.slice(1).split("/")) {
    const place = PLACE_ARGUMENT.exec(segment);
    if (!place) {
      segments.push(segment);
      continue;
    }
    const nom = place[1]!;
    const v = args[nom];
    if (v === undefined || v === null) return { refus: "gabarit_invalide", raison: `argument de chemin absent : ${nom}` };
    if (typeof v !== "string" && !(typeof v === "number" && Number.isFinite(v))) {
      fauteArgument ??= `argument de chemin qui n'est pas un texte ou un nombre : ${nom}`;
      continue;
    }
    const texte = String(v);
    if (texte === "" || texte === "." || texte === "..") {
      fauteArgument ??= `argument de chemin vide ou point : ${nom}`;
      continue;
    }
    segments.push(encodeURIComponent(texte));
  }
  const paires: Array<[string, string]> = [];
  for (const [nom, encodage] of Object.entries(g.requete ?? {})) {
    const lu = valeurDeRequete(nom, encodage, args[nom]);
    if ("raison" in lu) return { refus: "gabarit_invalide", raison: lu.raison };
    if (lu.valeur !== undefined) paires.push([nom, lu.valeur]);
  }
  if (fauteArgument !== undefined) return { refus: "argument_invalide", raison: fauteArgument };
  const suite = new URLSearchParams(paires).toString();
  return { methode: g.methode, chemin: `/${segments.join("/")}${suite ? `?${suite}` : ""}`, accept: g.accept };
}

/** Un segment de chemin décodé ; tel quel s'il porte un échappement illisible (il ne sera alors égal qu'à lui-même). Le
 *  relevé (scripts/mcp-routes-outils.ts) décode avec lui les segments qu'il lit (r6 de la relecture du 18/10/2026). */
export function segmentDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Deux requêtes sont-elles la même ? Même méthode, même `Accept`, mêmes segments de chemin un à un une fois décodés (un
 * « / » échappé reste dans son segment), mêmes paires de requête une fois décodées, dans le même ordre (le gabarit est une
 * table ordonnée). L'écriture ne compte pas : `%20` et `+` d'une requête, `%41` et `A`, sont la même requête.
 */
export function memeRequete(a: RequeteAppel, b: RequeteAppel): boolean {
  if (a.methode.toUpperCase() !== b.methode.toUpperCase() || a.accept !== b.accept) return false;
  const [cheminA = "", requeteA = ""] = coupe(a.chemin);
  const [cheminB = "", requeteB = ""] = coupe(b.chemin);
  const segmentsA = cheminA.split("/").map(segmentDecode);
  const segmentsB = cheminB.split("/").map(segmentDecode);
  if (segmentsA.length !== segmentsB.length || segmentsA.some((s, i) => s !== segmentsB[i])) return false;
  const pairesA = [...new URLSearchParams(requeteA)];
  const pairesB = [...new URLSearchParams(requeteB)];
  return pairesA.length === pairesB.length && pairesA.every(([n, v], i) => n === pairesB[i]![0] && v === pairesB[i]![1]);
}

/** Le chemin et sa requête, coupés au premier « ? ». */
function coupe(chemin: string): [string, string] {
  const i = chemin.indexOf("?");
  return i < 0 ? [chemin, ""] : [chemin.slice(0, i), chemin.slice(i + 1)];
}
