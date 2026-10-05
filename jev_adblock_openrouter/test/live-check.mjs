// Calls the real Jev model via OpenRouter (Decisions alpha endpoint) with a
// handful of hand-written candidates.
//   OPENROUTER_API_KEY=... node test/live-check.mjs
import { judgeCandidates, buildRequest } from "../src/typesafe.js";

const page = { host: "kaffee-kurier.example", title: "Espresso-Preise steigen weiter" };
const candidates = [
  { tag: "div", classes: "ad slot leaderboard", shape: "wide horizontal banner", standard_ad_size: true, iframe_src_host: "tpc.googlesyndication.com", data_attributes: ["data-ad-unit", "data-google-query-id"], known_ad_network: "googlesyndication.com", expect: "ad" },
  { tag: "div", classes: "box native teaser", shape: "medium rectangle", label: "Anzeige", text: "Anzeige Der Vollautomat, der Baristas ersetzt – jetzt 40 % günstiger Nur noch heute: BrewMaster 3000 mit Gratis-Bohnen-Abo. Jetzt sichern", link_hosts: ["shop.brewmaster-deals.example"], links_to_other_sites: true, expect: "ad" },
  { tag: "section", id: "related", classes: "box related", shape: "medium rectangle", text: "Mehr zum Thema Kaffee an der Börse: Warum der Preis schwankt So lagern Sie Bohnen richtig", link_hosts: ["kaffee-kurier.example"], expect: "content" },
  { tag: "section", classes: "box newsletter", shape: "medium rectangle", text: "Kaffee-Kurier Newsletter Jeden Morgen die wichtigsten News. Anmelden", expect: "content" },
  { tag: "div", id: "recommendations", classes: "box", shape: "medium rectangle", label: "Sponsored", text: "Sponsored Frauen über 50 tragen jetzt diese Schuhe Zahnärzte hassen diesen Trick", link_hosts: ["trk.taboola.com"], links_to_other_sites: true, image_alts: ["Frauen über 50 tragen jetzt diese Schuhe", "Zahnärzte hassen diesen Trick"], known_ad_network: "taboola.com", expect: "ad" },
  { tag: "section", id: "comments", classes: "box", shape: "medium rectangle", text: "Kommentare (2) Maria: Bei uns im Dorf kostet der Espresso jetzt 2,80 €. Jonas: Ich kaufe seit Jahren direkt bei der Rösterei.", expect: "content" },
  { tag: "div", id: "sidebar-banner", classes: "box mrec", shape: "medium rectangle", standard_ad_size: true, text: "Kaffeemühle Pro – 89,99 € · Prime", link_hosts: ["amzn.to"], links_to_other_sites: true, image_alts: ["Kaffeemühle Pro – Bestseller bei Amazon"], known_ad_network: "amzn.to", expect: "ad" },
  { tag: "div", id: "weather", classes: "box header addons", shape: "medium rectangle", text: "Wetter Hamburg 18 °C, leicht bewölkt", expect: "content" },
  { tag: "header", id: "site-header", shape: "wide horizontal banner", text: "Kaffee-Kurier Start Politik Admin", link_hosts: ["kaffee-kurier.example"], expect: "content" },
  { tag: "div", id: "promo-casino", classes: "box", shape: "medium rectangle", label: "Werbung", text: "Werbung Jetzt spielen", link_hosts: ["luckyspins.example"], links_to_other_sites: true, image_alts: ["500 € Bonus – Lucky Spins Casino"], expect: "ad" },
  { tag: "div", classes: "cookie banner", shape: "wide horizontal banner", text: "Wir verwenden Cookies, um unsere Website zu verbessern. Alle akzeptieren Nur notwendige", expect: "content" },
];

const expectations = candidates.map((c) => c.expect);
const clean = candidates.map(({ expect, ...c }) => c);

const req = buildRequest({ page, candidates: clean });
console.log("request bytes:", JSON.stringify(req).length, "| questions:", Object.keys(req.questions).length);

const t0 = performance.now();
const result = await judgeCandidates({ apiKey: process.env.OPENROUTER_API_KEY, page, candidates: clean });
const cost = result.usage?.cost;
console.log("model:", result.model, "| latency ms:", Math.round(performance.now() - t0),
  "| usage:", result.usage, cost != null ? `| cost $${Number(cost).toFixed(8)}` : "");

const THRESHOLD = 0.7;
let correct = 0;
for (const [i, p] of result.probabilities.entries()) {
  const verdict = p >= THRESHOLD ? "ad" : "content";
  const ok = verdict === expectations[i];
  if (ok) correct++;
  console.log(`${ok ? "✅" : "❌"} p=${p.toFixed(3)} ${verdict.padEnd(7)} expected=${expectations[i].padEnd(7)} ${clean[i].id ?? clean[i].classes ?? clean[i].tag}`);
}
console.log(`${correct}/${candidates.length} correct at threshold ${THRESHOLD}`);
