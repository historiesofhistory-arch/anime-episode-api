import { getMapping } from '../src/lib/mappings';
import { getMalInfo } from '../src/lib/mal';
import { getAnilistInfo } from '../src/lib/anilist';
import { getShowDetails, getSeasonEpisodes } from '../src/lib/tmdb';

async function main() {
  const ANILIST_ID = 21; // One Piece
  console.log('=== One Piece Test (AniList 21, MAL 21) ===\n');

  // Phase 1: AniList
  console.log('--- AniList ---');
  const alInfo = await getAnilistInfo(ANILIST_ID).catch(e => { console.error('AL fail:', e.message); return null; });
  console.log('idMal:', alInfo?.idMal);
  console.log('title:', alInfo?.titleEnglish || alInfo?.titleRomaji);
  console.log('episodes (AL):', alInfo?.episodes ?? 'null');
  console.log('status:', alInfo?.status);
  console.log('nextAiring:', alInfo?.nextAiringEpisode?.episode ?? 'none',
    alInfo?.nextAiringEpisode ? new Date(alInfo.nextAiringEpisode.airingAt * 1000).toISOString().substring(0,10) : '');
  const idMal = alInfo?.idMal ?? null;

  // Phase 2: DB mapping
  console.log('\n--- DB Mapping ---');
  const dbMapping = getMapping(ANILIST_ID);
  if (dbMapping) {
    console.log('DB found! malId:', dbMapping.malId);
    console.log('DB tmdbMappings count:', dbMapping.tmdbMappings.length);
    const dbTotalEps = dbMapping.tmdbMappings.reduce((sum, m) => sum + (m.anilistRange.to - m.anilistRange.from + 1), 0);
    console.log('DB total AL episodes:', dbTotalEps);
    // Show first 5 and last 3 mappings
    const show = dbMapping.tmdbMappings;
    for (const m of show.slice(0, 5)) {
      console.log(`  S${m.seasonNumber}: AL E${m.anilistRange.from}-${m.anilistRange.to} = TMDB ${m.tmdbShowId} E${m.tmdbRange.from}-${m.tmdbRange.to}`);
    }
    if (show.length > 5) {
      console.log('  ...');
      for (const m of show.slice(-3)) {
        console.log(`  S${m.seasonNumber}: AL E${m.anilistRange.from}-${m.anilistRange.to} = TMDB ${m.tmdbShowId} E${m.tmdbRange.from}-${m.tmdbRange.to}`);
      }
    }
  } else {
    console.log('DB: NOT FOUND');
  }

  // Phase 2b: MAL
  console.log('\n--- MAL ---');
  let malEpisodes: number | null = null;
  if (idMal) {
    const malInfo = await getMalInfo(idMal).catch(e => { console.error('MAL fail:', e.message); return null; });
    if (malInfo) {
      console.log('title:', malInfo.titleEnglish);
      console.log('episodes (MAL):', malInfo.episodes);
      console.log('status:', malInfo.status);
      malEpisodes = malInfo.episodes;
    }
  }

  // Phase 3: TMDB show details
  const tmdbShowId = dbMapping?.tmdbMappings[0]?.tmdbShowId;
  if (tmdbShowId) {
    console.log('\n--- TMDB Show ---');
    const show = await getShowDetails(tmdbShowId).catch(e => { console.error('TMDB fail:', e.message); return null; });
    if (show) {
      console.log('TMDB show:', show.name, `(ID: ${show.id})`);
      console.log('TMDB seasons:', show.number_of_seasons);
      const seasons = (show as any).seasons || [];
      for (const s of seasons.filter((s: any) => s.season_number > 0)) {
        console.log(`  S${s.season_number}: ${s.episode_count} eps`);
      }
      // Count total non-S0 episodes
      const totalTmdb = seasons.filter((s: any) => s.season_number > 0).reduce((sum: number, s: any) => sum + s.episode_count, 0);
      console.log('TMDB total non-S0 episodes:', totalTmdb);
    }
  }

  // Phase 5 check: Will reconciliation trigger?
  console.log('\n=== RECONCILIATION CHECK ===');
  if (dbMapping) {
    const dbTotalEps = dbMapping.tmdbMappings.reduce((sum, m) => sum + (m.anilistRange.to - m.anilistRange.from + 1), 0);
    const source = malEpisodes ?? alInfo?.episodes;
    if (source && source > dbTotalEps) {
      console.log(`YES - MISMATCH: source says ${source} eps, DB has ${dbTotalEps} eps → Reconciliation WILL trigger`);
    } else if (source) {
      console.log(`NO MISMATCH: source says ${source} eps, DB has ${dbTotalEps} eps → Reconciliation NOT needed`);
    } else {
      console.log(`Cannot check: source episodes is null (MAL=${malEpisodes}, AL=${alInfo?.episodes})`);
    }
  }
}

main().catch(console.error);
