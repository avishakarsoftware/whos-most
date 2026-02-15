type SoundName = 'playerJoin' | 'timerTick' | 'gameStart' | 'voteIn' | 'drumroll' | 'reveal' | 'fanfare' | 'fireworkPop' | 'award';

const MUTE_KEY = 'whosmost_muted';
const VIBRATE_KEY = 'whosmost_vibration';

class SoundManager {
    private ctx: AudioContext | null = null;
    private _muted: boolean;
    private _vibrationEnabled: boolean;

    constructor() {
        this._muted = localStorage.getItem(MUTE_KEY) === 'true';
        this._vibrationEnabled = localStorage.getItem(VIBRATE_KEY) !== 'false';
    }

    get muted() { return this._muted; }
    get vibrationEnabled() { return this._vibrationEnabled; }

    toggleMute(): boolean {
        this._muted = !this._muted;
        localStorage.setItem(MUTE_KEY, String(this._muted));
        return this._muted;
    }

    toggleVibration(): boolean {
        this._vibrationEnabled = !this._vibrationEnabled;
        localStorage.setItem(VIBRATE_KEY, String(this._vibrationEnabled));
        return this._vibrationEnabled;
    }

    private getCtx(): AudioContext {
        if (!this.ctx) this.ctx = new AudioContext();
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return this.ctx;
    }

    private tone(freq: number, duration: number, type: OscillatorType = 'sine', volume = 0.3, startTime = 0) {
        const ctx = this.getCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(volume, ctx.currentTime + startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + duration);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + startTime);
        osc.stop(ctx.currentTime + startTime + duration);
    }

    play(sound: SoundName) {
        if (this._muted) return;
        try {
            switch (sound) {
                case 'playerJoin':
                    this.tone(880, 0.15, 'sine', 0.2);
                    this.tone(1320, 0.12, 'sine', 0.1, 0.05);
                    break;
                case 'timerTick':
                    this.tone(600, 0.05, 'square', 0.1);
                    break;
                case 'gameStart':
                    this.tone(523, 0.12, 'sine', 0.2);
                    this.tone(659, 0.12, 'sine', 0.2, 0.1);
                    this.tone(784, 0.2, 'sine', 0.2, 0.2);
                    break;
                case 'voteIn':
                    // Soft confirmation plop
                    this.tone(660, 0.08, 'sine', 0.15);
                    this.tone(880, 0.1, 'sine', 0.1, 0.05);
                    break;
                case 'drumroll':
                    // Building tension
                    for (let i = 0; i < 8; i++) {
                        this.tone(200 + i * 30, 0.06, 'square', 0.08 + i * 0.01, i * 0.08);
                    }
                    break;
                case 'reveal':
                    // Swoosh reveal
                    this.tone(300, 0.2, 'sawtooth', 0.12);
                    this.tone(600, 0.15, 'sine', 0.15, 0.1);
                    this.tone(900, 0.2, 'sine', 0.1, 0.15);
                    break;
                case 'fanfare': {
                    this.tone(523, 0.3, 'square', 0.12);
                    this.tone(659, 0.3, 'square', 0.12, 0.25);
                    this.tone(784, 0.3, 'square', 0.12, 0.5);
                    this.tone(1047, 0.6, 'square', 0.15, 0.75);
                    this.tone(440, 0.25, 'sine', 0.08);
                    this.tone(523, 0.25, 'sine', 0.08, 0.25);
                    this.tone(659, 0.25, 'sine', 0.08, 0.5);
                    this.tone(880, 0.5, 'sine', 0.1, 0.75);
                    this.tone(1047, 0.8, 'sine', 0.08, 1.2);
                    this.tone(1319, 0.8, 'sine', 0.06, 1.2);
                    this.tone(1568, 0.8, 'sine', 0.05, 1.2);
                    break;
                }
                case 'fireworkPop': {
                    this.tone(200, 0.05, 'sawtooth', 0.15);
                    this.tone(800 + Math.random() * 400, 0.08, 'sine', 0.1, 0.03);
                    this.tone(2000 + Math.random() * 1000, 0.12, 'sine', 0.06, 0.05);
                    break;
                }
                case 'award': {
                    // Sparkly award reveal
                    this.tone(784, 0.12, 'sine', 0.15);
                    this.tone(988, 0.12, 'sine', 0.15, 0.08);
                    this.tone(1175, 0.15, 'sine', 0.12, 0.16);
                    this.tone(1568, 0.3, 'sine', 0.1, 0.24);
                    break;
                }
            }
        } catch {
            // AudioContext may fail in some environments
        }
    }

    vibrate(pattern: number | number[]) {
        if (!this._vibrationEnabled) return;
        navigator.vibrate?.(pattern);
    }
}

export const soundManager = new SoundManager();
