/**
 * The reasons of the shared call template analyser (src/appel-outil.ts, copied unchanged from the Sirenic server, so its
 * reasons are written in French) said in English for the client, by a closed table. test/call-template.test.ts plays the
 * shared vectors and checks that every refusal they produce is translated here: a reason the analyser gains without its
 * line below fails the test, and is said as "unrecognised reason" at run time, never in French.
 */

const REASONS: ReadonlyArray<readonly [RegExp, (m: RegExpExecArray) => string]> = [
  [/^gabarit absent ou qui n'est pas un objet$/, () => "the call template is missing or is not an object"],
  [/^champ inconnu : (.+)$/, (m) => `unknown field in the call template: ${m[1]}`],
  [/^méthode non reconnue : (.+)$/, (m) => `unknown method in the call template: ${m[1]}`],
  [/^chemin absent ou hors de \/v1\/$/, () => "the call template path is missing or outside /v1/"],
  [/^argument placé deux fois au chemin : (.+)$/, (m) => `argument placed twice in the path: ${m[1]}`],
  [/^segment inconnu : « (.*) »$/, (m) => `unknown path segment: "${m[1]}"`],
  [/^requête qui n'est pas un objet$/, () => "the call template query is not an object"],
  [/^paramètre de requête mal nommé : (.+)$/, (m) => `badly named query parameter: ${m[1]}`],
  [/^argument placé au chemin et en requête : (.+)$/, (m) => `argument placed both in the path and in the query: ${m[1]}`],
  [/^encodage inconnu : (.+) \((.*)\)$/, (m) => `unknown encoding of query parameter ${m[1]}: ${m[2]}`],
  [/^rendu inconnu : (.+)$/, (m) => `unknown rendering in the call template: ${m[1]}`],
  [/^Accept (.+) pour le rendu (.+)$/, (m) => `Accept ${m[1]} does not fit the rendering ${m[2]}`],
  [/^argument de chemin absent : (.+)$/, (m) => `path argument missing: ${m[1]}`],
  [/^argument de chemin qui n'est pas un texte ou un nombre : (.+)$/, (m) => `path argument is neither a string nor a number: ${m[1]}`],
  [/^argument de chemin vide ou point : (.+)$/, (m) => `path argument is empty, "." or "..": ${m[1]}`],
  [
    /^(.+) : encodage (texte|si-non-vide) d'une valeur qui n'est pas un texte, un nombre ou un booléen$/,
    (m) => `${m[1]}: the value is not a string, a number or a boolean`,
  ],
  [/^(.+) : encodage (virgules|point-virgule) d'une valeur qui n'est pas une liste de textes$/, (m) => `${m[1]}: the value is not a list of strings`],
  [/^(.+) : valeur sans écriture JSON$/, (m) => `${m[1]}: the value has no JSON form`],
  [/^(.+) : encodage si-vrai d'une valeur qui n'est pas un booléen$/, (m) => `${m[1]}: the value is not a boolean`],
];

/** The English sentence of an analyser reason; undefined when the table does not know it. */
export function englishReasonOrUndefined(reason: string): string | undefined {
  for (const [pattern, say] of REASONS) {
    const m = pattern.exec(reason);
    if (m) return say(m);
  }
  return undefined;
}

/** The English sentence of an analyser reason, or "unrecognised reason" (the French is never shown). */
export function englishReason(reason: string): string {
  return englishReasonOrUndefined(reason) ?? "unrecognised reason of the call template analyser";
}
