import json, urllib.request, time
import urllib.parse

TMDB_KEY = '8265bd1679663a7ea12ac168da84d2e8'

anime_names = [
    'Death Note',
    'Jujutsu Kaisen',
    'Demon Slayer Kimetsu no Yaiba',
    'Fullmetal Alchemist Brotherhood',
    'Steins Gate',
    'Cowboy Bebop',
    'One Punch Man',
    'Chainsaw Man',
    'Frieren Beyond Journeys End',
    'Spy x Family',
    'Bocchi the Rock',
    'Naruto',
    'Code Geass Lelouch',
    'Mob Psycho',
    'My Hero Academia',
    'Hunter x Hunter',
]

for name in anime_names:
    encoded = urllib.parse.quote(name)
    url = f'https://api.themoviedb.org/3/search/tv?api_key={TMDB_KEY}&query={encoded}'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        print(f'{name}: Error - {e}')
        continue
    
    results = data.get('results', [])
    if results:
        r = results[0]
        print(f'{name:40s} | TMDB ID: {r["id"]:8d} | {r["name"]:40s} | First Air: {r.get("first_air_date","N/A")}')
    else:
        print(f'{name:40s} | NOT FOUND')
    
    time.sleep(0.3)
