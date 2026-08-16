// Direct test of 182205 — no caching, no database, pure API calls

const ANILIST_API = 'https://graphql.anilist.co';
const TMDB_KEY = process.env.TMDB_API_KEY || '8265bd1679663a7ea12ac168da84d2e8';
const TMDB_BASE = 'https://api.themoviedb.org/3';

async function main() {
  console.log('=== STEP 1: Check 182205 in offline DB ===');
  const fs = await import('fs');
  const db = JSON.parse(fs.readFileSync('data/mappings.min.json', 'utf8'));
  console.log('182205 in mappings.min.json:', '182205' in db ? 'YES ⚠️' : 'NO ✅');
  const custom = JSON.parse(fs.readFileSync('data/custom-mappings.json', 'utf8'));
  const inCustom = custom.find((e: any) => e.anilistId === 182205);
  console.log('182205 in custom-mappings.json:', inCustom ? 'YES ⚠️' : 'NO ✅');
  console.log('');

  console.log('=== STEP 2: Fetch AniList 182205 ===');
  const query = `query { Media(id: 182205, type: ANIME) { id title { english romaji native } format seasonYear episodes startDate { year month day } endDate { year month day } relations { edges { relationType node { id format title { english romaji } } } } } }`;
  const alRes = await fetch(ANILIST_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  const alData = await alRes.json();
  const media = alData.data?.Media;
  if (!media) { console.log('ERROR: 182205 not found on AniList!'); return; }
  console.log('Title:', media.title.english || media.title.romaji);
  console.log('Format:', media.format, '| Episodes:', media.episodes);
  console.log('Start:', JSON.stringify(media.startDate), '| End:', JSON.stringify(media.endDate));
  console.log('Relations:');
  for (const e of (media.relations?.edges || [])) {
    console.log(`  ${e.relationType} → ${e.node.id} (${e.node.title?.english || e.node.title?.romaji}) [${e.node.format}]`);
  }
  console.log('');

  // Extract root name
  const title = media.title.english || media.title.romaji || '';
  const rootName = title
    .replace(/,?\s*(?:Season|S)\s*\d+.*$/i, '')
    .replace(/,?\s*(?:Part|P|Cour)\s*\d+.*$/i, '')
    .replace(/,?\s*\d+(?:st|nd|rd|th)\s*Season.*$/i, '')
    .trim();
  console.log('=== STEP 3: Root Name ===');
  console.log('Original:', title);
  console.log('Root:', rootName);
  console.log('Has Season/Part:', /(?:Season|S)\s*\d+|(?:Part|P|Cour)\s*\d+|\d+(?:st|nd|rd|th)\s*Season/i.test(title));
  console.log('');

  console.log('=== STEP 4: Search TMDB ===');
  const tmdbSearchUrl = `${TMDB_BASE}/search/tv?query=${encodeURIComponent(rootName)}&language=en-US&include_adult=false&api_key=${TMDB_KEY}`;
  const tmdbRes = await fetch(tmdbSearchUrl);
  const tmdbData = await tmdbRes.json();
  console.log('TMDB search for:', rootName);
  for (const r of (tmdbData.results || []).slice(0, 5)) {
    console.log(`  [${r.id}] ${r.name} | first_air: ${r.first_air_date} | pop: ${r.popularity}`);
  }
  console.log('');

  if (!tmdbData.results?.length) { console.log('No TMDB results, aborting.'); return; }

  // Take first result
  const tmdbShow = tmdbData.results[0];
  console.log('=== STEP 5: Selected TMDB Show ===');
  console.log(`[${tmdbShow.id}] ${tmdbShow.name} | first_air: ${tmdbShow.first_air_date}`);
  console.log('');

  // Fetch all seasons info
  console.log('=== STEP 6: Fetch TMDB Seasons ===');
  const showUrl = `${TMDB_BASE}/tv/${tmdbShow.id}?api_key=${TMDB_KEY}`;
  const showData = await (await fetch(showUrl)).json();
  const seasons = (showData.seasons || []).filter((s: any) => s.season_number > 0);
  console.log('Seasons:', seasons.map((s: any) => `S${s.season_number} (${s.episode_count} eps, ${s.air_date || 'N/A'})`).join(', '));
  console.log('');

  // Fetch all episodes
  console.log('=== STEP 7: Fetch ALL Episodes (flat) ===');
  const allEps: { ep: any; season_number: number }[] = [];
  for (const s of seasons) {
    try {
      const epUrl = `${TMDB_BASE}/tv/${tmdbShow.id}/season/${s.season_number}?api_key=${TMDB_KEY}`;
      const epData = await (await fetch(epUrl)).json();
      for (const ep of (epData.episodes || [])) {
        allEps.push({ ep, season_number: s.season_number });
      }
    } catch (e: any) {
      console.log(`  Error fetching S${s.season_number}:`, e.message);
    }
  }
  console.log(`Total episodes fetched: ${allEps.length}`);

  // Show date range per season
  const bySeason = new Map<number, typeof allEps>();
  for (const e of allEps) {
    if (!bySeason.has(e.season_number)) bySeason.set(e.season_number, []);
    bySeason.get(e.season_number)!.push(e);
  }
  for (const [sNum, eps] of [...bySeason.entries()].sort((a, b) => a[0] - b[0])) {
    const dates = eps.map(e => e.ep.air_date).filter(Boolean).sort();
    console.log(`  S${sNum}: E${eps[0].ep.episode_number}–E${eps[eps.length-1].ep.episode_number} | ${dates[0]} → ${dates[dates.length-1]} (${eps.length} eps)`);
  }
  console.log('');

  // Date matching
  const startDate = `${media.startDate.year}-${String(media.startDate.month ?? 0).padStart(2, '0')}-${String(media.startDate.day ?? 0).padStart(2, '0')}`;
  const endDate = media.endDate ? `${media.endDate.year}-${String(media.endDate.month ?? 0).padStart(2, '0')}-${String(media.endDate.day ?? 0).padStart(2, '0')}` : '';

  console.log('=== STEP 8: Date Matching ===');
  console.log('AniList startDate:', startDate);
  console.log('AniList endDate:', endDate);

  const firstMatch = allEps.find(e => e.ep.air_date === startDate);
  const lastMatch = endDate
    ? allEps.find(e => e.ep.air_date === endDate)
    : allEps.filter(e => e.ep.air_date >= startDate).pop();

  if (!firstMatch) {
    console.log('❌ NO first match for startDate:', startDate);
    // Show nearby dates
    const sorted = allEps.filter(e => e.ep.air_date).sort((a, b) => a.ep.air_date!.localeCompare(b.ep.air_date!));
    const idx = sorted.findIndex(e => e.ep.air_date! >= startDate);
    if (idx >= 0) {
      console.log('  Closest TMDB episode on/after startDate:');
      for (let i = Math.max(0, idx-2); i < Math.min(sorted.length, idx+3); i++) {
        const e = sorted[i];
        console.log(`    S${e.season_number}E${e.ep.episode_number}: ${e.ep.air_date} — ${e.ep.name}`);
      }
    }
    return;
  }

  console.log(`✅ First match: S${firstMatch.season_number}E${firstMatch.ep.episode_number} (${firstMatch.ep.air_date}) — ${firstMatch.ep.name}`);
  if (lastMatch) {
    console.log(`✅ Last match: S${lastMatch.season_number}E${lastMatch.ep.episode_number} (${lastMatch.ep.air_date}) — ${lastMatch.ep.name}`);
  }

  // Collect range
  const epsInRange = allEps.filter(e => {
    if (!e.ep.air_date) return false;
    return e.ep.air_date >= startDate && (!endDate || e.ep.air_date <= endDate);
  });

  console.log(`\n=== RESULT ===`);
  console.log(`Matched episodes: ${epsInRange.length}`);
  console.log(`Expected (AniList): ${media.episodes}`);
  console.log(`Match: ${epsInRange.length === media.episodes ? '✅ PERFECT' : '⚠️ MISMATCH'}`);
  console.log('');

  // Show mapping by TMDB season
  const mapBySeason = new Map<number, typeof epsInRange>();
  for (const e of epsInRange) {
    if (!mapBySeason.has(e.season_number)) mapBySeason.set(e.season_number, []);
    mapBySeason.get(e.season_number)!.push(e);
  }
  let alFrom = 1;
  for (const [sNum, eps] of [...mapBySeason.entries()].sort((a, b) => a[0] - b[0])) {
    const nums = eps.map(e => e.ep.episode_number).sort((a, b) => a - b);
    console.log(`  TMDB S${sNum} E${nums[0]}–E${nums[nums.length-1]} → AniList ep ${alFrom}–${alFrom + nums.length - 1}`);
    alFrom += nums.length;
  }
}

main().catch(e => console.error('FATAL:', e));
