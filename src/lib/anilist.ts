const ANILIST_API = 'https://graphql.anilist.co';

const cache = new Map<string, { data: AnilistMediaData; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

interface AnilistMediaData {
  titleEnglish: string | null;
  titleRomaji: string | null;
  titleNative: string | null;
  coverImage: string | null;
  bannerImage: string | null;
}

const QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
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
  }
}
`;

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

  const json = await res.json() as { data: { Media: { title: { english: string | null; romaji: string | null; native: string | null }; coverImage: { extraLarge: string | null; large: string | null }; bannerImage: string | null } } };
  const media = json.data.Media;

  const result: AnilistMediaData = {
    titleEnglish: media.title.english,
    titleRomaji: media.title.romaji,
    titleNative: media.title.native,
    coverImage: media.coverImage.extraLarge || media.coverImage.large,
    bannerImage: media.bannerImage,
  };

  cache.set(String(anilistId), { data: result, ts: Date.now() });
  return result;
}