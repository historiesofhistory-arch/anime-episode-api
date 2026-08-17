/**
 * Full simulation of the One Piece route flow
 * Tests: parseRange fix + nextAiringEpisode reconciliation trigger
 */
import { getMapping } from '../src/lib/mappings';
import { getMalInfo } from '../src/lib/mal';
import { getAnilistInfo } from '../src/lib/anilist';
import { getShowDetails, getSeasonEpisodes, getTmdbImageUrl } from '../src/lib/tmdb';
import { TMDBSeasonMapping } from '../src/lib/types';

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
): any[] {
  const results: any[] = [];
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

async function main() {
  const ANILIST_ID = 21;
  console.log('=== One Piece Full Flow Simulation ===\n');

  // Phase 1
  const alInfo = await getAnilistInfo(ANILIST_ID).catch(() => null);
  const idMal = alInfo?.idMal ?? null;
  const nextAiring = alInfo?.nextAiringEpisode ?? null;
  console.log('AniList: idMal=' + idMal + ' nextAiring=' + (nextAiring?.episode ?? 'none'));

  // Phase 2: DB
  const dbMapping = getMapping(ANILIST_ID);
  const mapping = dbMapping;
  console.log('DB: ' + (mapping ? mapping.tmdbMappings.length + ' season mappings' : 'NOT FOUND'));

  if (!mapping) { console.log('No mapping, aborting'); return; }

  // Phase 3: MAL
  let metaEpisodes: number | null = null;
  if (idMal) {
    try {
      const mal = await getMalInfo(idMal);
      metaEpisodes = mal.episodes;
      console.log('MAL episodes: ' + metaEpisodes);
    } catch { console.log('MAL failed'); }
  }

  // Phase 4: Map episodes from DB
  const primaryMapping = mapping.tmdbMappings.find(m => m.seasonNumber > 0) || mapping.tmdbMappings[0];
  const primaryShowId = primaryMapping.tmdbShowId;
  const activeMappings = mapping.tmdbMappings.filter(m => m.seasonNumber !== 0);

  console.log('\nFetching TMDB seasons: ' + activeMappings.map(m => 'S' + m.seasonNumber).join(', '));
  const seasonDataList = await Promise.all(
    activeMappings.map(m => getSeasonEpisodes(primaryShowId, m.seasonNumber).catch(() => null))
  );

  let allEpisodes: any[] = [];
  for (let i = 0; i < activeMappings.length; i++) {
    const tmdbMapping = activeMappings[i];
    const seasonData = seasonDataList[i];
    if (!seasonData?.episodes?.length) continue;
    // Skip broken mappings where from > to
    if (tmdbMapping.anilistRange.from > tmdbMapping.anilistRange.to) {
      console.log('S' + tmdbMapping.seasonNumber + ' BROKEN range: E' + tmdbMapping.anilistRange.from + '-' + tmdbMapping.anilistRange.to + ', skipping');
      continue;
    }
    const eps = mapEpisodesForSeason(seasonData.episodes, tmdbMapping, ANILIST_ID);
    allEpisodes.push(...eps);
  }

  // Dedup + sort
  const seen = new Set<number>();
  allEpisodes = allEpisodes.filter(ep => {
    if (seen.has(ep.number)) return false;
    seen.add(ep.number);
    return true;
  });
  allEpisodes.sort((a, b) => a.number - b.number);

  console.log('\nAfter DB mapping: ' + allEpisodes.length + ' episodes (E' + (allEpisodes[0]?.number ?? '?') + '-E' + (allEpisodes[allEpisodes.length-1]?.number ?? '?') + ')');

  // Phase 5: Reconciliation check
  const expectedEps = (metaEpisodes && metaEpisodes > 0)
    ? metaEpisodes
    : (nextAiring?.episode ? nextAiring.episode - 1 : 0);

  console.log('\n--- RECONCILIATION CHECK ---');
  console.log('metaEpisodes (MAL): ' + metaEpisodes);
  console.log('nextAiringEpisode: ' + (nextAiring?.episode ?? 'none'));
  console.log('expectedEps: ' + expectedEps);
  console.log('allEpisodes.length: ' + allEpisodes.length);

  if (expectedEps > 0 && expectedEps > allEpisodes.length) {
    const missing = expectedEps - allEpisodes.length;
    const source = metaEpisodes && metaEpisodes > 0 ? 'MAL' : 'nextAiringEpisode';
    console.log('\nMISMATCH (' + source + '): expected ' + expectedEps + ', mapped ' + allEpisodes.length + ', missing ~' + missing);

    const existingSeasons = new Set(activeMappings.map(m => m.seasonNumber));
    const showInfo = await getShowDetails(primaryShowId);
    const tmdbSeasons = (showInfo as any)?.seasons || [];
    const unmappedSeasons = tmdbSeasons
      .filter((s: any) => s.season_number > 0 && !existingSeasons.has(s.season_number))
      .sort((a: any, b: any) => a.season_number - b.season_number);

    console.log('Unmapped seasons: ' + (unmappedSeasons.length > 0 ? unmappedSeasons.map((s: any) => 'S' + s.season_number + '(' + s.episode_count + ')').join(', ') : 'NONE'));

    if (unmappedSeasons.length > 0) {
      const extraSeasonData = await Promise.all(
        unmappedSeasons.map(s => getSeasonEpisodes(primaryShowId, s.season_number).catch(() => null))
      );

      let nextAnilistNum = allEpisodes.length + 1;
      for (let i = 0; i < extraSeasonData.length; i++) {
        const sd = extraSeasonData[i];
        const sNum = unmappedSeasons[i].season_number;
        if (!sd?.episodes?.length) continue;
        const epNums = sd.episodes.map(e => e.episode_number).sort((a, b) => a - b);
        const extMapping: TMDBSeasonMapping = {
          tmdbShowId: primaryShowId,
          seasonNumber: sNum,
          anilistRange: { from: nextAnilistNum, to: nextAnilistNum + epNums.length - 1 },
          tmdbRange: { from: epNums[0], to: epNums[epNums.length - 1] },
        };
        const extraEps = mapEpisodesForSeason(sd.episodes, extMapping, ANILIST_ID);
        allEpisodes.push(...extraEps);
        console.log('Reconciled S' + sNum + ': +' + epNums.length + ' eps → AL E' + nextAnilistNum + '-E' + (nextAnilistNum + epNums.length - 1));
        nextAnilistNum += epNums.length;
      }
      allEpisodes.sort((a, b) => a.number - b.number);
    }
  } else {
    console.log('NO MISMATCH - reconciliation not needed');
  }

  // Final summary
  const airedEpisodes = allEpisodes.filter(ep => ep.hasAired);
  console.log('\n=== FINAL RESULT ===');
  console.log('Total episodes: ' + allEpisodes.length);
  console.log('Aired episodes: ' + airedEpisodes.length);
  console.log('Range: E' + (allEpisodes[0]?.number ?? '?') + '-E' + (allEpisodes[allEpisodes.length-1]?.number ?? '?'));
  console.log('Expected: ' + expectedEps + ' (aired)');
  console.log('Status: ' + (airedEpisodes.length >= expectedEps ? 'MATCH' : (airedEpisodes.length + ' < ' + expectedEps + ' (TMDB may be behind)')));
}

main().catch(console.error);
