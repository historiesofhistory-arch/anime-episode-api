import requests, json

animes = [
    'Jujutsu Kaisen',
    'Spy x Family',
    'Frieren Beyond Journey End',
    'Chainsaw Man',
    'Oshi no Ko',
    'Blue Lock',
    'Solo Leveling',
    'Dandadan',
    'Sakamoto Days',
    'Kaiju No. 8',
    'Boruto Naruto Next Generations',
    'One Punch Man',
    'Mob Psycho 100',
    'Tokyo Ghoul',
    'Wind Breaker',
    'Demon Slayer Kimetsu no Yaiba',
    'My Hero Academia Season 2',
]

results = []
for name in animes:
    r = requests.post('https://graphql.anilist.co', json={
        'query': '{Media(search:"' + name + '",type:ANIME){id title{english romaji}format episodes status idMal}}'
    }, headers={'Content-Type': 'application/json'})
    d = r.json().get('data', {}).get('Media')
    if d:
        title = d['title'].get('english') or d['title']['romaji']
        results.append(f"AL {d['id']} | MAL {d.get('idMal')} | {title} | {d['format']} | {d['episodes']} eps")

for r in results:
    print(r)
