/**
 * TEST: Root name search on TMDB in original language + date verification
 * Fixed: don't strip after colon if it's part of title (e.g. Re:Zero)
 */

const ANILIST_API = 'https://graphql.anilist.co';

function extractRootName(title: string): string {
  if (!title) return '';
  return title
    // Remove season/part/cour suffixes (must come AFTER the main title)
    .replace(/[,\s]+(?:Season|S)\s*\d+.*$/i, '')
    .replace(/[,\s]+(?:Part|P|Cour)\s*\d+.*$/i, '')
    .replace(/[,\s]+\d+(?:st|nd|rd|th)\s*Season.*$/i, '')
    // ⚠️ Do NOT strip after colon/dash — Re:ZERO, Dr. Stone etc have them in main name
    .trim();
}

const ANILIST_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    title { english romaji native }
    countryOfOrigin
    seasonYear
    season
    startDate { year month day }
    episodes
    format
  }
}
`;

async function fetchAnilist(id: number) {
  const res = await fetch(ANILIST_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: ANILIST_QUERY, variables: { id } }),
  });
  if (!res.ok) { console.error(`AniList HTTP ${res.status}`); return null; }
  const json: any = await res.json();
  return json.data?.Media ?? null;
}

// Use TMDB v3 directly for this test
const TMDB_KEY = process.env.TMDB_API_KEY || '';

async function searchTmdb(query: string, lang: string) {
  if (!TMDB_KEY) { console.log('    ⚠️  No TMDB_API_KEY — cannot search'); return []; }
  const url = `https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(query)}&language=${lang}&api_key=${TMDB_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json: any = await res.json();
  return json.results || [];
}

async function getTmdbDetails(tmdbId: number) {
  if (!TMDB_KEY) return null;
  const url = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_KEY}&language=en-US`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return await res.json();
}

function getSearchLang(country: string | null): string {
  if (!country) return 'ja';
  const map: Record<string, string> = { JP: 'ja', KR: 'ko', CN: 'zh' };
  return map[country.toUpperCase()] || 'ja';
}

// ====== MAIN ======
async function main() {
  const tests = [
    { id: 182205, name: 'Slime S4' },
    { id: 119661, name: 'Re:Zero S2 Part 2' },
    { id: 117641, name: 'AoT Final S2' },
  ];

  for (const t of tests) {
    console.log(`\n${'═'.repeat(85)}`);
    console.log(`  Test: ${t.name} (anilist ${t.id})`);
    console.log(`${'═'.repeat(85)}`);

    const anime = await fetchAnilist(t.id);
    if (!anime) { console.log('  ❌ Not found on AniList'); continue; }

    const rootEn = extractRootName(anime.title.english || '');
    const rootRomaji = extractRootName(anime.title.romaji || '');
    const searchLang = getSearchLang(anime.countryOfOrigin);

    console.log(`  Title EN:     ${anime.title.english}`);
    console.log(`  Title Romaji: ${anime.title.romaji}`);
    console.log(`  Title Native: ${anime.title.native}`);
    console.log(`  Country:      ${anime.countryOfOrigin} (${searchLang})`);
    console.log(`  Season Year:  ${anime.seasonYear}`);
    console.log(`  Start Date:   ${anime.startDate?.year}-${String(anime.startDate?.month ?? 0).padStart(2, '0')}-${String(anime.startDate?.day ?? 0).padStart(2, '0')}`);
    console.log(`  Episodes:     ${anime.episodes}`);
    console.log(`  ────────────────────────────────────`);
    console.log(`  Root EN:      "${rootEn}"`);
    console.log(`  Root Romaji:  "${rootRomaji}"`);
    console.log(`  Search Lang:   ${searchLang}`);

    // Search TMDB in original language (romaji)
    const searchTitle = rootRomaji || rootEn;
    console.log(`\n  🔍 TMDB search: "${searchTitle}" (lang=${searchLang})`);
    const results = await searchTmdb(searchTitle, searchLang);

    // Fallback: English search
    let allResults = [...(results || [])];
    if (!results?.length) {
      console.log(`  🔍 Fallback: "${rootEn}" (lang=en-US)`);
      const enResults = await searchTmdb(rootEn, 'en-US');
      allResults = enResults || [];
    }

    console.log(`  Found: ${allResults.length} results\n`);

    for (let i = 0; i < Math.min(3, allResults.length); i++) {
      const r = allResults[i];
      const tmdbYear = r.first_air_date?.substring(0, 4) || 'N/A';
      const anilistYear = String(anime.seasonYear || anime.startDate?.year || 'N/A');
      const match = tmdbYear === anilistYear ? '✅' : '❌';
      console.log(`  [${i + 1}] TMDB ${r.id}: "${r.name}" (original: "${r.original_name}")`);
      console.log(`       Air Date: ${r.first_air_date || 'N/A'} | Year: ${tmdbYear} | AniList Year: ${anilistYear} ${match}`);
      console.log(`       Popularity: ${r.popularity} | Seasons: ${r.number_of_seasons}`);
    }

    // Show full season breakdown for best match
    if (allResults.length > 0) {
      const details = await getTmdbDetails(allResults[0].id);
      if (details?.seasons) {
        console.log(`\n  📋 TMDB ${allResults[0].id} ("${details.name}") Season Breakdown:`);
        console.log(`     Total: ${details.number_of_seasons} seasons, ${details.number_of_episodes} episodes\n`);
        for (const s of details.seasons.filter((s: any) => s.season_number > 0)) {
          console.log(`     S${s.season_number}: "${s.name}" — ${s.episode_count} eps — ${s.air_date || 'N/A'}`);
        }
      }
    }
  }

  console.log('\n✅ Done.');
}

main().catch(console.error);