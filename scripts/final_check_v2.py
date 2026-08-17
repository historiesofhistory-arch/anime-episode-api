import json, urllib.request, time
from datetime import datetime

TMDB_KEY = '8265bd1679663a7ea12ac168da84d2e8'

# ALL VERIFIED: (name, mal_id, tmdb_series_id, tmdb_season_num)
anime_check = [
    # Previously verified exact matches
    ("Attack on Titan S1",     16498, 1429, 1),
    ("Attack on Titan S2",     25777, 1429, 2),
    ("Death Note",              1535, 13916, 1),
    ("Demon Slayer S1",       38000, 85937, 1),
    ("FMA Brotherhood",         5114, 31911, 1),
    ("Steins;Gate",             9253, 42509, 1),
    ("Cowboy Bebop",               1, 30991, 1),
    ("One Punch Man S1",       30276, 63926, 1),
    ("My Hero Academia S1",    31964, 65930, 1),
    # Previously verified with differences
    ("Code Geass S1",           1575, 31724, 1),
    # New additions with correct IDs
    ("Jujutsu Kaisen S1",      40748, 95479, 1),
    ("Chainsaw Man S1",        44511, 114410, 1),
    ("Frieren S1",             52991, 209867, 1),
    ("Spy x Family S1",        50265, 120089, 1),
    ("Bocchi the Rock S1",     47917, 119100, 1),
    ("Mob Psycho 100 S1",      32182, 67075, 1),
    ("Hunter x Hunter 2011",   11061, 46298, 1),
    ("Dragon Ball Super",      30694, 62715, 1),
    ("Solo Leveling S1",       52299, 127532, 1),
    ("Vinland Saga S1",        37521, 88803, 1),
    ("Mushoku Tensei S1",      39535, 94664, 1),
    ("Made in Abyss S1",       34599, 72636, 1),
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
    
    # Ep count mismatch note
    ep_note = ''
    if al_eps != tmdb_total:
        ep_note = f' [EPS MISMATCH: AL={al_eps} TMDB={tmdb_total}]'
    
    print(f"{name:30s} | AL: {str(al_start):10s} -> {str(al_end):10s} | TMDB: {str(tmdb_first_date):10s} -> {str(tmdb_last_date):10s} | Start: {start_str:>6s} | End: {end_str:>6s}{flag}{ep_note}")
    
    results.append({
        'name': name, 'al_title': al_title, 'mal_id': mal_id,
        'al_start': al_start, 'al_end': al_end, 'al_eps': al_eps,
        'tmdb_first': tmdb_first_date, 'tmdb_last': tmdb_last_date, 'tmdb_total': tmdb_total,
        'start_diff': start_diff, 'end_diff': end_diff,
        'eps_match': al_eps == tmdb_total
    })
    
    time.sleep(1.2)

print()
print('='*120)
print('FINAL ANALYSIS')
print('='*120)

# Filter: only where episode counts match (fair comparison)
same_eps = [r for r in results if r['eps_match']]
diff_eps = [r for r in results if not r['eps_match']]

exact = [r for r in same_eps if r['start_diff'] == 0 and r['end_diff'] == 0]
diffs = [r for r in same_eps if r['start_diff'] not in (0, None) or r['end_diff'] not in (0, None)]

print(f'\nTotal checked: {len(results)}')
print(f'Same episode count: {len(same_eps)}')
print(f'  EXACT date match: {len(exact)}')
print(f'  With date difference: {len(diffs)}')
print(f'Different episode count (unfair comparison): {len(diff_eps)}')

if diffs:
    print(f'\n--- DIFFERENCES (same ep count) ---')
    for r in diffs:
        print(f"  {r['name']}: AL start={r['al_start']} end={r['al_end']} | TMDB first={r['tmdb_first']} last={r['tmdb_last']} | diff: start={r['start_diff']}d end={r['end_diff']}d")

if diff_eps:
    print(f'\n--- EPS COUNT MISMATCH (skip end date comparison) ---')
    for r in diff_eps:
        print(f"  {r['name']}: AL={r['al_eps']}eps TMDB={r['tmdb_total']}eps | start_diff={r['start_diff']} end_diff={r['end_diff']}")

print(f'\n--- EXACT MATCHES ---')
for r in exact:
    print(f"  {r['name']}: {r['al_start']} -> {r['al_end']}")
