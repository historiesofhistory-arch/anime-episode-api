import { NextResponse } from 'next/server';
import { getMapping } from '@/lib/mappings';
import { dateBasedMapping } from '@/lib/date-mapping';
import { getShowDetails, getMovieDetails, getSeasonEpisodes, getShowImages, getTmdbImageUrl, getTmdbOriginalUrl } from '@/lib/tmdb';
import { getMalInfo } from '@/lib/mal';
import { getAnilistInfo } from '@/lib/anilist';
import { EpisodeResponse, AnimeEpisode, TMDBSeasonMapping, AnilistMapping } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function hasAired(airDate: string | null | undefined): boolean {
  if (!airDate) return false;
  const today = new Date();
  const utcToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 23, 59, 59));
  return new Date(airDate + 'T00:00:00Z') <= utcToday;
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

    // ============================================================
    // PHASE 1: AniList + DB (parallel) — get idMal, mapping, banner, nextAiring
    // ============================================================
    const anilistPromise = getAnilistInfo(anilistId).catch(() => null);
    const dbMapping = getMapping(anilistId);

    // Wait for AniList to get reliable idMal
    const alInfo = await anilistPromise;
    let idMal: number | null = alInfo?.idMal ?? dbMapping?.malId ?? null;
    const anilistBannerImage = alInfo?.bannerImage ?? null;
    const anilistNextAiringEpisode = alInfo?.nextAiringEpisode ?? null;

    // ============================================================
    // PHASE 2: Mapping resolution (DB → date-based fallback)
    // ============================================================
    let mapping: AnilistMapping | null = dbMapping;

    if (!mapping || mapping.tmdbMappings.length === 0) {
      console.log(`[API] No offline mapping for ${anilistId}, trying date-based mapping...`);
      try {
        const dateResult = await dateBasedMapping(anilistId);
        if (dateResult.mappings.length > 0) {
          mapping = {
            anilistId,
            malId: idMal,
            tmdbMappings: dateResult.mappings,
          };
          console.log(`[API] Date mapping found for ${anilistId}: TMDB ${mapping.tmdbMappings[0]?.tmdbShowId} (${mapping.tmdbMappings.length} season(s), ${dateResult.episodes.length} eps)`);
        } else {
          console.log(`[API] Date mapping failed for ${anilistId}: ${dateResult.errors.join('; ')}`);
        }
      } catch (dateError) {
        console.error(`[API] Date mapping error for ${anilistId}:`, dateError);
      }
    }

    if (!mapping || mapping.tmdbMappings.length === 0) {
      return NextResponse.json(
        { success: false, error: `No mapping found for AniList ID: ${anilistId}` },
        { status: 404 }
      );
    }

    // Use AniList's idMal (most reliable) for response
    mapping.malId = idMal;

    // ============================================================
    // PHASE 3: MAL (primary) + TMDB (parallel) — metadata + episodes
    // ============================================================
    const primaryMapping = mapping.tmdbMappings.find(m => m.seasonNumber > 0) || mapping.tmdbMappings[0];
    const primaryShowId = primaryMapping.tmdbShowId;
    const isMovieMapping = primaryMapping.isMovie;
    const preFilterSeasons = [...new Set(mapping.tmdbMappings.map(m => m.seasonNumber))];

    // MAL PRIMARY + TMDB in parallel
    let metaTitleEnglish: string | null = null;
    let metaTitleRomaji: string | null = null;
    let metaTitleNative: string | null = null;
    let metaCoverImage: string | null = null;
    let metaFormat: string | null = null;
    let metaStatus: string | null = null;
    let metaEpisodes: number | null = null;
    let malUsed = false;

    const [malResult, showDetails, imagesResult, ...seasonDataList] = await Promise.all([
      idMal
        ? getMalInfo(idMal).then(malInfo => {
            metaTitleEnglish = malInfo.titleEnglish;
            metaTitleRomaji = malInfo.titleRomaji;
            metaTitleNative = malInfo.titleNative;
            metaCoverImage = malInfo.coverImage;
            metaFormat = malInfo.format;
            metaStatus = malInfo.status;
            metaEpisodes = malInfo.episodes;
            malUsed = true;
          }).catch(() => null)
        : Promise.resolve(null),
      isMovieMapping ? getMovieDetails(primaryShowId).catch(() => null) : getShowDetails(primaryShowId).catch(() => null),
      getShowImages(primaryShowId).catch(() => null),
      ...(isMovieMapping ? [Promise.resolve(null)] : preFilterSeasons.map(s => getSeasonEpisodes(primaryShowId, s).catch(() => null))),
    ]);

    // AniList FALLBACK: only if MAL completely failed
    if (!malUsed && alInfo) {
      metaTitleEnglish = alInfo.titleEnglish;
      metaTitleRomaji = alInfo.titleRomaji;
      metaTitleNative = alInfo.titleNative;
      metaCoverImage = alInfo.coverImage;
      metaFormat = alInfo.format;
      metaStatus = alInfo.status;
      metaEpisodes = alInfo.episodes;
    }

    // ============================================================
    // PHASE 4: S0 filter + episode mapping
    // ============================================================
    const activeMappings = (metaFormat === 'TV')
      ? mapping.tmdbMappings.filter(m => m.seasonNumber !== 0)
      : mapping.tmdbMappings;

    if (activeMappings.length === 0) {
      return NextResponse.json(
        { success: false, error: `No mapping found for AniList ID: ${anilistId}` },
        { status: 404 }
      );
    }

    const seasonEpisodesMap = new Map<number, typeof seasonDataList[0]>();
    seasonDataList.forEach((sd, i) => {
      if (sd && i < preFilterSeasons.length) {
        seasonEpisodesMap.set(preFilterSeasons[i], sd);
      }
    });

    let allEpisodes: AnimeEpisode[] = [];
    for (const tmdbMapping of activeMappings) {
      const seasonData = seasonEpisodesMap.get(tmdbMapping.seasonNumber);
      if (!seasonData?.episodes?.length) {
        if (tmdbMapping.tmdbRange.from === 1 && tmdbMapping.tmdbRange.to === 1) {
          allEpisodes.push({
            id: `${anilistId}-1`,
            number: 1,
            title: metaTitleEnglish || showDetails?.name || 'Movie',
            description: (showDetails as any)?.overview || '',
            image: metaCoverImage || '',
            airDate: (showDetails as any)?.release_date?.substring(0, 10) || '',
            duration: (showDetails as any)?.runtime || 90,
            isFiller: false,
            titleJa: metaTitleNative || '',
            rating: '0',
            hasAired: true,
          });
        }
        continue;
      }
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

    // ============================================================
    // PHASE 5: Ongoing extension
    // ============================================================
    if (metaStatus === 'RELEASING' && metaEpisodes && metaEpisodes > allEpisodes.length) {
      console.log(`[API] Ongoing: source has ${metaEpisodes} eps, mapped ${allEpisodes.length}, extending...`);
      const existingSeasons = new Set(activeMappings.map(m => m.seasonNumber));
      try {
        const showInfo = showDetails || await getShowDetails(primaryShowId);
        const allSeasons = (showInfo as any)?.seasons
          ?.filter((s: any) => s.season_number > 0 && !existingSeasons.has(s.season_number))
          .sort((a: any, b: any) => a.season_number - b.season_number) || [];

        if (allSeasons.length > 0) {
          const extraSeasonData = await Promise.all(
            allSeasons.map(s => getSeasonEpisodes(primaryShowId, s.season_number).catch(() => null))
          );
          let alFrom = allEpisodes.length + 1;
          for (let i = 0; i < extraSeasonData.length; i++) {
            const sd = extraSeasonData[i];
            const sNum = allSeasons[i].season_number;
            if (!sd?.episodes?.length) continue;
            const epNums = sd.episodes.map(e => e.episode_number).sort((a, b) => a - b);
            const extMapping: TMDBSeasonMapping = {
              tmdbShowId: primaryShowId,
              seasonNumber: sNum,
              anilistRange: { from: alFrom, to: alFrom + epNums.length - 1 },
              tmdbRange: { from: epNums[0], to: epNums[epNums.length - 1] },
            };
            const extraEps = mapEpisodesForSeason(sd.episodes, extMapping, anilistId);
            allEpisodes.push(...extraEps);
            alFrom += epNums.length;
            console.log(`[API] Extended S${sNum}: +${epNums.length} eps (TMDB E${epNums[0]}-E${epNums[epNums.length-1]})`);
          }
          allEpisodes.sort((a, b) => a.number - b.number);
        }
      } catch (e) {
        console.error(`[API] Ongoing extension failed:`, e);
      }
    }

    // ============================================================
    // PHASE 6: Aired filter + next airing + images + response
    // ============================================================
    const airedEpisodes = allEpisodes.filter(ep => ep.hasAired);
    const totalAired = airedEpisodes.length;

    let nextAiringEpisode: number | null = null;
    let nextAiringDate: string | null = null;

    if (anilistNextAiringEpisode) {
      nextAiringEpisode = anilistNextAiringEpisode.episode;
      nextAiringDate = new Date(anilistNextAiringEpisode.airingAt * 1000).toISOString().substring(0, 10);
    } else {
      const unairedEp = allEpisodes.find(ep => !ep.hasAired && ep.airDate);
      if (unairedEp) {
        nextAiringEpisode = unairedEp.number;
        nextAiringDate = unairedEp.airDate;
      }
    }

    // Images: MAL cover > TMDB poster > TMDB images
    const images: { coverType: 'Banner' | 'Poster' | 'Fanart' | 'Clearlogo'; url: string }[] = [];

    if (metaCoverImage) {
      images.push({ coverType: 'Poster', url: metaCoverImage });
    } else if (showDetails?.poster_path) {
      images.push({ coverType: 'Poster', url: getTmdbOriginalUrl(showDetails.poster_path) });
    } else if (imagesResult?.posters?.[0]) {
      images.push({ coverType: 'Poster', url: getTmdbOriginalUrl(imagesResult.posters[0].file_path) });
    }

    if (anilistBannerImage) {
      images.push({ coverType: 'Banner', url: anilistBannerImage });
    } else {
      const backdrop = imagesResult?.backdrops?.[0];
      if (backdrop) images.push({ coverType: 'Banner', url: getTmdbOriginalUrl(backdrop.file_path) });
    }

    const fanartIdx = anilistBannerImage ? 0 : 1;
    const fanart = imagesResult?.backdrops?.[fanartIdx];
    if (fanart) {
      images.push({ coverType: 'Fanart', url: getTmdbOriginalUrl(fanart.file_path) });
    }

    const logo =
      imagesResult?.logos?.find(l => l.iso_639_1 === 'en') ||
      imagesResult?.logos?.find(l => l.iso_639_1 === 'ja') ||
      imagesResult?.logos?.[0];
    if (logo) {
      images.push({ coverType: 'Clearlogo', url: getTmdbOriginalUrl(logo.file_path) });
    }

    const title = metaTitleEnglish || metaTitleRomaji || showDetails?.name || 'Unknown';
    const titleJa = metaTitleNative || '';

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
        ongoing: metaStatus === 'RELEASING',
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
