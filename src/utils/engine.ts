/**
 * RankReel - Core engine pure logic
 * Implements decoupled ranking, subtitle timing, timeline scaling and title parsing.
 */

export interface ClipItem {
  id: string;
  rank: number; // Slot rank #1..#N (stays permanently attached to this clip)
  label: string;
  duration: number; // Raw file duration in seconds
  trimStart: number; // In seconds
  trimEnd: number; // In seconds
  mute: boolean;
  name?: string;
}

export interface SubtitleWord {
  word: string;
  start: number;
  end: number;
}

export interface SubtitleCue {
  text: string;
  words: SubtitleWord[];
  start: number;
  end: number;
}

/**
 * Splits title into exactly two lines balanced around middle word boundary.
 */
export function splitTitleInTwoLines(text: string): { line1: string; line2: string; warning?: string } {
  const cleaned = text.trim().replace(/\s+/g, ' ');
  if (!cleaned) {
    return { line1: '', line2: '', warning: 'El título está vacío.' };
  }
  
  // If already contains newline
  if (text.includes('\n')) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 2) {
      return { line1: lines[0], line2: lines[1] };
    }
    if (lines.length > 2) {
      return {
        line1: lines[0],
        line2: lines.slice(1).join(' '),
        warning: 'Demasiadas líneas: el título ocupará demasiado espacio en el video.'
      };
    }
    return { line1: lines[0], line2: '', warning: 'Recomendado: 2 líneas para impacto vertical.' };
  }

  const words = cleaned.split(' ');
  if (words.length <= 1) {
    return { line1: cleaned, line2: '', warning: 'Recomendado: 2 líneas para impacto vertical.' };
  }

  // Find split point closest to center character count
  const totalLength = cleaned.length;
  const targetHalf = totalLength / 2;

  let bestSplitIndex = 1;
  let minDiff = Infinity;
  let currentLen = 0;

  for (let i = 0; i < words.length - 1; i++) {
    currentLen += words[i].length + (i > 0 ? 1 : 0);
    const diff = Math.abs(currentLen - targetHalf);
    if (diff < minDiff) {
      minDiff = diff;
      bestSplitIndex = i + 1;
    }
  }

  const line1 = words.slice(0, bestSplitIndex).join(' ');
  const line2 = words.slice(bestSplitIndex).join(' ');
  return { line1, line2 };
}

/**
 * Validates clip count with recommendations (5 to 7 clips, ideal 6).
 */
export function validateClipCount(count: number): {
  status: 'empty' | 'few' | 'optimal' | 'many';
  message: string;
  isOptimal: boolean;
} {
  if (count === 0) {
    return {
      status: 'empty',
      message: 'Añade al menos un clip.',
      isOptimal: false
    };
  }
  if (count < 5) {
    return {
      status: 'few',
      message: `${count} clips: Pierdes tiempo de visualización. Te recomendamos entre 5 y 7 clips (el punto ideal es 6).`,
      isOptimal: false
    };
  }
  if (count > 7) {
    return {
      status: 'many',
      message: `${count} clips: La gente suele abandonar antes de terminar. Lo ideal son 6 clips.`,
      isOptimal: false
    };
  }
  return {
    status: 'optimal',
    message: `${count} clips: Cantidad óptima para retención y ritmo en formatos verticales.`,
    isOptimal: true
  };
}

/**
 * Shuffles playback order array while clip identities and rank numbers remain unchanged.
 */
export function shufflePlaybackOrder<T extends { id: string; rank: number }>(clips: T[]): T[] {
  if (clips.length <= 1) return [...clips];
  const copy = [...clips];
  // Fisher-Yates shuffle
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Ensures that rank #1 is placed at the very end of the playback order,
 * fulfilling the core rule of countdown ranking videos (the winner is revealed last).
 */
export function ensureRank1IsLastInPlayback<T extends { id: string; rank: number }>(clips: T[]): T[] {
  if (clips.length <= 1) return [...clips];
  const rank1Index = clips.findIndex(c => c.rank === 1);
  if (rank1Index === -1 || rank1Index === clips.length - 1) {
    return [...clips];
  }
  const result = clips.filter((_, idx) => idx !== rank1Index);
  result.push(clips[rank1Index]);
  return result;
}

/**
 * Shuffles playback order while strictly guaranteeing that rank #1 is the last clip shown.
 */
export function shufflePlaybackOrderWithRank1Last<T extends { id: string; rank: number }>(clips: T[]): T[] {
  if (clips.length <= 1) return [...clips];
  const rank1 = clips.find(c => c.rank === 1);
  const others = clips.filter(c => c.rank !== 1);

  // Shuffle the others
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }

  if (rank1) {
    others.push(rank1);
  }
  return others;
}

/**
 * Swaps rank numbers between two clips, strictly preserving each clip's label and identity.
 */
export function swapClipRanks(clips: ClipItem[], clipIdA: string, clipIdB: string): ClipItem[] {
  const clipA = clips.find(c => c.id === clipIdA);
  const clipB = clips.find(c => c.id === clipIdB);
  if (!clipA || !clipB || clipIdA === clipIdB) return [...clips];

  const rankA = clipA.rank;
  const rankB = clipB.rank;

  return clips.map(c => {
    if (c.id === clipIdA) return { ...c, rank: rankB };
    if (c.id === clipIdB) return { ...c, rank: rankA };
    return { ...c };
  });
}

/**
 * Assigns a specific target rank to a clip, swapping with whichever clip currently occupies it.
 * Preserves each clip's label ("qué pasó en el momento").
 */
export function setClipRank(clips: ClipItem[], clipId: string, targetRank: number): ClipItem[] {
  const targetClip = clips.find(c => c.id === clipId);
  if (!targetClip) return [...clips];
  if (targetClip.rank === targetRank) return [...clips];

  const currentOccupant = clips.find(c => c.rank === targetRank);
  if (currentOccupant) {
    return swapClipRanks(clips, clipId, currentOccupant.id);
  }

  return clips.map(c => (c.id === clipId ? { ...c, rank: targetRank } : { ...c }));
}

/**
 * Assigns podium ranks (#1, #2, #3) to selected clips.
 * Preserves all clip labels and names.
 */
export function assignTop3Podium(
  clips: ClipItem[],
  podium: { top1Id?: string; top2Id?: string; top3Id?: string }
): ClipItem[] {
  let result = [...clips];
  if (podium.top1Id) {
    result = setClipRank(result, podium.top1Id, 1);
  }
  if (podium.top2Id) {
    result = setClipRank(result, podium.top2Id, 2);
  }
  if (podium.top3Id) {
    result = setClipRank(result, podium.top3Id, 3);
  }
  return result;
}

/**
 * Shuffles intermediate ranks (e.g. ranks 4 to N) while keeping Top 3 (#1, #2, #3) locked.
 * Maintains each clip's label and file association intact.
 */
export function shuffleIntermediateRanks(clips: ClipItem[], keepTopN = 3): ClipItem[] {
  if (clips.length <= keepTopN) return [...clips];

  const locked = clips.filter(c => c.rank <= keepTopN);
  const toShuffle = clips.filter(c => c.rank > keepTopN);

  const availableRanks = toShuffle.map(c => c.rank);
  // Fisher-Yates shuffle available ranks
  for (let i = availableRanks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [availableRanks[i], availableRanks[j]] = [availableRanks[j], availableRanks[i]];
  }

  const shuffledClips = toShuffle.map((c, idx) => ({
    ...c,
    rank: availableRanks[idx]
  }));

  return [...locked, ...shuffledClips].sort((a, b) => a.rank - b.rank);
}

/**
 * Removes a clip by ID and re-indexes remaining rank slots #1..#N.
 */
export function removeClipById(clips: ClipItem[], idToRemove: string): ClipItem[] {
  return clips
    .filter(c => c.id !== idToRemove)
    .map((c, idx) => ({
      ...c,
      rank: idx + 1
    }));
}

/**
 * Calculates effective duration for a clip considering its trim settings.
 */
export function getClipEffectiveDuration(clip: ClipItem): number {
  const start = Math.max(0, clip.trimStart || 0);
  const rawEnd = clip.trimEnd > 0 ? clip.trimEnd : clip.duration;
  const end = Math.min(clip.duration, Math.max(start + 0.1, rawEnd));
  return Math.max(0.1, end - start);
}

/**
 * Computes total duration based on precedence rule:
 * 1. Audio duration if voice audio exists.
 * 2. Sum of clips if clips exist.
 * 3. Script estimated reading duration (~150 words per minute / 2.5 wps).
 */
export function calculateTotalDuration(
  audioDuration: number | null,
  clips: ClipItem[],
  scriptText: string
): number {
  if (audioDuration && audioDuration > 0.5) {
    return audioDuration;
  }
  if (clips.length > 0) {
    return clips.reduce((sum, c) => sum + getClipEffectiveDuration(c), 0);
  }
  const words = scriptText.trim().split(/\s+/).filter(Boolean);
  if (words.length > 0) {
    // 150 words per minute = 2.5 words per second
    return Math.max(3, words.length / 2.5);
  }
  return 15; // default 15s fallback
}

/**
 * Scales clip trim ranges so the sum of clip durations matches the voice audio duration.
 */
export function scaleClipsToVoice(clips: ClipItem[], targetDuration: number): ClipItem[] {
  if (clips.length === 0 || targetDuration <= 0) return clips;
  const currentTotal = clips.reduce((sum, c) => sum + getClipEffectiveDuration(c), 0);
  if (currentTotal <= 0) return clips;

  const ratio = targetDuration / currentTotal;

  return clips.map(clip => {
    const currDur = getClipEffectiveDuration(clip);
    const newDur = Math.max(0.5, currDur * ratio);
    const start = clip.trimStart || 0;
    return {
      ...clip,
      trimStart: start,
      trimEnd: start + newDur,
      duration: Math.max(clip.duration, start + newDur)
    };
  });
}

/**
 * Distributes script words over total duration proportionally to word character length.
 * Groups words into natural subtitle chunks (3-5 words each) with per-word timing.
 */
export function distributeSubtitles(scriptText: string, totalDuration: number): SubtitleCue[] {
  const rawWords = scriptText.trim().split(/\s+/).filter(Boolean);
  if (rawWords.length === 0 || totalDuration <= 0) return [];

  // Compute weights based on word length + pause after punctuation
  const weights = rawWords.map(w => {
    let weight = Math.max(2, w.length);
    if (/[,;]/.test(w)) weight += 2;
    if (/[.!?]/.test(w)) weight += 4;
    return weight;
  });

  const totalWeight = weights.reduce((acc, w) => acc + w, 0);
  let currentTime = 0;

  const wordTimings: SubtitleWord[] = rawWords.map((word, idx) => {
    const fraction = weights[idx] / totalWeight;
    const dur = fraction * totalDuration;
    const item: SubtitleWord = {
      word,
      start: currentTime,
      end: currentTime + dur
    };
    currentTime += dur;
    return item;
  });

  // Group into cues of 3-5 words or on sentence breaks
  const cues: SubtitleCue[] = [];
  let currentGroup: SubtitleWord[] = [];

  for (let i = 0; i < wordTimings.length; i++) {
    const wt = wordTimings[i];
    currentGroup.push(wt);

    const isEndPunctuation = /[.!?]$/.test(wt.word);
    const isComma = /[,;]$/.test(wt.word);
    const isAtLimit = currentGroup.length >= 5;
    const isNaturalBreak = currentGroup.length >= 3 && isComma;

    if (isEndPunctuation || isAtLimit || isNaturalBreak || i === wordTimings.length - 1) {
      cues.push({
        text: currentGroup.map(g => g.word).join(' '),
        words: [...currentGroup],
        start: currentGroup[0].start,
        end: currentGroup[currentGroup.length - 1].end
      });
      currentGroup = [];
    }
  }

  return cues;
}

/**
 * Identifies active clip in playback order at current timestamp t.
 */
export function getActiveClipAtTime(
  playbackClips: ClipItem[],
  t: number
): { clip: ClipItem | null; index: number; localTime: number; clipDuration: number } {
  if (playbackClips.length === 0) {
    return { clip: null, index: -1, localTime: 0, clipDuration: 0 };
  }

  let accumulated = 0;
  for (let i = 0; i < playbackClips.length; i++) {
    const clip = playbackClips[i];
    const dur = getClipEffectiveDuration(clip);
    if (t >= accumulated && (t < accumulated + dur || i === playbackClips.length - 1)) {
      const local = Math.min(dur, Math.max(0, t - accumulated));
      return { clip, index: i, localTime: local, clipDuration: dur };
    }
    accumulated += dur;
  }

  const lastClip = playbackClips[playbackClips.length - 1];
  return {
    clip: lastClip,
    index: playbackClips.length - 1,
    localTime: getClipEffectiveDuration(lastClip),
    clipDuration: getClipEffectiveDuration(lastClip)
  };
}

/**
 * Formats seconds into m:ss format.
 */
export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export interface TextOverlayConfig {
  titleY: number;
  titleTextColor: string;
  titleUppercase: boolean;
  titleBgBox: boolean;
  rankingBadgeVisible: boolean;
  rankingBadgeY: number;
  rankingBadgeSize: number;
  rankingBadgeColor: string;
  rankingBadgeStroke: number;
  clipLabelVisible: boolean;
  clipLabelSize: number;
  clipLabelTextColor: string;
  clipLabelBgStyle: 'dark-border' | 'solid-dark' | 'none';
  subtitlesY: number;
  subtitlesSize: number;
  subtitlesBgBox: boolean;
}

export const DEFAULT_TEXT_CONFIG: TextOverlayConfig = {
  titleY: 240,
  titleTextColor: '#FFFFFF',
  titleUppercase: true,
  titleBgBox: false,
  rankingBadgeVisible: true,
  rankingBadgeY: 460,
  rankingBadgeSize: 130,
  rankingBadgeColor: '#ffd400',
  rankingBadgeStroke: 18,
  clipLabelVisible: true,
  clipLabelSize: 42,
  clipLabelTextColor: '#FFFFFF',
  clipLabelBgStyle: 'dark-border',
  subtitlesY: 1580,
  subtitlesSize: 48,
  subtitlesBgBox: false
};

/**
 * Returns text overlay configuration presets.
 */
export function getTextLayoutPreset(presetName: 'viral_standard' | 'tiktok_safe' | 'giant_badge' | 'minimal'): TextOverlayConfig {
  switch (presetName) {
    case 'tiktok_safe':
      return {
        ...DEFAULT_TEXT_CONFIG,
        titleY: 210,
        rankingBadgeY: 420,
        subtitlesY: 1440, // Elevated well above TikTok account, audio, description & right-rail actions
        subtitlesSize: 46,
        subtitlesBgBox: true
      };
    case 'giant_badge':
      return {
        ...DEFAULT_TEXT_CONFIG,
        titleY: 220,
        rankingBadgeY: 480,
        rankingBadgeSize: 175,
        rankingBadgeStroke: 22,
        clipLabelSize: 44,
        subtitlesY: 1600
      };
    case 'minimal':
      return {
        ...DEFAULT_TEXT_CONFIG,
        titleY: 200,
        titleBgBox: false,
        rankingBadgeY: 380,
        rankingBadgeSize: 100,
        rankingBadgeStroke: 10,
        clipLabelSize: 36,
        clipLabelBgStyle: 'none',
        subtitlesY: 1640,
        subtitlesSize: 38
      };
    case 'viral_standard':
    default:
      return { ...DEFAULT_TEXT_CONFIG };
  }
}

/**
 * Clamps vertical Y coordinate within standard canvas boundaries (1080x1920).
 */
export function clampTextPosition(y: number, min = 80, max = 1840): number {
  return Math.min(max, Math.max(min, y));
}

export interface RetentionColor {
  id: string;
  label: string;
  hex: string;
  psychology: string;
}

export const RETENTION_COLORS: RetentionColor[] = [
  { id: 'white', label: 'Blanco base', hex: '#FFFFFF', psychology: 'Lectura neutral y balance' },
  { id: 'yellow', label: 'Amarillo atención', hex: '#FFD400', psychology: 'Fijación visual primaria, optimismo' },
  { id: 'orange', label: 'Naranja urgencia', hex: '#FF7A00', psychology: 'Dopamina, urgencia y curiosidad activa' },
  { id: 'red', label: 'Rosa/Rojo hook', hex: '#FF2A70', psychology: 'Alerta máxima sensorial e impacto instantáneo' },
  { id: 'cyan', label: 'Cian contraste', hex: '#38BDF8', psychology: 'Contraste frío de alta nitidez' },
  { id: 'lime', label: 'Verde lima pop', hex: '#A3E635', psychology: 'Sorpresa, energía y retención visual' }
];

/**
 * Returns importance color for left vertical ranking ladder (ranks 1 to N).
 * The first 4 ranks receive psychology colors by hierarchy:
 * 1 -> Red/Pink (#ff2a70)
 * 2 -> Orange (#ff7a00)
 * 3 -> Yellow (#ffd400)
 * 4 -> Cyan (#38bdf8)
 * 5+ -> White (#ffffff)
 */
export function getRankLadderColor(rankNumber: number): string {
  switch (rankNumber) {
    case 1:
      return '#FF2A70'; // Red/Pink (Top 1)
    case 2:
      return '#FF7A00'; // Orange (Top 2)
    case 3:
      return '#FFD400'; // Yellow (Top 3)
    case 4:
      return '#38BDF8'; // Cyan (Top 4)
    default:
      return '#FFFFFF'; // White with heavy black stroke
  }
}

export interface TitleWordToken {
  index: number;
  word: string;
  cleanWord: string;
  line: 1 | 2;
  color: string;
}

/**
 * Parses lines into word tokens and resolves their individual retention colors.
 */
export function parseTitleWordsWithColors(
  line1: string,
  line2: string,
  wordColorMap: Record<number, string> = {},
  fallbackKeyword = '',
  fallbackKeywordColor = '#FFD400'
): TitleWordToken[] {
  const tokens: TitleWordToken[] = [];
  const wordsL1 = line1.trim().split(/\s+/).filter(Boolean);
  const wordsL2 = line2.trim().split(/\s+/).filter(Boolean);
  const kwUpper = fallbackKeyword.trim().toUpperCase();

  let globalIndex = 0;

  const processWord = (w: string, line: 1 | 2) => {
    const clean = w.replace(/[^A-Za-z0-9áéíóúÁÉÍÓÚñÑ]/g, '').toUpperCase();
    let color = wordColorMap[globalIndex];

    if (!color) {
      if (kwUpper && clean && kwUpper.includes(clean)) {
        color = fallbackKeywordColor;
      } else {
        color = '#FFFFFF';
      }
    }

    tokens.push({
      index: globalIndex,
      word: w,
      cleanWord: clean,
      line,
      color
    });
    globalIndex++;
  };

  wordsL1.forEach(w => processWord(w, 1));
  wordsL2.forEach(w => processWord(w, 2));

  return tokens;
}

/**
 * Calculates vertical positions for left ranking ladder items given slot count.
 * Supports explicit spacing (in pixels) between consecutive numbers,
 * or even distribution between startY and endY if spacing is not specified.
 */
export function calculateLadderPositions(
  slotCount: number,
  startY = 380,
  endY = 1540,
  spacing?: number
): { rank: number; y: number }[] {
  if (slotCount <= 0) return [];
  if (slotCount === 1) return [{ rank: 1, y: startY }];

  if (typeof spacing === 'number' && spacing > 0) {
    return Array.from({ length: slotCount }, (_, i) => ({
      rank: i + 1,
      y: Math.round(startY + i * spacing)
    }));
  }

  const step = (endY - startY) / (slotCount - 1);
  return Array.from({ length: slotCount }, (_, i) => ({
    rank: i + 1,
    y: Math.round(startY + i * step)
  }));
}

/**
 * Computes recommended spacing between ladder numbers for a given slot count
 * to fit nicely within vertical bounds.
 */
export function computeAutoLadderSpacing(slotCount: number, startY = 400, endY = 1600): number {
  if (slotCount <= 1) return 135;
  const raw = (endY - startY) / (slotCount - 1);
  return Math.max(60, Math.min(240, Math.round(raw)));
}


/**
 * Resolves the displayed text for a ranking ladder slot (allows custom texts like 'TOP 1', '1º', '🥇' or default '1.').
 */
export function resolveLadderItemText(rank: number, customTexts?: Record<number, string>): string {
  if (customTexts && customTexts[rank] !== undefined && customTexts[rank].trim() !== '') {
    return customTexts[rank].trim();
  }
  return `${rank}.`;
}

/**
 * Resolves the color for a ranking ladder slot (allows custom hex color or falls back to hierarchy color).
 */
export function resolveLadderItemColor(rank: number, customColors?: Record<number, string>): string {
  if (customColors && customColors[rank]) {
    return customColors[rank];
  }
  return getRankLadderColor(rank);
}

/**
 * Resolves reaction tag text beside active ladder slot.
 */
export function resolveLadderItemTag(
  rank: number,
  clipLabel?: string,
  customTags?: Record<number, string>
): string {
  if (customTags && customTags[rank] !== undefined && customTags[rank].trim() !== '') {
    return customTags[rank].trim();
  }
  if (clipLabel && clipLabel.trim()) {
    return clipLabel.trim();
  }
  return `Top #${rank}`;
}

/**
 * Resolves the center ranking badge display text (e.g. '#2', 'TOP 2', or custom badge text).
 */
export function resolveBadgeText(rank: number, prefix = '#', customText?: string): string {
  if (customText !== undefined && customText.trim() !== '') {
    return customText.trim();
  }
  return `${prefix}${rank}`;
}

