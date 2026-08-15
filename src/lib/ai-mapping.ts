import { AnilistMapping, TMDBSeasonMapping, EpisodeRange } from './types';
import { searchShows, getShowDetails, getSeasonEpisodes, TMDBSearchResult } from './tmdb';
import { getAnilistInfo } from './anilist';
import fs from 'fs';
import path from 'path';

const CUSTOM_MAPPINGS_PATH = path.join(process.cwd(), 'data', 'custom-mappings.json');

// In-memory cache for AI mappings loaded from file
const customMappingsCache = new Map<number, AnilistMapping>();
let customMappingsLoaded = false;

interface LLMSeasonMapping {
  tmdbShowId: number;
  seasonNumber: number;
  anilistFrom: number;
  anilistTo: number;
  tmdbFrom: number;
  tmdbTo: number;
}

function loadCustomMappings(): void {
  if (customMappingsLoaded) return;
  try {
    if (fs.existsSync(CUSTOM_MAPPINGS_PATH)) {
      const raw = fs.readFileSync(CUSTOM_MAPPINGS_PATH, 'utf-8');
      const mappings: AnilistMapping[] = JSON.parse(raw);
      for (const m of mappings) {
        customMappingsCache.set(m.anilistId, m);
      }
      console.log(`[AI-Mapping] Loaded ${mappings.length} custom mappings from disk`);
    }
  } catch (e) {
    console.error('[AI-Mapping] Failed to load custom mappings:', e);
  }
  customMappingsLoaded = true;
}

function saveCustomMappings(): void {
  try {
    const arr = Array.from(customMappingsCache.values());
    const dir = path.dirname(CUSTOM_MAPPINGS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CUSTOM_MAPPINGS_PATH, JSON.stringify(arr, null, 2));
    console.log(`[AI-Mapping] Saved ${arr.length} custom mappings to disk`);
  } catch (e) {
    console.error('[AI-Mapping] Failed to save custom mappings:', e);
  }
}

export function getCustomMapping(anilistId: number): AnilistMapping | null {
  loadCustomMappings();
  return customMappingsCache.get(anilistId) ?? null;
}

/**
 * AI-powered fallback: AniList ID → TMDB mapping using LLM + TMDB search.
 *
 * Flow:
 * 1. Get anime info from AniList (title, episodes, season, year)
 * 2. Search TMDB for matching shows
 * 3. Use LLM to pick correct TMDB show and determine season mapping
 * 4. Validate by fetching actual TMDB season data
 * 5. Save mapping for future offline use
 */
export async function aiMapAnilistToTmdb(anilistId: number): Promise<AnilistMapping> {
  // Check custom cache first
  const existing = getCustomMapping(anilistId);
  if (existing) return existing;

  // Step 1: Get AniList info
  const anilistInfo = await getAnilistInfo(anilistId);
  const title = anilistInfo.titleEnglish || anilistInfo.titleRomaji || anilistInfo.titleNative || '';
  if (!title) throw new Error(`No title found for AniList ID: ${anilistId}`);

  // Step 2: Search TMDB
  const searchResults = await searchShows(title);
  if (!searchResults.results?.length) {
    throw new Error(`No TMDB search results for: ${title}`);
  }

  // Step 3: Use LLM to determine the mapping
  const tmdbMappings = await llmDetermineMapping(anilistId, {
    title,
    titleRomaji: anilistInfo.titleRomaji,
    titleNative: anilistInfo.titleNative,
    coverImage: anilistInfo.coverImage,
    bannerImage: anilistInfo.bannerImage,
  }, searchResults.results.slice(0, 5));

  const mapping: AnilistMapping = {
    anilistId,
    malId: null,
    tmdbMappings,
  };

  // Step 4: Save for future use
  customMappingsCache.set(anilistId, mapping);
  saveCustomMappings();

  return mapping;
}

/**
 * Use LLM to pick the right TMDB show and determine season mapping.
 */
async function llmDetermineMapping(
  anilistId: number,
  anilistInfo: { title: string; titleRomaji: string | null; titleNative: string | null; coverImage: string | null; bannerImage: string | null },
  tmdbResults: TMDBSearchResult[]
): Promise<TMDBSeasonMapping[]> {
  // Fetch details for top TMDB results to get season info
  const tmdbDetails = await Promise.allSettled(
    tmdbResults.slice(0, 3).map(r => getShowDetails(r.id))
  );

  const tmdbContext = tmdbResults.slice(0, 3).map((r, i) => {
    const detail = tmdbDetails[i].status === 'fulfilled' ? tmdbDetails[i].value : null;
    const seasons = detail?.seasons
      ?.filter(s => s.season_number > 0)
      .map(s => ({
          season: s.season_number,
          name: s.name,
          episodeCount: s.episode_count,
          airDate: s.air_date || 'unknown',
        }))
      ?? [];
    return {
      tmdbId: r.id,
      name: r.name,
      originalName: r.original_name,
      firstAirDate: r.first_air_date,
      popularity: r.popularity,
      totalSeasons: detail?.number_of_seasons ?? r.number_of_seasons ?? 0,
      totalEpisodes: detail?.number_of_seasons ? undefined : r.number_of_episodes,
      seasons,
    };
  });

  // Build the prompt for LLM
  const systemPrompt = `You are an anime-to-TMDB mapping expert. Given an anime from AniList and TMDB search results, determine the correct TMDB show and season mapping.

Rules:
- Pick the TMDB show that best matches the anime
- Many anime have multiple seasons/parts on TMDB (e.g., "Re:Zero - Starting Life in Another World" has Season 1, Season 2 Part 1, Season 2 Part 2 as separate TMDB entries, OR they might be seasons within one show)
- AniList often splits seasons into separate entries (e.g., Re:Zero S2 Part 1 = anilist 108632, Re:Zero S2 Part 2 = anilist 119661)
- Your job is to figure out which TMDB season(s) correspond to THIS specific AniList entry
- For single-season shows: direct 1:1 mapping
- For multi-part shows: identify the correct season/part
- Some anime have all episodes in one TMDB season, some split across multiple TMDB seasons/shows

Respond ONLY with valid JSON array, no markdown, no explanation. Each element must have:
{"tmdbShowId": number, "seasonNumber": number, "anilistFrom": number, "anilistTo": number, "tmdbFrom": number, "tmdbTo": number}

- tmdbShowId: the TMDB show ID
- seasonNumber: which TMDB season (1, 2, 3...)
- anilistFrom/anilistTo: the AniList episode range for this show (use 1-based, e.g. 1-25)
- tmdbFrom/tmdbTo: the corresponding TMDB episode range in that season`;

  const userPrompt = `AniList ID: ${anilistId}
Anime Title: ${anilistInfo.title}
Romaji: ${anilistInfo.titleRomaji || 'N/A'}
Native: ${anilistInfo.titleNative || 'N/A'}

TMDB Search Results:
${JSON.stringify(tmdbContext, null, 2)}

Determine the correct TMDB mapping for this AniList entry. Return ONLY a JSON array.`;

  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();

    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      thinking: { type: 'disabled' },
    });

    const responseText = completion.choices?.[0]?.message?.content;
    if (!responseText) throw new Error('Empty LLM response');

    // Parse the LLM response - extract JSON array
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error(`Could not parse LLM response: ${responseText}`);

    const parsed: LLMSeasonMapping[] = JSON.parse(jsonMatch[0]);

    // Convert to TMDBSeasonMapping format
    const mappings: TMDBSeasonMapping[] = parsed.map(m => ({
      tmdbShowId: m.tmdbShowId,
      seasonNumber: m.seasonNumber,
      anilistRange: { from: m.anilistFrom, to: m.anilistTo },
      tmdbRange: { from: m.tmdbFrom, to: m.tmdbTo },
    }));

    // Validate: fetch actual TMDB season data to confirm episode ranges
    await validateMappings(mappings);

    return mappings;
  } catch (error) {
    console.error('[AI-Mapping] LLM failed, falling back to heuristic:', error);
    // Fallback: simple heuristic - pick first result, assume 1:1
    return heuristicMapping(anilistId, tmdbResults);
  }
}

/**
 * Validate mappings by checking actual TMDB season episode counts.
 */
async function validateMappings(mappings: TMDBSeasonMapping[]): Promise<void> {
  for (const m of mappings) {
    try {
      const season = await getSeasonEpisodes(m.tmdbShowId, m.seasonNumber);
      const actualEpCount = season.episodes?.length ?? 0;
      const expectedRange = m.tmdbRange.to - m.tmdbRange.from + 1;
      if (actualEpCount > 0 && expectedRange > actualEpCount) {
        console.warn(
          `[AI-Mapping] Validation warning: TMDB ${m.tmdbShowId} S${m.seasonNumber} has ${actualEpCount} episodes but mapping expects range ${m.tmdbRange.from}-${m.tmdbRange.to} (${expectedRange} eps)`
        );
      }
    } catch (e) {
      console.warn(`[AI-Mapping] Could not validate TMDB ${m.tmdbShowId} S${m.seasonNumber}:`, e);
    }
  }
}

/**
 * Fallback heuristic when LLM fails: pick best TMDB result and do simple 1:1 mapping.
 */
async function heuristicMapping(
  anilistId: number,
  tmdbResults: TMDBSearchResult[]
): Promise<TMDBSeasonMapping[]> {
  // Pick the most popular result
  const best = tmdbResults[0];
  if (!best) throw new Error('No TMDB results available for heuristic mapping');

  // Get show details to check seasons
  const details = await getShowDetails(best.id);
  const seasons = details.seasons?.filter(s => s.season_number > 0) ?? [];

  const mappings: TMDBSeasonMapping[] = [];

  if (seasons.length <= 1) {
    // Single season: 1:1 mapping
    const epCount = seasons[0]?.episode_count ?? 25;
    mappings.push({
      tmdbShowId: best.id,
      seasonNumber: 1,
      anilistRange: { from: 1, to: epCount },
      tmdbRange: { from: 1, to: epCount },
    });
  } else {
    // Multiple seasons: map them sequentially
    let anilistEp = 1;
    for (const s of seasons) {
      if (!s.episode_count) continue;
      mappings.push({
        tmdbShowId: best.id,
        seasonNumber: s.season_number,
        anilistRange: { from: anilistEp, to: anilistEp + s.episode_count - 1 },
        tmdbRange: { from: 1, to: s.episode_count },
      });
      anilistEp += s.episode_count;
    }
  }

  console.log(`[AI-Mapping] Heuristic mapping for ${anilistId} → TMDB ${best.id}:`, JSON.stringify(mappings));
  return mappings;
}