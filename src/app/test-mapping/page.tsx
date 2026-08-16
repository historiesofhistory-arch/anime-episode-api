'use client';

import { useState } from 'react';

interface Episode {
  id: number;
  episode_number: number;
  name: string;
  overview?: string;
  air_date?: string;
  still_path?: string | null;
  runtime?: number | null;
}

interface Mapping {
  tmdbShowId: number;
  seasonNumber: number;
  anilistRange: { from: number; to: number };
  tmdbRange: { from: number; to: number };
}

interface TestResult {
  anilistId: number;
  title: string;
  rootName: string;
  hasSeasonOrPart: boolean;
  rootS1: { id: number; startDate: string; title: string } | null;
  tmdbShow: { id: number; name: string; verified: boolean } | null;
  startDate: string;
  endDate: string;
  anilistEpisodes: number | null;
  mappings: Mapping[];
  episodes: { ep: Episode; season: number }[];
  errors: string[];
}

const TEST_CASES = [
  // Scenario 1: AniList splits parts, TMDB combines
  { id: 108511, label: 'Slime S2 (Part 1)', scenario: 'Part split → TMDB combined' },
  { id: 116742, label: 'Slime S2 Part 2', scenario: 'Part split → TMDB combined' },
  // Scenario 5: No season in title
  { id: 154707, label: 'Oshi no Ko', scenario: 'No season indicator in title' },
];

export default function TestMappingPage() {
  const [inputId, setInputId] = useState('');
  const [result, setResult] = useState<TestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function testId(id: number) {
    setInputId(String(id));
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch(`/api/test-mapping/${id}`);
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setResult(data);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const id = parseInt(inputId);
    if (id) testId(id);
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#e0e0e0', fontFamily: 'monospace', padding: 24 }}>
      <h1 style={{ color: '#60a5fa', fontSize: 20, marginBottom: 8 }}>🎬 Date-Based Mapping Test</h1>
      <p style={{ color: '#888', fontSize: 13, marginBottom: 24 }}>
        Tests the new date-matching logic: AniList startDate/endDate → TMDB air_date match
      </p>

      {/* Quick Test Buttons */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ color: '#aaa', fontSize: 12, marginBottom: 8 }}>QUICK TEST CASES:</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {TEST_CASES.map(tc => (
            <button
              key={tc.id}
              onClick={() => testId(tc.id)}
              disabled={loading}
              style={{
                background: '#1a1a2e', color: '#60a5fa', border: '1px solid #333',
                padding: '6px 12px', borderRadius: 6, cursor: loading ? 'wait' : 'pointer',
                fontSize: 12, textAlign: 'left', lineHeight: 1.4,
                opacity: loading ? 0.5 : 1,
              }}
            >
              <div style={{ fontWeight: 'bold' }}>{tc.label}</div>
              <div style={{ color: '#888', fontSize: 10 }}>{tc.scenario}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Manual Input */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <input
          type="number"
          value={inputId}
          onChange={e => setInputId(e.target.value)}
          placeholder="Enter AniList ID..."
          style={{
            flex: 1, maxWidth: 300, background: '#1a1a1a', border: '1px solid #333',
            color: '#fff', padding: '8px 12px', borderRadius: 6, fontSize: 14, fontFamily: 'monospace',
          }}
        />
        <button
          type="submit"
          disabled={loading || !inputId}
          style={{
            background: '#2563eb', color: '#fff', border: 'none', padding: '8px 20px',
            borderRadius: 6, cursor: loading ? 'wait' : 'pointer', fontSize: 14, fontWeight: 'bold',
            opacity: (loading || !inputId) ? 0.5 : 1,
          }}
        >
          {loading ? '...' : 'TEST'}
        </button>
      </form>

      {error && <div style={{ color: '#f87171', background: '#1a0a0a', border: '1px solid #333', padding: 12, borderRadius: 6, marginBottom: 16 }}>{error}</div>}

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Summary */}
          <div style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 12, color: '#fff' }}>{result.title}</div>
            <table style={{ fontSize: 13, borderCollapse: 'collapse' }}>
              <tbody>
                <tr><td style={{ color: '#888', paddingRight: 16, padding: '2px 0' }}>AniList ID</td><td>{result.anilistId}</td></tr>
                <tr><td style={{ color: '#888', paddingRight: 16, padding: '2px 0' }}>Root Name</td><td>{result.rootName}</td></tr>
                <tr><td style={{ color: '#888', paddingRight: 16, padding: '2px 0' }}>Season/Part</td><td>{result.hasSeasonOrPart ? '✅ Yes' : '❌ No'}</td></tr>
                <tr><td style={{ color: '#888', paddingRight: 16, padding: '2px 0' }}>AniList Dates</td><td>{result.startDate} → {result.endDate}</td></tr>
                <tr><td style={{ color: '#888', paddingRight: 16, padding: '2px 0' }}>AniList Episodes</td><td>{result.anilistEpisodes ?? '?'}</td></tr>
                {result.rootS1 && (
                  <tr><td style={{ color: '#888', paddingRight: 16, padding: '2px 0' }}>Root S1</td><td>{result.rootS1.title} (id={result.rootS1.id}, {result.rootS1.startDate})</td></tr>
                )}
                {result.tmdbShow && (
                  <tr>
                    <td style={{ color: '#888', paddingRight: 16, padding: '2px 0' }}>TMDB Show</td>
                    <td>
                      {result.tmdbShow.name} (id={result.tmdbShow.id}){' '}
                      {result.tmdbShow.verified ? <span style={{ color: '#4ade80' }}>✅ date verified</span> : <span style={{ color: '#fbbf24' }}>⚠️ popularity fallback</span>}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mapping Result */}
          {result.mappings.length > 0 ? (
            <div style={{ background: '#0a1a0a', border: '1px solid #22c55e44', borderRadius: 8, padding: 16 }}>
              <div style={{ color: '#4ade80', fontWeight: 'bold', marginBottom: 8 }}>
                ✅ MAPPING FOUND ({result.episodes.length} episodes)
              </div>
              {result.mappings.map((m, i) => (
                <div key={i} style={{ fontSize: 13, padding: '4px 0', borderBottom: i < result.mappings.length - 1 ? '1px solid #1a2a1a' : 'none' }}>
                  TMDB S{m.seasonNumber} E{m.tmdbRange.from}–E{m.tmdbRange.to}{' '}
                  → AniList ep {m.anilistRange.from}–{m.anilistRange.to}
                </div>
              ))}
              <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>
                {result.episodes.length === result.anilistEpisodes
                  ? <span style={{ color: '#4ade80' }}>Episode count match: {result.episodes.length} = {result.anilistEpisodes}</span>
                  : <span style={{ color: '#fbbf24' }}>Count: {result.episodes.length} vs expected {result.anilistEpisodes}</span>
                }
              </div>
            </div>
          ) : (
            <div style={{ background: '#1a0a0a', border: '1px solid #ef444444', borderRadius: 8, padding: 16 }}>
              <div style={{ color: '#f87171', fontWeight: 'bold' }}>❌ NO MAPPING</div>
              {result.errors.map((e, i) => <div key={i} style={{ color: '#f87171', fontSize: 12, marginTop: 4 }}>{e}</div>)}
            </div>
          )}

          {/* Episode List */}
          {result.episodes.length > 0 && (
            <div style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: 16 }}>
              <div style={{ color: '#aaa', fontSize: 12, marginBottom: 8 }}>EPISODES:</div>
              <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                <table style={{ fontSize: 12, borderCollapse: 'collapse', width: '100%' }}>
                  <thead>
                    <tr style={{ color: '#666', borderBottom: '1px solid #333' }}>
                      <th style={{ textAlign: 'left', padding: '4px 8px' }}>TMDB</th>
                      <th style={{ textAlign: 'left', padding: '4px 8px' }}>AniList #</th>
                      <th style={{ textAlign: 'left', padding: '4px 8px' }}>Title</th>
                      <th style={{ textAlign: 'left', padding: '4px 8px' }}>Air Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.episodes.map((e, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #1a1a1a' }}>
                        <td style={{ padding: '4px 8px', color: '#60a5fa' }}>S{e.season}E{e.ep.episode_number}</td>
                        <td style={{ padding: '4px 8px' }}>{i + 1}</td>
                        <td style={{ padding: '4px 8px' }}>{e.ep.name}</td>
                        <td style={{ padding: '4px 8px', color: '#888' }}>{e.ep.air_date || 'N/A'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
