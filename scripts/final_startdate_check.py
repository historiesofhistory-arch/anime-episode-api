import json, urllib.request, time
from datetime import datetime

TMDB_KEY = '8265bd1679663a7ea12ac168da84d2e8'

# ALL VERIFIED correct data
anime_check = [
    # (name, mal_id, tmdb_series_id, tmdb_season_num, expected_eps_al)
    ("Attack on Titan S1",      16498, 1429,   1,  25),
    ("Attack on Titan S2",      25777, 1429,   2,  12),
    ("Death Note",               1535, 13916,  1,  37),
    ("Demon Slayer S1",         38000, 85937,  1,  26),
    ("FMA Brotherhood",           5114, 31911,  1,  64),
    ("Steins;Gate",               9253, 42509,  1,  24),
    ("Cowboy Bebop",                 1, 30991,  1,  26),
    ("One Punch Man S1",         30276, 63926,  1,  12),
    ("My Hero Academia S1",      31964, 65930,  1,  13),
    ("Code Geass S1",             1575, 31724,  1,  25),
    ("Jujutsu Kaisen S1",        40748, 95479,  1,  24),
    ("Chainsaw Man S1",          44511, 114410,1,  12),
    ("Frieren S1",               52991, 209867,1,  28),
    ("Spy x Family S1",          50265, 120089,1,  12),
    ("Bocchi the Rock S1",       47917, 119100,1,  12),
    ("Mob Psycho 100 S1",        32182, 67075, 1,  12),
    ("Dragon Ball Super",        30694, 62715, 1, 131),
    ("Solo Leveling S1",         52299, 127532,1,  12),
    ("Vinland Saga S1",          37521, 88803, 1,  24),
    ("Mushoku Tensei S1",        39535, 94664, 1,  11),
    ("Made in Abyss S1",         34599, 72636, 1,  13),
    ("Hunter x Hunter 2011",     11061, 46298, 1, 148),
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

for name, mal_id, tmdb_id, season_num, expected_al_eps in anime_check:
    # AniList
    al_query = json.dumps({
        "query": f"query{{Media(idMal:{mal_id}){{title{{english romaji}}idMal startDate{{year month day}}endDate{{year month day}}episodes}}}}"
    }).encode('utf-8')
    
    req = urllib.request.Request('https://graphql.anilist.co', data=al_query, headers={
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0)',
        'Accept': 'application/json'
    })
    
    al_data = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                al_data = json.loads(resp.read())['data']['Media']
            break
        except Exception as e:
            if attempt < 2:
                time.sleep(3)
            else:
                print(f"AniList error for {name}: {e}")
                al_data = None
    
    if not al_data:
        time.sleep(2)
        continue
    
    al_title = al_data['title'].get('english') or al_data['title']['romaji']
    al_mal = al_data.get('idMal')
    al_start = fmt_date(al_data['startDate'])
    al_end = fmt_date(al_data['endDate'])
    al_eps = al_data['episodes']
    
    # Verify we got right anime
    if al_eps != expected_al_eps and al_eps is not None:
        print(f"  [WARNING] {name}: Expected {expected_al_eps} eps, got {al_eps} from AniList ({al_title}, MAL:{al_mal})")
    
    # TMDB
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
    tmdb_first_name = tmdb_eps_list[0].get('name', '')[:50]
    
    start_diff = safe_diff(al_start, tmdb_first_date)
    end_diff = safe_diff(al_end, tmdb_last_date)
    
    # For start date comparison
    start_str = 'EXACT' if start_diff == 0 else f'{start_diff:+d}d' if start_diff is not None else 'N/A'
    end_str = 'EXACT' if end_diff == 0 else f'{end_diff:+d}d' if end_diff is not None else 'N/A'
    
    same_eps = al_eps == tmdb_total
    eps_flag = '' if same_eps else f' [EPS: AL={al_eps} TMDB={tmdb_total}]'
    
    flag = ''
    if start_diff not in (0, None):
        flag = ' <<< START DIFF >>>'
    
    print(f"{name:30s} | AL start: {str(al_start):10s} | TMDB S{season_num} first ep: {str(tmdb_first_date):10s} | Diff: {start_str:>6s}{eps_flag}{flag}")
    
    results.append({
        'name': name, 'al_title': al_title,
        'al_start': al_start, 'al_end': al_end, 'al_eps': al_eps,
        'tmdb_first': tmdb_first_date, 'tmdb_last': tmdb_last_date, 'tmdb_total': tmdb_total,
        'start_diff': start_diff, 'end_diff': end_diff,
        'same_eps': same_eps
    })
    
    time.sleep(2)  # 2 sec delay to avoid rate limit

print()
print('='*120)
print('FINAL RESULT: AniList startDate vs TMDB First Episode Air Date')
print('='*120)

start_exact = [r for r in results if r['start_diff'] == 0]
start_diff = [r for r in results if r['start_diff'] not in (0, None)]
start_na = [r for r in results if r['start_diff'] is None]

print(f'\nTotal: {len(results)}')
print(f'Start date EXACT: {len(start_exact)}')
print(f'Start date DIFFERENT: {len(start_diff)}')
print(f'Start date N/A: {len(start_na)}')

if start_diff:
    print(f'\n--- START DATE DIFFERENCES ---')
    for r in start_diff:
        print(f"  {r['name']}: AL={r['al_start']} TMDB={r['tmdb_first']} DIFF={r['start_diff']}d")

# Also check end date ONLY for same-episode-count entries
same_eps_results = [r for r in results if r['same_eps']]
end_exact = [r for r in same_eps_results if r['end_diff'] == 0]
end_diff = [r for r in same_eps_results if r['end_diff'] not in (0, None)]

print(f'\n--- END DATE (only same ep count, {len(same_eps_results)} entries) ---')
print(f'End date EXACT: {len(end_exact)}')
print(f'End date DIFFERENT: {len(end_diff)}')
if end_diff:
    for r in end_diff:
        print(f"  {r['name']}: AL={r['al_end']} TMDB={r['tmdb_last']} DIFF={r['end_diff']}d")
