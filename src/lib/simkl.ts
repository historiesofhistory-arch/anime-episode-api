const SIMKL_API = 'https://api.simkl.com';

// In-memory cache
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Get SIMKL ID from MAL ID using the redirect endpoint (no auth needed).
 * Follows the redirect and extracts the SIMKL ID from the final URL.
 */
export async function getSimklId(malId: number): Promise<number | null> {
  const cacheKey = `simkl_id_${malId}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data as number | null;
  }

  try {
    const redirectUrl = `${SIMKL_API}/redirect?mal=${malId}`;
    const res = await fetch(redirectUrl, { redirect: 'follow' });

    if (!res.ok) {
      console.error(`[SIMKL] Redirect failed for MAL ${malId}: ${res.status}`);
      cache.set(cacheKey, { data: null, ts: Date.now() });
      return null;
    }

    // Extract SIMKL ID from final URL: https://simkl.com/anime/12345/title-slug
    const finalUrl = res.url;
    const match = finalUrl.match(/simkl\.com\/anime\/(\d+)/);

    if (!match) {
      console.error(`[SIMKL] Could not extract SIMKL ID from URL: ${finalUrl}`);
      cache.set(cacheKey, { data: null, ts: Date.now() });
      return null;
    }

    const simklId = parseInt(match[1], 10);
    cache.set(cacheKey, { data: simklId, ts: Date.now() });
    return simklId;
  } catch (e) {
    console.error(`[SIMKL] Error getting SIMKL ID for MAL ${malId}:`, e);
    return null;
  }
}

/**
 * Get TMDB ID from SIMKL ID using episodes_summary (no auth needed).
 */
export async function getTmdbIdFromSimkl(simklId: number): Promise<number | null> {
  const cacheKey = `simkl_tmdb_${simklId}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data as number | null;
  }

  try {
    const url = `${SIMKL_API}/anime/${simklId}?extended=episodes_summary`;
    const res = await fetch(url);

    if (!res.ok) {
      console.error(`[SIMKL] API failed for SIMKL ${simklId}: ${res.status}`);
      cache.set(cacheKey, { data: null, ts: Date.now() });
      return null;
    }

    const data = await res.json() as any;

    // TMDB ID can be in different locations in the response
    const tmdbId = data?.ids?.tmdb ?? data?.tmdb_id ?? null;

    if (!tmdbId) {
      console.error(`[SIMKL] No TMDB ID found in response for SIMKL ${simklId}`);
      cache.set(cacheKey, { data: null, ts: Date.now() });
      return null;
    }

    cache.set(cacheKey, { data: tmdbId, ts: Date.now() });
    return tmdbId as number;
  } catch (e) {
    console.error(`[SIMKL] Error getting TMDB ID for SIMKL ${simklId}:`, e);
    return null;
  }
}

/**
 * Get TMDB ID via SIMKL: MAL ID → SIMKL redirect → SIMKL ID → TMDB ID
 * No authentication required.
 */
export async function getTmdbIdViaSimkl(malId: number): Promise<number | null> {
  const simklId = await getSimklId(malId);
  if (!simklId) {
    console.log(`[SIMKL] Could not get SIMKL ID for MAL ${malId}`);
    return null;
  }

  console.log(`[SIMKL] MAL ${malId} → SIMKL ${simklId}`);

  const tmdbId = await getTmdbIdFromSimkl(simklId);
  if (!tmdbId) {
    console.log(`[SIMKL] Could not get TMDB ID for SIMKL ${simklId}`);
    return null;
  }

  console.log(`[SIMKL] SIMKL ${simklId} → TMDB ${tmdbId}`);
  return tmdbId;
}
