import { hash, POLICY_VERSION, type PageContext } from "./model";

function structuredTypes(doc: Document): string[] {
  const found = new Set<string>();
  const visit = (item: unknown, depth: number) => {
    if (!item || typeof item !== "object" || depth > 6) return;
    if (Array.isArray(item)) {
      for (const child of item.slice(0, 40)) visit(child, depth + 1);
      return;
    }
    const obj = item as Record<string, unknown>;
    const types = Array.isArray(obj["@type"]) ? obj["@type"] : [obj["@type"]];
    for (const type of types) if (typeof type === "string") found.add(type.toLowerCase());
    for (const key of ["@graph", "mainEntity", "mainEntityOfPage"]) visit(obj[key], depth + 1);
  };
  for (const script of [...doc.querySelectorAll('script[type="application/ld+json"]')].slice(
    0,
    10,
  )) {
    try {
      if ((script.textContent?.length ?? 0) < 100_000)
        visit(JSON.parse(script.textContent ?? ""), 0);
    } catch {
      /* Invalid publisher metadata is optional. */
    }
  }
  return [...found];
}

export function pageContext(doc: Document, href: string): PageContext {
  const url = new URL(href);
  const segments = url.pathname.split("/").filter(Boolean);
  const types = structuredTypes(doc);
  const og = doc.querySelector('meta[property="og:type"]')?.getAttribute("content") ?? "";
  const hasArticle =
    types.some((t) => /article|blogposting/.test(t)) ||
    og === "article" ||
    !!doc.querySelector('main article h1, article [itemprop="articleBody"], [itemtype$="Article"]');
  const isSearch =
    /^(search|find)$/i.test(segments[0] ?? "") ||
    url.searchParams.has("q") ||
    url.searchParams.has("s");
  const queryArticle = hasArticle && (url.searchParams.has("p") || url.searchParams.has("article"));
  const kind: PageContext["kind"] = isSearch
    ? "search"
    : segments.length === 0 && !queryArticle
      ? "home"
      : types.includes("product") || og.startsWith("product")
        ? "product"
        : hasArticle
          ? "article"
          : types.some((t) => /collectionpage|itemlist/.test(t))
            ? "listing"
            : "page";
  // Detail leaves and numeric IDs vary; their route family does not. Generic pages
  // keep literal routes unless the leaf is clearly an ID or long slug.
  let route = segments.map((s) => (/^\d+$/.test(s) || /^[a-f\d-]{16,}$/i.test(s) ? ":id" : s));
  if (kind === "article" || kind === "product") {
    // Remove date components, never the detail leaf or its named route family.
    route = route.filter(
      (_, i) => i === segments.length - 1 || !/^\d{1,4}$/.test(segments[i] ?? ""),
    );
    if (route.length) route[route.length - 1] = ":detail";
    // BBC /news/articles/<id> and /sport/football/articles/<id> keep families apart.
  } else if (route.length > 1 && (route.at(-1)?.split("-").length ?? 0) >= 4) {
    route[route.length - 1] = ":detail";
  }
  // Stable main-shell semantics distinguish templates without hashing text or ads.
  const main = doc.querySelector('main, [role="main"]');
  const anchor =
    main?.getAttribute("data-component") ??
    main?.getAttribute("data-testid") ??
    main?.tagName ??
    "body";
  const shell = `${anchor.slice(0, 100)}|${doc.querySelector("article") ? "article" : ""}`;
  const routeLabel = `/${route.join("/")}`;
  const label = `${kind} · ${routeLabel}`.slice(0, 200);
  const key = `${url.origin}|v${POLICY_VERSION}|${hash(`${kind}|${routeLabel}|${shell}`)}`;
  return { key, label, origin: url.origin, kind };
}
