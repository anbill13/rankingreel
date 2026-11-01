import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitTitleInTwoLines,
  validateClipCount,
  shufflePlaybackOrder,
  getClipEffectiveDuration,
  calculateTotalDuration,
  scaleClipsToVoice,
  distributeSubtitles,
  getActiveClipAtTime,
  removeClipById,
  formatTime,
  getTextLayoutPreset,
  clampTextPosition,
  getRankLadderColor,
  calculateLadderPositions,
  computeAutoLadderSpacing,
  ensureRank1IsLastInPlayback,
  shufflePlaybackOrderWithRank1Last,
  swapClipRanks,
  setClipRank,
  assignTop3Podium,
  shuffleIntermediateRanks,
  parseTitleWordsWithColors,
  resolveLadderItemText,
  resolveLadderItemColor,
  resolveLadderItemTag,
  resolveBadgeText,
  type ClipItem
} from './engine';

test('splitTitleInTwoLines splits smoothly into 2 balanced lines', () => {
  const result = splitTitleInTwoLines('TOP 5 MOMENTOS LOCOS EN LA PISCINA');
  assert.equal(result.line1, 'TOP 5 MOMENTOS');
  assert.equal(result.line2, 'LOCOS EN LA PISCINA');
  assert.equal(result.warning, undefined);
});

test('splitTitleInTwoLines handles manual newlines and warns if > 2 lines', () => {
  const manual2 = splitTitleInTwoLines('LÍNEA UNO\nLÍNEA DOS');
  assert.equal(manual2.line1, 'LÍNEA UNO');
  assert.equal(manual2.line2, 'LÍNEA DOS');

  const manual3 = splitTitleInTwoLines('UNO\nDOS\nTRES');
  assert.ok(manual3.warning?.includes('Demasiadas líneas'));
});

test('validateClipCount checks optimal count of 5-7, recommending 6', () => {
  const zero = validateClipCount(0);
  assert.equal(zero.status, 'empty');

  const four = validateClipCount(4);
  assert.equal(four.status, 'few');
  assert.ok(four.message.includes('Pierdes tiempo de visualización'));

  const six = validateClipCount(6);
  assert.equal(six.status, 'optimal');
  assert.equal(six.isOptimal, true);

  const eight = validateClipCount(8);
  assert.equal(eight.status, 'many');
  assert.ok(eight.message.includes('abandonar antes de terminar'));
});

test('shufflePlaybackOrder preserves clip rank numbers and ids', () => {
  const sampleClips = [
    { id: 'c1', rank: 1, label: 'Momento 1' },
    { id: 'c2', rank: 2, label: 'Momento 2' },
    { id: 'c3', rank: 3, label: 'Momento 3' },
    { id: 'c4', rank: 4, label: 'Momento 4' },
    { id: 'c5', rank: 5, label: 'Momento 5' },
    { id: 'c6', rank: 6, label: 'Momento 6' }
  ];

  const shuffled = shufflePlaybackOrder(sampleClips);
  assert.equal(shuffled.length, 6);
  // Verify every clip still retains its intrinsic rank
  for (const c of shuffled) {
    const original = sampleClips.find(orig => orig.id === c.id);
    assert.ok(original);
    assert.equal(c.rank, original.rank);
  }
});

test('getClipEffectiveDuration calculates trimmed window', () => {
  const clip: ClipItem = {
    id: 'c1',
    rank: 1,
    label: 'Clip A',
    duration: 10,
    trimStart: 2,
    trimEnd: 7,
    mute: true
  };
  assert.equal(getClipEffectiveDuration(clip), 5);
});

test('calculateTotalDuration obeys voice > clips > script precedence', () => {
  const clips: ClipItem[] = [
    { id: 'c1', rank: 1, label: 'A', duration: 4, trimStart: 0, trimEnd: 4, mute: true },
    { id: 'c2', rank: 2, label: 'B', duration: 6, trimStart: 0, trimEnd: 6, mute: true }
  ];

  // Voice priority
  const withVoice = calculateTotalDuration(22.5, clips, 'tres palabras aqui');
  assert.equal(withVoice, 22.5);

  // Clips sum priority
  const withoutVoice = calculateTotalDuration(null, clips, 'tres palabras aqui');
  assert.equal(withoutVoice, 10);

  // Script fallback (clamped to minimum 3 seconds)
  const scriptOnly = calculateTotalDuration(null, [], 'uno dos tres cuatro cinco');
  assert.equal(scriptOnly, 3);
});

test('scaleClipsToVoice adjusts clips to fit exact voice duration', () => {
  const clips: ClipItem[] = [
    { id: 'c1', rank: 1, label: 'A', duration: 10, trimStart: 0, trimEnd: 2, mute: true }, // dur 2
    { id: 'c2', rank: 2, label: 'B', duration: 10, trimStart: 0, trimEnd: 3, mute: true }  // dur 3
  ]; // Total = 5s

  const scaled = scaleClipsToVoice(clips, 10); // Scale to 10s (ratio = 2)
  assert.equal(getClipEffectiveDuration(scaled[0]), 4);
  assert.equal(getClipEffectiveDuration(scaled[1]), 6);
});

test('distributeSubtitles generates proportional word timings across totalDuration', () => {
  const text = 'Este es el momento definitivo. No te lo pierdas!';
  const cues = distributeSubtitles(text, 10);
  assert.ok(cues.length > 0);
  assert.equal(cues[0].start, 0);
  const lastCue = cues[cues.length - 1];
  assert.ok(Math.abs(lastCue.end - 10) < 0.001);
  assert.ok(cues[0].words.length > 0);
});

test('getActiveClipAtTime locates active clip correctly along timeline', () => {
  const clips: ClipItem[] = [
    { id: 'c1', rank: 6, label: 'A', duration: 5, trimStart: 0, trimEnd: 5, mute: true },
    { id: 'c2', rank: 5, label: 'B', duration: 5, trimStart: 0, trimEnd: 5, mute: true }
  ];

  const at2 = getActiveClipAtTime(clips, 2);
  assert.equal(at2.clip?.id, 'c1');
  assert.equal(at2.localTime, 2);

  const at7 = getActiveClipAtTime(clips, 7);
  assert.equal(at7.clip?.id, 'c2');
  assert.equal(at7.localTime, 2);
});

test('removeClipById deletes clip and maintains contiguous 1..N ranks', () => {
  const clips: ClipItem[] = [
    { id: 'c1', rank: 1, label: 'A', duration: 4, trimStart: 0, trimEnd: 4, mute: true },
    { id: 'c2', rank: 2, label: 'B', duration: 4, trimStart: 0, trimEnd: 4, mute: true },
    { id: 'c3', rank: 3, label: 'C', duration: 4, trimStart: 0, trimEnd: 4, mute: true }
  ];

  const updated = removeClipById(clips, 'c2');
  assert.equal(updated.length, 2);
  assert.equal(updated[0].id, 'c1');
  assert.equal(updated[0].rank, 1);
  assert.equal(updated[1].id, 'c3');
  assert.equal(updated[1].rank, 2);
});

test('formatTime outputs m:ss format', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(65), '1:05');
  assert.equal(formatTime(12), '0:12');
});

test('getTextLayoutPreset returns correct settings for tiktok_safe and giant_badge', () => {
  const tiktok = getTextLayoutPreset('tiktok_safe');
  assert.equal(tiktok.subtitlesY, 1440);
  assert.equal(tiktok.subtitlesBgBox, true);

  const giant = getTextLayoutPreset('giant_badge');
  assert.equal(giant.rankingBadgeSize, 175);
  assert.equal(giant.rankingBadgeStroke, 22);
});

test('clampTextPosition restricts Y values to canvas limits', () => {
  assert.equal(clampTextPosition(50, 100, 1800), 100);
  assert.equal(clampTextPosition(2000, 100, 1800), 1800);
  assert.equal(clampTextPosition(500, 100, 1800), 500);
});

test('getRankLadderColor assigns hierarchy colors to top 4 ranks', () => {
  assert.equal(getRankLadderColor(1), '#FF2A70'); // Rank 1: Red/Pink
  assert.equal(getRankLadderColor(2), '#FF7A00'); // Rank 2: Orange
  assert.equal(getRankLadderColor(3), '#FFD400'); // Rank 3: Yellow
  assert.equal(getRankLadderColor(4), '#38BDF8'); // Rank 4: Cyan
  assert.equal(getRankLadderColor(5), '#FFFFFF'); // Rank 5: White
  assert.equal(getRankLadderColor(8), '#FFFFFF'); // Rank 8: White
});

test('calculateLadderPositions spaces ranks evenly along canvas height', () => {
  const ladder = calculateLadderPositions(6, 380, 1580);
  assert.equal(ladder.length, 6);
  assert.equal(ladder[0].rank, 1);
  assert.equal(ladder[0].y, 380);
  assert.equal(ladder[5].rank, 6);
  assert.equal(ladder[5].y, 1580);
});

test('calculateLadderPositions supports explicit spacing between numbers', () => {
  // 6 ranks starting at 400 with 130px spacing
  const ladder = calculateLadderPositions(6, 400, 1600, 130);
  assert.equal(ladder.length, 6);
  assert.equal(ladder[0].rank, 1);
  assert.equal(ladder[0].y, 400);
  assert.equal(ladder[1].rank, 2);
  assert.equal(ladder[1].y, 530);
  assert.equal(ladder[2].rank, 3);
  assert.equal(ladder[2].y, 660);
  assert.equal(ladder[5].rank, 6);
  assert.equal(ladder[5].y, 1050);
});

test('computeAutoLadderSpacing derives balanced step within limits', () => {
  const step6 = computeAutoLadderSpacing(6, 400, 1600); // (1600 - 400) / 5 = 240 -> clamped to 220
  assert.ok(step6 >= 60 && step6 <= 240);
  const step10 = computeAutoLadderSpacing(10, 400, 1600); // 1200 / 9 = 133
  assert.equal(step10, 133);
});

test('parseTitleWordsWithColors resolves custom colors per word token', () => {
  const line1 = 'Ranking Best';
  const line2 = 'Turning My Mom Into Me';
  const customColors: Record<number, string> = {
    3: '#FFD400', // "My"
    4: '#FFD400', // "Mom"
    6: '#FF7A00'  // "Me"
  };

  const tokens = parseTitleWordsWithColors(line1, line2, customColors);
  assert.equal(tokens.length, 7);
  assert.equal(tokens[0].word, 'Ranking');
  assert.equal(tokens[0].color, '#FFFFFF');
  assert.equal(tokens[3].word, 'My');
  assert.equal(tokens[3].color, '#FFD400');
  assert.equal(tokens[4].word, 'Mom');
  assert.equal(tokens[4].color, '#FFD400');
  assert.equal(tokens[6].word, 'Me');
  assert.equal(tokens[6].color, '#FF7A00');
});

test('resolveLadderItemText allows full custom slot names or defaults to rank number', () => {
  assert.equal(resolveLadderItemText(1), '1.');
  assert.equal(resolveLadderItemText(1, { 1: 'TOP 1' }), 'TOP 1');
  assert.equal(resolveLadderItemText(2, { 1: 'TOP 1', 2: '🥈 Segundo' }), '🥈 Segundo');
  assert.equal(resolveLadderItemText(3, { 1: 'TOP 1' }), '3.');
});

test('resolveLadderItemColor allows custom colors per rank slot', () => {
  assert.equal(resolveLadderItemColor(1), '#FF2A70'); // Default rank 1 hierarchy
  assert.equal(resolveLadderItemColor(1, { 1: '#00FF00' }), '#00FF00'); // Custom override
  assert.equal(resolveLadderItemColor(2, { 1: '#00FF00' }), '#FF7A00'); // Rank 2 default intact
});

test('resolveLadderItemTag resolves custom reaction tag or clip label', () => {
  assert.equal(resolveLadderItemTag(6, 'No way! 🤯'), 'No way! 🤯');
  assert.equal(resolveLadderItemTag(6, 'Old label', { 6: 'OMG 🔥' }), 'OMG 🔥');
  assert.equal(resolveLadderItemTag(3, ''), 'Top #3');
});

test('resolveBadgeText formats prefix and number or custom label', () => {
  assert.equal(resolveBadgeText(2, '#'), '#2');
  assert.equal(resolveBadgeText(2, 'TOP '), 'TOP 2');
  assert.equal(resolveBadgeText(2, '#', 'FINALISTA 🏆'), 'FINALISTA 🏆');
});

test('ensureRank1IsLastInPlayback places rank #1 at the end of playback', () => {
  const clips = [
    { id: 'c1', rank: 1 },
    { id: 'c3', rank: 3 },
    { id: 'c2', rank: 2 }
  ];
  const ordered = ensureRank1IsLastInPlayback(clips);
  assert.equal(ordered.length, 3);
  assert.equal(ordered[ordered.length - 1].rank, 1);
  assert.equal(ordered[ordered.length - 1].id, 'c1');
});

test('shufflePlaybackOrderWithRank1Last keeps rank #1 strictly at the end', () => {
  const clips = [
    { id: 'c1', rank: 1 },
    { id: 'c2', rank: 2 },
    { id: 'c3', rank: 3 },
    { id: 'c4', rank: 4 },
    { id: 'c5', rank: 5 }
  ];
  for (let i = 0; i < 5; i++) {
    const shuffled = shufflePlaybackOrderWithRank1Last(clips);
    assert.equal(shuffled.length, 5);
    assert.equal(shuffled[4].rank, 1);
    assert.equal(shuffled[4].id, 'c1');
  }
});

test('swapClipRanks swaps ranks while keeping each clip label intact', () => {
  const clips: ClipItem[] = [
    { id: 'c1', rank: 1, label: 'Look Ganador ✨', duration: 3, trimStart: 0, trimEnd: 3, mute: false },
    { id: 'c6', rank: 6, label: 'No way! 🤯', duration: 3, trimStart: 0, trimEnd: 3, mute: false }
  ];
  const swapped = swapClipRanks(clips, 'c1', 'c6');
  const clip1 = swapped.find(c => c.id === 'c1')!;
  const clip6 = swapped.find(c => c.id === 'c6')!;

  assert.equal(clip1.rank, 6);
  assert.equal(clip1.label, 'Look Ganador ✨'); // Label stays with clip1!
  assert.equal(clip6.rank, 1);
  assert.equal(clip6.label, 'No way! 🤯'); // Label stays with clip6!
});

test('setClipRank assigns target rank and swaps with occupant without losing labels', () => {
  const clips: ClipItem[] = [
    { id: 'c1', rank: 1, label: 'Momento 1', duration: 2, trimStart: 0, trimEnd: 2, mute: false },
    { id: 'c2', rank: 2, label: 'Momento 2', duration: 2, trimStart: 0, trimEnd: 2, mute: false },
    { id: 'c3', rank: 3, label: 'Momento 3', duration: 2, trimStart: 0, trimEnd: 2, mute: false }
  ];
  // Promote clip 3 to rank 1
  const updated = setClipRank(clips, 'c3', 1);
  assert.equal(updated.find(c => c.id === 'c3')!.rank, 1);
  assert.equal(updated.find(c => c.id === 'c3')!.label, 'Momento 3');
  assert.equal(updated.find(c => c.id === 'c1')!.rank, 3);
  assert.equal(updated.find(c => c.id === 'c1')!.label, 'Momento 1');
});

test('assignTop3Podium sets ranks 1, 2, 3 smoothly', () => {
  const clips: ClipItem[] = [
    { id: 'c1', rank: 1, label: 'Clip A', duration: 2, trimStart: 0, trimEnd: 2, mute: false },
    { id: 'c2', rank: 2, label: 'Clip B', duration: 2, trimStart: 0, trimEnd: 2, mute: false },
    { id: 'c3', rank: 3, label: 'Clip C', duration: 2, trimStart: 0, trimEnd: 2, mute: false },
    { id: 'c4', rank: 4, label: 'Clip D', duration: 2, trimStart: 0, trimEnd: 2, mute: false }
  ];
  // Select Clip D as top 1, Clip C as top 2, Clip B as top 3
  const podium = assignTop3Podium(clips, { top1Id: 'c4', top2Id: 'c3', top3Id: 'c2' });
  assert.equal(podium.find(c => c.id === 'c4')!.rank, 1);
  assert.equal(podium.find(c => c.id === 'c4')!.label, 'Clip D');
  assert.equal(podium.find(c => c.id === 'c3')!.rank, 2);
  assert.equal(podium.find(c => c.id === 'c2')!.rank, 3);
});

test('shuffleIntermediateRanks preserves Top 3 and shuffles >= 4', () => {
  const clips: ClipItem[] = [
    { id: 'c1', rank: 1, label: 'Top 1', duration: 2, trimStart: 0, trimEnd: 2, mute: false },
    { id: 'c2', rank: 2, label: 'Top 2', duration: 2, trimStart: 0, trimEnd: 2, mute: false },
    { id: 'c3', rank: 3, label: 'Top 3', duration: 2, trimStart: 0, trimEnd: 2, mute: false },
    { id: 'c4', rank: 4, label: 'Slot 4', duration: 2, trimStart: 0, trimEnd: 2, mute: false },
    { id: 'c5', rank: 5, label: 'Slot 5', duration: 2, trimStart: 0, trimEnd: 2, mute: false },
    { id: 'c6', rank: 6, label: 'Slot 6', duration: 2, trimStart: 0, trimEnd: 2, mute: false }
  ];
  const result = shuffleIntermediateRanks(clips, 3);
  assert.equal(result.find(c => c.id === 'c1')!.rank, 1);
  assert.equal(result.find(c => c.id === 'c2')!.rank, 2);
  assert.equal(result.find(c => c.id === 'c3')!.rank, 3);
  // All labels still match their clips
  result.forEach(c => {
    if (c.id === 'c4') assert.equal(c.label, 'Slot 4');
    if (c.id === 'c5') assert.equal(c.label, 'Slot 5');
    if (c.id === 'c6') assert.equal(c.label, 'Slot 6');
  });
});


