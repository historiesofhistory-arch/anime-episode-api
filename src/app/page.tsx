'use client';

import { useState, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Search,
  ExternalLink,
  Image as ImageIcon,
  Calendar,
  Clock,
  Film,
  Copy,
  Check,
} from 'lucide-react';

interface AnimeImage {
  coverType: string;
  url: string;
}

interface AnimeEpisode {
  id: string;
  number: number;
  title: string;
  description: string;
  image: string;
  airDate: string;
  duration: number;
  isFiller: boolean;
  titleJa: string;
  rating: string;
  hasAired: boolean;
}

interface ApiResponse {
  success: boolean;
  data?: {
    id: string;
    malId: number | null;
    title: string;
    titleJa: string;
    images: AnimeImage[];
    totalEpisodes: number;
    currentEpisode: number;
    nextAiringEpisode: number | null;
    nextAiringDate: string | null;
    episodes: AnimeEpisode[];
  };
  error?: string;
}

export default function Home() {
  const [anilistId, setAnilistId] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchAnime = useCallback(async (id: string) => {
    if (!id.trim()) return;
    const trimmed = id.trim();
    setLoading(true);
    setData(null);
    setCopied(false);
    try {
      const res = await fetch(`/api/episode/${trimmed}`);
      const json: ApiResponse = await res.json();
      setData(json);
    } catch {
      setData({ success: false, error: 'Failed to fetch data. Check your connection.' });
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchAnime(anilistId);
  };

  const copyJson = async () => {
    if (!data) return;
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const banner = data?.data?.images?.find(i => i.coverType === 'Banner');
  const poster = data?.data?.images?.find(i => i.coverType === 'Poster');
  const clearlogo = data?.data?.images?.find(i => i.coverType === 'Clearlogo');

  return (
    <div className="min-h-screen flex flex-col">
      {/* Hero / Search Section */}
      <header className="relative overflow-hidden">
        {banner && (
          <div className="absolute inset-0 z-0">
            <img
              src={banner.url}
              alt=""
              className="w-full h-full object-cover opacity-20 blur-sm"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/80 to-background" />
          </div>
        )}
        <div className="relative z-10 max-w-3xl mx-auto px-4 pt-16 pb-10 sm:pt-24 sm:pb-14">
          {clearlogo && data?.data ? (
            <img
              src={clearlogo.url}
              alt={data.data.title}
              className="h-12 sm:h-16 mx-auto mb-6 object-contain"
            />
          ) : (
            <h1 className="text-3xl sm:text-4xl font-bold text-center mb-2 tracking-tight">
              AniList Episode API
            </h1>
          )}
          <p className="text-muted-foreground text-center mb-8 text-sm sm:text-base">
            Enter an AniList ID to get anime details, episodes, and images from TMDB
          </p>

          <form onSubmit={handleSubmit} className="flex gap-2 max-w-md mx-auto">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                inputMode="numeric"
                placeholder="AniList ID (e.g. 108632)"
                value={anilistId}
                onChange={e => setAnilistId(e.target.value.replace(/[^0-9]/g, ''))}
                className="pl-9 h-11"
              />
            </div>
            <Button type="submit" disabled={loading || !anilistId.trim()} className="h-11 px-5">
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                </span>
              ) : (
                'Search'
              )}
            </Button>
          </form>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 pb-12">
        {/* Loading Skeleton */}
        {loading && (
          <div className="space-y-6 mt-4">
            <div className="flex flex-col sm:flex-row gap-6">
              <Skeleton className="w-48 h-72 rounded-lg shrink-0" />
              <div className="flex-1 space-y-3">
                <Skeleton className="h-8 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
                <div className="flex gap-2 pt-2">
                  <Skeleton className="h-6 w-24 rounded-full" />
                  <Skeleton className="h-6 w-24 rounded-full" />
                  <Skeleton className="h-6 w-32 rounded-full" />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-32 rounded-lg" />
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {data && !data.success && (
          <Card className="mt-4 border-destructive/30">
            <CardContent className="p-6 text-center">
              <p className="text-destructive font-medium">{data.error || 'Something went wrong'}</p>
              <p className="text-muted-foreground text-sm mt-1">
                Make sure the AniList ID exists and has a TMDB mapping.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {data?.success && data.data && (
          <div className="mt-4 space-y-6">
            {/* Anime Header */}
            <div className="flex flex-col sm:flex-row gap-5">
              {poster && (
                <img
                  src={poster.url}
                  alt={data.data.title}
                  className="w-36 sm:w-48 h-auto rounded-lg shadow-lg shrink-0 self-start"
                />
              )}
              <div className="flex-1 min-w-0">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight leading-tight">
                  {data.data.title}
                </h2>
                <div className="flex flex-wrap items-center gap-2 mt-2 text-sm text-muted-foreground">
                  <Badge variant="secondary" className="font-mono text-xs">
                    AniList: {data.data.id}
                  </Badge>
                  {data.data.malId && (
                    <Badge variant="outline" className="font-mono text-xs">
                      MAL: {data.data.malId}
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-3 mt-3 text-sm">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Film className="h-4 w-4" />
                    {data.data.totalEpisodes} episodes
                  </span>
                  {data.data.nextAiringEpisode && (
                    <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                      <Calendar className="h-4 w-4" />
                      Ep {data.data.nextAiringEpisode} airing {data.data.nextAiringDate}
                    </span>
                  )}
                </div>

                {/* API Endpoint Info */}
                <div className="mt-4 flex items-center gap-2">
                  <code className="text-xs bg-muted px-2.5 py-1.5 rounded-md font-mono truncate">
                    /api/episode/{data.data.id}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 shrink-0"
                    onClick={copyJson}
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>

                {/* Image Gallery */}
                {data.data.images.length > 0 && (
                  <div className="flex gap-2 mt-4 overflow-x-auto pb-1">
                    {data.data.images.map((img, i) => (
                      <a
                        key={i}
                        href={img.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 group"
                      >
                        <div className="relative w-28 h-16 sm:w-36 sm:h-20 rounded-md overflow-hidden border border-border">
                          <img
                            src={img.url}
                            alt={img.coverType}
                            className="w-full h-full object-cover transition-transform group-hover:scale-105"
                          />
                          <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[10px] text-white text-center py-0.5">
                            {img.coverType}
                          </span>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Episode List */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Episodes</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {data.data.episodes.map(ep => (
                  <a
                    key={ep.id}
                    href={`/api/episode/${data.data!.id}`}
                    className="block"
                  >
                    <Card className="overflow-hidden hover:shadow-md transition-shadow">
                      <div className="flex h-full">
                        <div className="relative w-28 sm:w-32 shrink-0 bg-muted">
                          {ep.image ? (
                            <img
                              src={ep.image}
                              alt={ep.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
                            </div>
                          )}
                          <span className="absolute top-1.5 left-1.5 bg-black/70 text-white text-xs font-mono px-1.5 py-0.5 rounded">
                            {ep.number}
                          </span>
                        </div>
                        <div className="flex flex-col justify-center p-3 min-w-0">
                          <p className="text-sm font-medium leading-tight line-clamp-2">
                            {ep.title}
                          </p>
                          <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                            {ep.airDate && (
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {ep.airDate}
                              </span>
                            )}
                            {ep.duration > 0 && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {ep.duration}m
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </Card>
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!data && !loading && (
          <div className="text-center mt-20 space-y-3">
            <div className="flex justify-center gap-1 text-4xl">
              {['🅰️', '📺', '🔗'].map((e, i) => (
                <span key={i} className="animate-bounce" style={{ animationDelay: `${i * 0.15}s` }}>
                  {e}
                </span>
              ))}
            </div>
            <p className="text-muted-foreground text-sm">
              Try searching for <button onClick={() => { setAnilistId('108632'); fetchAnime('108632'); }} className="underline underline-offset-2 hover:text-foreground transition-colors">Re:Zero S2 (108632)</button>,{' '}
              <button onClick={() => { setAnilistId('21'); fetchAnime('21'); }} className="underline underline-offset-2 hover:text-foreground transition-colors">One Piece (21)</button>, or{' '}
              <button onClick={() => { setAnilistId('1'); fetchAnime('1'); }} className="underline underline-offset-2 hover:text-foreground transition-colors">Cowboy Bebop (1)</button>
            </p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t py-4">
        <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <p>Data from TMDB + Anibridge Mappings ({'19K'} AniList titles indexed)</p>
          <a
            href="https://github.com/anibridge/anibridge-mappings"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-foreground transition-colors"
          >
            Anibridge <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </footer>
    </div>
  );
}
