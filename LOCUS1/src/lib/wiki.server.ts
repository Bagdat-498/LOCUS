/**
 * Wikipedia / Wikimedia Commons data access. Server-only.
 * All photos come from openly licensed Commons files with a clickable source page.
 */

const UA = "VisualCampus/1.0 (LOCUS hackathon demo; contact via app)";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Serialise requests a little so we stay under Wikimedia's rate limits. */
let chain: Promise<unknown> = Promise.resolve();
function queued<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.then(
    () => sleep(120),
    () => sleep(120),
  );
  return next;
}

async function api(base: string, params: Record<string, string>) {
  const url = new URL(base);
  url.search = new URLSearchParams({ format: "json", origin: "*", ...params }).toString();

  return queued(async () => {
    let lastStatus = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Api-User-Agent": UA, Accept: "application/json" },
      });
      if (res.ok) return (await res.json()) as any;
      lastStatus = res.status;
      if (res.status !== 429 && res.status < 500) break;
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 5000)
        : 500 * 2 ** attempt;
      await sleep(wait);
    }
    throw new Error(`${base} responded ${lastStatus}`);
  });
}

const WP = "https://en.wikipedia.org/w/api.php";
const COMMONS = "https://commons.wikimedia.org/w/api.php";

export type Candidate = {
  title: string;
  description: string | null;
  thumbnail: string | null;
};

export async function searchUniversities(query: string): Promise<Candidate[]> {
  const data = await api(WP, {
    action: "query",
    generator: "search",
    gsrsearch: `${query} university OR college OR institute`,
    gsrlimit: "8",
    prop: "description|pageimages",
    piprop: "thumbnail",
    pithumbsize: "200",
  });
  const pages: any[] = Object.values(data?.query?.pages ?? {});
  const mapped = pages
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((p) => ({
      title: p.title as string,
      description: (p.description as string) ?? null,
      thumbnail: p.thumbnail?.source ?? null,
    }));

  const institution = /universit|college|institut|school|academy|polytech|hochschule|\bETH\b/i;
  const person = /\b(born|mathematician|physicist|chemist|politician|academic|professor|writer|footballer|engineer|economist)\b/i;
  const filtered = mapped.filter(
    (c) =>
      institution.test(`${c.title} ${c.description ?? ""}`) &&
      !person.test(c.description ?? ""),
  );
  return (filtered.length ? filtered : mapped).slice(0, 6);
}

export type PageInfo = {
  title: string;
  extract: string;
  wikipediaUrl: string;
  officialSite: string | null;
  city: string | null;
  country: string | null;
  coordinates: { lat: number; lon: number } | null;
  commonsCategory: string | null;
};

export async function getPageInfo(title: string): Promise<PageInfo | null> {
  const data = await api(WP, {
    action: "query",
    titles: title,
    prop: "extracts|pageprops|coordinates",
    exintro: "1",
    explaintext: "1",
    redirects: "1",
  });
  const page: any = Object.values(data?.query?.pages ?? {})[0];
  if (!page || page.missing !== undefined) return null;

  const qid: string | undefined = page.pageprops?.wikibase_item;
  let officialSite: string | null = null;
  let city: string | null = null;
  let country: string | null = null;
  let commonsCategory: string | null = null;

  if (qid) {
    try {
      const wd = await api("https://www.wikidata.org/w/api.php", {
        action: "wbgetentities",
        ids: qid,
        props: "claims",
      });
      const claims = wd?.entities?.[qid]?.claims ?? {};
      officialSite = claims.P856?.[0]?.mainsnak?.datavalue?.value ?? null;
      commonsCategory = claims.P373?.[0]?.mainsnak?.datavalue?.value ?? null;
      const ids: string[] = [];
      const cityId = claims.P131?.[0]?.mainsnak?.datavalue?.value?.id;
      const countryId = claims.P17?.[0]?.mainsnak?.datavalue?.value?.id;
      if (cityId) ids.push(cityId);
      if (countryId) ids.push(countryId);
      if (ids.length) {
        const labels = await api("https://www.wikidata.org/w/api.php", {
          action: "wbgetentities",
          ids: ids.join("|"),
          props: "labels",
          languages: "en",
        });
        if (cityId) city = labels?.entities?.[cityId]?.labels?.en?.value ?? null;
        if (countryId) country = labels?.entities?.[countryId]?.labels?.en?.value ?? null;
      }
    } catch {
      // Wikidata is optional enrichment
    }
  }

  const coord = page.coordinates?.[0];

  return {
    title: page.title,
    extract: (page.extract as string) ?? "",
    wikipediaUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
    officialSite,
    city,
    country,
    coordinates: coord ? { lat: coord.lat, lon: coord.lon } : null,
    commonsCategory,
  };
}

export type RawImage = {
  id: string;
  fileTitle: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  descriptionUrl: string;
  description: string | null;
  license: string | null;
  artist: string | null;
  date: string | null;
  sha1: string | null;
  queryHint: string;
};

function stripHtml(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 400) : null;
}

function mapImages(data: any, queryHint: string): RawImage[] {
  const pages: any[] = Object.values(data?.query?.pages ?? {});
  const out: RawImage[] = [];
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    if (!info) continue;
    const mime: string = info.mime ?? "";
    if (!mime.startsWith("image/") || mime.includes("svg")) continue;
    const meta = info.extmetadata ?? {};
    out.push({
      id: String(p.pageid ?? p.title),
      fileTitle: String(p.title ?? "").replace(/^File:/, ""),
      url: info.url,
      thumbUrl: info.thumburl ?? info.url,
      width: info.width ?? 0,
      height: info.height ?? 0,
      descriptionUrl: info.descriptionurl ?? info.url,
      description: stripHtml(meta.ImageDescription?.value),
      license: (meta.LicenseShortName?.value as string) ?? null,
      artist: stripHtml(meta.Artist?.value),
      date: ((meta.DateTimeOriginal?.value ?? meta.DateTime?.value) as string)
        ? stripHtml(meta.DateTimeOriginal?.value ?? meta.DateTime?.value)
        : null,
      sha1: info.sha1 ?? null,
      queryHint,
    });
  }
  return out;
}

const IMAGE_PROPS = {
  prop: "imageinfo",
  iiprop: "url|mime|extmetadata|sha1|size",
  iiurlwidth: "900",
};

export async function searchCommons(search: string, limit = 20, hint = search): Promise<RawImage[]> {
  try {
    const data = await api(COMMONS, {
      action: "query",
      generator: "search",
      gsrsearch: search,
      gsrnamespace: "6",
      gsrlimit: String(limit),
      ...IMAGE_PROPS,
    });
    return mapImages(data, hint);
  } catch {
    return [];
  }
}

export async function imagesInCategory(
  category: string,
  limit = 20,
  hint = category,
): Promise<RawImage[]> {
  try {
    const data = await api(COMMONS, {
      action: "query",
      generator: "categorymembers",
      gcmtitle: `Category:${category}`,
      gcmtype: "file",
      gcmlimit: String(limit),
      ...IMAGE_PROPS,
    });
    return mapImages(data, hint);
  } catch {
    return [];
  }
}

export function dedupe(images: RawImage[]): RawImage[] {
  const seenHash = new Set<string>();
  const seenName = new Set<string>();
  const out: RawImage[] = [];
  for (const img of images) {
    const norm = img.fileTitle
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/, "")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\b(img|dsc|photo|image|p?\d{2,})\b/g, "")
      .trim();
    const hash = img.sha1 ?? "";
    if (hash && seenHash.has(hash)) continue;
    if (norm && seenName.has(norm)) continue;
    if (img.width && img.width < 400) continue;
    if (hash) seenHash.add(hash);
    if (norm) seenName.add(norm);
    out.push(img);
  }
  return out;
}
