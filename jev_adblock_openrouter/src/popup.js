const DEFAULTS = { apiKey: "", enabled: true, threshold: 0.7, mode: "remove", toast: true, animate: true };
const $ = (id) => document.getElementById(id);

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function loadStats() {
  const { totalBlocked = 0 } = await chrome.storage.local.get({ totalBlocked: 0 });
  $("statTotal").textContent = totalBlocked;
  const tab = await activeTab();
  if (!tab?.id) return;
  try {
    const s = await chrome.tabs.sendMessage(tab.id, { type: "getStats" });
    $("statPage").textContent = s?.removedOnPage ?? 0;
    $("pageError").textContent = s?.lastError ? `Error: ${s.lastError}` : "";
    $("pageError").className = s?.lastError ? "hint error" : "hint";
  } catch {
    $("pageError").textContent = "Not active on this page (e.g. chrome://).";
    $("pageError").className = "hint";
  }
}

async function init() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  $("enabled").checked = s.enabled;
  $("apiKey").value = s.apiKey;
  $("threshold").value = s.threshold;
  $("thresholdValue").textContent = Number(s.threshold).toFixed(2);
  $("mode").value = s.mode;
  $("toast").checked = s.toast;
  $("animate").checked = s.animate;
  if (!s.apiKey) {
    $("keyStatus").textContent = "Enter your key – nothing happens without one.";
    $("keyStatus").className = "hint error";
  }
  await loadStats();
}

$("enabled").addEventListener("change", (e) => chrome.storage.sync.set({ enabled: e.target.checked }));
$("mode").addEventListener("change", (e) => chrome.storage.sync.set({ mode: e.target.value }));
$("toast").addEventListener("change", (e) => chrome.storage.sync.set({ toast: e.target.checked }));
$("animate").addEventListener("change", (e) => chrome.storage.sync.set({ animate: e.target.checked }));
$("threshold").addEventListener("input", (e) => {
  $("thresholdValue").textContent = Number(e.target.value).toFixed(2);
});
$("threshold").addEventListener("change", (e) => chrome.storage.sync.set({ threshold: Number(e.target.value) }));

let keyTimer = null;
$("apiKey").addEventListener("input", (e) => {
  clearTimeout(keyTimer);
  const apiKey = e.target.value.trim();
  keyTimer = setTimeout(() => {
    chrome.storage.sync.set({ apiKey });
    $("keyStatus").textContent = apiKey ? "Saved." : "Enter your key – nothing happens without one.";
    $("keyStatus").className = apiKey ? "hint ok" : "hint error";
  }, 300);
});

$("testKey").addEventListener("click", async () => {
  $("keyStatus").textContent = "Checking…";
  $("keyStatus").className = "hint";
  const res = await chrome.runtime.sendMessage({ type: "testKey" });
  if (res?.error) {
    $("keyStatus").textContent = `Error: ${res.error}`;
    $("keyStatus").className = "hint error";
  } else {
    $("keyStatus").textContent = `OK – ${res.ok}`;
    $("keyStatus").className = "hint ok";
  }
});

$("rescan").addEventListener("click", async () => {
  const tab = await activeTab();
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "rescan" });
    setTimeout(loadStats, 1500);
  } catch {
    $("pageError").textContent = "Not active on this page.";
  }
});

init();
