import { getAnilistInfo } from '../src/lib/anilist';

async function main() {
  // Try common One Piece IDs
  const ids = [21, 16498]; // 21 = likely One Piece
  
  for (const id of ids) {
    try {
      const info = await getAnilistInfo(id);
      console.log(`AniList ${id}: ${info.titleEnglish || info.titleRomaji} | idMal: ${info.idMal} | eps: ${info.episodes} | status: ${info.status} | nextAiring: ${info.nextAiringEpisode?.episode || 'none'}`);
    } catch(e: any) {
      console.log(`AniList ${id}: ERROR ${e.message}`);
    }
  }
}

main().catch(console.error);
