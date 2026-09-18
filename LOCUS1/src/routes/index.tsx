import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Building2, Loader2, MapPin, Search, ShieldCheck, TriangleAlert } from "lucide-react";

import {
  CATEGORY_LABELS,
  buildProfile,
  findUniversities,
  type CategoryId,
  type Candidate,
  type Profile,
} from "@/lib/campus.functions";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { u?: string } => {
    const u = search["u"];
    return typeof u === "string" && u ? { u } : {};
  },

  head: () => ({
    meta: [
      { title: "Visual Campus — see a university before you apply" },
      {
        name: "description",
        content:
          "Enter a university name and get a verified visual profile: campus, dorms, lecture halls, library, sports and city photos, each with a clickable source.",
      },
      { property: "og:title", content: "Visual Campus — see a university before you apply" },
      {
        property: "og:description",
        content: "Verified, deduplicated campus photos with sources and confidence scores.",
      },
    ],
  }),
  component: Index,
});

const EXAMPLES = [
  "Nazarbayev University",
  "ETH Zurich",
  "University of Tokyo",
  "Trinity College Dublin",
];

function Index() {
  const { u } = Route.useSearch();
  const navigate = useNavigate({ from: "/" });
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<CategoryId | "all">("all");
  const search = useServerFn(findUniversities);
  const build = useServerFn(buildProfile);
  const startedFor = useRef<string | null>(null);

  const searching = useMutation({
    mutationFn: (q: string) => search({ data: { query: q } }),
    onSuccess: (res) => {
      setError(null);
      if (!res.candidates.length) {
        setError("Nothing matched that name. Try the full official name of the university.");
        return;
      }
      const only = res.candidates.length === 1 ? res.candidates[0] : undefined;
      if (only) {
        run(only.title);
        return;
      }

      setCandidates(res.candidates);
    },
    onError: (e: Error) => setError(e.message),
  });

  const building = useMutation({
    mutationFn: (title: string) => build({ data: { title } }),
    onSuccess: (res) => {
      if (!res.profile) {
        setError(res.error ?? "No profile could be built.");
        setProfile(null);
        return;
      }
      setError(null);
      setFilter("all");
      setProfile(res.profile);
    },
    onError: (e: Error) => setError(e.message),
  });

  function run(title: string) {
    setCandidates(null);
    setProfile(null);
    setError(null);
    startedFor.current = title;
    void navigate({ search: { u: title }, replace: true });
    building.mutate(title);
  }

  useEffect(() => {
    if (u && startedFor.current !== u) {
      startedFor.current = u;
      setQuery(u);
      building.mutate(u);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [u]);

  const busy = searching.isPending || building.isPending;

  const counts = useMemo(() => {
    const map = new Map<CategoryId, number>();
    profile?.photos.forEach((p) => map.set(p.category, (map.get(p.category) ?? 0) + 1));
    return map;
  }, [profile]);

  const shown = profile
    ? profile.photos.filter((p) => filter === "all" || p.category === filter)
    : [];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-6xl px-5 pb-24 pt-10 sm:pt-16">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            <Building2 className="h-4 w-4 text-primary" />
            Visual Campus
          </div>
          <span className="font-mono text-xs text-muted-foreground">open sources only</span>
        </header>

        <section className="mt-14 sm:mt-20">
          <h1 className="max-w-3xl font-display text-5xl leading-[1.05] sm:text-7xl">
            See the university <span className="italic text-primary">as a student sees it</span>
          </h1>
          <p className="mt-5 max-w-xl text-base text-muted-foreground">
            Type a name. We search open photo archives, remove duplicates, check that every picture
            really belongs to that place, and sort it into a visual profile — with sources.
          </p>

          <form
            className="mt-8 flex w-full max-w-2xl flex-col gap-3 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (query.trim().length < 2 || busy) return;
              setProfile(null);
              setCandidates(null);
              searching.mutate(query.trim());
            }}
          >
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Enter a university name"
                className="h-14 w-full rounded-md border border-border bg-card pl-11 pr-4 text-base outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-14 items-center justify-center gap-2 rounded-md bg-primary px-7 font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ? "Building profile" : "Build profile"}
            </button>
          </form>

          <div className="mt-4 flex flex-wrap gap-2">
            {EXAMPLES.map((name) => (
              <button
                key={name}
                onClick={() => {
                  setQuery(name);
                  run(name);
                }}
                className="rounded-full border border-border px-3 py-1 font-mono text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
              >
                {name}
              </button>
            ))}
          </div>
        </section>

        {error ? (
          <p className="mt-10 flex items-start gap-2 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            {error}
          </p>
        ) : null}

        {building.isPending ? <Skeleton /> : null}

        {candidates && !building.isPending ? (
          <section className="mt-12">
            <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Which one did you mean?
            </h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {candidates.map((c) => (
                <li key={c.title}>
                  <button
                    onClick={() => run(c.title)}
                    className="flex w-full items-center gap-4 rounded-md border border-border bg-card p-4 text-left transition-colors hover:border-primary"
                  >
                    {c.thumbnail ? (
                      <img
                        src={c.thumbnail}
                        alt=""
                        className="h-14 w-14 rounded object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded bg-muted">
                        <Building2 className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    <span>
                      <span className="block font-medium">{c.title}</span>
                      <span className="block text-sm text-muted-foreground">
                        {c.description ?? "No short description"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {profile && !building.isPending ? (
          <section className="mt-16">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
              <div>
                <h2 className="font-display text-4xl sm:text-5xl">{profile.title}</h2>
                <p className="mt-2 flex flex-wrap items-center gap-3 font-mono text-xs text-muted-foreground">
                  {profile.city || profile.country ? (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" />
                      {[profile.city, profile.country].filter(Boolean).join(", ")}
                    </span>
                  ) : null}
                  {profile.officialSite ? (
                    <a
                      href={profile.officialSite}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      official site <ArrowUpRight className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                  <a
                    href={profile.wikipediaUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    wikipedia <ArrowUpRight className="h-3.5 w-3.5" />
                  </a>
                </p>
              </div>
              <p className="font-mono text-xs text-muted-foreground">
                {profile.photos.length} verified photos · {(profile.elapsedMs / 1000).toFixed(1)}s
              </p>
            </div>

            <p className="mt-6 max-w-3xl text-base leading-relaxed text-muted-foreground">
              {profile.summary}
            </p>

            {profile.warnings.length ? (
              <ul className="mt-5 space-y-2">
                {profile.warnings.map((w) => (
                  <li
                    key={w}
                    className="flex items-start gap-2 font-mono text-xs text-muted-foreground"
                  >
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                    {w}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-8 flex flex-wrap gap-2">
              <FilterChip
                active={filter === "all"}
                onClick={() => setFilter("all")}
                label={`All (${profile.photos.length})`}
              />
              {(Object.keys(CATEGORY_LABELS) as CategoryId[])
                .filter((c) => counts.get(c))
                .map((c) => (
                  <FilterChip
                    key={c}
                    active={filter === c}
                    onClick={() => setFilter(c)}
                    label={`${CATEGORY_LABELS[c]} (${counts.get(c)})`}
                  />
                ))}
            </div>

            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((p) => (
                <figure
                  key={p.id}
                  className="overflow-hidden rounded-md border border-border bg-card"
                >
                  <div className="aspect-[4/3] overflow-hidden bg-muted">
                    <img
                      src={p.thumbUrl}
                      alt={p.title}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
                    />
                  </div>
                  <figcaption className="space-y-2 p-4">
                    <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-wider">
                      <span className="text-primary">{CATEGORY_LABELS[p.category]}</span>
                      <span
                        className={
                          p.verified
                            ? "inline-flex items-center gap-1 text-success"
                            : "inline-flex items-center gap-1 text-warning"
                        }
                      >
                        {p.verified ? (
                          <ShieldCheck className="h-3.5 w-3.5" />
                        ) : (
                          <TriangleAlert className="h-3.5 w-3.5" />
                        )}
                        {p.confidence}%
                      </span>
                    </div>
                    <p className="line-clamp-2 text-sm">{p.note || p.title}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {[p.license, p.date, p.author].filter(Boolean).join(" · ") || "license unknown"}
                    </p>
                    <a
                      href={p.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-primary"
                    >
                      source <ArrowUpRight className="h-3 w-3" />
                    </a>
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-4 py-1.5 font-mono text-xs transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:border-primary hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function Skeleton() {
  return (
    <section className="mt-16">
      <div className="h-10 w-72 animate-pulse rounded bg-muted" />
      <div className="mt-4 h-4 w-full max-w-2xl animate-pulse rounded bg-muted" />
      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-[4/3] animate-pulse rounded-md bg-muted" />
        ))}
      </div>
      <p className="mt-6 font-mono text-xs text-muted-foreground">
        Searching open archives, removing duplicates and verifying each photo…
      </p>
    </section>
  );
}
