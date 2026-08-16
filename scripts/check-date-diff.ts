// Check real date differences between AniList and TMDB

const ANILIST_API = 'https://graphql.anilist.co';
const TMDB_KEY = process.env.TMDB_API_KEY || '8265bd1679663a7ea12ac168da84d2e8';
const TMDB_BASE = 'https://api.themoviedb.org/3';

interface ALMedia {
  id: number;
  title: { english: string | null; romaji: string | null };
  startDate: { year: number | null; month: number | null; day: number | null } | null;
}

// Popular anime IDs to test - mix of seasons, parts, ongoing, completed
const TEST_IDS = [
  21,     // One Piece
  51009,  // Jujutsu Kaisen
  1535,   // Death Note
  16498,  // Demon Slayer S1
  11757,  // Boruto
  140960, // Dandadan (if it exists)
  1535,   // Death Note
  1,      // Cowboy Bebop
  20,     // Naruto
  22,     // Naruto Shippuden
  11061,  // Hunter x Hunter (2011)
  9969,   // Gintama
  9253,   // Steins;Gate
  20464,  // Your Lie in April
  21459,  // My Hero Academia S1
  21746,  // Mob Psycho S1
  108511, // Slime S2 Part 1
  116742, // Slime S2 Part 2
  182205, // Slime S4
  154707, // Oshi no Ko S1
  168946, // Oshi no Ko S2
  119661, // Re:Zero S2 Part 2
  138680, // Mob Psycho S3
];

async function fetchAnilist(id: number): Promise<ALMedia | null> {
  const query = `query($id:Int){Media(id:$id,type:ANIME){id title{english romaji} startDate{year month day}}}`;
  const res = await fetch(ANILIST_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { id } }),
  });
  const json: any = await res.json();
  return json.data?.Media ?? null;
}

async function searchTmdb(query: string) {
  const url = `${TMDB_BASE}/search/tv?query=${encodeURIComponent(query)}&language=en-US&api_key=${TMDB_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.results?.[0] ?? null;
}

async function getFirstEpDate(tmdbId: number, season: number) {
  const url = `${TMDB_BASE}/tv/${tmdbId}/season/${season}?api_key=${TMDB_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  const firstEp = data.episodes?.[0];
  return firstEp?.air_date || null;
}

function fmtDate(d: { year: number | null; month: number | null; day: number | null } | null): string {
  if (!d || !d.year || !d.month || !d.day) return 'N/A';
  return `${d.year}-${String(d.month).padStart(2,'0')}-${String(d.day).padStart(2,'0')}`;
}

function extractRoot(title: string): string {
  return title
    .replace(/,?\s*(?:Season|S)\s*\d+.*$/i, '')
    .replace(/,?\s*(?:Part|P|Cour)\s*\d+.*$/i, '')
    .trim();
}

function extractSeason(title: string): number | null {
  const m = title.match(/(?:Season\s*|S\s*)(\d+)/i);
  return m ? parseInt(m[1]) : null;
}

async function main() {
  console.log('=== AniList vs TMDB Date Comparison ===\n');
  const diffs: string[] = [];
  const matches: string[] = [];

  for (const id of TEST_IDS) {
    try {
      const al = await fetchAnilist(id);
      if (!al) continue;
      const alDate = fmtDate(al.startDate);
      if (alDate === 'N/A') continue;

      const title = al.title.english || al.title.romaji || '';
      const root = extractRoot(title);
      const season = extractSeason(title);

      const tmdbShow = await searchTmdb(root);
      if (!tmdbShow) continue;

      const epDate = await getFirstEpDate(tmdbShow.id, season || 1);
      if (!epDate) continue;

      const alMs = new Date(alDate + 'T00:00:00Z').getTime();
      const tmdbMs = new Date(epDate + 'T00:00:00Z').getTime();
      const diffDays = Math.round(Math.abs(alMs - tmdbMs) / (1000 * 60 * 60 * 24));

      const status = diffDays === 0 ? '✅ MATCH' : diffDays <= 1 ? '⚠️ 1 DAY OFF' : '❌ ' + diffDays + ' DAYS OFF';

      const line = `${status} | AL ${alDate} | TMDB ${epDate} | ${title.substring(0, 45)} (S${season || 1})`;
      console.log(line);

      if (diffDays > 0) diffs.push(line);
      else matches.push(line);
    } catch (e) {
      // skip
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Matches: ${matches.length}`);
  console.log(`Different: ${diffs.length}`);
  if (diffs.length > 0) {
    console.log(`\n=== Date Differences Found ===`);
    diffs.forEach(d => console.log(d));
  } else {
    console.log('\nNo date differences found in this sample!');
  }
}

main().catch(console.error);
