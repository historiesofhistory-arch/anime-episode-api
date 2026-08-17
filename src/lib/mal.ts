const MAL_BASE = 'https://api.myanimelist.net/v2';
const MAL_CLIENT_ID = process.env.MAL_CLIENT_ID || '';

// In-memory cache with TTL
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

interface MalMedia {
  id: number;
  title: string;
  main_picture?: { medium: string; large: string } | null;
  alternative_titles?: {
    synonyms?: string[];
    en?: string;
    ja?: string;
  };
  start_date?: string | null;
  end_date?: string | null;
  synopsis?: string;
  num_episodes?: number;
  status?: string;
  media_type?: string;
  related_anime?: {
    node: { id: number; title: string; media_type?: string };
    relation_type: string;
    relation_type_formatted: string;
  }[];
}

export interface MalMediaData {
  malId: number;
  titleEnglish: string | null;
  titleRomaji: string | null;
  titleNative: string | null;
  coverImage: string | null;
  format: string | null;    // mapped: tv, ova, movie, tv_special, ona, music
  status: string | null;    // mapped: currently_airing, finished_airing, not_yet_aired
  episodes: number | null;
  startDate: string;     // YYYY-MM-DD or ''
  endDate: string;       // YYYY-MM-DD or ''
  synopsis: string | null;
  relatedAnime: { malId: number; title: string; relationType: string; mediaType: string | null }[];
}

// Map MAL media_type/status to AniList-compatible values
function mapFormat(mediaType: string | undefined | null): string | null {
  if (!mediaType) return null;
  const map: Record<string, string> = {
    tv: 'TV',
    ova: 'OVA',
    movie: 'MOVIE',
    tv_special: 'SPECIAL',
    ona: 'ONA',
    music: 'MUSIC',
  };
  return map[mediaType.toLowerCase()] || mediaType.toUpperCase();
}

function mapStatus(status: string | undefined | null): string | null {
  if (!status) return null;
  const map: Record<string, string> = {
    currently_airing: 'RELEASING',
    finished_airing: 'FINISHED',
    not_yet_aired: 'NOT_YET_RELEASED',
  };
  return map[status.toLowerCase()] || status.toUpperCase();
}

async function malFetch<T>(endpoint: string): Promise<T> {
  const url = `${MAL_BASE}${endpoint}`;
  const cached = cache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data as T;
  }

  const res = await fetch(url, {
    headers: {
      'X-MAL-Client-ID': MAL_CLIENT_ID,
    },
  } as any);

  if (!res.ok) {
    throw new Error(`MAL API error: ${res.status} for ${endpoint}`);
  }

  const data = await res.json();
  cache.set(url, { data, ts: Date.now() });
  return data as T;
}

function parseMalMedia(m: MalMedia): MalMediaData {
  return {
    malId: m.id,
    titleEnglish: m.alternative_titles?.en || null,
    titleRomaji: m.title || null,
    titleNative: m.alternative_titles?.ja || null,
    coverImage: m.main_picture?.large || m.main_picture?.medium || null,
    format: mapFormat(m.media_type),
    status: mapStatus(m.status),
    episodes: m.num_episodes ?? null,
    startDate: m.start_date || '',
    endDate: m.end_date || '',
    synopsis: m.synopsis || null,
    relatedAnime: (m.related_anime || []).map(r => ({
      malId: r.node.id,
      title: r.node.title,
      relationType: r.relation_type,
      mediaType: r.node.media_type || null,
    })),
  };
}

/**
 * Get MAL anime info by MAL ID.
 * Returns same shape as getAnilistInfo for drop-in replacement.
 */
export async function getMalInfo(malId: number): Promise<MalMediaData> {
  const data = await malFetch<MalMedia>(
    `/anime/${malId}?fields=title,alternative_titles,main_picture,start_date,end_date,num_episodes,status,media_type,related_anime,synopsis`
  );
  return parseMalMedia(data);
}

/**
 * Lightweight MAL fetch for date-mapping BFS (only id, title, dates, format, relations).
 * Uses separate cache namespace to avoid polluting main cache.
 */
export async function fetchMalForBfs(malId: number): Promise<{
  id: number;
  title: string;
  format: string | null;
  startDate: string;
  endDate: string;
  episodes: number | null;
  relations: { malId: number; relationType: string; mediaType: string | null }[];
} | null> {
  try {
    const data = await malFetch<MalMedia>(
      `/anime/${malId}?fields=title,media_type,start_date,end_date,num_episodes,related_anime`
    );
    return {
      id: data.id,
      title: data.title,
      format: mapFormat(data.media_type),
      startDate: data.start_date || '',
      endDate: data.end_date || '',
      episodes: data.num_episodes ?? null,
      relations: (data.related_anime || []).map(r => ({
        malId: r.node.id,
        relationType: r.relation_type,
        mediaType: r.node.media_type || null,
      })),
    };
  } catch {
    return null;
  }
}
