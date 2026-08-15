import { NextResponse } from 'next/server';
import { getMapping } from '@/lib/mappings';
import { aiMapAnilistToTmdb } from '@/lib/ai-mapping';
import { getShowDetails, getSeasonEpisodes, getShowImages, getTmdbImageUrl, getTmdbOriginalUrl } from '@/lib/tmdb';
import { getAnilistInfo } from '@/lib/anilist';
import { EpisodeResponse, AnimeEpisode, TMDBSeasonMapping, AnilistMapping } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function hasAired(airDate: string | null | undefined): boolean {
  if (!airDate) return false;
  return new Date(airDate) <= new Date();
}

function mapEpisodesForSeason(
  tmdbEpisodes: { episode_number: number; name: string; overview?: string; still_path?: string | null; air_date?: string | null; runtime?: number | null }[],
  mapping: TMDBSeasonMapping,
  anilistId: number
): AnimeEpisode[] {
  const results: AnimeEpisode[] = [];
  for (const ep of tmdbEpisodes) {
    const tmdbNum = ep.episode_number;
    if (tmdbNum < mapping.tmdbRange.from || tmdbNum > mapping.tmdbRange.to) continue;
    const offset = tmdbNum - mapping.tmdbRange.from;
    const anilistNum = mapping.anilistRange.from + offset;
    results.push({
      id: `${anilistId}-${anilistNum}`,
      number: anilistNum,
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
  return results;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ anilistId: string }> }
) {
  try {
    const { anilistId: anilistIdStr } = await params;
    const anilistId = parseInt(anilistIdStr, 10);

    if (isNaN(anilistId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid AniList ID. Must be a number.' },
        { status: 400 }
      );
    }

    // 1. Try offline mapping first (instant)
    let mapping: AnilistMapping | null = getMapping(anilistId);
    let usedAiMapping = false;

    // 2. If not found offline, use AI-powered mapping
    if (!mapping || mapping.tmdbMappings.length === 0) {
      console.log(`[API] No offline mapping for ${anilistId}, trying AI mapping...`);
      try {
        mapping = await aiMapAnilistToTmdb(anilistId);
        usedAiMapping = true;
        console.log(`[API] AI mapping found for ${anilistId}: TMDB ${mapping.tmdbMappings[0]?.tmdbShowId}`);
      } catch (aiError) {
        console.error(`[API] AI mapping failed for ${anilistId}:`, aiError);
        return NextResponse.json(
          { success: false, error: `No mapping found for AniList ID: ${anilistId}. AI mapping also failed: ${aiError instanceof Error ? aiError.message : 'Unknown error'}` },
          { status: 404 }
        );
      }
    }

    const primaryShowId = mapping.tmdbMappings[0].tmdbShowId;
    const seasonNumbers = [...new Set(mapping.tmdbMappings.map(m => m.seasonNumber))];

    // 3. Fetch everything in parallel: AniList (title+poster), TMDB (show+images+seasons)
    // Skip AniList fetch if AI mapping already fetched it
    const [anilistInfo, showDetails, imagesResult, ...seasonDataList] = await Promise.all([
      usedAiMapping ? Promise.resolve(getAnilistInfoFromCache(anilistId)) : getAnilistInfo(anilistId).catch(() => null),
      getShowDetails(primaryShowId).catch(() => null),
      getShowImages(primaryShowId).catch(() => null),
      ...seasonNumbers.map(s => getSeasonEpisodes(primaryShowId, s).catch(() => null)),
    ]);

    const seasonEpisodesMap = new Map<number, typeof seasonDataList[0]>();
    seasonDataList.forEach((sd, i) => {
      if (sd) seasonEpisodesMap.set(seasonNumbers[i], sd);
    });

    // 4. Map episodes using ranges
    let allEpisodes: AnimeEpisode[] = [];
    for (const tmdbMapping of mapping.tmdbMappings) {
      const seasonData = seasonEpisodesMap.get(tmdbMapping.seasonNumber);
      if (!seasonData?.episodes) continue;
      allEpisodes.push(...mapEpisodesForSeason(seasonData.episodes, tmdbMapping, anilistId));
    }

    // Deduplicate & sort
    const seen = new Set<number>();
    allEpisodes = allEpisodes.filter(ep => {
      if (seen.has(ep.number)) return false;
      seen.add(ep.number);
      return true;
    });
    allEpisodes.sort((a, b) => a.number - b.number);

    // 5. Filter ongoing: only aired
    const airedEpisodes = allEpisodes.filter(ep => ep.hasAired);
    const totalAired = airedEpisodes.length;

    let nextAiringEpisode: number | null = null;
    let nextAiringDate: string | null = null;
    const unairedEp = allEpisodes.find(ep => !ep.hasAired && ep.airDate);
    if (unairedEp) {
      nextAiringEpisode = unairedEp.number;
      nextAiringDate = unairedEp.airDate;
    }

    // 6. Build images
    const images: { coverType: 'Banner' | 'Poster' | 'Fanart' | 'Clearlogo'; url: string }[] = [];

    // Poster: AniList cover first, fallback TMDB poster
    if (anilistInfo?.coverImage) {
      images.push({ coverType: 'Poster', url: anilistInfo.coverImage });
    } else if (showDetails?.poster_path) {
      images.push({ coverType: 'Poster', url: getTmdbOriginalUrl(showDetails.poster_path) });
    } else if (imagesResult?.posters?.[0]) {
      images.push({ coverType: 'Poster', url: getTmdbOriginalUrl(imagesResult.posters[0].file_path) });
    }

    // Banner: AniList banner first, fallback TMDB backdrop
    if (anilistInfo?.bannerImage) {
      images.push({ coverType: 'Banner', url: anilistInfo.bannerImage });
    } else {
      const backdrop = imagesResult?.backdrops?.[0];
      if (backdrop) images.push({ coverType: 'Banner', url: getTmdbOriginalUrl(backdrop.file_path) });
    }

    // Fanart from TMDB backdrops
    const fanartIdx = anilistInfo?.bannerImage ? 0 : 1;
    const fanart = imagesResult?.backdrops?.[fanartIdx];
    if (fanart) {
      images.push({ coverType: 'Fanart', url: getTmdbOriginalUrl(fanart.file_path) });
    }

    // Clearlogo from TMDB — English first, then Japanese
    const logo =
      imagesResult?.logos?.find(l => l.iso_639_1 === 'en') ||
      imagesResult?.logos?.find(l => l.iso_639_1 === 'ja') ||
      imagesResult?.logos?.[0];
    if (logo) {
      images.push({ coverType: 'Clearlogo', url: getTmdbOriginalUrl(logo.file_path) });
    }

    // 7. Title: AniList English name first, fallback Romaji, then TMDB
    const title = anilistInfo?.titleEnglish || anilistInfo?.titleRomaji || showDetails?.name || 'Unknown';
    const titleJa = anilistInfo?.titleNative || '';

    const response: EpisodeResponse = {
      success: true,
      data: {
        id: String(anilistId),
        malId: mapping.malId,
        title,
        titleJa,
        images,
        totalEpisodes: totalAired,
        currentEpisode: totalAired > 0 ? airedEpisodes[totalAired - 1].number : 0,
        nextAiringEpisode,
        nextAiringDate,
        episodes: airedEpisodes,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('API Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

/** Helper to get AniList info from ai-mapping's cache (avoids double fetch) */
function getAnilistInfoFromCache(anilistId: number) {
  // ai-mapping already called getAnilistInfo internally, the anilist.ts cache has it
  return getAnilistInfo(anilistId).catch(() => null);
}