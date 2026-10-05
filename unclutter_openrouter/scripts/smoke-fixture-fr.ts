/**
 * Démo FR de bout en bout : la fixture locale -> candidats -> une requête Jev.
 * Affiche la réponse BRUTE de Jev (choix, probabilité, confiance) et les règles
 * réellement retenues par le filtre conservateur (P >= 0.9 ET confiance >= 0.9).
 *
 * Usage : OPENROUTER_API_KEY=... bun run scripts/smoke-fixture-fr.ts
 */
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { collectCandidates } from "../lib/dom";
import {
  evaluationCall,
  evaluationRequest,
  MIN_CONFIDENCE,
  MIN_PROBABILITY,
  OPENROUTER_MODEL,
} from "../lib/jev";
import type { Snapshot } from "../lib/model";
import { pageContext } from "../lib/page-context";
import { providerLabel, smokeCredentials } from "../lib/providers";

const { provider, key } = smokeCredentials(process.env);
const href = "https://lecho.fr/societe/prix-du-cafe";
const dom = new JSDOM(readFileSync(new URL("../demo/fixture_fr.html", import.meta.url), "utf8"), {
  url: href,
});
const document = dom.window.document;
const candidates = collectCandidates(document);
if (!candidates.length) throw new Error("Aucun candidat trouvé dans la fixture.");
const snapshot: Snapshot = { url: href, context: pageContext(document, href), candidates };

const start = performance.now();
const { url, init } = evaluationCall(snapshot, key, provider);
const response = await fetch(url, init);
const elapsed = Math.round(performance.now() - start);
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const raw = (await response.json()) as {
  answers: Record<
    string,
    { choice: string; confidence?: number; probabilities?: Record<string, number> }
  >;
};

let masked = 0;
const lines = candidates.map((candidate) => {
  const answer = raw.answers[candidate.id];
  const choice = answer?.choice ?? "(aucune réponse)";
  const probability = answer?.probabilities?.[choice];
  const confidence = answer?.confidence;
  const labelled = choice !== "keep" && choice !== "uncertain";
  const gated =
    labelled && (probability ?? 0) >= MIN_PROBABILITY && (confidence ?? 1) >= MIN_CONFIDENCE
      ? "MASQUÉ"
      : "visible";
  if (gated === "MASQUÉ") masked += 1;
  const p = probability === undefined ? "  —  " : probability.toFixed(2);
  const c = confidence === undefined ? " — " : confidence.toFixed(2);
  return `  ${gated}  ${choice.padEnd(11)} p=${p} conf=${c}  ${candidate.selector}`;
});

console.log(
  `${candidates.length} candidats · ${masked} masqués · ${elapsed} ms · ${providerLabel(provider)}` +
    `${provider === "openrouter" ? ` (${OPENROUTER_MODEL})` : ""}\n` +
    `seuils: p>=${MIN_PROBABILITY} conf>=${MIN_CONFIDENCE} · snapshot ${JSON.stringify(evaluationRequest(snapshot)).length} caractères\n` +
    lines.join("\n"),
);
