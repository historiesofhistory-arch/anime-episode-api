/**
 * Direct test of One Piece (AniList 1088, MAL 1174)
 * Bypasses Next.js server, tests the logic directly.
 */
import { getMapping } from '../src/lib/mappings';
import { dateBasedMapping } from '../src/lib/date-mapping';
import { getMalInfo } from '../src/lib/mal';
import { getAnilistInfo } from '../src/lib/anilist';
import { getShowDetails, getSeasonEpisodes } from '../src/lib/tmdb';

const TMDB_API_KEY = process.env.TMDB_API_KEY || '8265bd1679663a7ea12ac168da84d2e8';

async function main() {
  const ANILIST_ID = 1088;
  console.log('=== One Piece Test (AniList 1088, MAL 1174) ===\n');

  // Phase 1: AniList info
  console.log('--- Phase 1: AniList ---');
  const alInfo = await getAnilistInfo(ANILIST_ID).catch(e => { console.error('AL fail:', e.message); return null; });
  console.log('idMal:', alInfo?.idMal);
  console.log('title:', alInfo?.titleEnglish || alInfo?.titleRomaji);
  console.log('episodes:', alInfo?.episodes);
  console.log('status:', alInfo?.status);
  console.log('nextAiring:', alInfo?.nextAiringEpisode?.episode, 'at', alInfo?.nextAiringEpisode ? new Date(alInfo.nextAiringEpisode.airingAt * 1000).toISOString() : 'N/A');
  const idMal = alInfo?.idMal ?? null;

  // Phase 2: DB mapping
  console.log('\n--- Phase 2: DB Mapping ---');
  const dbMapping = getMapping(ANILIST_ID);
  if (dbMapping) {
    console.log('DB found! malId:', dbMapping.malId);
    console.log('DB tmdbMappings:', dbMapping.tmdbMappings.length);
    for (const m of dbMapping.tmdbMappings) {
      console.log(`  S${m.seasonNumber}: AL E${m.anilistRange.from}-${m.anilistRange.to} = TMDB ${m.tmdbShowId} E${m.tmdbRange.from}-${m.tmdbRange.to}`);
    }
    // Calculate total episodes from DB
    const dbTotalEps = dbMapping.tmdbMappings.reduce((sum, m) => sum + (m.anilistRange.to - m.anilistRange.from + 1), 0);
    console.log('DB total episodes:', dbTotalEps);
  } else {
    console.log('DB: NOT FOUND');
  }

  // Phase 2b: MAL info
  console.log('\n--- Phase 2b: MAL Info ---');
  if (idMal) {
    const malInfo = await getMalInfo(idMal).catch(e => { console.error('MAL fail:', e.message); return null; });
    if (malInfo) {
      console.log('MAL title:', malInfo.titleEnglish);
      console.log('MAL episodes:', malInfo.episodes);
      console.log('MAL status:', malInfo.status);
      console.log('MAL format:', malInfo.format);
    }
  }

  // Check what TMDB show we're dealing with
  const tmdbShowId = dbMapping?.tmdbMappings[0]?.tmdbShowId;
  if (tmdbShowId) {
    console.log('\n--- TMDB Show Info ---');
    const show = await getShowDetails(tmdbShowId).catch(e => { console.error('TMDB fail:', e.message); return null; });
    if (show) {
      console.log('TMDB show:', show.name);
      console.log('TMDB seasons:', show.number_of_seasons);
      if ((show as any).seasons) {
        for (const s of (show as any).seasons) {
          console.log(`  S${s.season_number}: ${s.episode_count} eps (${s.name})`);
        }
      }
    }

    // Fetch S1 episodes count
    console.log('\n--- TMDB S1 Episodes ---');
    const s1 = await getSeasonEpisodes(tmdbShowId, 1).catch(() => null);
    if (s1) {
      console.log('S1 episode count:', s1.episodes?.length);
    }
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log('MAL episodes (from AniList):', alInfo?.episodes);
  if (dbMapping) {
    const dbTotalEps = dbMapping.tmdbMappings.reduce((sum, m) => sum + (m.anilistRange.to - m.anilistRange.from + 1), 0);
    console.log('DB mapped episodes:', dbTotalEps);
    if (alInfo?.episodes && alInfo.episodes > dbTotalEps) {
      console.log(`MISMATCH: MAL says ${alInfo.episodes} but DB has ${dbTotalEps} → Reconciliation WILL trigger`);
    } else {
      console.log('OK: DB has enough episodes (or MAL count unknown)');
    }
  }
}

main().catch(console.error);
