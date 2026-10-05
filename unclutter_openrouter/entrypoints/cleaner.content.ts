import { browser } from "wxt/browser";
import { collectCandidates, createCleaner } from "../lib/dom";
import { pageContext } from "../lib/page-context";
import { ANALYSIS_VERSION, unwrap, type PageState, type Profile, type Reply } from "../lib/model";

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_idle",
  main(ctx) {
    const cleaner = createCleaner(document);
    let state: PageState = {
      context: pageContext(document, location.href),
      profile: null,
      enabled: true,
      hiddenCount: 0,
    };
    let revision = 0;
    let timeout: number | undefined;
    let lastUrl = location.href;
    let autoTimer: number | undefined;
    let autoPendingKey: string | null = null;
    const autoRequested = new Set<string>();
    let autoEnabled = false;
    const requestAuto = () => {
      if (
        !autoEnabled ||
        !state.enabled ||
        document.visibilityState !== "visible" ||
        state.profile?.enabled === false ||
        (state.profile && state.profile.analysisVersion >= ANALYSIS_VERSION)
      )
        return;
      const key = state.context.key;
      if (autoRequested.has(key) || autoPendingKey === key) return;
      clearTimeout(autoTimer);
      autoPendingKey = key;
      // Let client-rendered banners/ads mount; DOM mutation never schedules
      // additional paid calls. The background also persists attempt deduplication.
      autoTimer = ctx.setTimeout(() => {
        autoPendingKey = null;
        if (
          ctx.isInvalid ||
          !autoEnabled ||
          !state.enabled ||
          document.visibilityState !== "visible" ||
          pageContext(document, location.href).key !== key
        )
          return;
        autoRequested.add(key);
        void browser.runtime
          .sendMessage({ type: "visit", context: state.context })
          .catch(() => undefined);
        // DEMO BUILD: raised from 1500 ms to 4000 ms. Ad frameworks (Actirise,
        // Prebid, Teads) inject their slots by script AFTER the page is idle:
        // on marmiton.org the initial HTML contains no ad container at all, so an
        // early analysis finds nothing to hide. Still bounded to one call per key.
      }, 4000);
    };
    const sync = async () => {
      const version = ++revision;
      const context = pageContext(document, location.href);
      if (context.key !== state.context.key || lastUrl !== location.href) {
        cleaner.restore();
        state.hiddenCount = 0;
      }
      lastUrl = location.href;
      const result = unwrap(
        (await browser.runtime.sendMessage({
          type: "sync",
          context,
          hiddenCount: state.hiddenCount,
        })) as Reply<{ profile: Profile | null; enabled: boolean; autoEnabled: boolean }>,
      );
      if (version !== revision || ctx.isInvalid) return state;
      autoEnabled = result.autoEnabled;
      state = { context, ...result, hiddenCount: 0 };
      state.hiddenCount = cleaner.apply(
        state.enabled && state.profile?.enabled ? state.profile.rules : [],
      );
      // Update badge with actual match count, not count of stored selectors.
      await browser.runtime.sendMessage({ type: "sync", context, hiddenCount: state.hiddenCount });
      requestAuto();
      return state;
    };
    const safelySync = () =>
      void sync().catch(() => {
        cleaner.restore();
      });
    const schedule = () => {
      clearTimeout(timeout);
      timeout = ctx.setTimeout(safelySync, 180);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "id", "data-testid", "data-component", "content", "style"],
    });
    ctx.addEventListener(document, "visibilitychange", () => {
      if (document.visibilityState === "visible") safelySync();
    });
    ctx.addEventListener(window, "wxt:locationchange", () => {
      clearTimeout(autoTimer);
      autoPendingKey = null;
      revision++;
      cleaner.restore();
      state.hiddenCount = 0;
      schedule();
    });
    const listener = (
      message: { type?: string },
      sender: { id?: string },
      sendResponse: (reply: Reply<unknown>) => void,
    ) => {
      if (sender.id !== browser.runtime.id) return;
      const respond = async () => {
        if (message.type === "refresh" || message.type === "state") return sync();
        if (message.type === "snapshot")
          return {
            context: pageContext(document, location.href),
            candidates: collectCandidates(document),
            url: location.href,
          };
        throw new Error("Unknown page request.");
      };
      void respond().then(
        (data) => sendResponse({ ok: true, data }),
        () => sendResponse({ ok: false, error: "Page connection unavailable. Refresh this tab." }),
      );
      return true;
    };
    browser.runtime.onMessage.addListener(listener);
    ctx.onInvalidated(() => {
      revision++;
      clearTimeout(timeout);
      clearTimeout(autoTimer);
      observer.disconnect();
      cleaner.restore();
      browser.runtime.onMessage.removeListener(listener);
    });
    safelySync();
  },
});
