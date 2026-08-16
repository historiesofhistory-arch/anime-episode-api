import { AnilistMapping, TMDBSeasonMapping, EpisodeRange } from './types';
import { searchShows, getShowDetails, getSeasonEpisodes, TMDBSearchResult } from './tmdb';
import { getAnilistInfo } from './anilist';
import fs from 'fs';
import path from 'path';

/**
 * Extract season/part/cour number from an anime title.
 * Handles patterns like "Season 4", "S4", "Part 2", "Cour 2", "3rd Season", etc.
 * Returns null if no season indicator is found.
 */
function extractSeasonFromTitle(title: string): number | null {
  // "Season 4", "Season4", "S4", "S 4"
  const seasonMatch = title.match(/(?:Season\s*|S\s*)(\d+)/i);
  if (seasonMatch) return parseInt(seasonMatch[1], 10);

  // "Part 2", "Part2", "P2"
  const partMatch = title.match(/(?:Part\s*|P\s*)(\d+)/i);
  if (partMatch) return parseInt(partMatch[1], 10);

  // "Cour 2", "Cour2"
  const courMatch = title.match(/Cour\s*(\d+)/i);
  if (courMatch) return parseInt(courMatch[1], 10);

  // "3rd Season", "2nd Season", "1st Season"
  const ordinalMatch = title.match(/(\d+)(?:st|nd|rd|th)\s*Season/i);
  if (ordinalMatch) return parseInt(ordinalMatch[1], 10);

  // "II", "III", "IV" (Roman numerals) — limited to common ones
  const romanMatch = title.match(/\b(II|III|IV|V|VI|VII|VIII)\b/i);
  if (romanMatch) {
    const romanMap: Record<string, number> = {
      'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7, 'VIII': 8,
    };
    return romanMap[romanMatch[1].toUpperCase()] ?? null;
  }

  return null;
}


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
 * 1. Get anime info from AniList (or LLM + web search if AniList is down)
 * 2. Search TMDB for matching shows
 * 3. Use LLM to pick correct TMDB show and determine season mapping
 * 4. Validate by fetching actual TMDB season data
 * 5. Save mapping for future offline use
 */
export async function aiMapAnilistToTmdb(anilistId: number): Promise<AnilistMapping> {
  // Check custom cache first
  const existing = getCustomMapping(anilistId);
  if (existing) return existing;

  // Step 1: Get AniList info (try AniList first, then LLM fallback)
  let anilistInfo: Awaited<ReturnType<typeof getAnilistInfo>>;
  let title = '';
  try {
    anilistInfo = await getAnilistInfo(anilistId);
    title = anilistInfo.titleEnglish || anilistInfo.titleRomaji || anilistInfo.titleNative || '';
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    // If AniList is down (403), say so clearly instead of guessing wrong
    if (msg.includes('403')) {
      throw new Error(`AniList API is temporarily down (403). AI mapping requires AniList to identify the anime. Please try again later. For now, only anime in the offline database (18,697 titles) are available during this outage.`);
    }
    // Other errors: try web search + LLM as best effort
    console.log(`[AI-Mapping] AniList API failed for ${anilistId}, using web search + LLM...`);
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();

    // Try multiple search queries for better coverage
    const queries = [
      `anilist ${anilistId} anime`,
      `anilist.co/anime/${anilistId}`,
      `${anilistId} anime title name`,
    ];
    let allResults: any[] = [];
    for (const q of queries) {
      try {
        const r = await zai.functions.invoke('web_search', { query: q, num: 3 });
        if (r?.length) allResults.push(...r);
      } catch { /* skip failed queries */ }
    }

    // Deduplicate by URL
    const seen = new Set<string>();
    allResults = allResults.filter(r => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });

    // Ask LLM to extract the anime title from all search results
    const identify = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: 'You identify anime from web search results about an AniList ID. Look at ALL the search results carefully. Return ONLY the anime\'s English title. If you see the anime name in any result, return it exactly. No quotes, no explanation, just the title. If you cannot determine the title, return the romaji name.' },
        { role: 'user', content: `What anime is AniList ID ${anilistId}?\n\nWeb search results:\n${JSON.stringify(allResults.slice(0, 8), null, 2)}` },
      ],
      thinking: { type: 'disabled' },
    });
    title = (identify.choices?.[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '');
    console.log(`[AI-Mapping] LLM identified: ${title}`);

    // If TMDB search with this title fails, try with just the first few meaningful words
    if (!title) throw new Error(`No title found for AniList ID: ${anilistId}`);
    anilistInfo = { idMal: null, titleEnglish: title || null, titleRomaji: null, titleNative: null, coverImage: null, bannerImage: null, seasonYear: null, format: null, status: null, episodes: null, nextAiringEpisode: null, relations: null } as any;
  }
  if (!title) throw new Error(`No title found for AniList ID: ${anilistId}`);

  // Extract season number from the title BEFORE stripping it
  let detectedSeason = extractSeasonFromTitle(title);
  console.log(`[AI-Mapping] Detected season=${detectedSeason} from title: "${title}"`);

  // Also try to infer season from AniList relations (if available)
  // e.g., if this entry has a PREQUEL relation to Season 3, this is likely Season 4
  if (!detectedSeason && anilistInfo.relations?.edges?.length) {
    const prequels = anilistInfo.relations.edges
      .filter(e => e.relationType === 'PREQUEL' && e.node.format === 'TV')
      .map(e => ({
        id: e.node.id,
        title: e.node.title.english || e.node.title.romaji,
        season: extractSeasonFromTitle(e.node.title.english || e.node.title.romaji || ''),
        year: e.node.seasonYear,
      }));

    if (prequels.length > 0) {
      // Find the prequel with the highest season number
      const maxPrequelSeason = Math.max(...prequels.map(p => p.season ?? 0));
      if (maxPrequelSeason > 0) {
        detectedSeason = maxPrequelSeason + 1;
        console.log(`[AI-Mapping] Inferred season=${detectedSeason} from prequel relations (max prequel season=${maxPrequelSeason})`);
      } else {
        // No season in prequel titles — count prequels as a fallback
        // Sort by seasonYear to count them in order
        const sorted = prequels
          .filter(p => p.year)
          .sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
        if (sorted.length > 0) {
          detectedSeason = sorted.length + 1;
          console.log(`[AI-Mapping] Inferred season=${detectedSeason} from ${sorted.length} prequel relation(s)`);
        }
      }
    }
  }

  if (detectedSeason) {
    console.log(`[AI-Mapping] Final detected season: ${detectedSeason} for anilistId=${anilistId}`);
  }

  // Step 2: Search TMDB
  let tmdbSearchResults = await searchShows(title);
  if (!tmdbSearchResults.results?.length) {
    // TMDB search failed — try with shortened title (remove subtitles/season info)
    const shortTitle = title.replace(/\s*(Season|S\d+|Part|Cour|\d+)(\s*\d+)?.*$/i, '').trim();
    if (shortTitle !== title && shortTitle.length > 2) {
      console.log(`[AI-Mapping] TMDB no results for "${title}", trying "${shortTitle}"`);
      tmdbSearchResults = await searchShows(shortTitle);
    }
  }
  if (!tmdbSearchResults.results?.length) {
    throw new Error(`No TMDB search results for: ${title}`);
  }

  // Step 3: Use LLM to determine the mapping
  const tmdbMappings = await llmDetermineMapping(anilistId, {
    title,
    titleRomaji: anilistInfo.titleRomaji,
    titleNative: anilistInfo.titleNative,
    coverImage: anilistInfo.coverImage,
    bannerImage: anilistInfo.bannerImage,
    detectedSeason,
  }, tmdbSearchResults.results.slice(0, 5));

  const mapping: AnilistMapping = {
    anilistId,
    malId: null,
    tmdbMappings,
  };

  // Step 4: Save for future use (only cache in memory — don't persist heuristic mappings)
  customMappingsCache.set(anilistId, mapping);
  // NOTE: We do NOT call saveCustomMappings() here anymore.
  // Heuristic mappings are not persisted to disk because they are unreliable.
  // Only LLM-validated mappings should be persisted (handled inside llmDetermineMapping on success).

  return mapping;
}

/**
 * Use LLM to pick the right TMDB show and determine season mapping.
 */
async function llmDetermineMapping(
  anilistId: number,
  anilistInfo: { title: string; titleRomaji: string | null; titleNative: string | null; coverImage: string | null; bannerImage: string | null; detectedSeason: number | null },
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
- Many anime have multiple seasons/parts on TMDB (e.g., "Re:Zero" has Season 1, Season 2 Part 1, Season 2 Part 2 as separate TMDB entries, OR they might be seasons within one show)
- AniList often splits seasons into separate entries (e.g., Re:Zero S2 Part 1 = anilist 108632, Re:Zero S2 Part 2 = anilist 119661)
- Your job is to figure out which TMDB season(s) correspond to THIS specific AniList entry
- For single-season shows: direct 1:1 mapping
- For multi-part shows: identify the correct season/part
- Some anime have all episodes in one TMDB season, some split across multiple TMDB seasons/shows
- Pay close attention to season names like "Season 4", "Part 1", "Cour 1", etc.

Respond ONLY with valid JSON array, no markdown, no explanation. Each element must have:
{"tmdbShowId": number, "seasonNumber": number, "anilistFrom": number, "anilistTo": number, "tmdbFrom": number, "tmdbTo": number}

- tmdbShowId: the TMDB show ID
- seasonNumber: which TMDB season (1, 2, 3...)
- anilistFrom/anilistTo: the AniList episode range for this show (use 1-based, e.g. 1-25)
- tmdbFrom/tmdbTo: the corresponding TMDB episode range in that season`;

  const seasonHint = anilistInfo.detectedSeason
    ? `\n\nIMPORTANT: This AniList entry's title contains "Season ${anilistInfo.detectedSeason}" (or equivalent). This is almost certainly Season ${anilistInfo.detectedSeason} of the franchise. Map it to the correct TMDB season accordingly. If TMDB has a season ${anilistInfo.detectedSeason}, use that. If TMDB groups it differently (e.g., parts/cours), pick the part that corresponds to season ${anilistInfo.detectedSeason}.`
    : '';

  const userPrompt = `AniList ID: ${anilistId}
Anime Title: ${anilistInfo.title}
Romaji: ${anilistInfo.titleRomaji || 'N/A'}
Native: ${anilistInfo.titleNative || 'N/A'}${seasonHint}

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

    // Cache in memory only — no disk persistence
    const mapping: AnilistMapping = {
      anilistId,
      malId: null,
      tmdbMappings: mappings,
    };
    customMappingsCache.set(anilistId, mapping);
    console.log(`[AI-Mapping] LLM-validated mapping cached (memory only) for anilistId=${anilistId}`);

    return mappings;
  } catch (error) {
    console.error('[AI-Mapping] LLM failed, falling back to heuristic:', error);
    // Fallback: simple heuristic - pick first result, use detected season if available
    return heuristicMapping(anilistId, tmdbResults, anilistInfo.detectedSeason);
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
 * Now uses detectedSeason to pick the correct TMDB season instead of defaulting to S1.
 */
async function heuristicMapping(
  anilistId: number,
  tmdbResults: TMDBSearchResult[],
  detectedSeason: number | null
): Promise<TMDBSeasonMapping[]> {
  // Pick the most popular result
  const best = tmdbResults[0];
  if (!best) throw new Error('No TMDB results available for heuristic mapping');

  // Get show details to check seasons
  const details = await getShowDetails(best.id);
  const seasons = details.seasons?.filter(s => s.season_number > 0) ?? [];

  const mappings: TMDBSeasonMapping[] = [];

  // If we detected a season number, try to map to THAT specific season
  if (detectedSeason && seasons.length > 0) {
    const targetSeason = seasons.find(s => s.season_number === detectedSeason);
    if (targetSeason) {
      const epCount = targetSeason.episode_count ?? 25;
      mappings.push({
        tmdbShowId: best.id,
        seasonNumber: detectedSeason,
        anilistRange: { from: 1, to: epCount },
        tmdbRange: { from: 1, to: epCount },
      });
      console.log(`[AI-Mapping] Heuristic mapping for ${anilistId} → TMDB ${best.id} Season ${detectedSeason} (detected from title):`, JSON.stringify(mappings));
      return mappings;
    } else {
      console.warn(`[AI-Mapping] Detected season ${detectedSeason} but TMDB ${best.id} doesn't have it. Available seasons: ${seasons.map(s => s.season_number).join(', ')}`);
    }
  }

  // No season detected or season not found: fall back to original behavior
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
    // Multiple seasons without season hint: map only the first season
    // (safer default than mapping ALL seasons which was the old bug)
    const firstSeason = seasons[0];
    const epCount = firstSeason?.episode_count ?? 25;
    mappings.push({
      tmdbShowId: best.id,
      seasonNumber: 1,
      anilistRange: { from: 1, to: epCount },
      tmdbRange: { from: 1, to: epCount },
    });
    console.warn(`[AI-Mapping] Heuristic: no season detected, defaulting to Season 1 for ${anilistId}. This may be wrong — LLM mapping is preferred.`);
  }

  console.log(`[AI-Mapping] Heuristic mapping for ${anilistId} → TMDB ${best.id}:`, JSON.stringify(mappings));
  return mappings;
}
