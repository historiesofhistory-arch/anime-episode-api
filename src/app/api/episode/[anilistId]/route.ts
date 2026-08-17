import { NextResponse } from 'next/server';
import { getMapping } from '@/lib/mappings';
import { dateBasedMapping } from '@/lib/date-mapping';
import { getShowDetails, getMovieDetails, getSeasonEpisodes, getShowImages, getTmdbImageUrl, getTmdbOriginalUrl } from '@/lib/tmdb';
import { getMalInfo } from '@/lib/mal';
import { getAnilistInfo } from '@/lib/anilist';
import { getTmdbIdViaSimkl } from '@/lib/simkl';
import { verifyEpisodes } from '@/lib/verification';
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
    // PHASE 1: AniList + DB (parallel)
    //   - AniList: idMal, dates, banner, nextAiring, episodes, format, status
    //   - DB: tmdbMappings, malId
    // ============================================================
    const anilistPromise = getAnilistInfo(anilistId).catch((e) => {
      console.error(`[API] AniList fetch failed for ${anilistId}:`, e);
      return null;
    });
    const dbMapping = getMapping(anilistId);

    const alInfo = await anilistPromise;
    let idMal: number | null = alInfo?.idMal ?? dbMapping?.malId ?? null;
    const anilistBannerImage = alInfo?.bannerImage ?? null;
    const anilistNextAiringEpisode = alInfo?.nextAiringEpisode ?? null;

    // Dates from AniList (fallback if MAL fails)
    const alStartDate = alInfo?.startDate ?? null;
    const alEndDate = alInfo?.endDate ?? null;
    const alFormat = alInfo?.format ?? null;
    const alStatus = alInfo?.status ?? null;
    const alEpisodes = alInfo?.episodes ?? null;

    // ============================================================
    // PHASE 2: TMDB ID Resolution — DB → SIMKL → Date-Based
    // ============================================================
    let tmdbShowId: number | null = null;
    let mappingSource: 'db' | 'simkl' | 'date-based' | null = null;
    let dateBasedMappings: TMDBSeasonMapping[] = []; // Only populated by date-based path
    let dateBasedEpisodes: AnimeEpisode[] = [];     // Only populated by date-based path
    let dateBasedRawEps: { ep: any; season: number }[] = []; // Raw from date-mapping

    // --- Layer 1: Database ---
    if (dbMapping && dbMapping.tmdbMappings.length > 0) {
      tmdbShowId = dbMapping.tmdbMappings[0].tmdbShowId;
      mappingSource = 'db';
      console.log(`[API] L1 (DB): TMDB ${tmdbShowId} for AniList ${anilistId}`);
    }

    // --- Layer 2: SIMKL (if DB failed and MAL ID available) ---
    if (!tmdbShowId && idMal) {
      console.log(`[API] L1 failed, trying L2 (SIMKL) with MAL ${idMal}...`);
      try {
        const simklTmdbId = await getTmdbIdViaSimkl(idMal);
        if (simklTmdbId) {
          tmdbShowId = simklTmdbId;
          mappingSource = 'simkl';
          console.log(`[API] L2 (SIMKL): TMDB ${tmdbShowId} for AniList ${anilistId}`);
        }
      } catch (e) {
        console.error(`[API] SIMKL error for ${anilistId}:`, e);
      }
    }

    // --- Layer 3: Date-Based Mapping (if DB and SIMKL both failed) ---
    if (!tmdbShowId) {
      console.log(`[API] L1 & L2 failed, trying L3 (Date-Based) for ${anilistId}...`);
      try {
        const dateResult = await dateBasedMapping(anilistId);
        if (dateResult.mappings.length > 0) {
          tmdbShowId = dateResult.mappings[0].tmdbShowId;
          dateBasedMappings = dateResult.mappings;
          dateBasedRawEps = dateResult.episodes;
          // Convert raw TMDB episodes to AnimeEpisode format
          dateBasedEpisodes = dateResult.episodes.map((item, idx) => ({
            id: `${anilistId}-${idx + 1}`,
            number: idx + 1,
            title: item.ep.name || '',
            description: item.ep.overview || '',
            image: getTmdbImageUrl(item.ep.still_path ?? null),
            airDate: item.ep.air_date || '',
            duration: item.ep.runtime || 24,
            isFiller: false,
            titleJa: '',
            rating: '0',
            hasAired: hasAired(item.ep.air_date),
          }));
          mappingSource = 'date-based';
          console.log(`[API] L3 (Date-Based): TMDB ${tmdbShowId} for AniList ${anilistId} (${dateBasedMappings.length} season(s), ${dateBasedEpisodes.length} eps)`);
        } else {
          console.log(`[API] L3 failed for ${anilistId}: ${dateResult.errors.join('; ')}`);
        }
      } catch (e) {
        console.error(`[API] Date-based mapping error for ${anilistId}:`, e);
      }
    }

    if (!tmdbShowId) {
      return NextResponse.json(
        { success: false, error: `No mapping found for AniList ID: ${anilistId}` },
        { status: 404 }
      );
    }

    // ============================================================
    // PHASE 3: Metadata + TMDB Details + Verification (PARALLEL)
    //   - MAL info (titles, format, status, episodes, dates)
    //   - TMDB show details + images
    //   - Verification layer (if DB or SIMKL path)
    // ============================================================
    const isMovieMapping = dateBasedMappings.length > 0 && dateBasedMappings[0].isMovie;

    // Metadata variables
    let metaTitleEnglish: string | null = null;
    let metaTitleRomaji: string | null = null;
    let metaTitleNative: string | null = null;
    let metaCoverImage: string | null = null;
    let metaFormat: string | null = null;
    let metaStatus: string | null = null;
    let metaEpisodes: number | null = null;
    let startDate: string | null = null;  // For verification
    let endDate: string | null = null;     // For verification
    let malUsed = false;

    // Build parallel promises
    const parallelPromises: Promise<any>[] = [
      // MAL metadata
      idMal
        ? getMalInfo(idMal).then((malInfo) => {
            metaTitleEnglish = malInfo.titleEnglish;
            metaTitleRomaji = malInfo.titleRomaji;
            metaTitleNative = malInfo.titleNative;
            metaCoverImage = malInfo.coverImage;
            metaFormat = malInfo.format;
            metaStatus = malInfo.status;
            metaEpisodes = malInfo.episodes;
            startDate = malInfo.startDate || null;
            endDate = malInfo.endDate || null;
            malUsed = true;
          }).catch(() => null)
        : Promise.resolve(null),

      // TMDB show details
      isMovieMapping
        ? getMovieDetails(tmdbShowId).catch(() => null)
        : getShowDetails(tmdbShowId).catch(() => null),

      // TMDB images
      getShowImages(tmdbShowId).catch(() => null),
    ];

    // Verification promise (only for DB and SIMKL paths)
    let verificationPromise: Promise<any> = Promise.resolve(null);

    if (mappingSource === 'db' || mappingSource === 'simkl') {
      // Verification needs dates. We'll use AniList dates as initial value,
      // MAL dates will be set when MAL promise resolves.
      // Start verification with a small delay to let MAL dates arrive first.
      // But actually we run in parallel - use AniList dates directly.
      // MAL dates are used as fallback display metadata only.

      // We need to wait a tick so MAL can set dates if it resolves fast
      verificationPromise = (async () => {
        // Brief delay to allow MAL to potentially set dates first
        await new Promise(r => setTimeout(r, 50));

        // Use MAL dates if available, else AniList dates
        const verifyStart = startDate || alStartDate;
        const verifyEnd = endDate || alEndDate;

        if (!verifyStart) {
          console.log(`[API] Verification skipped: no start date available (MAL: ${malUsed})`);
          return null;
        }

        // Expected episode count from MAL/AniList
        const expected = (metaEpisodes && metaEpisodes > 0)
          ? metaEpisodes
          : (alEpisodes && alEpisodes > 0 ? alEpisodes : null);

        return verifyEpisodes(tmdbShowId, verifyStart, verifyEnd, anilistId, expected);
      })();
    }

    parallelPromises.push(verificationPromise);

    // Execute all in parallel
    const [malResult, showDetails, imagesResult, verificationResult] = await Promise.all(parallelPromises);

    // AniList fallback for metadata (only if MAL failed)
    if (!malUsed && alInfo) {
      metaTitleEnglish = alInfo.titleEnglish;
      metaTitleRomaji = alInfo.titleRomaji;
      metaTitleNative = alInfo.titleNative;
      metaCoverImage = alInfo.coverImage;
      metaFormat = alFormat;
      metaStatus = alStatus;
      metaEpisodes = alEpisodes;
      // Dates already set from AniList above if MAL didn't set them
      if (!startDate) startDate = alStartDate;
      if (!endDate) endDate = alEndDate;
    }

    // ============================================================
    // PHASE 4: Episode Assembly
    //   - DB/SIMKL path: Use verified episodes (overwrites DB mapping)
    //   - Date-Based path: Use date-based mapping episodes directly
    // ============================================================
    let allEpisodes: AnimeEpisode[] = [];

    if (mappingSource === 'date-based') {
      // Date-based mapping already has date-matched episodes
      allEpisodes = dateBasedEpisodes;
      console.log(`[API] Using date-based episodes: ${allEpisodes.length} eps`);

    } else if (mappingSource === 'db' || mappingSource === 'simkl') {
      // Try verification layer first
      if (verificationResult && verificationResult.episodes.length > 0) {
        allEpisodes = verificationResult.episodes;
        console.log(`[API] Using VERIFIED episodes (${verificationResult.method}): ${allEpisodes.length} eps`);
      } else {
        // Verification failed or returned empty — fallback to DB mapping's season ranges
        console.log(`[API] Verification returned no episodes, falling back to ${mappingSource} season mapping...`);

        if (mappingSource === 'db' && dbMapping) {
          const activeMappings = (metaFormat === 'TV')
            ? dbMapping.tmdbMappings.filter((m) => m.seasonNumber !== 0)
            : dbMapping.tmdbMappings;

          const preFilterSeasons = [...new Set(activeMappings.map((m) => m.seasonNumber))];
          const seasonDataList = await Promise.all(
            preFilterSeasons.map((s) => getSeasonEpisodes(tmdbShowId!, s).catch(() => null))
          );

          const seasonEpisodesMap = new Map<number, (typeof seasonDataList)[0]>();
          seasonDataList.forEach((sd, i) => {
            if (sd && i < preFilterSeasons.length) {
              seasonEpisodesMap.set(preFilterSeasons[i], sd);
            }
          });

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
          allEpisodes = allEpisodes.filter((ep) => {
            if (seen.has(ep.number)) return false;
            seen.add(ep.number);
            return true;
          });
          allEpisodes.sort((a, b) => a.number - b.number);
        }
        // For SIMKL path with no verification, we have no episodes — will try reconciliation
      }
    }

    // ============================================================
    // PHASE 5: Episode Count Reconciliation (fallback)
    //   Triggers when MAL/AniList says X eps but we have fewer.
    //   Fetches unmapped TMDB seasons sequentially.
    // ============================================================
    const expectedEps = (metaEpisodes && metaEpisodes > 0)
      ? metaEpisodes
      : (anilistNextAiringEpisode?.episode
        ? anilistNextAiringEpisode.episode - 1
        : 0);

    if (expectedEps > 0 && expectedEps > allEpisodes.length && !isMovieMapping && tmdbShowId) {
      const missing = expectedEps - allEpisodes.length;
      const source = metaEpisodes && metaEpisodes > 0 ? 'MAL' : 'nextAiringEpisode';
      console.log(`[API] EP-COUNT MISMATCH (${source}): expected ${expectedEps} eps, have ${allEpisodes.length} eps, missing ~${missing}. Reconciling...`);

      try {
        const showInfo = showDetails || await getShowDetails(tmdbShowId);
        const tmdbSeasons = (showInfo as any)?.seasons || [];

        // Get all currently mapped TMDB season numbers
        const mappedTmdbSeasons = new Set<number>();
        if (mappingSource === 'db' && dbMapping) {
          dbMapping.tmdbMappings.forEach((m) => mappedTmdbSeasons.add(m.seasonNumber));
        }

        const unmappedSeasons = tmdbSeasons
          .filter((s: any) => s.season_number > 0 && !mappedTmdbSeasons.has(s.season_number))
          .sort((a: any, b: any) => a.season_number - b.season_number);

        if (unmappedSeasons.length > 0) {
          console.log(`[API] Found ${unmappedSeasons.length} unmapped TMDB seasons: [${unmappedSeasons.map((s: any) => 'S' + s.season_number).join(', ')}]`);

          const extraSeasonData = await Promise.all(
            unmappedSeasons.map((s: any) => getSeasonEpisodes(tmdbShowId, s.season_number).catch(() => null))
          );

          let nextAnilistNum = allEpisodes.length + 1;
          for (let i = 0; i < extraSeasonData.length; i++) {
            const sd = extraSeasonData[i];
            const sNum = unmappedSeasons[i].season_number;
            if (!sd?.episodes?.length) continue;

            const epNums = sd.episodes.map((e: any) => e.episode_number).sort((a: number, b: number) => a - b);
            const extMapping: TMDBSeasonMapping = {
              tmdbShowId: tmdbShowId!,
              seasonNumber: sNum,
              anilistRange: { from: nextAnilistNum, to: nextAnilistNum + epNums.length - 1 },
              tmdbRange: { from: epNums[0], to: epNums[epNums.length - 1] },
            };

            const extraEps = mapEpisodesForSeason(sd.episodes, extMapping, anilistId);
            allEpisodes.push(...extraEps);
            console.log(`[API] Reconciled S${sNum}: +${epNums.length} eps → AniList E${nextAnilistNum}-E${nextAnilistNum + epNums.length - 1}`);
            nextAnilistNum += epNums.length;
          }

          allEpisodes.sort((a, b) => a.number - b.number);
          console.log(`[API] After reconciliation: ${allEpisodes.length} eps (expected ${expectedEps})`);
        } else {
          console.log(`[API] No unmapped TMDB seasons found.`);
        }
      } catch (e) {
        console.error(`[API] Episode count reconciliation failed:`, e);
      }
    }

    // ============================================================
    // PHASE 6: Aired filter + next airing + images + response
    // ============================================================
    const airedEpisodes = allEpisodes.filter((ep) => ep.hasAired);
    const totalAired = airedEpisodes.length;

    let nextAiringEpisode: number | null = null;
    let nextAiringDate: string | null = null;

    if (anilistNextAiringEpisode) {
      nextAiringEpisode = anilistNextAiringEpisode.episode;
      nextAiringDate = new Date(anilistNextAiringEpisode.airingAt * 1000).toISOString().substring(0, 10);
    } else {
      const unairedEp = allEpisodes.find((ep) => !ep.hasAired && ep.airDate);
      if (unairedEp) {
        nextAiringEpisode = unairedEp.number;
        nextAiringDate = unairedEp.airDate;
      }
    }

    // Images
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
      imagesResult?.logos?.find((l: any) => l.iso_639_1 === 'en') ||
      imagesResult?.logos?.find((l: any) => l.iso_639_1 === 'ja') ||
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
        malId: idMal,
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
