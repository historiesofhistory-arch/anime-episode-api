import { TMDBShow, TMDBSeason, TMDBImages, TMDBEpisode } from './types';

const TMDB_API_KEY = process.env.TMDB_API_KEY!;
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p';

// In-memory cache with TTL
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

async function tmdbFetch<T>(endpoint: string): Promise<T> {
  const url = `${TMDB_BASE}${endpoint}${endpoint.includes('?') ? '&' : '?'}api_key=${TMDB_API_KEY}`;

  const cached = cache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data as T;
  }

  const res = await fetch(url, { next: { revalidate: 1800 } });
  if (!res.ok) {
    throw new Error(`TMDB API error: ${res.status} ${res.statusText} for ${endpoint}`);
  }

  const data = await res.json();
  cache.set(url, { data, ts: Date.now() });
  return data as T;
}

export function getTmdbImageUrl(path: string | null, size: string = 'w500'): string {
  if (!path) return '';
  return `${TMDB_IMG}/${size}${path}`;
}

export function getTmdbOriginalUrl(path: string | null): string {
  return getTmdbImageUrl(path, 'original');
}

// TMDB Search result types
export interface TMDBSearchResult {
  id: number;
  name: string;
  original_name: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  first_air_date?: string;
  popularity: number;
  vote_average: number;
  vote_count: number;
  origin_country: string[];
  genre_ids?: number[];
  number_of_seasons?: number;
  number_of_episodes?: number;
}

export interface TMDBSearchResponse {
  page: number;
  results: TMDBSearchResult[];
  total_pages: number;
  total_results: number;
}

export async function searchShows(query: string, year?: number): Promise<TMDBSearchResponse> {
  let endpoint = `/search/tv?query=${encodeURIComponent(query)}`;
  if (year) endpoint += `&first_air_date_year=${year}`;
  endpoint += '&include_adult=false';
  return tmdbFetch<TMDBSearchResponse>(endpoint);
}

export async function getShowDetails(tmdbId: number): Promise<TMDBShow> {
  try {
    return await tmdbFetch<TMDBShow>(`/tv/${tmdbId}`);
  } catch {
    // Fallback: might be a movie ID
    return tmdbFetch<TMDBShow>(`/movie/${tmdbId}`);
  }
}

export async function getMovieDetails(tmdbId: number): Promise<TMDBShow> {
  try {
    return await tmdbFetch<TMDBShow>(`/movie/${tmdbId}`);
  } catch {
    // Fallback: might be a TV show ID
    return tmdbFetch<TMDBShow>(`/tv/${tmdbId}`);
  }
}

export async function getSeasonEpisodes(tmdbId: number, seasonNumber: number): Promise<TMDBSeason> {
  try {
    return await tmdbFetch<TMDBSeason>(`/tv/${tmdbId}/season/${seasonNumber}`);
  } catch {
    // Movie: no seasons, return empty
    return { id: tmdbId, season_number: seasonNumber, name: '', episodes: [] };
  }
}

export async function getShowImages(tmdbId: number): Promise<TMDBImages> {
  try {
    return await tmdbFetch<TMDBImages>(`/tv/${tmdbId}/images`);
  } catch {
    // Fallback: might be a movie ID
    return tmdbFetch<TMDBImages>(`/movie/${tmdbId}/images`);
  }
}

/**
 * Get a specific episode's TMDB data by episode number within a season.
 */
export function findEpisodeInSeason(
  episodes: TMDBEpisode[],
  tmdbEpNumber: number
): TMDBEpisode | undefined {
  return episodes.find(ep => ep.episode_number === tmdbEpNumber);
}
