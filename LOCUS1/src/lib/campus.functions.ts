import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { aiJson } from "./ai.server";
import {
  dedupe,
  getPageInfo,
  imagesInCategory,
  searchCommons,
  searchUniversities,
  type RawImage,
} from "./wiki.server";

export type { Candidate } from "./wiki.server";

export const CATEGORIES = [
  "campus",
  "dorm",
  "lecture_hall",
  "library",
  "sports",
  "labs",
  "student_life",
  "city",
] as const;

export type CategoryId = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  campus: "Campus",
  dorm: "Dorms",
  lecture_hall: "Lecture halls",
  library: "Library",
  sports: "Sports",
  labs: "Labs",
  student_life: "Student life",
  city: "City",
};

export type ProfilePhoto = {
  id: string;
  title: string;
  url: string;
  thumbUrl: string;
  sourceUrl: string;
  license: string | null;
  author: string | null;
  date: string | null;
  category: CategoryId;
  confidence: number;
  verified: boolean;
  note: string;
};

export type Profile = {
  title: string;
  city: string | null;
  country: string | null;
  officialSite: string | null;
  wikipediaUrl: string;
  summary: string;
  coordinates: { lat: number; lon: number } | null;
  photos: ProfilePhoto[];
  warnings: string[];
  elapsedMs: number;
};

type Cached = { at: number; profile: Profile };
const cache = new Map<string, Cached>();
const CACHE_TTL = 30 * 60 * 1000;

export const findUniversities = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ query: z.string().min(2) }).parse(input))
  .handler(async ({ data }) => {
    const candidates = await searchUniversities(data.query.trim());
    return { candidates };
  });

export const buildProfile = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ title: z.string().min(2) }).parse(input))
  .handler(async ({ data }): Promise<{ profile: Profile | null; error?: string }> => {
    const started = Date.now();
    const key = data.title.trim().toLowerCase();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL) {
      return { profile: { ...hit.profile, elapsedMs: Date.now() - started } };
    }

    let info: Awaited<ReturnType<typeof getPageInfo>> = null;
    try {
      info = await getPageInfo(data.title.trim());
    } catch {
      return {
        profile: null,
        error: "The open encyclopaedia is busy right now. Please try again in a few seconds.",
      };
    }
    if (!info) {
      return { profile: null, error: "We could not find a university page with that name." };
    }

    const name = info.title;
    const place = [info.city, info.country].filter(Boolean).join(", ");
    const warnings: string[] = [];

    const buckets = await Promise.all([
      info.commonsCategory ? imagesInCategory(info.commonsCategory, 24, name) : Promise.resolve([]),
      searchCommons(`${name} campus`, 16, name),
      searchCommons(`${name} building`, 12, name),
      searchCommons(`${name} library OR dormitory OR laboratory`, 12, name),
      searchCommons(`${name} students OR sports OR stadium`, 10, name),
      info.city ? searchCommons(`${info.city} city view`, 12, info.city) : Promise.resolve([]),
    ]);

    const pool: RawImage[] = dedupe(buckets.flat()).slice(0, 32);
    if (pool.length === 0) {
      return {
        profile: null,
        error: "No openly licensed photos were found for this university yet.",
      };
    }

    const payload = pool.map((img) => ({
      id: img.id,
      file: img.fileTitle,
      description: img.description ?? "",
      foundFor: img.queryHint,
    }));

    let ai: {
      summary: string;
      items: {
        id: string;
        category: string;
        belongs: boolean;
        confidence: number;
        note: string;
      }[];
    };

    try {
      ai = await aiJson({
        instructions:
          "You verify photographs for a university visual profile. Judge only from the file name, description and the search that surfaced it. " +
          "Set belongs=false for logos, maps, diagrams, coats of arms, portraits, documents, unrelated places or anything you cannot tie to the university or its city. " +
          "confidence is 0-100 and must be honest: below 50 when the evidence is weak. Never invent facts. " +
          "Keep each note under 12 words. Write a 2-3 sentence factual summary of the campus based on the provided encyclopaedia extract.",
        input: JSON.stringify({
          university: name,
          location: place || null,
          extract: info.extract.slice(0, 1500),
          images: payload,
        }),
        schemaName: "visual_profile",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["summary", "items"],
          properties: {
            summary: { type: "string" },
            items: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "category", "belongs", "confidence", "note"],
                properties: {
                  id: { type: "string" },
                  category: { type: "string", enum: [...CATEGORIES] },
                  belongs: { type: "boolean" },
                  confidence: { type: "number" },
                  note: { type: "string" },
                },
              },
            },
          },
        },
      });
    } catch (err) {
      return {
        profile: null,
        error: err instanceof Error ? err.message : "The verification step failed.",
      };
    }

    const byId = new Map(ai.items.map((i) => [i.id, i]));
    const photos: ProfilePhoto[] = [];
    for (const img of pool) {
      const verdict = byId.get(img.id);
      if (!verdict || !verdict.belongs) continue;
      const confidence = Math.max(0, Math.min(100, Math.round(verdict.confidence)));
      if (confidence < 25) continue;
      photos.push({
        id: img.id,
        title: img.fileTitle,
        url: img.url,
        thumbUrl: img.thumbUrl,
        sourceUrl: img.descriptionUrl,
        license: img.license,
        author: img.artist,
        date: img.date,
        category: (CATEGORIES as readonly string[]).includes(verdict.category)
          ? (verdict.category as CategoryId)
          : "campus",
        confidence,
        verified: confidence >= 60,
        note: verdict.note,
      });
    }

    photos.sort((a, b) => b.confidence - a.confidence);

    if (photos.length < 6) {
      warnings.push(
        "Few confirmed photos are available from open sources for this university — the profile is incomplete.",
      );
    }
    if (photos.some((p) => !p.verified)) {
      warnings.push("Photos marked “low confidence” could not be fully confirmed.");
    }
    if (!info.officialSite) {
      warnings.push("No official website is recorded in open data for this university.");
    }

    const profile: Profile = {
      title: name,
      city: info.city,
      country: info.country,
      officialSite: info.officialSite,
      wikipediaUrl: info.wikipediaUrl,
      summary: ai.summary || info.extract.slice(0, 400),
      coordinates: info.coordinates,
      photos,
      warnings,
      elapsedMs: Date.now() - started,
    };

    cache.set(key, { at: Date.now(), profile });
    return { profile };
  });
