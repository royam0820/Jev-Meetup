// Tiny local relay so the harness page can hit the real Jev model via OpenRouter
// (the key stays in this Node process; the page never sees it).
//   OPENROUTER_API_KEY=... node test/relay.mjs
import http from "node:http";
import { judgeCandidates } from "../src/typesafe.js";

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error("OPENROUTER_API_KEY is missing");
  process.exit(1);
}

http
  .createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.end();
    if (req.method !== "POST" || req.url !== "/judge") {
      res.statusCode = 404;
      return res.end();
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const msg = JSON.parse(body);
      const t0 = performance.now();
      const result = await judgeCandidates({ apiKey, page: msg.page, candidates: msg.candidates });
      result.latencyMs = Math.round(performance.now() - t0);
      console.log(JSON.stringify({ n: msg.candidates.length, latencyMs: result.latencyMs, usage: result.usage,
        rows: msg.candidates.map((c, i) => ({ p: +result.probabilities[i].toFixed(3), id: c.id, classes: c.classes, label: c.label, net: c.known_ad_network })) }, null, 1));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err.message }));
    }
  })
  .listen(8788, () => console.log("relay on http://localhost:8788/judge"));
