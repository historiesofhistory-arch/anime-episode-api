import json, urllib.request, time
from datetime import datetime

TMDB_KEY = '8265bd1679663a7ea12ac168da84d2e8'

# ALL VERIFIED CORRECT: (name, mal_id, tmdb_series_id, tmdb_season_num)
# Verified by checking the AniList title matches
anime_check = [
    ("Attack on Titan S1",     16498, 1429, 1),   # VERIFIED: AL=Attack on Titan, TMDB S1=25 eps
    ("Attack on Titan S2",     25777, 1429, 2),   # VERIFIED: AL=AoT S2
    ("Death Note",              1535, 13916, 1),   # VERIFIED
    ("Demon Slayer S1",       38000, 85937, 1),   # VERIFIED
    ("FMA Brotherhood",         5114, 31911, 1),   # VERIFIED
    ("Steins;Gate",             9253, 42509, 1),   # VERIFIED
    ("Cowboy Bebop",               1, 30991, 1),   # VERIFIED
    ("One Punch Man S1",       30276, 63926, 1),   # VERIFIED
    ("Naruto",                   20, 46260, 1),   # VERIFIED: AL=Naruto (220eps full), TMDB S1=52eps
    ("Code Geass S1",           1575, 31724, 1),   # VERIFIED
    ("My Hero Academia S1",    31964, 65930, 1),   # VERIFIED
]

def fmt_date(d):
    if not d or not d.get('year') or not d.get('month') or not d.get('day'):
        return None
    return f"{d['year']}-{d['month']:02d}-{d['day']:02d}"

def safe_diff(d1, d2):
    if not d1 or not d2:
        return None
    try:
        return (datetime.strptime(d1, '%Y-%m-%d') - datetime.strptime(d2, '%Y-%m-%d')).days
    except:
        return None

results = []

for name, mal_id, tmdb_id, season_num in anime_check:
    al_query = json.dumps({
        "query": f"query{{Media(idMal:{mal_id}){{title{{romaji english}}startDate{{year month day}}endDate{{year month day}}episodes}}}}"
    }).encode('utf-8')
    
    req = urllib.request.Request('https://graphql.anilist.co', data=al_query, headers={
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            al_data = json.loads(resp.read())['data']['Media']
    except Exception as e:
        print(f"AniList error for {name}: {e}")
        time.sleep(2)
        continue
    
    al_title = al_data['title'].get('english') or al_data['title']['romaji']
    al_start = fmt_date(al_data['startDate'])
    al_end = fmt_date(al_data['endDate'])
    al_eps = al_data['episodes']
    
    tmdb_url = f'https://api.themoviedb.org/3/tv/{tmdb_id}/season/{season_num}?api_key={TMDB_KEY}'
    try:
        req2 = urllib.request.Request(tmdb_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req2, timeout=10) as resp:
            tmdb_data = json.loads(resp.read())
    except Exception as e:
        print(f"TMDB error for {name}: {e}")
        time.sleep(1)
        continue
    
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
    
    start_str = 'EXACT' if start_diff == 0 else f'{start_diff:+d}d' if start_diff is not None else 'N/A'
    end_str = 'EXACT' if end_diff == 0 else f'{end_diff:+d}d' if end_diff is not None else 'N/A'
    
    flag = ''
    if start_diff not in (0, None) or end_diff not in (0, None):
        flag = ' <<< DIFF >>>'
    
    # Note about season/episode count differences
    note = ''
    if al_eps != tmdb_total:
        note = f' [NOTE: AL has {al_eps} eps (full series), TMDB S{season_num} has {tmdb_total} eps]'
    
    print(f"{name:30s} | AL: {str(al_start):10s} -> {str(al_end):10s} | TMDB S{season_num}: {str(tmdb_first_date):10s} -> {str(tmdb_last_date):10s} | Start: {start_str:>6s} | End: {end_str:>6s}{flag}{note}")
    
    results.append({
        'name': name, 'al_title': al_title,
        'al_start': al_start, 'al_end': al_end, 'al_eps': al_eps,
        'tmdb_first': tmdb_first_date, 'tmdb_last': tmdb_last_date, 'tmdb_total': tmdb_total,
        'start_diff': start_diff, 'end_diff': end_diff
    })
    
    time.sleep(1.2)

print()
print('='*100)
print('ANALYSIS: When AniList entry == TMDB Season (same episode count)')
print('='*100)
clean = [r for r in results if r['al_eps'] == r['tmdb_total']]
clean_exact = [r for r in clean if r['start_diff'] == 0 and r['end_diff'] == 0]
clean_diff = [r for r in clean if r['start_diff'] not in (0, None) or r['end_diff'] not in (0, None)]

print(f'\nClean matches (same ep count): {len(clean)}/{len(results)}')
print(f'  Exact date match: {len(clean_exact)}')
print(f'  With date difference: {len(clean_diff)}')

if clean_diff:
    print(f'\nDate differences (same ep count):')
    for r in clean_diff:
        print(f"  {r['name']}: start_diff={r['start_diff']}d, end_diff={r['end_diff']}d")
        print(f"    AL:  {r['al_start']} -> {r['al_end']}")
        print(f"    TMDB: {r['tmdb_first']} -> {r['tmdb_last']}")

print(f'\nDifferent ep counts (AniList = full series, TMDB = 1 season):')
diff_eps = [r for r in results if r['al_eps'] != r['tmdb_total']]
for r in diff_eps:
    print(f"  {r['name']}: AL={r['al_eps']}eps, TMDB S={r['tmdb_total']}eps | start_diff={r['start_diff']}, end_diff={r['end_diff']}")
