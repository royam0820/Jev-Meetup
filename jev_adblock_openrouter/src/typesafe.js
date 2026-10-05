// Shared Jev (System One) integration — OpenRouter fork.
// Upstream: realZachi/typesafe-adblock (MIT), which calls TypeSafe's own API.
// This fork routes the exact same "one noul question per candidate" call
// through OpenRouter's Decisions (alpha) endpoint, so a plain OpenRouter key
// works — no TypeSafe waitlist needed. The wire format is identical.
//   TypeSafe 1P : POST https://api.typesafe.ai/v1/systemone      model jev-latest
//   OpenRouter  : POST https://openrouter.ai/api/alpha/decisions model typesafe/jev-1.13

export const TYPESAFE_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
export const OPENROUTER_KEY_ENDPOINT = "https://openrouter.ai/api/v1/key";
export const DEFAULT_MODEL = "typesafe/jev-1.13";

// Jev context limits (docs/model-jaggedness): 64k tokens for state + all
// questions, 32k for state + longest question. ~30 compact candidates stay
// far below that; the content script also batches with this cap.
export const MAX_CANDIDATES_PER_REQUEST = 30;

const AD_CRITERIA = {
  true:
    "Paid or third-party advertising: an ad-network slot or iframe (Google Ads, DoubleClick, AdSense, Taboola, Outbrain, Amazon, Criteo, etc.), " +
    "a placement labeled sponsored, promoted, advertisement, Anzeige, Werbung or gesponsert, " +
    "or an affiliate / product banner promoting a product, service, app, shop, casino, or offer that is not the subject of the page itself.",
  false:
    "The website's own content or interface: article or post text, headlines, images that belong to the story, navigation, header, footer, " +
    "search, comments, related or recommended articles from the same site, cookie or consent notices, login, subscription or newsletter prompts, " +
    "share buttons, video players that are the page's content, or empty layout containers.",
};

/**
 * Build the System One request for a batch of DOM candidates.
 * Every candidate gets its own Noul question over the same state, so the
 * whole batch is one API call (speculative fan-out pattern).
 */
export function buildRequest({ page, candidates, model = DEFAULT_MODEL }) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("buildRequest: candidates must be a non-empty array");
  }
  if (candidates.length > MAX_CANDIDATES_PER_REQUEST) {
    throw new Error(`buildRequest: at most ${MAX_CANDIDATES_PER_REQUEST} candidates per request`);
  }
  const questions = {};
  candidates.forEach((_, i) => {
    questions[`ad_${i}`] = {
      type: "noul",
      instructions:
        `Is the page element \`candidates[${i}]\` a paid advertisement or sponsored promotional placement? ` +
        "Judge it by its text, label, link targets, iframe source, attributes, and shape, in the context of `page`.",
      criteria: AD_CRITERIA,
    };
  });
  return { model, state: { page, candidates }, questions };
}

/** Extract the per-candidate "is an ad" probabilities from a response body. */
export function parseResponse(body, count) {
  const probabilities = [];
  for (let i = 0; i < count; i++) {
    const answer = body?.answers?.[`ad_${i}`];
    if (!answer || answer.type !== "noul" || typeof answer.noul !== "number") {
      throw new Error(`parseResponse: missing noul answer for candidate ${i}`);
    }
    probabilities.push(answer.noul);
  }
  return { model: body.model, probabilities, usage: body.usage };
}

const RETRYABLE = new Set([429, 529, 500, 502, 503, 504]);

async function postWithRetry({ url, apiKey, payload, fetchImpl, attempts = 4 }) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      lastError = err;
      await sleep(backoffMs(attempt));
      continue;
    }
    if (res.ok) return res.json();

    const text = await res.text().catch(() => "");
    lastError = new Error(`OpenRouter API ${res.status}: ${text.slice(0, 300)}`);
    if (!RETRYABLE.has(res.status)) throw lastError;

    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt));
  }
  throw lastError;
}

function backoffMs(attempt) {
  return 500 * 2 ** attempt + Math.random() * 250;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Judge a batch of candidates. Returns { model, probabilities, usage }.
 * probabilities[i] is P(candidates[i] is an ad) in [0, 1].
 */
export async function judgeCandidates({ apiKey, page, candidates, model, fetchImpl = globalThis.fetch }) {
  if (!apiKey) throw new Error("No OpenRouter API key set.");
  const payload = buildRequest({ page, candidates, model });
  const body = await postWithRetry({ url: TYPESAFE_ENDPOINT, apiKey, payload, fetchImpl });
  return parseResponse(body, candidates.length);
}

/** GET /api/v1/key – used by the popup's "Test" button to validate the key. */
export async function checkKey({ apiKey, fetchImpl = globalThis.fetch }) {
  if (!apiKey) throw new Error("No OpenRouter API key set.");
  const res = await fetchImpl(OPENROUTER_KEY_ENDPOINT, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`OpenRouter API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const d = body?.data ?? {};
  const usage = Number(d.usage ?? 0);
  const limit = d.limit == null ? null : Number(d.limit);
  return limit == null
    ? `key OK — usage $${usage.toFixed(4)}, no hard limit`
    : `key OK — usage $${usage.toFixed(4)} / limit $${limit.toFixed(2)}`;
}
