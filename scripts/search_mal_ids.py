import json, urllib.request, time

def search_anilist(name):
    query = json.dumps({
        "query": f"query{{search: Media(search:\"{name}\", type:ANIME){{title{{romaji english}}idMal episodes startDate{{year month day}}endDate{{year month day}}format}}}}"
    }).encode('utf-8')
    
    req = urllib.request.Request('https://graphql.anilist.co', data=query, headers={
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())['data']['search']
    except Exception as e:
        return None
    return data

searches = [
    'Jujutsu Kaisen',
    'Chainsaw Man',
    'Frieren',
    'Spy x Family',
    'Bocchi the Rock',
    'Mob Psycho 100',
    'Hunter x Hunter 2011',
    'Dragon Ball Super',
    'Solo Leveling',
    'Vinland Saga',
    'Mushoku Tensei',
    'Made in Abyss',
]

for s in searches:
    result = search_anilist(s)
    if result:
        # Find TV format, season 1-ish
        for r in [result] if not isinstance(result, list) else result:
            if isinstance(r, dict):
                title = r['title'].get('english') or r['title']['romaji']
                mal = r.get('idMal')
                eps = r.get('episodes')
                fmt = r.get('format','')
                start = f"{r['startDate']['year']}-{r['startDate']['month']:02d}-{r['startDate']['day']:02d}" if r.get('startDate') and r['startDate'].get('year') else 'N/A'
                end_d = r.get('endDate')
                end = f"{end_d['year']}-{end_d['month']:02d}-{end_d['day']:02d}" if end_d and end_d.get('year') else 'N/A'
                print(f'{s:30s} | MAL: {mal:>8} | {title:45s} | {fmt:10s} | {start} -> {end} ({eps}eps)')
                break
    else:
        print(f'{s:30s} | ERROR')
    time.sleep(1)
