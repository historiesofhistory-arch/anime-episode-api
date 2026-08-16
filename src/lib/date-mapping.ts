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

const ANILIST_API = 'https://graphql.anilist.co';
const TMDB_KEY = process.env.TMDB_API_KEY || '';
const TMDB_BASE = 'https://api.themoviedb.org/3';

// ====== AniList ======

interface AnilistMedia {
  id: number;
  title: { english: string | null; romaji: string | null; native: string | null };
  format: string | null;
  seasonYear: number | null;
  episodes: number | null;
  startDate: { year: number | null; month: number | null; day: number | null } | null;
  endDate: { year: number | null; month: number | null; day: number | null } | null;
  relations: { edges: { relationType: string; node: { id: number; format: string | null } }[] } | null;
}

const ANILIST_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    title { english romaji native }
    format
    seasonYear
    episodes
    startDate { year month day }
    endDate { year month day }
    relations {
      edges {
        relationType
        node { id format }
      }
    }
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

function formatDate(d: { year: number | null; month: number | null; day: number | null } | null): string {
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

// ====== BFS: Find Root Season (S1) ======

async function findRootSeason(startId: number): Promise<{ id: number; startDate: string; title: string } | null> {
  const visited = new Set<number>();
  const queue = [startId];
  let root: AnilistMedia | null = null;
  const RELEVANT = new Set(['PREQUEL', 'SEQUEL', 'PARENT', 'PARENT_STORY']);
  const TV = new Set(['TV', 'TV_SHORT']);

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    try {
      const m = await fetchAnilist(id);
      if (!m || !TV.has(m.format || '')) continue;
      if (!root || (m.seasonYear ?? 9999) < (root.seasonYear ?? 9999) || (m.seasonYear === root.seasonYear && m.id < root.id)) {
        root = m;
      }
      if (m.relations?.edges) {
        for (const e of m.relations.edges) {
          if (RELEVANT.has(e.relationType) && TV.has(e.node.format || '') && !visited.has(e.node.id)) {
            queue.push(e.node.id);
          }
        }
      }
    } catch { /* skip failed */ }
  }

  if (!root) return null;
  return {
    id: root.id,
    startDate: formatDate(root.startDate),
    title: root.title.english || root.title.romaji || '',
  };
}

// ====== TMDB ======

interface TmdbSearchResult {
  id: number; name: string; first_air_date?: string; popularity: number;
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
  return data.results || [];
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

  // Step 1: Fetch AniList entry
  const entry = await fetchAnilist(anilistId).catch(e => { result.errors.push(`AniList: ${e.message}`); return null; });
  if (!entry) return result;

  const title = entry.title.english || entry.title.romaji || '';
  result.title = title;
  result.rootName = extractRootName(title);
  result.hasSeasonOrPart = hasSeasonOrPart(title);
  result.startDate = formatDate(entry.startDate);
  result.endDate = formatDate(entry.endDate);
  result.anilistEpisodes = entry.episodes;

  // Step 2: If season/part, find root S1 via BFS (parallel candidate)
  let rootStartDate = result.startDate;
  if (result.hasSeasonOrPart) {
    const root = await findRootSeason(anilistId);
    if (root) {
      result.rootS1 = root;
      rootStartDate = root.startDate || result.startDate;
    }
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
  const lastMatch = result.endDate
    ? allEps.find(e => e.ep.air_date === result.endDate)
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