/**
 * TEST SCRIPT — AniList Relation Chain Extractor
 * Purpose: ONE AniList call → traverse PREQUEL/SEQUEL → extract ALL seasons/parts
 * Not part of the main app — just a test.
 */

const ANILIST_API = 'https://graphql.anilist.co';

interface MediaNode {
  id: number;
  title: { english: string | null; romaji: string | null };
  format: string | null;
  seasonYear: number | null;
  episodes: number | null;
  season: string | null;
}

interface RelationEdge {
  relationType: string;
  node: MediaNode;
}

interface MediaData {
  id: number;
  title: { english: string | null; romaji: string | null };
  format: string | null;
  seasonYear: number | null;
  episodes: number | null;
  season: string | null;
  relations: {
    edges: RelationEdge[];
  } | null;
}

const QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    title { english romaji }
    format
    seasonYear
    episodes
    season
    relations {
      edges {
        relationType
        node {
          id
          title { english romaji }
          format
          seasonYear
          episodes
          season
        }
      }
    }
  }
}
`;

async function fetchMedia(id: number): Promise<MediaData | null> {
  try {
    const res = await fetch(ANILIST_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { id } }),
    });
    if (!res.ok) {
      console.error(`  ❌ HTTP ${res.status} for id=${id}`);
      return null;
    }
    const json: any = await res.json();
    return json.data?.Media ?? null;
  } catch (e: any) {
    console.error(`  ❌ Fetch failed for id=${id}: ${e.message}`);
    return null;
  }
}

/**
 * From ONE starting ID, traverse PREQUEL/SEQUEL to find ALL related seasons.
 * Uses BFS — goes both forward (sequels) and backward (prequels).
 */
async function extractFullChain(startId: number): Promise<MediaData[]> {
  const visited = new Set<number>();
  const queue: number[] = [startId];
  const results: MediaData[] = [];

  // Only follow these relation types (skip CHARACTER, STAFF, etc.)
  const RELEVANT_TYPES = new Set([
    'PREQUEL', 'SEQUEL', 'PARENT', 'PARENT_STORY',
    'ADAPTATION', 'ALTERNATIVE', 'ALTERNATIVE_VERSION',
    'SIDE_STORY', 'SPIN_OFF', 'SUMMARY',
  ]);

  const tvFormats = new Set(['TV', 'TV_SHORT']);

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    const media = await fetchMedia(id);
    if (!media) continue;

    if (!tvFormats.has(media.format || '')) {
      console.log(`  ⏭️  Skipping id=${id} (${media.format}): ${media.title.english || media.title.romaji}`);
    } else {
      results.push(media);
    }

    if (media.relations?.edges) {
      for (const edge of media.relations.edges) {
        if (!RELEVANT_TYPES.has(edge.relationType)) continue;
        if (visited.has(edge.node.id)) continue;
        if (!tvFormats.has(edge.node.format || '')) continue;
        queue.push(edge.node.id);
        console.log(`  → ${edge.relationType}: id=${edge.node.id} (${edge.node.format}) — ${edge.node.title.english || edge.node.title.romaji}`);
      }
    }
  }

  return results;
}

/** Sort seasons: by seasonYear, then by id (lower = older) */
function sortByChronology(items: MediaData[]): MediaData[] {
  return items.sort((a, b) => {
    const yearA = a.seasonYear ?? 9999;
    const yearB = b.seasonYear ?? 9999;
    if (yearA !== yearB) return yearA - yearB;
    return a.id - b.id;
  });
}

/** Extract season/part number from title */
function extractInfo(title: string | null): { season: number | null; part: number | null; label: string } {
  if (!title) return { season: null, part: null, label: 'N/A' };
  const seasonMatch = title.match(/(?:Season\s*|S\s*)(\d+)/i);
  const partMatch = title.match(/(?:Part\s*|P\s*)(\d+)/i);
  const courMatch = title.match(/Cour\s*(\d+)/i);
  return {
    season: seasonMatch ? parseInt(seasonMatch[1]) : null,
    part: partMatch ? parseInt(partMatch[1]) : (courMatch ? parseInt(courMatch[1]) : null),
    label: title,
  };
}

// ====== MAIN ======
async function main() {
  const START_ID = 182205; // Slime Season 4
  console.log(`\n🔵 Starting from AniList ID: ${START_ID}\n`);

  const chain = await extractFullChain(START_ID);
  const sorted = sortByChronology(chain);

  console.log(`\n${'═'.repeat(90)}`);
  console.log(`  RESULTS: Found ${sorted.length} TV entries in relation chain`);
  console.log(`${'═'.repeat(90)}\n`);

  console.log(
    'Order'.padEnd(6) +
    'AniList ID'.padEnd(14) +
    'Season'.padEnd(10) +
    'Part'.padEnd(8) +
    'Eps'.padEnd(6) +
    'Year'.padEnd(8) +
    'Title'
  );
  console.log('─'.repeat(90));

  sorted.forEach((m, i) => {
    const info = extractInfo(m.title.english || m.title.romaji);
    console.log(
      `${String(i + 1).padEnd(6)}` +
      `${String(m.id).padEnd(14)}` +
      `${String(info.season ?? '?').padEnd(10)}` +
      `${String(info.part ?? '-').padEnd(8)}` +
      `${String(m.episodes ?? '?').padEnd(6)}` +
      `${String(m.seasonYear ?? '?').padEnd(8)}` +
      `${m.title.english || m.title.romaji || 'N/A'}`
    );
  });

  // Compute cumulative episode offsets (for TMDB mapping)
  console.log('\n' + '─'.repeat(90));
  console.log('CUMULATIVE EPISODE OFFSETS (how it would map to TMDB combined seasons):\n');

  // Group by detected season number
  const seasonGroups = new Map<number, MediaData[]>();
  for (const m of sorted) {
    const info = extractInfo(m.title.english || m.title.romaji);
    const sNum = info.season ?? (seasonGroups.size + 1);
    if (!seasonGroups.has(sNum)) seasonGroups.set(sNum, []);
    seasonGroups.get(sNum)!.push(m);
  }

  for (const [seasonNum, entries] of seasonGroups) {
    console.log(`  📺 Season ${seasonNum}:`);
    let offset = 1;
    for (const entry of entries) {
      const info = extractInfo(entry.title.english || entry.title.romaji);
      const eps = entry.episodes ?? '?';
      const end = typeof eps === 'number' ? offset + eps - 1 : '?';
      console.log(
        `    ${info.part ? `Part ${info.part}` : '(main)'} → TMDB S${seasonNum} ep ${offset}–${end} (${eps} eps)` +
        ` — anilist ${entry.id}: ${entry.title.english || entry.title.romaji}`
      );
      if (typeof eps === 'number') offset += eps;
    }
    console.log(`    Total TMDB S${seasonNum} episodes needed: ${offset - 1}\n`);
  }

  console.log('✅ Test complete.');
}

main().catch(console.error);
