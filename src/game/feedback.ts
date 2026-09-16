import type { SettingsRecord } from '../types';

export type FeedbackCue = 'tile' | 'target' | 'bonus' | 'invalid' | 'already-found' | 'hint' | 'complete';

export interface AudioDefinition {
  frequency: number;
  duration: number;
  type: OscillatorType;
}

export const AUDIO_DEFINITIONS: Readonly<Record<FeedbackCue, AudioDefinition>> = {
  tile: { frequency: 440, duration: 0.045, type: 'sine' },
  target: { frequency: 660, duration: 0.1, type: 'sine' },
  bonus: { frequency: 880, duration: 0.09, type: 'triangle' },
  invalid: { frequency: 180, duration: 0.12, type: 'sawtooth' },
  'already-found': { frequency: 300, duration: 0.07, type: 'square' },
  hint: { frequency: 520, duration: 0.14, type: 'triangle' },
  complete: { frequency: 784, duration: 0.18, type: 'sine' }
};

export const HAPTIC_PATTERNS: Readonly<Record<FeedbackCue, readonly number[]>> = {
  tile: [8], target: [18], bonus: [12, 24, 12], invalid: [28, 18], 'already-found': [10, 18, 10], hint: [14, 22, 14], complete: [18, 30, 18, 30, 24]
};

type AudioContextLike = AudioContext;
export interface FeedbackControllerOptions {
  settings?: Pick<SettingsRecord, 'sound' | 'haptics'>;
  sound?: boolean;
  haptics?: boolean;
  reducedMotion?: boolean;
  audioContextFactory?: () => AudioContextLike;
  vibrate?: (pattern: number | number[]) => boolean;
}

function browserAudioContext(): AudioContextLike | undefined {
  const candidate = globalThis as typeof globalThis & { AudioContext?: new () => AudioContextLike; webkitAudioContext?: new () => AudioContextLike };
  const Constructor = candidate.AudioContext ?? candidate.webkitAudioContext;
  return Constructor ? new Constructor() : undefined;
}

export function createFeedbackController(options: FeedbackControllerOptions = {}) {
  let soundEnabled = options.sound ?? options.settings?.sound ?? true;
  let hapticsEnabled = options.haptics ?? options.settings?.haptics ?? true;
  const vibrate = options.vibrate ?? (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' ? navigator.vibrate.bind(navigator) : undefined);
  const makeAudio = options.audioContextFactory ?? browserAudioContext;
  let audio: AudioContextLike | undefined;
  let audioAttempted = false;

  function ensureAudio(): AudioContextLike | undefined {
    if (!soundEnabled) return undefined;
    if (!audioAttempted) {
      audioAttempted = true;
      try { audio = makeAudio(); } catch { audio = undefined; }
    }
    return audio;
  }

  function prime(): void {
    const context = ensureAudio();
    if (context?.state === 'suspended') void context.resume().catch(() => undefined);
  }

  function play(cue: FeedbackCue): void {
    const context = ensureAudio();
    if (context) {
      try {
        if (context.state === 'suspended') void context.resume().catch(() => undefined);
        const definition = AUDIO_DEFINITIONS[cue];
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = context.currentTime;
        oscillator.type = definition.type;
        oscillator.frequency.setValueAtTime(definition.frequency, start);
        gain.gain.setValueAtTime(0.06, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + definition.duration);
        oscillator.connect(gain); gain.connect(context.destination);
        oscillator.start(start); oscillator.stop(start + definition.duration);
      } catch {}
    }
    if (hapticsEnabled) { try { vibrate?.([...HAPTIC_PATTERNS[cue]]); } catch {} }
  }

  function updatePreferences(preferences: Pick<SettingsRecord, 'sound' | 'haptics'>): void {
    soundEnabled = preferences.sound;
    hapticsEnabled = preferences.haptics;
  }

  return { play, prime, updatePreferences, get audioContext(): AudioContextLike | undefined { return audio; } };
}
