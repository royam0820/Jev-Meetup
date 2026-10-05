# TypeSafe Fun AdBlocker 🧹

A Chrome extension (Manifest V3) that spots ads on any website in real time and pops
their DOM elements out of the page. The semantic call, "is this element an ad?", is made
by [TypeSafe AI](https://docs.typesafe.ai)'s System One model **Jev**. Everything else
is plain code.

> **This is a fun side project, not a real ad blocker.** It costs API tokens per page,
> it will miss ads, it will occasionally eat something that is not an ad, and it does
> nothing about tracking, malware, or video ads. If you want a real ad blocker, use uBlock
> Origin. If you want to see a tiny decision model judge DOM elements, read on.

**BYOK: bring your own key.** There is no backend. You paste your own TypeSafe API key
into the popup; it is stored in `chrome.storage.sync` in your browser and sent only to
`https://api.typesafe.ai`. You pay for your own usage.

## How it works

1. **Find candidates (code)** – `src/content.js` looks for ad-shaped elements:
   `iframe` / `ins`, id and class tokens like `ad`, `sponsored`, `banner`, `data-ad-*`
   attributes, links to ad networks, and short labels such as "Sponsored", "Advertisement",
   "Anzeige", "Werbung". Tight wrappers are collapsed into one candidate. Anything too
   big (half the viewport, contains `main` or `h1`) is skipped. Teaser cards are climbed
   from the label up to the whole card (`article` / `li`), stopping at page-level
   containers, at 35 % of the viewport, at 1500 characters of text, or when the parent
   holds a second label (then it is a feed, not a card).
2. **Describe compactly (code)** – each candidate becomes a small JSON object: tag,
   classes, label, text excerpt, link hosts, iframe host, shape ("wide horizontal
   banner"), whether it has a standard IAB size, and any recognized ad network.
   Numbers are turned into words up front because Jev is weak on numbers.
3. **Judge (TypeSafe)** – the service worker (`src/background.js` → `src/typesafe.js`)
   sends **one** request per batch with one `noul` question per candidate
   (`Is candidates[i] a paid advertisement …?`) to `POST /v1/systemone`, model `jev-latest`.
   The answer is one probability per element.
4. **Act (code)** – everything with `P(ad) ≥ threshold` (default 0.70) gets a pulsing
   red outline, shrinks and fades away, and is removed with `element.remove()`.
   A `MutationObserver` plus a scroll handler catch lazy-loaded ads; batches are
   debounced by 600 ms and capped at 30 candidates per request.

## Install

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → pick this folder.
3. Click the icon, paste your TypeSafe API key, hit **Test**.
4. Browse. The badge shows how many ads were removed on the current tab; a small toast
   appears in the corner after each batch.

## Popup options

| Option | Effect |
| --- | --- |
| On / off | Pause the content script |
| Threshold | Probability above which an element is removed (0.30–0.95) |
| Mode | `Remove` or `Highlight only` (debug: red outline plus the probability) |
| Pop animation | On: pulse outline for ~0.9 s, then shrink and fade out. Off: remove instantly |
| Toast | Corner toast after each batch |
| Rescan page | Forget the "already judged" set and scan again |

The animation is skipped automatically when the tab is hidden, and a 2.5 s fail-safe
timer removes the element even if the animation timeline is frozen.

## What leaves your browser

Per batch, one request to `api.typesafe.ai` containing: the page hostname and title,
and for each candidate the fields listed under step 2 (up to 220 characters of visible
text, link hostnames, image alt texts, attribute names). Nothing else. No page is sent
in full, nothing is stored on any server of this project, because there is none.

## Testing without installing

```bash
# terminal 1: real TypeSafe calls through a tiny local relay (the key stays in Node)
TYPESAFE_API_KEY=... npm run relay

# terminal 2: static server
npm run serve
# then open http://localhost:8787/test/harness.html
```

`test/harness.html` loads `test/fixture.html` (a German news page with an article,
navigation, comments, a newsletter box, a teaser grid and eight different ads) with a
faked `chrome` API and runs the real content script. Without the relay it falls back to
a heuristic. The fixture text is German on purpose: it exercises the German labels.

```bash
# only check the TypeSafe integration with hand-written candidates
TYPESAFE_API_KEY=... npm run live-check
```

As of 2026-09-17: 11/11 hand-written candidates correct, 8/8 ads removed in the harness
(including two full teaser cards with an "Anzeige" overlay on the image and the headline
below), 0 false removals, roughly 0.7–1.9 s per batch.

## Limits

- Ads inside cross-origin iframes are removed as a whole iframe; the script never sees
  their content.
- Jev reads literally. Ads that hide without a label, ad-network link, or ad-like class
  never reach the candidate list.
- Every batch is an API call. Tune the threshold and the candidate heuristics on the
  sites you actually visit.
- Sites that detect missing ad slots may behave oddly. That is part of the fun.

## Contributing

Issues and PRs are welcome. Good first targets: more label words for other languages,
better card detection on specific sites, and a smarter candidate heuristic that keeps
the token count low. Keep the split intact: rules and thresholds in code, only the
semantic judgment goes to the model.

## License

MIT, see `LICENSE`.
