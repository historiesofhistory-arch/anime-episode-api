const query = `
query {
  Media(id: 108511) {
    id
    format
    title { english romaji }
    episodes
    status
    relations {
      edges {
        relationType
        node {
          id
          title { english }
          format
          episodes
        }
      }
    }
  }
}
`;

async function main() {
  // 1. Get 108511 info and relations
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const j: any = await res.json();
  if (j.errors) { console.log('Errors:', JSON.stringify(j.errors)); return; }
  const m = j.data.Media;
  console.log(`108511: format=${m.format} eps=${m.episodes} status=${m.status}`);
  console.log('Relations:');
  for (const e of m.relations.edges) {
    console.log(`  ${e.relationType} → ${e.node.id} (${e.node.format}, eps=${e.node.episodes}) ${e.node.title.english || ''}`);
  }

  // 2. Search for any Slime entry with 2026 date (for the TMDB ep16)
  const query2 = `
  query {
    Page(page: 1, perPage: 10) {
      media(search: "Reincarnated Slime", type: ANIME, startDate_greater: 20250101) {
        id
        title { english romaji }
        format
        episodes
        startDate { year month day }
        status
      }
    }
  }`;
  const res2 = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: query2 }),
  });
  const j2: any = await res2.json();
  console.log('\nSlime entries after 2025:');
  for (const m2 of j2.data.Page.media) {
    const sd = m2.startDate;
    console.log(`  ${m2.id} ${m2.format} eps=${m2.episodes} ${(m2.title.english || m2.title.romaji)} | ${sd.year}-${String(sd.month||0).padStart(2,'0')}`);
  }

  // 3. Also check 106509 and 161802 details
  for (const id of [106509, 161802]) {
    const query3 = `{Media(id:${id}){id format title{english romaji}episodes startDate{year month day}status}}`;
    const r3 = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query3 }),
    });
    const j3: any = await r3.json();
    const m3 = j3.data.Media;
    console.log(`\n${m3.id}: format=${m3.format} eps=${m3.episodes} status=${m3.status} ${m3.title.english || m3.title.romaji} | ${m3.startDate.year}-${String(m3.startDate.month||0).padStart(2,'0')}`);
  }
}

main().catch(console.error);
