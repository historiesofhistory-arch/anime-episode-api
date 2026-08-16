// API Response types matching the reference format: just4anime.online/api/episodes/{id}

export interface AnimeImage {
  coverType: "Banner" | "Poster" | "Fanart" | "Clearlogo";
  url: string;
}

export interface AnimeEpisode {
  id: string;          // "anilistId-episodeNumber"
  number: number;      // AniList episode number
  title: string;       // Episode title from TMDB
  description: string; // Episode overview from TMDB
  image: string;       // Episode thumbnail (still_path)
  airDate: string;     // YYYY-MM-DD or null
  duration: number;    // Episode runtime in minutes
  isFiller: boolean;   // TMDB doesn't have filler info, always false
  titleJa: string;     // Japanese title (not always available)
  rating: string;      // TMDB doesn't have per-ep ratings, default "0"
  hasAired: boolean;   // Based on air_date vs now
}

export interface EpisodeResponse {
  success: boolean;
  data: {
    id: string;                // AniList ID as string
    malId: number | null;
    title: string;
    titleJa: string;
    images: AnimeImage[];
    totalEpisodes: number;
    currentEpisode: number;
    nextAiringEpisode: number | null;
    nextAiringDate: string | null;
    ongoing: boolean;
    episodes: AnimeEpisode[];
  };
}

// TMDB API types

export interface TMDBShow {
  id: number;
  name: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  status: string;
  number_of_seasons: number;
  seasons?: TMDBSeasonMeta[];
}

export interface TMDBSeasonMeta {
  id: number;
  season_number: number;
  name: string;
  episode_count: number;
  air_date?: string | null;
  overview?: string;
  poster_path?: string | null;
}

export interface TMDBEpisode {
  id: number;
  episode_number: number;
  name: string;
  overview?: string;
  still_path?: string | null;
  air_date?: string | null;
  runtime?: number | null;
  vote_average?: number;
}

export interface TMDBSeason {
  id: number;
  season_number: number;
  name: string;
  episodes: TMDBEpisode[];
}

export interface TMDBImages {
  id: number;
  backdrops: TMDBImageItem[];
  logos: TMDBImageItem[];
  posters: TMDBImageItem[];
}

export interface TMDBImageItem {
  aspect_ratio: number;
  file_path: string;
  height: number;
  iso_639_1?: string;
  vote_average: number;
  vote_count: number;
  width: number;
}

// Anibridge mapping types

export interface EpisodeRange {
  from: number;
  to: number;
}

export interface TMDBSeasonMapping {
  tmdbShowId: number;
  seasonNumber: number;
  anilistRange: EpisodeRange;  // AniList episode range
  tmdbRange: EpisodeRange;     // Corresponding TMDB episode range
  isMovie?: boolean;           // true if tmdbShowId is a movie, not a TV show
}

export interface AnilistMapping {
  anilistId: number;
  malId: number | null;
  tmdbMappings: TMDBSeasonMapping[];
}
