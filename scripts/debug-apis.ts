async function main() {
  // 1. Test MAL API directly
  console.log('=== MAL Direct Test ===');
  try {
    const res = await fetch('https://api.myanimelist.net/v2/anime/21?fields=num_episodes,title,status', {
      headers: { 'X-MAL-Client-ID': process.env.MAL_CLIENT_ID || '' },
    });
    console.log('MAL status:', res.status, res.statusText);
    const text = await res.text();
    console.log('MAL body:', text.substring(0, 500));
  } catch(e: any) { console.error('MAL error:', e.message); }

  // 2. Test TMDB API directly
  console.log('\n=== TMDB Direct Test ===');
  const tmdbKey = process.env.TMDB_API_KEY || '8265bd1679663a7ea12ac168da84d2e8';
  try {
    const res = await fetch(`https://api.themoviedb.org/3/tv/37854?api_key=${tmdbKey}`);
    console.log('TMDB status:', res.status, res.statusText);
    const text = await res.text();
    console.log('TMDB body:', text.substring(0, 300));
  } catch(e: any) { console.error('TMDB error:', e.message); }

  // 3. Check DB S22 mapping for One Piece
  console.log('\n=== DB S22 check ===');
  const fs = await import('fs');
  const data = JSON.parse(fs.readFileSync('/home/z/my-project/data/mappings.min.json', 'utf-8'));
  // Find all entries with anilist:21
  for (const [key, entry] of Object.entries(data)) {
    if (typeof entry === 'object' && entry !== null && 'anilist:21' in (entry as any)) {
      const alMapping = (entry as any)['anilist:21'];
      const keys = Object.keys(alMapping);
      // Show only entries that have high episode ranges (S21/S22)
      for (const rangeStr of keys) {
        const [from] = rangeStr.split('-').map(Number);
        if (from >= 1080) {
          console.log(`Source: ${key}`);
          console.log(`  anilist:21 range: ${rangeStr} → ${alMapping[rangeStr]}`);
        }
      }
    }
  }
}

main().catch(console.error);
