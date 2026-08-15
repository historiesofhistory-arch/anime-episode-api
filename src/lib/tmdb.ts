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

export async function getShowDetails(tmdbId: number): Promise<TMDBShow> {
  return tmdbFetch<TMDBShow>(`/tv/${tmdbId}`);
}

export async function getSeasonEpisodes(tmdbId: number, seasonNumber: number): Promise<TMDBSeason> {
  return tmdbFetch<TMDBSeason>(`/tv/${tmdbId}/season/${seasonNumber}`);
}

export async function getShowImages(tmdbId: number): Promise<TMDBImages> {
  return tmdbFetch<TMDBImages>(`/tv/${tmdbId}/images`);
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
