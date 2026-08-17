import json, urllib.request, time
from datetime import datetime

TMDB_KEY = '8265bd1679663a7ea12ac168da84d2e8'

# CORRECT verified data: (name, mal_id, tmdb_series_id, tmdb_season_num)
anime_check = [
    ("Attack on Titan S1", 16498, 1429, 1),
    ("Attack on Titan S2", 25777, 1429, 2),
    ("Attack on Titan S3 Pt1", 37510, 1429, 3),
    ("Attack on Titan S3 Pt2", 48583, 1429, 4),  # need to check
    ("Death Note", 1535, 13916, 1),
    ("Jujutsu Kaisen S1", 51009, 95479, 1),
    ("Demon Slayer S1", 38000, 85937, 1),
    ("FMA Brotherhood", 5114, 31911, 1),
    ("Steins;Gate", 9253, 42509, 1),
    ("Cowboy Bebop", 1, 30991, 1),
    ("One Punch Man S1", 30276, 63926, 1),
    ("Chainsaw Man S1", 50265, 114410, 1),
    ("Frieren S1", 52991, 209867, 1),
    ("Spy x Family S1", 50265, 120089, 1),  # MAL ID might be wrong
    ("Bocchi the Rock S1", 51535, 119100, 1),
    ("Naruto", 20, 46260, 1),
    ("Code Geass S1", 1575, 31724, 1),
    ("Mob Psycho S1", 32173, 67075, 1),
    ("My Hero Academia S1", 31964, 65930, 1),
    ("Hunter x Hunter 2011", 11061, 46260, 1),  # need correct TMDB ID
]

def fmt_date(d):
    if not d or not d.get('year') or not d.get('month') or not d.get('day'):
        return None
    return f"{d['year']}-{d['month']:02d}-{d['day']:02d}"

def safe_diff(d1, d2):
    """Return (d1 - d2) in days, or None if either is None"""
    if not d1 or not d2:
        return None
    try:
        return (datetime.strptime(d1, '%Y-%m-%d') - datetime.strptime(d2, '%Y-%m-%d')).days
    except:
        return None

results = []

for name, mal_id, tmdb_id, season_num in anime_check:
    # AniList lookup using MAL ID
    al_query = json.dumps({
        "query": f"query{{Media(idMal:{mal_id}){{title{{romaji english}}idMal startDate{{year month day}}endDate{{year month day}}episodes format}}}}"
    }).encode('utf-8')
    
    req = urllib.request.Request('https://graphql.anilist.co', data=al_query, headers={
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            al_data = json.loads(resp.read())['data']['Media']
    except Exception as e:
        print(f"AniList error for {name} (MAL:{mal_id}): {e}")
        time.sleep(2)
        continue
    
    al_title = al_data['title'].get('english') or al_data['title']['romaji']
    al_mal = al_data.get('idMal')
    al_start = fmt_date(al_data['startDate'])
    al_end = fmt_date(al_data['endDate'])
    al_eps = al_data['episodes']
    
    # TMDB season data
    tmdb_url = f'https://api.themoviedb.org/3/tv/{tmdb_id}/season/{season_num}?api_key={TMDB_KEY}'
    try:
        req2 = urllib.request.Request(tmdb_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req2, timeout=10) as resp:
            tmdb_data = json.loads(resp.read())
    except Exception as e:
        print(f"TMDB error for {name}: {e}")
        time.sleep(1)
        continue
    
    tmdb_season_name = tmdb_data.get('name', '')
    tmdb_eps_list = tmdb_data.get('episodes', [])
    if not tmdb_eps_list:
        print(f"No episodes for {name} S{season_num}")
        time.sleep(1)
        continue
    
    tmdb_first_date = tmdb_eps_list[0].get('air_date')
    tmdb_last_date = tmdb_eps_list[-1].get('air_date')
    tmdb_total = len(tmdb_eps_list)
    
    start_diff = safe_diff(al_start, tmdb_first_date)
    end_diff = safe_diff(al_end, tmdb_last_date)
    
    start_match = 'EXACT' if start_diff == 0 else f'{start_diff:+d}d' if start_diff is not None else 'N/A'
    end_match = 'EXACT' if end_diff == 0 else f'{end_diff:+d}d' if end_diff is not None else 'N/A'
    
    flag = ''
    if start_diff not in (0, None) or end_diff not in (0, None):
        flag = ' <<< DIFF >>>'
    
    # Verify names match
    name_ok = 'OK' if name.lower().split()[0] in (al_title or '').lower() else f'MISMATCH: {al_title}'
    
    print(f"{name:30s} | AL({al_mal}): {str(al_start):10s} -> {str(al_end):10s} ({al_eps}ep) | TMDB S{season_num}: {str(tmdb_first_date):10s} -> {str(tmdb_last_date):10s} ({tmdb_total}ep) | Start: {start_match:>6s} | End: {end_match:>6s}{flag} | {name_ok}")
    
    results.append({
        'name': name, 'al_title': al_title, 'al_mal': al_mal,
        'al_start': al_start, 'al_end': al_end, 'al_eps': al_eps,
        'tmdb_first': tmdb_first_date, 'tmdb_last': tmdb_last_date, 'tmdb_total': tmdb_total,
        'start_diff': start_diff, 'end_diff': end_diff
    })
    
    time.sleep(1.2)

print()
print('=== SUMMARY ===')
diffs = [r for r in results if r['start_diff'] not in (0, None) or r['end_diff'] not in (0, None)]
exact = [r for r in results if r['start_diff'] == 0 and r['end_diff'] == 0]
print(f'Exact matches: {len(exact)}/{len(results)}')
print(f'With differences: {len(diffs)}/{len(results)}')

if diffs:
    print()
    print('Differences found:')
    for r in diffs:
        print(f"  {r['name']} ({r['al_title']}, MAL:{r['al_mal']}): start_diff={r['start_diff']}d, end_diff={r['end_diff']}d")
        print(f"    AL:  start={r['al_start']}  end={r['al_end']}  eps={r['al_eps']}")
        print(f"    TMDB: first_ep={r['tmdb_first']}  last_ep={r['tmdb_last']}  eps={r['tmdb_total']}")

print()
print('=== EXACT MATCHES ===')
for r in exact:
    print(f"  {r['name']} ({r['al_title']}): {r['al_start']} -> {r['al_end']}")
