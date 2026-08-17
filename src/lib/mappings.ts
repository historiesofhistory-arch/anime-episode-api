import { AnilistMapping, TMDBSeasonMapping, EpisodeRange } from './types';
import path from 'path';
import fs from 'fs';

// Parse a range string like "1-13", "1", or open-ended "1089-" into {from, to}
function parseRange(rangeStr: string): EpisodeRange {
  const parts = rangeStr.split('-');
  const from = Number(parts[0]) || 0;
  const to = (parts.length > 1 && parts[1] !== '') ? (Number(parts[1]) || 0) : from;
  return { from, to };
}

// Source priority: higher number = higher priority (processed first, wins on dedup)
function getSourcePriority(key: string): number {
  if (key.startsWith('mal:')) return 4;       // MAL is most reliable for TMDB offsets
  if (key.startsWith('anidb:') && key.endsWith(':R')) return 3;
  if (key.startsWith('tvdb_show:')) return 2;
  if (key.startsWith('tmdb_show:')) return 1;   // tmdb_show source keys (self-referencing)
  return 0;
}

// Module-level cache for the reverse index
let _index: Map<number, AnilistMapping> | null = null;

/**
 * Build and cache a reverse index: AniList ID -> { malId, tmdbMappings[] }
 * This is computed once and stays in memory for the lifetime of the process.
 *
 * IMPORTANT: anibridge mappings have TWO ways TMDB data appears:
 *
 * 1. As a SERVICE key inside a non-TMDB source entry (e.g. mal:39587):
 *    { "tmdb_show:65942:s1": { "1-13": "26-38" } }
 *    Format: "anilistEpRange": "tmdbEpRange"
 *
 * 2. As the SOURCE key itself (e.g. tmdb_show:65942:s1):
 *    { "anilist:119661": { "39-50": "1-12" } }
 *    Format: "tmdbEpRange": "anilistEpRange"  (INVERTED!)
 *    We must SWAP the ranges when extracting from tmdb_show source keys.
 */
function buildReverseIndex(): Map<number, AnilistMapping> {
  if (_index) return _index;

  const filePath = path.join(process.cwd(), 'data', 'mappings.min.json');
  const raw = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);

  type RawEntry = { sourceKey: string; anilistId: number; malId: number | null; tmdbMappings: TMDBSeasonMapping[] };
  const allEntries: RawEntry[] = [];

  for (const sourceKey of Object.keys(data)) {
    const entry = data[sourceKey];
    if (!entry || typeof entry !== 'object') continue;
    if (sourceKey === '$meta') continue;

    // Check if the SOURCE KEY itself is a tmdb_show entry
    const isTmdbShowSource = sourceKey.startsWith('tmdb_show:');
    const isTmdbMovieSource = sourceKey.startsWith('tmdb_movie:');
    const isTmdbSource = isTmdbShowSource || isTmdbMovieSource;
    let sourceTmdbShowId = 0;
    let sourceTmdbSeason = 1;
    if (isTmdbShowSource) {
      const parts = sourceKey.split(':');
      sourceTmdbShowId = parseInt(parts[1], 10);
      sourceTmdbSeason = parseInt(parts[2].replace('s', ''), 10);
    } else if (isTmdbMovieSource) {
      const parts = sourceKey.split(':');
      sourceTmdbShowId = parseInt(parts[1], 10);
      sourceTmdbSeason = 1; // movies are treated as season 1
    }

    for (const [serviceKey, ranges] of Object.entries(entry)) {
      if (serviceKey.startsWith('anilist:')) {
        const anilistId = parseInt(serviceKey.replace('anilist:', ''), 10);

        // Find malId from sibling service keys
        let malId: number | null = null;
        for (const [sk] of Object.entries(entry)) {
          if (sk.startsWith('mal:')) {
            malId = parseInt(sk.replace('mal:', ''), 10);
            break;
          }
        }

        const tmdbMappings: TMDBSeasonMapping[] = [];

        if (ranges && typeof ranges === 'object') {
          if (isTmdbSource) {
            // === CASE 2: Source is tmdb_show, ranges are INVERTED ===
            // "tmdbEpRange": "anilistEpRange" → swap them
            for (const [tmdbRangeStr, anilistRangeStr] of Object.entries(ranges)) {
              tmdbMappings.push({
                tmdbShowId: sourceTmdbShowId,
                seasonNumber: sourceTmdbSeason,
                anilistRange: parseRange(anilistRangeStr as string),
                tmdbRange: parseRange(tmdbRangeStr as string),
                isMovie: isTmdbMovieSource,
              });
            }
          } else if (!sourceKey.startsWith('tvdb_show:')) {
            // CASE 1b: Source is mal/anidb/other (NOT tvdb_show) — safe to use tmdb_show service keys
            // For tvdb_show sources, the tmdb_show ranges may belong to a different anilist ID
            // in the same entry, so we skip them here. The tmdb_show SOURCE keys (CASE 2)
            // handle those mappings correctly.
            for (const [sk, sr] of Object.entries(entry)) {
              if ((sk.startsWith('tmdb_show:') || sk.startsWith('tmdb_movie:')) && sr && typeof sr === 'object') {
                const parts = sk.split(':');
                const tmdbShowId = parseInt(parts[1], 10);
                const seasonNumber = sk.startsWith('tmdb_movie:') ? 1 : parseInt(parts[2].replace('s', ''), 10);

                const isMovie = sk.startsWith('tmdb_movie:');
                for (const [anilistRangeStr, tmdbRangeStr] of Object.entries(sr as Record<string, string>)) {
                  tmdbMappings.push({
                    tmdbShowId,
                    seasonNumber,
                    anilistRange: parseRange(anilistRangeStr),
                    tmdbRange: parseRange(tmdbRangeStr),
                    isMovie,
                  });
                }
              }
            }
          }
        }

        if (tmdbMappings.length > 0) {
          allEntries.push({ sourceKey, anilistId, malId, tmdbMappings });
        }
      }
    }
  }

  // Sort by source priority descending (highest priority first)
  allEntries.sort((a, b) => getSourcePriority(b.sourceKey) - getSourcePriority(a.sourceKey));

  // Build index - first one wins on dedup
  const index = new Map<number, AnilistMapping>();

  for (const raw of allEntries) {
    if (index.has(raw.anilistId)) {
      const existing = index.get(raw.anilistId)!;
      if (raw.malId !== null && existing.malId === null) existing.malId = raw.malId;
      // Only add tmdb mappings that don't conflict with existing ones
      for (const m of raw.tmdbMappings) {
        const conflicts = existing.tmdbMappings.some(
          e => e.tmdbShowId === m.tmdbShowId &&
               e.seasonNumber === m.seasonNumber &&
               e.anilistRange.from === m.anilistRange.from &&
               e.anilistRange.to === m.anilistRange.to
        );
        if (!conflicts) {
          existing.tmdbMappings.push(m);
        }
      }
    } else {
      index.set(raw.anilistId, {
        anilistId: raw.anilistId,
        malId: raw.malId,
        tmdbMappings: [...raw.tmdbMappings],
      });
    }
  }

  // Sort tmdbMappings by anilistRange.from for each entry
  for (const mapping of index.values()) {
    mapping.tmdbMappings.sort((a, b) => a.anilistRange.from - b.anilistRange.from);
  }

  _index = index;
  return index;
}

/**
 * Get the TMDB mapping for a given AniList ID.
 * Returns null if not found.
 */
export function getMapping(anilistId: number): AnilistMapping | null {
  const index = buildReverseIndex();
  return index.get(anilistId) ?? null;
}

/**
 * Get stats about the loaded index (useful for debugging/health checks).
 */
export function getIndexStats() {
  const index = buildReverseIndex();
  return {
    totalAnilistIds: index.size,
  };
}
