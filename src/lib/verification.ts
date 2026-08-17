import { AnimeEpisode, TMDBEpisode } from './types';
import { getAllTmdbEpisodes, getTmdbImageUrl } from './tmdb';

function hasAired(airDate: string | null | undefined): boolean {
  if (!airDate) return false;
  const today = new Date();
  const utcToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 23, 59, 59));
  return new Date(airDate + 'T00:00:00Z') <= utcToday;
}

function parseDate(d: string): number {
  // Returns ms since epoch for YYYY-MM-DD
  const [y, m, day] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, day);
}

function daysToMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}

export interface VerificationResult {
  episodes: AnimeEpisode[];
  tmdbShowId: number;
  method: 'exact' | 'tolerance' | 'none';
  totalTmdbEpisodes: number;
}

/**
 * Verification Layer: Fetches ALL TMDB episodes (flat, ignoring seasons),
 * matches by date range [startDate, endDate] with ±1 day tolerance fallback.
 * Overwrites any DB/other episode mapping.
 *
 * @param tmdbShowId - TMDB show ID
 * @param startDate - YYYY-MM-DD from MAL/AniList
 * @param endDate - YYYY-MM-DD or null (ongoing)
 * @param anilistId - AniList ID (for episode IDs)
 * @param expectedEpCount - Optional expected episode count for confirmation
 */
export async function verifyEpisodes(
  tmdbShowId: number,
  startDate: string,
  endDate: string | null,
  anilistId: number,
  expectedEpCount?: number | null,
): Promise<VerificationResult> {
  // Fetch all TMDB episodes flat (all seasons, skip specials)
  const allTmdbEps = await getAllTmdbEpisodes(tmdbShowId, true);

  if (allTmdbEps.length === 0) {
    console.log(`[VERIFY] No TMDB episodes found for show ${tmdbShowId}`);
    return { episodes: [], tmdbShowId, method: 'none', totalTmdbEpisodes: 0 };
  }

  console.log(`[VERIFY] Fetched ${allTmdbEps.length} total TMDB episodes for show ${tmdbShowId}`);
  console.log(`[VERIFY] Date range: ${startDate} → ${endDate || 'ongoing'}`);

  const startMs = parseDate(startDate);
  const endMs = endDate ? parseDate(endDate) : null;
  const toleranceMs = daysToMs(1);

  // PASS 1: Exact date match
  const exactMatched = matchEpisodes(allTmdbEps, startMs, endMs, 0, anilistId);

  // If exact found episodes AND count matches expected → done
  if (exactMatched.length > 0 && exactMatched.length === expectedEpCount) {
    console.log(`[VERIFY] EXACT match: ${exactMatched.length} episodes`);
    logEpCountCheck(exactMatched.length, expectedEpCount);
    return {
      episodes: exactMatched,
      tmdbShowId,
      method: 'exact',
      totalTmdbEpisodes: allTmdbEps.length,
    };
  }

  // If exact found episodes but count mismatches, OR exact found 0 → try tolerance
  // (covers cases like AoT S1 where last ep is 1 day off)
  const toleranceMatched = matchEpisodes(allTmdbEps, startMs, endMs, toleranceMs, anilistId);

  if (toleranceMatched.length > 0) {
    const method = exactMatched.length > 0 ? 'tolerance_fix' : 'tolerance';
    console.log(`[VERIFY] ${method === 'tolerance_fix' ? 'TOLERANCE (fixed count mismatch)' : 'TOLERANCE (±1 day)'} match: ${toleranceMatched.length} episodes`);
    logEpCountCheck(toleranceMatched.length, expectedEpCount);
    return {
      episodes: toleranceMatched,
      tmdbShowId,
      method: method === 'tolerance_fix' ? 'tolerance' : 'none',
      totalTmdbEpisodes: allTmdbEps.length,
    };
  }

  // Exact had results but tolerance had none — use exact
  if (exactMatched.length > 0) {
    console.log(`[VERIFY] EXACT match (no tolerance improvement): ${exactMatched.length} episodes`);
    logEpCountCheck(exactMatched.length, expectedEpCount);
    return {
      episodes: exactMatched,
      tmdbShowId,
      method: 'exact',
      totalTmdbEpisodes: allTmdbEps.length,
    };
  }

  console.log(`[VERIFY] No episodes matched for show ${tmdbShowId} in range ${startDate} → ${endDate || 'ongoing'}`);
  return { episodes: [], tmdbShowId, method: 'none', totalTmdbEpisodes: allTmdbEps.length };
}

/**
 * Match TMDB episodes within [startMs - tolerance, endMs + tolerance].
 * Episodes must have a valid air_date.
 */
function matchEpisodes(
  tmdbEps: TMDBEpisode[],
  startMs: number,
  endMs: number | null,
  toleranceMs: number,
  anilistId: number,
): AnimeEpisode[] {
  const effectiveStart = startMs - toleranceMs;
  const effectiveEnd = endMs ? endMs + toleranceMs : null;

  const matched: AnimeEpisode[] = [];
  for (const ep of tmdbEps) {
    if (!ep.air_date) continue;

    const epMs = parseDate(ep.air_date);

    // Must be at or after effective start
    if (epMs < effectiveStart) continue;

    // Must be at or before effective end (if end date exists)
    if (effectiveEnd !== null && epMs > effectiveEnd) continue;

    matched.push({
      id: `${anilistId}-${matched.length + 1}`,
      number: matched.length + 1,
      title: ep.name || '',
      description: ep.overview || '',
      image: getTmdbImageUrl(ep.still_path ?? null),
      airDate: ep.air_date || '',
      duration: ep.runtime || 24,
      isFiller: false,
      titleJa: '',
      rating: '0',
      hasAired: hasAired(ep.air_date),
    });
  }

  return matched;
}

function logEpCountCheck(matched: number, expected?: number | null) {
  if (!expected || expected <= 0) return;
  if (matched === expected) {
    console.log(`[VERIFY] Episode count confirmed: ${matched}/${expected}`);
  } else {
    console.log(`[VERIFY] Episode count mismatch: got ${matched}, expected ${expected}. Using verified count.`);
  }
}
