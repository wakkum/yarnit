import type { RecordingKind } from '../engine/types';

export const KIND_LABEL: Record<RecordingKind, string> = { interview: 'Interview', voiceover: 'Voice-over', music: 'Music', sfx: 'Sound effect' };
// plain symbols, not emoji: emoji are missing in some browsers and fonts
export const KIND_ICON: Record<RecordingKind, string> = { interview: '◉', voiceover: 'VO', music: '♪', sfx: '✦' };
