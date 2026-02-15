// --- Data Models ---

export interface Prompt {
  id: number;
  text: string;
}

export interface PromptPack {
  title: string;
  prompts: Prompt[];
}

export interface PlayerInfo {
  nickname: string;
  avatar: string;
}

export interface Vote {
  voter: string;
  target: string;
}

export interface PodiumEntry {
  nickname: string;
  avatar: string;
  vote_count: number;
  rank: number;
}

export interface RoundResult {
  prompt: Prompt;
  votes: Vote[];
  podium: PodiumEntry[];
  majority_winner: string;
  prediction_points: Record<string, number>;
}

export interface LeaderboardEntry {
  nickname: string;
  avatar: string;
  score: number;
  rank: number;
  rank_change: number;
}

export interface Superlative {
  title: string;
  winner: string;
  avatar: string;
  detail: string;
}

export interface GameSettings {
  timer_seconds: number;
  show_votes: boolean;
}

// --- Avatar Emojis ---

export const AVATAR_EMOJIS = [
  '😎', '🤠', '👻', '🦊', '🐸', '🔥', '💀', '🌈',
  '🦄', '🍕', '🎸', '🏄', '🧠', '💅', '🤡', '👽',
  '🐝', '🦋', '🍄', '🌶️', '🎭', '🧊', '🪩', '🫧',
];

// --- Vibe Categories ---

export const VIBE_CATEGORIES = [
  { id: 'party', label: 'Party Night', emoji: '🎉', description: 'Classic party prompts for a wild night' },
  { id: 'spicy', label: 'Spicy', emoji: '🌶️', description: 'Bold, daring, and a little scandalous' },
  { id: 'wholesome', label: 'Wholesome', emoji: '💛', description: 'Sweet and heartwarming prompts' },
  { id: 'work', label: 'Work Friends', emoji: '💼', description: 'Office-appropriate fun with coworkers' },
  { id: 'custom', label: 'Custom', emoji: '✨', description: 'Describe your own vibe' },
] as const;

export type VibeId = typeof VIBE_CATEGORIES[number]['id'];
