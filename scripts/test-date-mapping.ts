/**
 * TEST: Date-based episode mapping — Final flow
 * 1. BFS chain → S1 startDate (verification)
 * 2. Specific entry's startDate + endDate
 * 3. TMDB search (English root) → verify by S1 date
 * 4. TMDB episodes → match by date range → episode range
 */

const ANILIST_API = 'https://graphql.anilist.co';
const TMDB_KEY = process.env.TMDB_API_KEY || '8265bd1679663a7ea12ac168da84d2e8';

interface AnilistMedia {
  id: number;
  title: { english: string | null; romaji: string | null; native: string | null };
  format: string | null;
  seasonYear: number | null;
  episodes: number | null;
  startDate: { year: number | null; month: number | null; day: number | null } | null;
  endDate: { year: number | null; month: number | null; day: number | null } | null;
  relations: { edges: RelationEdge[] } | null;
}

interface RelationEdge {
  relationType: string;
  node: { id: number; format: string | null };
}

const QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    title { english romaji native }
    format
    seasonYear
    episodes
    startDate { year month day }
    endDate { year month day }
    relations {
      edges {
        relationType
        node { id format }
      }
    }
  }
}
`;

async function fetchAnilist(id: number): Promise<AnilistMedia | null> {
  const res = await fetch(ANILIST_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { id } }),
  });
  if (!res.ok) return null;
  const json: any = await res.json();
  return json.data?.Media ?? null;
}

function formatDate(d: { year: number | null; month: number | null; day: number | null } | null): string {
  if (!d || !d.year) return 'N/A';
  return `${d.year}-${String(d.month ?? 0).padStart(2, '0')}-${String(d.day ?? 0).padStart(2, '0')}`;
}

function extractRootName(title: string): string {
  if (!title) return '';
  return title
    .replace(/,?\s*(?:Season|S)\s*\d+.*$/i, '')
    .replace(/,?\s*(?:Part|P|Cour)\s*\d+.*$/i, '')
    .replace(/,?\s*\d+(?:st|nd|rd|th)\s*Season.*$/i, '')
    .trim();
}

function hasSeasonOrPart(title: string): boolean {
  return /(?:Season|S)\s*\d+|(?:Part|P|Cour)\s*\d+|\d+(?:st|nd|rd|th)\s*Season/i.test(title);
}

// BFS to find S1 (root) — the earliest entry in the chain
async function findRootSeason(startId: number): Promise<AnilistMedia | null> {
  const visited = new Set<number>();
  const queue = [startId];
  let root: AnilistMedia | null = null;
  const RELEVANT = new Set(['PREQUEL', 'SEQUEL']);
  const TV = new Set(['TV', 'TV_SHORT']);

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const m = await fetchAnilist(id);
    if (!m || !TV.has(m.format || '')) continue;
    // Track the oldest entry as root
    if (!root || (m.seasonYear ?? 9999) < (root.seasonYear ?? 9999) || (m.seasonYear === root.seasonYear && m.id < root.id)) {
      root = m;
    }
    if (m.relations?.edges) {
      for (const e of m.relations.edges) {
        if (RELEVANT.has(e.relationType) && TV.has(e.node.format || '') && !visited.has(e.node.id)) {
          queue.push(e.node.id);
        }
      }
    }
  }
  return root;
}

async function searchTmdb(query: string) {
  const url = `https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(query)}&language=en-US&include_adult=false&api_key=${TMDB_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json: any = await res.json();
  return json.results || [];
}

async function getTmdbAllEpisodes(tmdbId: number): Promise<any[]> {
  // First get show details to know seasons
  const showUrl = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_KEY}&language=en-US`;
  const showRes = await fetch(showUrl);
  if (!showRes.ok) return [];
  const show: any = await showRes.json();

  const allEps: any[] = [];
  const seasons = show.seasons?.filter((s: any) => s.season_number > 0) || [];

  // Fetch all seasons in parallel
  const epsPromises = seasons.map(async (s: any) => {
    const url = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${s.season_number}?api_key=${TMDB_KEY}&language=en-US`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data: any = await res.json();
    return (data.episodes || []).map((ep: any) => ({
      ...ep,
      season_number: s.season_number,
    }));
  });

  const results = await Promise.all(epsPromises);
  for (const eps of results) allEps.push(...eps);

  return allEps;
}

// ====== MAIN ======
async function main() {
  // Test multiple entries
  const TEST_IDS = [
    { id: 108511, name: 'Slime S2 (Part 1)' },
    { id: 116742, name: 'Slime S2 Part 2' },
  ];
  for (const test of TEST_IDS) {
    console.log(`\n${'█'.repeat(70)}`);
    console.log(`  TEST: ${test.name} (anilist ${test.id})`);
    console.log(`${'█'.repeat(70)}\n`);

    const entry = await fetchAnilist(test.id);
  if (!entry) { console.log('❌ Not found'); continue; }

  const title = entry.title.english || entry.title.romaji || '';
  const hasSP = hasSeasonOrPart(title);
  const rootEn = extractRootName(title);

  console.log(`Title: ${title}`);
  console.log(`Has Season/Part: ${hasSP}`);
  console.log(`Root Name: "${rootEn}"`);
  console.log(`Start Date: ${formatDate(entry.startDate)}`);
  console.log(`End Date: ${formatDate(entry.endDate)}`);
  console.log(`Episodes: ${entry.episodes}`);

  // Step 2: If season/part, find root (S1) for verification
  let rootStartDate = formatDate(entry.startDate);
  if (hasSP) {
    console.log(`\n→ Season/Part detected, finding root (S1) via PREQUEL chain...`);
    const root = await findRootSeason(test.id);
    if (root) {
      rootStartDate = formatDate(root.startDate);
      console.log(`  Root found: ${root.title.english || root.title.romaji} (id=${root.id})`);
      console.log(`  Root Start Date: ${rootStartDate}`);
    } else {
      console.log(`  ⚠️  Root not found, using entry's own date`);
    }
  }

  // Step 3: Search TMDB (parallel with above in production)
  console.log(`\n→ TMDB Search: "${rootEn}"`);
  const results = await searchTmdb(rootEn);
  console.log(`  Found ${results.length} results`);

  // Step 4: Verify by S1 date match
  let matchedShow: any = null;
  for (const r of results.slice(0, 5)) {
    const s1Date = r.first_air_date?.substring(0, 10) || '';
    const match = s1Date === rootStartDate;
    console.log(`  TMDB ${r.id}: "${r.name}" S1=${s1Date} vs AniList S1=${rootStartDate} ${match ? '✅' : '❌'}`);
    if (match && !matchedShow) matchedShow = r;
  }

  if (!matchedShow) {
    // Fallback: pick most popular
    matchedShow = results[0];
    console.log(`\n  ⚠️  No date match, falling back to most popular: TMDB ${matchedShow.id}`);
  }

  console.log(`\n→ Matched TMDB Show: ${matchedShow.id} "${matchedShow.name}"`);

  // Step 5: Get ALL episodes from TMDB (flat)
  console.log(`\n→ Fetching all TMDB episodes...`);
  const allEps = await getTmdbAllEpisodes(matchedShow.id);
  console.log(`  Total TMDB episodes: ${allEps.length}`);

  // Step 6: Match by date range
  const startDateStr = formatDate(entry.startDate);
  const endDateStr = formatDate(entry.endDate);

  const firstEp = allEps.find(ep => ep.air_date === startDateStr);
  const lastEp = allEps.find(ep => ep.air_date === endDateStr);

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  DATE MATCH RESULTS`);
  console.log(`${'═'.repeat(70)}`);
  console.log(`  AniList Start Date: ${startDateStr} → TMDB Ep: ${firstEp ? `S${firstEp.season_number}E${firstEp.episode_number} "${firstEp.name}"` : '❌ NOT FOUND'}`);
  console.log(`  AniList End Date:   ${endDateStr} → TMDB Ep: ${lastEp ? `S${lastEp.season_number}E${lastEp.episode_number} "${lastEp.name}"` : '❌ NOT FOUND'}`);

  if (firstEp && lastEp) {
    // Get all episodes in range
    const epsInRange = allEps.filter(ep => {
      if (!ep.air_date) return false;
      return ep.air_date >= startDateStr && ep.air_date <= endDateStr;
    });
    console.log(`\n  📺 MAPPING RESULT:`);
    console.log(`     TMDB Show ID: ${matchedShow.id}`);
    console.log(`     Season Range: S${firstEp.season_number} to S${lastEp.season_number}`);
    console.log(`     Episode Range: E${firstEp.episode_number} to E${lastEp.episode_number}`);
    console.log(`     Total Episodes: ${epsInRange.length}`);
    console.log(`     AniList Episodes: ${entry.episodes}`);
    console.log(`     Match: ${epsInRange.length === entry.episodes ? '✅ PERFECT' : '⚠️  COUNT MISMATCH'}`);
    console.log(`\n  Episodes:`);
    for (const ep of epsInRange) {
      console.log(`     S${ep.season_number}E${ep.episode_number}: "${ep.name}" (${ep.air_date})`);
    }
  } else {
    console.log(`\n  ❌ Could not find matching episodes by date`);
    console.log(`  Available TMDB dates around that period:`);
    const nearby = allEps
      .filter(ep => ep.air_date && ep.air_date.startsWith(String(entry.startDate?.year || entry.seasonYear || '')))
      .slice(0, 10);
    for (const ep of nearby) {
      console.log(`     S${ep.season_number}E${ep.episode_number}: "${ep.name}" (${ep.air_date})`);
    }
  }

    console.log(`\n✅ Test complete for ${test.name}.`);
  }
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`ALL TESTS DONE`);
  console.log(`${'═'.repeat(70)}`);
}

main().catch(console.error);