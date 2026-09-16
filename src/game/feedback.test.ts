import { describe, expect, it, vi } from 'vitest';
import { AUDIO_DEFINITIONS, createFeedbackController, HAPTIC_PATTERNS, type FeedbackCue } from './feedback';

const cues: FeedbackCue[] = ['tile', 'target', 'bonus', 'invalid', 'already-found', 'hint', 'complete'];

describe('feedback', () => {
  it('maps every cue to distinct enough restrained audio and haptic feedback', () => {
    expect(new Set(cues.map(cue => `${AUDIO_DEFINITIONS[cue].frequency}:${AUDIO_DEFINITIONS[cue].duration}:${AUDIO_DEFINITIONS[cue].type}`)).size).toBe(cues.length);
    expect(new Set(cues.map(cue => HAPTIC_PATTERNS[cue].join(','))).size).toBe(cues.length);
    expect(Math.max(...cues.flatMap(cue => HAPTIC_PATTERNS[cue]))).toBeLessThanOrEqual(30);
  });

  it('does not create audio until an enabled cue is played', () => {
    const factory = vi.fn(() => undefined as never);
    const controller = createFeedbackController({ sound: true, haptics: false, audioContextFactory: factory });
    expect(factory).not.toHaveBeenCalled();
    controller.play('tile');
    expect(factory).toHaveBeenCalledTimes(1);
    controller.play('target');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('guards disabled sound and haptics without touching either adapter', () => {
    const factory = vi.fn(() => undefined as never);
    const vibrate = vi.fn(() => true);
    const controller = createFeedbackController({ sound: false, haptics: false, audioContextFactory: factory, vibrate });
    controller.play('complete');
    expect(factory).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('uses haptics independently and safely no-ops when browser APIs are unavailable', () => {
    const vibrate = vi.fn(() => true);
    createFeedbackController({ sound: false, haptics: true, vibrate }).play('hint');
    expect(vibrate).toHaveBeenCalledWith([...HAPTIC_PATTERNS.hint]);
    expect(() => createFeedbackController({ sound: true, haptics: true }).play('invalid')).not.toThrow();
  });

  it('does not treat reduced motion as an audio or haptic disable', () => {
    const factory = vi.fn(() => undefined as never);
    const vibrate = vi.fn(() => true);
    createFeedbackController({ sound: true, haptics: true, reducedMotion: true, audioContextFactory: factory, vibrate }).play('target');
    expect(factory).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });
});
