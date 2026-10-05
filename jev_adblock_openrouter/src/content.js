// Content script: finds ad-looking DOM candidates, describes them compactly,
// asks the service worker (→ TypeSafe Jev) which ones are ads, removes those.
//
// Division of labour (see docs.typesafe.ai/concepts/how-to-build-with-system-one):
//   code   → candidate discovery, size/shape buckets, known-network detection,
//            batching, thresholds, DOM removal
//   Jev    → the semantic judgment "is this element an advertisement?"
(() => {
  if (window.__tsabLoaded) return;
  window.__tsabLoaded = true;

  const DEFAULTS = { apiKey: "", enabled: true, threshold: 0.7, mode: "remove", toast: true, animate: true };
  const MAX_PER_BATCH = 30;
  const DEBOUNCE_MS = 600;
  const OWN_ATTR = "data-tsab"; // marks our own UI so it is never a candidate

  const settings = { ...DEFAULTS };
  let judged = new WeakSet();
  const pending = new Set();
  let timer = null;
  let busy = false;
  let removedOnPage = 0;
  let lastError = null;

  // ---------- heuristics owned by code ----------

  const AD_TOKEN =
    /^(ad|ads|adv|advert|adverts|advertisement|advertisements|advertising|adsense|adslot|adunit|adbox|adwrap|adwrapper|adcontainer|adplaceholder|sponsor|sponsors|sponsored|sponsoring|sponsorship|promo|promos|promoted|promotion|banner|banners|billboard|leaderboard|skyscraper|mpu|dfp|gpt|taboola|outbrain|mgid|revcontent|commercial|affiliate|anzeige|anzeigen|werbung|reklame|teads|criteo|prebid|adnxs|doubleclick|pub|pubs|publicite|publicites|sponsorise|sponsorises|annonce|annonces|partenariat|partenariats|banniere|bannieres|encart|encarts)$/i;

  const LABEL_RE =
    /^(sponsored( content| post| link| story| by .{1,40})?|advertisement|advertisements|advertising|ad|ads|promoted|paid partnership|paid post|paid content|anzeige|anzeigen|-\s*anzeige\s*-|werbung|gesponsert|reklame|publicité|publicités|sponsorisé|sponsorisée|sponsorisés|annonce|annonces|partenariat|contenu sponsorisé|publicidad|pubblicità|advertentie|annons|reklama)$/i;

  const AD_HOSTS = [
    "doubleclick.net", "googlesyndication.com", "googleadservices.com", "adservice.google", "google.com/aclk",
    "taboola.com", "outbrain.com", "amazon-adsystem.com", "amzn.to", "criteo.com", "criteo.net", "adnxs.com",
    "mgid.com", "teads.tv", "rubiconproject.com", "pubmatic.com", "openx.net", "smartadserver.com",
    "yieldlab.net", "adform.net", "revcontent.com", "zemanta.com", "awin1.com", "shareasale.com",
    "impact.com", "impactradius", "adsrvr.org", "bidswitch.net", "moatads.com", "adroll.com", "media.net",
    "plista.com", "ligatus.com", "yieldmo.com", "sharethrough.com", "nativo.com", "connatix.com",
  ];

  const ATTR_SELECTOR = [
    "iframe", "ins",
    "[data-ad]", "[data-ad-slot]", "[data-ad-unit]", "[data-adunit]", "[data-ad-client]", "[data-ad-name]",
    "[data-google-query-id]", "[data-sponsored]", "[data-native-ad]", "[data-taboola]", "[data-outbrain]",
    "[data-ad-type]", "[data-adtype]", "[data-freestar-ad]", "[data-testid*='ad-' i]", "[data-testid*='sponsor' i]",
    "[aria-label*='advert' i]", "[aria-label*='sponsor' i]", "[aria-label*='anzeige' i]", "[aria-label*='werbung' i]",
    "[aria-label*='publicité' i]", "[aria-label*='sponsorisé' i]", "[aria-label*='annonce' i]",
    "a[href*='doubleclick.net']", "a[href*='googleadservices']", "a[href*='/aclk?']", "a[href*='taboola.com']",
    "a[href*='outbrain.com']", "a[href*='amzn.to/']", "a[href*='awin1.com']", "a[href*='shareasale.com']",
    "a[href*='mgid.com']", "a[href*='revcontent.com']",
  ].join(",");

  const STOP_TAGS = new Set(["BODY", "HTML", "MAIN", "NAV", "HEADER", "FOOTER", "UL", "OL", "TABLE", "FORM"]);
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK", "TITLE", "SVG", "PATH"]);

  // Classic IAB / AdSense sizes — a strong, code-owned signal (Jev is weak on numbers).
  const STANDARD_SIZES = new Set([
    "300x250", "728x90", "320x50", "160x600", "300x600", "970x250", "336x280", "320x100", "970x90",
    "250x250", "200x200", "468x60", "120x600", "300x50", "300x100", "980x120", "980x90", "800x250", "640x480",
  ]);

  const tokenize = (s) =>
    String(s || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .split(/[^A-Za-z]+/)
      .filter(Boolean);

  function hasAdToken(el) {
    const tokens = tokenize(el.id).concat(tokenize(el.className?.baseVal ?? el.className));
    return tokens.some((t) => AD_TOKEN.test(t));
  }

  const area = (el) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, r.width) * Math.max(0, r.height);
  };
  // Fallback for hidden/background tabs where innerWidth/innerHeight report 0.
  const viewportArea = () => {
    const w = window.innerWidth || document.documentElement.clientWidth || 0;
    const h = window.innerHeight || document.documentElement.clientHeight || 0;
    return Math.max(w * h, 800 * 600);
  };

  function isVisible(el) {
    if (!el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return false;
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden";
  }

  function isOurs(el) {
    return !!el.closest?.(`[${OWN_ATTR}]`);
  }

  // Collapse tight wrappers: <div class="ad-slot"><iframe/></div> → the div.
  function collapseWrapper(el) {
    let cur = el;
    for (let i = 0; i < 4; i++) {
      const p = cur.parentElement;
      if (!p || STOP_TAGS.has(p.tagName)) break;
      const a = area(cur);
      const pa = area(p);
      if (pa > Math.max(a * 1.4, a + 4000)) break;
      if (p.children.length > 3) break;
      cur = p;
    }
    return cur;
  }

  // From a "Sponsored" label, climb to the card that holds it.
  function labelContainer(labelEl) {
    const vp = viewportArea();
    let cur = labelEl;
    let best = labelEl;
    for (let i = 0; i < 8; i++) {
      const p = cur.parentElement;
      if (!p || STOP_TAGS.has(p.tagName)) break;
      if (area(p) > vp * 0.35) break;
      if ((p.textContent || "").length > 1500) break;
      if (findLabelElements(p).length > 1) break; // parent is a feed of several cards
      if (p.querySelector("h1, main")) break;
      cur = p;
      best = p;
    }
    return best;
  }

  function acceptable(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (SKIP_TAGS.has(el.tagName) || isOurs(el)) return false;
    if (judged.has(el)) return false;
    if (!isVisible(el)) return false;
    if (el.tagName !== "IFRAME") {
      if (area(el) > viewportArea() * 0.5) return false;
      if ((el.textContent || "").length > 2000) return false;
      if (el.querySelector("main, h1")) return false;
    }
    return true;
  }

  function findLabelElements(root) {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const t = node.nodeValue.trim();
        if (t.length < 2 || t.length > 40 || !LABEL_RE.test(t)) return NodeFilter.FILTER_SKIP;
        const p = node.parentElement;
        if (!p || SKIP_TAGS.has(p.tagName) || isOurs(p)) return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n;
    while ((n = walker.nextNode())) out.push(n.parentElement);
    return out;
  }

  function collectCandidates(root) {
    const raw = new Set();
    const scope = root.nodeType === Node.ELEMENT_NODE ? root : document.body;
    if (!scope) return [];

    if (scope.matches?.(ATTR_SELECTOR)) raw.add(scope);
    scope.querySelectorAll(ATTR_SELECTOR).forEach((el) => raw.add(el));

    // id/class token scan
    const all = scope.querySelectorAll("[id],[class]");
    for (const el of all) if (hasAdToken(el)) raw.add(el);
    if (scope !== document.body && hasAdToken(scope)) raw.add(scope);

    for (const labelEl of findLabelElements(scope)) raw.add(labelContainer(labelEl));

    // resolve to containers and drop nested duplicates
    const resolved = new Set();
    for (const el of raw) {
      const target = el.tagName === "A" ? labelContainer(el) : collapseWrapper(el);
      if (acceptable(target)) resolved.add(target);
    }
    const list = [...resolved];
    return list.filter((el) => {
      // if an ancestor candidate exists and is not much larger, let the ancestor represent it
      const outer = list.find((o) => o !== el && o.contains(el));
      if (!outer) return true;
      return area(outer) > area(el) * 2; // keep inner when outer is much bigger (safer)
    }).filter((el) => {
      // drop an outer whose inner is kept
      const inner = list.find((o) => o !== el && el.contains(o));
      if (!inner) return true;
      return !(area(el) > area(inner) * 2);
    });
  }

  // ---------- describing a candidate as compact state for Jev ----------

  function shapeName(w, h) {
    const ratio = w / Math.max(1, h);
    if (w < 120 && h < 120) return "small badge";
    if (ratio >= 3) return "wide horizontal banner";
    if (ratio <= 1 / 3) return "tall vertical column";
    if (Math.abs(ratio - 1) < 0.25) return "square box";
    if (w * h > viewportArea() * 0.25) return "large block";
    return "medium rectangle";
  }

  function hostOf(url) {
    try {
      return new URL(url, location.href).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  function knownNetwork(hosts, el) {
    const hay = hosts.join(" ") + " " + (el.getAttribute("src") || "") + " " + [...el.attributes].map((a) => a.name + "=" + a.value).join(" ");
    return AD_HOSTS.find((h) => hay.includes(h)) || undefined;
  }

  function describe(el) {
    const r = el.getBoundingClientRect();
    const w = Math.round(r.width);
    const h = Math.round(r.height);
    const pageHost = location.hostname.replace(/^www\./, "");

    const linkHosts = [];
    const anchors = el.tagName === "A" ? [el] : [...el.querySelectorAll("a[href]")];
    for (const a of anchors) {
      const host = hostOf(a.getAttribute("href"));
      if (host && !linkHosts.includes(host)) linkHosts.push(host);
      if (linkHosts.length >= 6) break;
    }
    const iframeSrc = el.tagName === "IFRAME" ? el.getAttribute("src") || "" : el.querySelector("iframe[src]")?.getAttribute("src") || "";
    const iframeHost = iframeSrc ? hostOf(iframeSrc) : undefined;

    const text = (el.innerText || el.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 220);
    const label = findLabelElements(el)
      .map((e) => e.textContent.trim())
      .find(Boolean);
    const imageAlts = [...el.querySelectorAll("img[alt]")]
      .map((i) => i.getAttribute("alt").trim())
      .filter(Boolean)
      .slice(0, 3);
    const dataAttrs = [...el.attributes]
      .map((a) => a.name)
      .filter((n) => n.startsWith("data-"))
      .slice(0, 8);
    const classes = tokenize(el.className?.baseVal ?? el.className).slice(0, 8).join(" ");
    const allHosts = linkHosts.concat(iframeHost ? [iframeHost] : []);

    const c = {
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      classes: classes || undefined,
      role: el.getAttribute("role") || undefined,
      aria_label: el.getAttribute("aria-label") || undefined,
      shape: shapeName(w, h),
      standard_ad_size: STANDARD_SIZES.has(`${w}x${h}`) || undefined,
      label: label || undefined,
      text: text || undefined,
      link_hosts: linkHosts.length ? linkHosts : undefined,
      links_to_other_sites: linkHosts.some((hst) => hst !== pageHost && !hst.endsWith("." + pageHost)) || undefined,
      iframe_src_host: iframeHost || undefined,
      image_alts: imageAlts.length ? imageAlts : undefined,
      data_attributes: dataAttrs.length ? dataAttrs : undefined,
      known_ad_network: knownNetwork(allHosts, el),
    };
    for (const k of Object.keys(c)) if (c[k] === undefined) delete c[k];
    return c;
  }

  // ---------- acting on judgments ----------

  function showToast(msg) {
    if (!settings.toast) return;
    let host = document.getElementById("tsab-toast");
    if (!host) {
      host = document.createElement("div");
      host.id = "tsab-toast";
      host.setAttribute(OWN_ATTR, "");
      Object.assign(host.style, {
        position: "fixed", right: "16px", bottom: "16px", zIndex: "2147483647",
        background: "#0f172a", color: "#f8fafc", font: "13px/1.4 system-ui, sans-serif",
        padding: "10px 14px", borderRadius: "10px", boxShadow: "0 8px 24px rgba(0,0,0,.35)",
        transition: "opacity .3s", opacity: "0", pointerEvents: "none", maxWidth: "320px",
      });
      document.documentElement.appendChild(host);
    }
    host.textContent = msg;
    host.style.opacity = "1";
    clearTimeout(host._t);
    host._t = setTimeout(() => (host.style.opacity = "0"), 2200);
  }

  function act(el, p, desc) {
    if (!el.isConnected) return false;
    if (settings.mode === "highlight") {
      el.style.outline = "3px solid #e11d48";
      el.style.outlineOffset = "-3px";
      el.style.position ||= "relative";
      const tag = document.createElement("div");
      tag.setAttribute(OWN_ATTR, "");
      tag.textContent = `AD ${(p * 100).toFixed(0)}%`;
      Object.assign(tag.style, {
        position: "absolute", top: "0", left: "0", zIndex: "2147483646", background: "#e11d48", color: "#fff",
        font: "bold 11px system-ui, sans-serif", padding: "2px 6px", pointerEvents: "none",
      });
      el.appendChild(tag);
    } else if (settings.animate && !document.hidden && typeof el.animate === "function") {
      popAway(el);
    } else {
      el.remove();
    }
    console.debug("[tsab] ad", p.toFixed(2), desc);
    return true;
  }

  // Pulse a red outline for a moment, then shrink + fade and remove.
  function popAway(el) {
    const prev = { outline: el.style.outline, outlineOffset: el.style.outlineOffset, transformOrigin: el.style.transformOrigin };
    // Hard guarantee: whatever happens to the animation timeline (tab hidden mid-way,
    // page pausing animations), the element is gone after this.
    const failSafe = setTimeout(() => el.isConnected && el.remove(), 2500);
    el.style.outline = "3px solid #e11d48";
    el.style.outlineOffset = "-3px";
    el.style.transformOrigin = "center center";
    const pulse = el.animate(
      [
        { boxShadow: "0 0 0 0 rgba(225,29,72,.75)", outlineColor: "#e11d48" },
        { boxShadow: "0 0 0 14px rgba(225,29,72,0)", outlineColor: "#fb7185" },
      ],
      { duration: 450, iterations: 2, easing: "ease-out" },
    );
    pulse.finished
      .catch(() => {})
      .then(() => {
        if (!el.isConnected) return;
        const pop = el.animate(
          [
            { transform: "scale(1)", opacity: 1 },
            { transform: "scale(1.08)", opacity: 1, offset: 0.3 },
            { transform: "scale(0)", opacity: 0 },
          ],
          { duration: 320, easing: "cubic-bezier(.5,0,.9,.4)", fill: "forwards" },
        );
        return pop.finished.catch(() => {});
      })
      .then(() => {
        clearTimeout(failSafe);
        if (el.isConnected) el.remove();
        Object.assign(el.style, prev);
      });
  }

  async function flush() {
    timer = null;
    if (busy) {
      schedule();
      return;
    }
    if (!settings.enabled || !settings.apiKey) {
      pending.clear();
      return;
    }
    const els = [...pending].filter(acceptable).slice(0, MAX_PER_BATCH);
    els.forEach((el) => pending.delete(el));
    if (pending.size) pending.forEach((el) => !acceptable(el) && pending.delete(el));
    if (!els.length) return;

    busy = true;
    try {
      els.forEach((el) => judged.add(el));
      const candidates = els.map(describe);
      const page = { host: location.hostname, title: (document.title || "").slice(0, 120) };
      const res = await chrome.runtime.sendMessage({ type: "judge", page, candidates });
      if (!res || res.error) {
        lastError = res?.error ?? "No response from the service worker";
        console.warn("[tsab]", lastError);
        return;
      }
      lastError = null;
      let hits = 0;
      res.probabilities.forEach((p, i) => {
        if (p >= settings.threshold && act(els[i], p, candidates[i])) hits++;
      });
      if (hits) {
        removedOnPage += hits;
        chrome.runtime.sendMessage({ type: "blocked", count: hits }).catch(() => {});
        showToast(`🧹 ${hits} ad${hits === 1 ? "" : "s"} ${settings.mode === "highlight" ? "flagged" : "removed"} · ${candidates.length} checked · ${res.latencyMs} ms`);
      }
    } catch (err) {
      lastError = err?.message ?? String(err);
      console.warn("[tsab]", err);
    } finally {
      busy = false;
      if (pending.size) schedule();
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  }

  function scan(root = document.body) {
    if (!root) return;
    for (const el of collectCandidates(root)) pending.add(el);
    if (pending.size) schedule();
  }

  // ---------- wiring ----------

  const observer = new MutationObserver((mutations) => {
    if (!settings.enabled) return;
    for (const m of mutations) {
      if (m.type === "childList") {
        for (const n of m.addedNodes) if (n.nodeType === Node.ELEMENT_NODE && !isOurs(n)) scan(n);
      } else if (m.type === "attributes" && m.target.nodeType === Node.ELEMENT_NODE && !isOurs(m.target)) {
        scan(m.target);
      }
    }
  });

  function start() {
    scan(document.body);
    observer.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["class", "id", "src", "style"],
    });
    // lazy-loaded ads often appear on scroll without new attributes we filter on
    let scrollT = null;
    addEventListener("scroll", () => {
      clearTimeout(scrollT);
      scrollT = setTimeout(() => scan(document.body), 400);
    }, { passive: true });
  }

  chrome.storage.sync.get(DEFAULTS).then((s) => {
    Object.assign(settings, s);
    if (document.readyState === "loading") addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;
    for (const [k, { newValue }] of Object.entries(changes)) if (k in DEFAULTS) settings[k] = newValue;
    if (changes.enabled?.newValue || changes.apiKey?.newValue) scan(document.body);
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "getStats") {
      sendResponse({ removedOnPage, pending: pending.size, lastError });
    } else if (msg?.type === "rescan") {
      judged = new WeakSet();
      scan(document.body);
      sendResponse({ ok: true, pending: pending.size });
    }
    return false;
  });
})();
