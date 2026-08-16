/**
 * Date-based AniList → TMDB episode mapping (NO AI, NO IMDB)
 * 
 * Flow:
 * 1. Extract root name + detect season/part from AniList title
 * 2. If season/part: BFS PREQUEL chain → find S1 → get S1 startDate (verification)
 * 3. Get the requested entry's startDate + endDate
 * 4. Search TMDB with root English name
 * 5. Verify TMDB show by S1 date match (or popularity fallback)
 * 6. Fetch ALL TMDB episodes (flat, all seasons)
 * 7. Match startDate/endDate → find exact episode range
 */

import { AnilistMapping, TMDBSeasonMapping, TMDBEpisode } from './types';
import { fetchMalForBfs } from './mal';

const ANILIST_API = 'https://graphql.anilist.co';
const TMDB_KEY = process.env.TMDB_API_KEY || '';
const TMDB_BASE = 'https://api.themoviedb.org/3';

// ====== AniList (FALLBACK only — used when MAL ID unavailable) ======

interface AnilistMedia {
  id: number;
  title: { english: string | null; romaji: string | null; native: string | null };
  format: string | null;
  seasonYear: number | null;
  episodes: number | null;
  startDate: { year: number | null; month: number | null; day: number | null } | null;
  endDate: { year: number | null; month: number | null; day: number | null } | null;
}

const ANILIST_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id idMal
    title { english romaji native }
    format
    seasonYear
    episodes
    startDate { year month day }
    endDate { year month day }
  }
}
`;

async function fetchAnilist(id: number): Promise<AnilistMedia | null> {
  const res = await fetch(ANILIST_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: ANILIST_QUERY, variables: { id } }),
  });
  if (!res.ok) throw new Error(`AniList API error: ${res.status}`);
  const json: any = await res.json();
  return json.data?.Media ?? null;
}

function formatDateAL(d: { year: number | null; month: number | null; day: number | null } | null): string {
  if (!d || !d.year) return '';
  return `${d.year}-${String(d.month ?? 0).padStart(2, '0')}-${String(d.day ?? 0).padStart(2, '0')}`;
}

// ====== Title Parsing ======

function extractRootName(title: string): string {
  if (!title) return '';
  return title
    .replace(/,?\s*(?:Season|S)\s*\d+.*$/i, '')
    .replace(/,?\s*(?:Part|P|Cour)\s*\d+.*$/i, '')
    .replace(/,?\s*\d+(?:st|nd|rd|th)\s*Season.*$/i, '')
    .trim();
}

function hasSeasonOrPart(title: string): boolean {
  return /(?:Season|S)\s*\d+|(?:Part|P|Cour)\s*\d+|\d+(?:st|nd|rd|th)\s*Season/i.test(title);
}

// ====== BFS: Find Root Season (S1) via MAL ======

async function findRootSeason(startMalId: number): Promise<{ id: number; startDate: string; title: string } | null> {
  const visited = new Set<number>();
  const queue = [startMalId];
  let root: { id: number; startDate: string; title: string; seasonYear: number } | null = null;
  const RELEVANT = new Set(['prequel', 'sequel']);
  const TV = new Set(['tv', 'tv_short']);

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    try {
      const m = await fetchMalForBfs(id);
      if (!m || !TV.has(m.format || '')) continue;
      const year = parseInt(m.startDate?.substring(0, 4) || '9999', 10);
      if (!root || year < root.seasonYear || (year === root.seasonYear && m.id < root.id)) {
        root = { id: m.id, startDate: m.startDate, title: m.title, seasonYear: year };
      }
      for (const r of m.relations) {
        if (RELEVANT.has(r.relationType) && TV.has(r.mediaType || '') && !visited.has(r.malId)) {
          queue.push(r.malId);
        }
      }
    } catch { /* skip failed */ }
  }

  if (!root) return null;
  return { id: root.id, startDate: root.startDate, title: root.title };
}

// ====== TMDB ======

interface TmdbSearchResult {
  id: number; name: string; first_air_date?: string; release_date?: string; popularity: number;
  title?: string; // movies use 'title' instead of 'name'
}

async function tmdbGet<T>(endpoint: string): Promise<T> {
  const sep = endpoint.includes('?') ? '&' : '?';
  const url = `${TMDB_BASE}${endpoint}${sep}api_key=${TMDB_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB ${res.status} for ${endpoint}`);
  return res.json();
}

async function searchTmdb(query: string): Promise<TmdbSearchResult[]> {
 const data = await tmdbGet<any>(`/search/tv?query=${encodeURIComponent(query)}&language=en-US&include_adult=false`);
  return (data.results || []).map((r: any) => ({ id: r.id, name: r.name || '', first_air_date: r.first_air_date, popularity: r.popularity }));
}

async function searchTmdbMovie(query: string): Promise<TmdbSearchResult[]> {
  const data = await tmdbGet<any>(`/search/movie?query=${encodeURIComponent(query)}&language=en-US&include_adult=false`);
  return (data.results || []).map((r: any) => ({ id: r.id, name: r.title || '', first_air_date: r.release_date, popularity: r.popularity }));
}

async function getTmdbAllEpisodes(tmdbId: number): Promise<{ ep: TMDBEpisode; season_number: number }[]> {
  const show: any = await tmdbGet<any>(`/tv/${tmdbId}`);
  const seasons = (show.seasons || []).filter((s: any) => s.season_number > 0);

  const allEps = await Promise.all(
    seasons.map(async (s: any) => {
      try {
        const data: any = await tmdbGet<any>(`/tv/${tmdbId}/season/${s.season_number}`);
        return (data.episodes || []).map((ep: TMDBEpisode) => ({ ep, season_number: s.season_number }));
      } catch { return []; }
    })
  );
  return allEps.flat();
}

// ====== Main Mapping Function ======

export interface DateMappingResult {
  anilistId: number;
  title: string;
  rootName: string;
  hasSeasonOrPart: boolean;
  rootS1: { id: number; startDate: string; title: string } | null;
  tmdbShow: { id: number; name: string; verified: boolean } | null;
  startDate: string;
  endDate: string;
  anilistEpisodes: number | null;
  mappings: TMDBSeasonMapping[];
  episodes: { ep: TMDBEpisode; season: number }[];
  errors: string[];
}

export async function dateBasedMapping(anilistId: number): Promise<DateMappingResult> {
  const result: DateMappingResult = {
    anilistId, title: '', rootName: '', hasSeasonOrPart: false,
    rootS1: null, tmdbShow: null,
    startDate: '', endDate: '', anilistEpisodes: null,
    mappings: [], episodes: [], errors: [],
  };

  // Step 1: Fetch MAL info (primary) or AniList (fallback) to get title, dates, format, malId
  let title = '';
  let format: string | null = null;
  let malId: number | null = null;

  // Try AniList first just to get idMal (one small call)
  const alEntry = await fetchAnilist(anilistId).catch(() => null);
  malId = (alEntry as any)?.idMal ?? null;

  // Get full info from MAL if we have malId
  let startDate = '';
  let endDate = '';
  let episodes: number | null = null;
  if (malId) {
    try {
      const { getMalInfo } = await import('./mal');
      const malInfo = await getMalInfo(malId);
      title = malInfo.titleEnglish || malInfo.titleRomaji || '';
      format = malInfo.format;
      startDate = malInfo.startDate;
      endDate = malInfo.endDate;
      episodes = malInfo.episodes;
    } catch { /* MAL failed, fall back to AniList data */ }
  }

  // Fallback: use AniList data if MAL didn't work
  if (!title && alEntry) {
    title = alEntry.title.english || alEntry.title.romaji || '';
    format = alEntry.format;
    startDate = formatDateAL(alEntry.startDate);
    endDate = formatDateAL(alEntry.endDate);
    episodes = alEntry.episodes;
  }

  result.title = title;
  result.rootName = extractRootName(title);
  result.hasSeasonOrPart = hasSeasonOrPart(title);
  result.startDate = startDate;
  result.endDate = endDate;
  result.anilistEpisodes = episodes;

  // Step 2: If season/part, find root S1 via MAL BFS
  let rootStartDate = result.startDate;
  if (result.hasSeasonOrPart && malId) {
    const root = await findRootSeason(malId);
    if (root) {
      result.rootS1 = root;
      rootStartDate = root.startDate || result.startDate;
    }
  }

  // Step 2.5: Handle MOVIE format (and single-episode formats that map to movies) differently
  if (format === 'MOVIE' || format === 'SPECIAL' || format === 'TV_SPECIAL') {
    return await mapMovie(result, title);
  }

  // Step 3: Search TMDB
  const tmdbResults = await searchTmdb(result.rootName).catch(e => { result.errors.push(`TMDB search: ${e.message}`); return []; });
  if (!tmdbResults.length) { result.errors.push(`No TMDB results for "${result.rootName}"`); return result; }

  // Step 4: Verify by S1 date match
  let matchedShow: TmdbSearchResult | null = null;
  for (const r of tmdbResults.slice(0, 5)) {
    const s1Date = r.first_air_date?.substring(0, 10) || '';
    if (s1Date && s1Date === rootStartDate) {
      matchedShow = r;
      break;
    }
  }
  if (!matchedShow) {
    matchedShow = tmdbResults[0];
  }
  result.tmdbShow = { id: matchedShow.id, name: matchedShow.name, verified: matchedShow.first_air_date?.substring(0, 10) === rootStartDate };

  // Step 5: Get ALL TMDB episodes (flat)
  const allEps = await getTmdbAllEpisodes(matchedShow.id).catch(e => {
    result.errors.push(`TMDB episodes: ${e.message}`);
    return [];
  });
  if (!allEps.length) { result.errors.push('No TMDB episodes found'); return result; }

  // Step 6: Match by date range
  if (!result.startDate) { result.errors.push('No AniList startDate'); return result; }

  const firstMatch = allEps.find(e => e.ep.air_date === result.startDate);
  // For lastMatch: try exact endDate, else fall back to last available episode from startDate
  const lastMatch = result.endDate
    ? (allEps.find(e => e.ep.air_date === result.endDate)
       ?? allEps.filter(e => e.ep.air_date >= result.startDate).pop())
    : allEps.filter(e => e.ep.air_date >= result.startDate).pop();

  if (!firstMatch) {
    result.errors.push(`No TMDB episode with air_date="${result.startDate}"`);
    return result;
  }

  // Build episode list and mapping
  const startS = firstMatch.season_number;
  const startE = firstMatch.ep.episode_number;

  let endS = startS;
  let endE = startE;
  if (lastMatch) {
    endS = lastMatch.season_number;
    endE = lastMatch.ep.episode_number;
  }

  // Collect all episodes in range
  const epsInRange = allEps.filter(e => {
    if (!e.ep.air_date) return false;
    return e.ep.air_date >= result.startDate && (!result.endDate || e.ep.air_date <= result.endDate);
  });

  result.episodes = epsInRange.map(e => ({ ep: e.ep, season: e.season_number }));

  // Build TMDBSeasonMapping (may span multiple TMDB seasons)
  const bySeason = new Map<number, typeof epsInRange>();
  for (const e of epsInRange) {
    if (!bySeason.has(e.season_number)) bySeason.set(e.season_number, []);
    bySeason.get(e.season_number)!.push(e);
  }

  // Calculate AniList episode range (1-based)
  let anilistFrom = 1;
  for (const [sNum, eps] of bySeason) {
    const epNumbers = eps.map(e => e.ep.episode_number).sort((a, b) => a - b);
    result.mappings.push({
      tmdbShowId: matchedShow.id,
      seasonNumber: sNum,
      anilistRange: { from: anilistFrom, to: anilistFrom + epNumbers.length - 1 },
      tmdbRange: { from: epNumbers[0], to: epNumbers[epNumbers.length - 1] },
    });
    anilistFrom += epNumbers.length;
  }

  return result;
}

// ====== Movie Handler ======

async function mapMovie(result: DateMappingResult, movieTitle: string): Promise<DateMappingResult> {
  if (!movieTitle) { result.errors.push('No title for movie'); return result; }

  const movieResults = await searchTmdbMovie(movieTitle).catch(e => { result.errors.push(`TMDB movie search: ${e.message}`); return []; });
  if (!movieResults.length) { result.errors.push(`No TMDB movie results for "${movieTitle}"`); return result; }

  // Pick best match: date match first, else popularity
  let matched = movieResults[0];
  let verified = false;
  for (const r of movieResults.slice(0, 5)) {
    const relDate = r.first_air_date?.substring(0, 10) || '';
    if (relDate && relDate === result.startDate) {
      matched = r;
      verified = true;
      break;
    }
  }

  result.tmdbShow = { id: matched.id, name: matched.name, verified };

  // Fetch movie details for images
  try {
    const movieDetails: any = await tmdbGet<any>(`/movie/${matched.id}`);
    // Build a single "episode" from the movie itself
    const movieEp: TMDBEpisode = {
      id: movieDetails.id,
      episode_number: 1,
      name: matched.name,
      overview: movieDetails.overview || '',
      still_path: movieDetails.poster_path || null,
      air_date: movieDetails.release_date?.substring(0, 10) || result.startDate,
      runtime: movieDetails.runtime || null,
    };
    result.episodes = [{ ep: movieEp, season: 1 }];
    result.mappings = [{
      tmdbShowId: matched.id,
      seasonNumber: 1,
      anilistRange: { from: 1, to: 1 },
      tmdbRange: { from: 1, to: 1 },
    }];
  } catch (e: any) {
    result.errors.push(`TMDB movie details: ${e.message}`);
  }

  return result;
}