const ANILIST_API = 'https://graphql.anilist.co';

const cache = new Map<string, { data: AnilistMediaData; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

interface AnilistMediaData {
  idMal: number | null;
  titleEnglish: string | null;
  titleRomaji: string | null;
  titleNative: string | null;
  coverImage: string | null;
  bannerImage: string | null;
  seasonYear: number | null;
  format: string | null;
  status: string | null;
  episodes: number | null;
  startDate: string | null;  // YYYY-MM-DD or null
  endDate: string | null;    // YYYY-MM-DD or null
  nextAiringEpisode: { episode: number; airingAt: number } | null;
  relations: { edges: { relationType: string; node: { id: number; title: { english: string | null; romaji: string | null }; format: string | null; seasonYear: number | null } }[] } | null;
}

const QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    idMal
    title {
      english
      romaji
      native
    }
    coverImage {
      extraLarge
      large
    }
    bannerImage
    seasonYear
    format
    status
    episodes
    startDate { year month day }
    endDate { year month day }
    nextAiringEpisode { episode airingAt }
    relations {
      edges {
        relationType
        node {
          id
          title { english romaji }
          format
          seasonYear
        }
      }
    }
  }
}
`;
function formatAnilistDate(d: { year: number | null; month: number | null; day: number | null } | undefined | null): string | null {
  if (!d || !d.year || !d.month || !d.day) return null;
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

export async function getAnilistInfo(anilistId: number): Promise<AnilistMediaData> {
  const cached = cache.get(String(anilistId));
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data;
  }

  const res = await fetch(ANILIST_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { id: anilistId } }),
    next: { revalidate: 1800 },
  });

  if (!res.ok) {
    throw new Error(`AniList API error: ${res.status}`);
  }

  const json = await res.json() as any;
  const media = json.data.Media;

  const result: AnilistMediaData = {
    idMal: media.idMal ?? null,
    titleEnglish: media.title.english,
    titleRomaji: media.title.romaji,
    titleNative: media.title.native,
    coverImage: media.coverImage?.extraLarge || media.coverImage?.large,
    bannerImage: media.bannerImage,
    seasonYear: media.seasonYear ?? null,
    format: media.format ?? null,
    status: media.status ?? null,
    episodes: media.episodes ?? null,
    startDate: formatAnilistDate(media.startDate),
    endDate: formatAnilistDate(media.endDate),
    nextAiringEpisode: media.nextAiringEpisode ?? null,
    relations: media.relations ?? null,
  };

  cache.set(String(anilistId), { data: result, ts: Date.now() });
  return result;
}