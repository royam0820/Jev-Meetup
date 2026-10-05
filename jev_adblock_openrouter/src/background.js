// MV3 service worker: holds the API key, talks to Jev via OpenRouter, keeps the badge.
import { judgeCandidates, checkKey } from "./typesafe.js";

const DEFAULTS = { apiKey: "", enabled: true, threshold: 0.7, mode: "remove", toast: true, animate: true };

async function getSettings() {
  return chrome.storage.sync.get(DEFAULTS);
}

const badgeCounts = new Map(); // tabId -> ads removed on the current page

async function setBadge(tabId, count) {
  const text = count > 0 ? String(count) : "";
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#e11d48" });
    await chrome.action.setBadgeText({ tabId, text });
  } catch {
    // tab may be gone
  }
}

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading") {
    badgeCounts.delete(tabId);
    setBadge(tabId, 0);
  }
});
chrome.tabs.onRemoved.addListener((tabId) => badgeCounts.delete(tabId));

async function addToTotal(n) {
  const { totalBlocked = 0 } = await chrome.storage.local.get({ totalBlocked: 0 });
  await chrome.storage.local.set({ totalBlocked: totalBlocked + n });
}

const handlers = {
  async judge(msg) {
    const { apiKey } = await getSettings();
    const t0 = performance.now();
    const result = await judgeCandidates({ apiKey, page: msg.page, candidates: msg.candidates });
    return { ...result, latencyMs: Math.round(performance.now() - t0) };
  },

  async blocked(msg, sender) {
    const tabId = sender.tab?.id;
    if (tabId != null) {
      const next = (badgeCounts.get(tabId) ?? 0) + msg.count;
      badgeCounts.set(tabId, next);
      await setBadge(tabId, next);
    }
    await addToTotal(msg.count);
    return { ok: true };
  },

  async testKey() {
    const { apiKey } = await getSettings();
    const summary = await checkKey({ apiKey });
    return { ok: summary };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) {
    sendResponse({ error: `Unknown message type: ${msg?.type}` });
    return false;
  }
  handler(msg, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err?.message ?? String(err) }));
  return true; // keep the channel open for the async response
});
