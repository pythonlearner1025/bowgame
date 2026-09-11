/**
 * Produces and plays bow audio while deliberately leaving gameplay event timing to the runtime.
 * Procedural synthesis constants below are authored sound-design values, not gameplay tuning.
 */
/* eslint-disable no-magic-numbers -- The renderer is a calibrated synthesis patch. */
/* eslint-disable no-bitwise -- The seeded xorshift generator requires exact bit operations. */
import { bowAssetUrl } from './BowAssetUrl.js';
/** Maximum simultaneous voices; bounding the graph avoids audio-thread spikes. */
export const BOW_AUDIO_VOICES = 16;
/** Calibrated gain and smoothing values shared by recorded and procedural layers. */
export const BOW_AUDIO_MIX = {
    drawBase: 0.04,
    drawCharge: 0.13,
    drawFadeStart: 0.8,
    drawSilentCharge: 0.97,
    drawSmooth: 0.065,
    headWorldBoost: 1.75,
    headWorldCap: 1.28,
    headConfirm: 1.04,
};
/** Stable public paths for the two recorded foley layers. */
export const BOW_RECORDED_AUDIO = {
    release: bowAssetUrl('bow-audio/release-recorded.wav'),
    whizz: bowAssetUrl('bow-audio/whizz-recorded.wav'),
};
/** Per-recording gain corrections measured against the procedural layers. */
export const BOW_RECORDED_MIX = { release: 0.8, whizz: 0.9 };
const PROCEDURAL_SOUNDS = ['draw', 'body', 'head', 'cover'];
const recordingBytes = new Map();
function loadRecordingBytes(path) {
    let pending = recordingBytes.get(path);
    if (!pending) {
        pending = (async () => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            try {
                const response = await fetch(path, { signal: controller.signal });
                if (!response.ok) {
                    throw new Error(`Recording request failed for ${path}: HTTP ${response.status}`);
                }
                return await response.arrayBuffer();
            }
            finally {
                clearTimeout(timeout);
            }
        })();
        recordingBytes.set(path, pending);
        void pending.catch(() => {
            if (recordingBytes.get(path) === pending) {
                recordingBytes.delete(path);
            }
        });
    }
    return pending;
}
const LENGTHS = {
    draw: 0.9,
    release: 0.34,
    flight: 0.24,
    whizz: 0.32,
    body: 0.3,
    head: 0.34,
    cover: 0.3,
};
/**
 * Renders deterministic bow audio from seeded noise, resonances, and fiber transients.
 *
 * @param kind - Sound design to render.
 * @param rate - Output sample rate in samples per second.
 * @param seed - Integer seed used by the deterministic xorshift generator.
 * @returns Mono samples normalized for the selected sound design.
 */
export function renderBowSound(kind, rate = 24000, seed = 7413) {
    const lengthSeconds = LENGTHS[kind];
    const samples = new Float32Array(Math.ceil(lengthSeconds * rate));
    let randomState = seed | 0;
    let lowNoise = 0;
    let slowNoise = 0;
    let phaseRadians = 0;
    let peakAmplitude = 0;
    const random = () => {
        randomState ^= randomState << 13;
        randomState ^= randomState >>> 17;
        randomState ^= randomState << 5;
        return (randomState >>> 0) / 2147483648 - 1;
    };
    for (let i = 0; i < samples.length; i++) {
        const timeSeconds = i / rate;
        const progress = timeSeconds / lengthSeconds;
        const noise = random();
        lowNoise += 0.14 * (noise - lowNoise);
        slowNoise += 0.025 * (noise - slowNoise);
        const highNoise = noise - lowNoise;
        let sample = 0;
        if (kind === 'draw') {
            const pulse = 0.5 + 0.5 * Math.pow(Math.sin(timeSeconds * 18 + Math.sin(timeSeconds * 7)), 4);
            const grain = highNoise * (0.025 + 0.07 * pulse) + lowNoise * 0.75;
            sample =
                grain * (0.5 + 0.5 * Math.sin(Math.PI * progress) ** 2) +
                    0.04 * Math.sin(2 * Math.PI * (190 * timeSeconds + 12 * timeSeconds * timeSeconds)) * pulse;
        }
        else if (kind === 'release') {
            phaseRadians += (2 * Math.PI * (118 + 49 * Math.exp(-timeSeconds * 35))) / rate;
            const string = (Math.sin(phaseRadians) +
                0.35 * Math.sin(phaseRadians * 2.03) +
                0.18 * Math.sin(phaseRadians * 3.91)) *
                Math.exp(-timeSeconds * 19);
            sample =
                0.47 * string +
                    0.8 * highNoise * Math.exp(-timeSeconds * 105) +
                    1.3 * lowNoise * Math.exp(-timeSeconds * 37) +
                    0.28 * Math.sin(timeSeconds * 2 * Math.PI * 71) * Math.exp(-timeSeconds * 31);
        }
        else if (kind === 'flight' || kind === 'whizz') {
            const passExponent = kind === 'whizz' ? 2.4 : 1.6;
            const passEnvelope = Math.sin(Math.PI * progress) ** passExponent;
            const sweep = Math.sin(2 * Math.PI * (1600 * timeSeconds - 1600 * timeSeconds * timeSeconds));
            const gain = kind === 'whizz' ? 0.85 : 0.4;
            sample = gain * passEnvelope * (highNoise * 0.7 + lowNoise * 1.1 + sweep * 0.035);
        }
        else {
            const isHeadImpact = kind === 'head';
            const isCoverImpact = kind === 'cover';
            let crackDecay = 210;
            let crackGain = 0.3;
            let resonanceFrequency = 74;
            let bodyDecay = 20;
            let crunchGain = 0.45;
            if (isHeadImpact) {
                crackDecay = 100;
                crackGain = 1.65;
                resonanceFrequency = 105;
                bodyDecay = 24;
                crunchGain = 1.4;
            }
            else if (isCoverImpact) {
                crackDecay = 160;
                crackGain = 0.9;
                resonanceFrequency = 210;
                bodyDecay = 40;
                crunchGain = 0.55;
            }
            const crack = highNoise * Math.exp(-timeSeconds * crackDecay) * crackGain;
            const body = (slowNoise * 4 +
                lowNoise * 0.9 +
                Math.sin(timeSeconds * 2 * Math.PI * resonanceFrequency) * 0.28) *
                Math.exp(-timeSeconds * bodyDecay);
            const crunch = (noise > 0 ? 0.8 : -0.8) *
                lowNoise *
                (Math.exp(-Math.abs(timeSeconds - 0.025) * 95) +
                    0.65 * Math.exp(-Math.abs(timeSeconds - 0.055) * 110) +
                    0.3 * Math.exp(-Math.abs(timeSeconds - 0.105) * 120)) *
                crunchGain;
            sample = crack + body + crunch;
        }
        const edgeEnvelope = Math.min(1, timeSeconds / 0.0015, (lengthSeconds - timeSeconds) / 0.012);
        const loopEnvelope = kind === 'draw' ? Math.sin(Math.PI * progress) ** 0.25 : 1;
        samples[i] = Math.tanh(sample * 1.6) * edgeEnvelope * loopEnvelope;
        peakAmplitude = Math.max(peakAmplitude, Math.abs(samples[i]));
    }
    const targetAmplitudeBySound = {
        draw: 0.3,
        release: 0.76,
        flight: 0.18,
        whizz: 0.43,
        body: 0.76,
        head: 0.94,
        cover: 0.76,
    };
    const normalization = targetAmplitudeBySound[kind] / (peakAmplitude || 1);
    for (let i = 0; i < samples.length; i++) {
        samples[i] *= normalization;
    }
    return samples;
}
/**
 * Reports whether a swept arrow segment passes within the listener's audible whizz shell.
 *
 * @param from - Arrow segment start in world-space meters.
 * @param to - Arrow segment end in world-space meters.
 * @param listener - Listener position in world-space meters.
 * @returns Whether the closest point lies between 0.3 and 2.4 meters from the listener.
 */
export function shouldArrowWhizz(from, to, listener) {
    const deltaX = to.x - from.x;
    const deltaY = to.y - from.y;
    const deltaZ = to.z - from.z;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ;
    if (lengthSquared < 1e-8) {
        return false;
    }
    const progress = ((listener.x - from.x) * deltaX +
        (listener.y - from.y) * deltaY +
        (listener.z - from.z) * deltaZ) /
        lengthSquared;
    if (progress < 0 || progress > 1) {
        return false;
    }
    const distance = Math.hypot(from.x + deltaX * progress - listener.x, from.y + deltaY * progress - listener.y, from.z + deltaZ * progress - listener.z);
    return distance >= 0.3 && distance <= 2.4;
}
/** Owns the Web Audio graph and translates gameplay events into bounded audio voices. */
export class BowAudio {
    context = null;
    master = null;
    compressor = null;
    limiter = null;
    played = {
        draw: 0,
        release: 0,
        flight: 0,
        whizz: 0,
        body: 0,
        head: 0,
        cover: 0,
    };
    buffers = new Map();
    recordingLoad = null;
    recordings = {};
    voices = [];
    draws = new Map();
    listener = { x: 0, y: 0, z: 0 };
    right = { x: 1, y: 0, z: 0 };
    muted = false;
    volume = 0.6;
    headshotConfirmations = 0;
    paused = true;
    /** Creates or resumes the audio graph and asynchronously loads recorded foley. */
    async resume() {
        if (!this.context) {
            const context = new AudioContext();
            this.context = context;
            this.master = context.createGain();
            this.master.gain.value = this.muted ? 0 : this.volume;
            this.compressor = context.createDynamicsCompressor();
            this.compressor.threshold.value = -8;
            this.compressor.knee.value = 10;
            this.compressor.ratio.value = 8;
            this.compressor.attack.value = 0.002;
            this.compressor.release.value = 0.12;
            this.limiter = context.createWaveShaper();
            const curve = new Float32Array(2049);
            for (let i = 0; i < curve.length; i++) {
                curve[i] = 0.88 * Math.tanh(((i / (curve.length - 1)) * 2 - 1) * 1.6);
            }
            this.limiter.curve = curve;
            this.limiter.oversample = '2x';
            this.master.connect(this.compressor);
            this.compressor.connect(this.limiter);
            this.limiter.connect(context.destination);
            for (const kind of PROCEDURAL_SOUNDS) {
                const samples = renderBowSound(kind);
                const buffer = context.createBuffer(1, samples.length, 24000);
                buffer.copyToChannel(new Float32Array(samples), 0);
                this.buffers.set(kind, buffer);
            }
        }
        this.paused = false;
        const context = this.context;
        await context.resume();
        if (this.context !== context) {
            return;
        }
        this.recordingLoad ??= this.loadRecordings(context);
        await this.recordingLoad;
    }
    /**
     * Loads optional recorded layers, retaining procedural fallbacks when loading fails.
     *
     * @param context - Audio graph that will own the decoded buffers.
     */
    async loadRecordings(context) {
        await Promise.all(Object.keys(BOW_RECORDED_AUDIO).map(async (kind) => {
            const path = BOW_RECORDED_AUDIO[kind];
            this.recordings[kind] = { path, status: 'loading' };
            try {
                // DecodeAudioData may detach its input. Keep the cached bytes immutable.
                const bytes = await loadRecordingBytes(path);
                const buffer = await context.decodeAudioData(bytes.slice(0));
                if (this.context !== context) {
                    return;
                }
                if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > 3) {
                    throw new Error('Invalid recording length');
                }
                this.buffers.set(kind, buffer);
                this.recordings[kind] = { path, status: 'decoded' };
            }
            catch (error) {
                console.warn('Bow audio recording could not be loaded; using procedural fallback.', {
                    error,
                    kind,
                    path,
                });
                if (this.context === context) {
                    this.recordings[kind] = { path, status: 'failed' };
                }
            }
        }));
    }
    /**
     * Returns a serializable diagnostic snapshot without exposing live audio nodes.
     *
     * @returns Current playback, buffer, and recording-load diagnostics.
     */
    getState() {
        return {
            state: this.context?.state ?? 'uninitialized',
            paused: this.paused,
            muted: this.muted,
            volume: this.volume,
            headshotConfirmations: this.headshotConfirmations,
            voices: this.voices.length,
            drawLoops: this.draws.size,
            played: { ...this.played },
            recordings: Object.fromEntries(Object.entries(this.recordings).map(([kind, value]) => [kind, { ...value }])),
            buffers: [...this.buffers].map(([kind, buffer]) => ({
                kind,
                duration: buffer.duration,
                sampleRate: buffer.sampleRate,
                channels: buffer.numberOfChannels,
                source: kind in BOW_RECORDED_AUDIO ? 'recorded' : 'procedural',
                path: BOW_RECORDED_AUDIO[kind] ?? null,
            })),
        };
    }
    /**
     * Updates the listener frame used for distance attenuation and stereo panning.
     *
     * @param position - Listener origin in world-space meters.
     * @param right - Listener's normalized world-space right direction.
     */
    setListener(position, right) {
        this.listener = { ...position };
        this.right = { ...right };
    }
    /**
     * Sets mute state and smoothly updates the master gain.
     *
     * @param muted - Whether master output should be silent.
     */
    setMuted(muted) {
        this.muted = muted;
        if (this.context && this.master) {
            this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.context.currentTime, 0.012);
        }
    }
    /**
     * Returns whether master audio is muted.
     *
     * @returns Current mute state.
     */
    isMuted() {
        return this.muted;
    }
    /**
     * Sets master volume after clamping it to the authored safe range.
     *
     * @param volume - Requested normalized master gain.
     */
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(0.8, volume));
        this.setMuted(this.muted);
    }
    /**
     * Computes distance gain and listener-relative stereo pan for a world point.
     *
     * @param position - Optional source position in world-space meters.
     * @returns Distance attenuation and normalized stereo pan.
     */
    spatial(position) {
        if (!position) {
            return { gain: 1, pan: 0 };
        }
        const deltaX = position.x - this.listener.x;
        const deltaY = position.y - this.listener.y;
        const deltaZ = position.z - this.listener.z;
        const distance = Math.hypot(deltaX, deltaY, deltaZ);
        return {
            gain: distance > 55 ? 0 : 1 / Math.pow(1 + distance * 0.085, 1.2),
            pan: Math.max(-1, Math.min(1, (deltaX * this.right.x + deltaY * this.right.y + deltaZ * this.right.z) / (distance || 1))),
        };
    }
    /**
     * Disconnects a completed voice and removes all bookkeeping references to it.
     *
     * @param voice - Voice whose source has ended or must be retired.
     */
    finish(voice) {
        if (voice.ended) {
            return;
        }
        voice.ended = true;
        voice.source.disconnect();
        voice.gain.disconnect();
        voice.pan.disconnect();
        const index = this.voices.indexOf(voice);
        if (index >= 0) {
            this.voices.splice(index, 1);
        }
        for (const [id, drawVoice] of this.draws) {
            if (drawVoice === voice) {
                this.draws.delete(id);
            }
        }
    }
    /**
     * Fades and schedules one voice for shutdown.
     *
     * @param voice - Active voice to stop.
     */
    stopVoice(voice) {
        if (voice.ended || !this.context) {
            return;
        }
        const now = this.context.currentTime;
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setTargetAtTime(0, now, 0.006);
        try {
            voice.source.stop(now + 0.035);
        }
        catch (error) {
            console.warn('Bow audio voice could not be scheduled to stop; disconnecting it.', { error });
            this.finish(voice);
        }
    }
    /**
     * Creates one spatialized voice when audio is ready and the source is audible.
     *
     * @param kind - Sound layer to play.
     * @param position - Optional source position in world-space meters.
     * @param loop - Whether the buffer repeats until explicitly stopped.
     * @returns The new voice, or undefined when playback is unavailable or inaudible.
     */
    play(kind, position, loop = false) {
        const context = this.context;
        const buffer = this.buffers.get(kind);
        if (!context || !buffer || !this.master || this.paused || context.state !== 'running') {
            return undefined;
        }
        const placement = this.spatial(position);
        if (placement.gain < 0.025) {
            return undefined;
        }
        // Stops/disconnects the oldest voice before creating another, so CPU use is bounded.
        if (this.voices.length >= BOW_AUDIO_VOICES) {
            const oldest = this.voices[0];
            try {
                oldest.source.stop();
            }
            catch (error) {
                console.warn('Oldest bow audio voice was already stopped.', { error });
            }
            this.finish(oldest);
        }
        const source = context.createBufferSource();
        const gain = context.createGain();
        const pan = context.createStereoPanner();
        source.buffer = buffer;
        source.loop = loop;
        source.playbackRate.value =
            kind in BOW_RECORDED_AUDIO || loop ? 1 : 0.97 + Math.random() * 0.06;
        gain.gain.value = loop ? 0 : placement.gain * (BOW_RECORDED_MIX[kind] ?? 1);
        pan.pan.value = placement.pan;
        source.connect(gain);
        gain.connect(pan);
        pan.connect(this.master);
        const voice = { source, gain, pan, ended: false };
        this.voices.push(voice);
        source.onended = () => this.finish(voice);
        source.start();
        this.played[kind]++;
        return voice;
    }
    /**
     * Starts, updates, or stops the continuous bow-draw layer for one player.
     *
     * @param id - Stable player identifier that owns the draw loop.
     * @param charge - Normalized draw charge from 0 to 1.
     * @param position - Optional source position in world-space meters.
     */
    draw(id, charge, position) {
        const existing = this.draws.get(id);
        if (charge <= 0 || charge >= BOW_AUDIO_MIX.drawSilentCharge) {
            if (existing) {
                this.stopVoice(existing);
                this.draws.delete(id);
            }
            return;
        }
        if (!existing && this.draws.size >= 7) {
            return;
        }
        const voice = existing ?? this.play('draw', position, true);
        if (!voice || !this.context) {
            return;
        }
        if (!existing) {
            this.draws.set(id, voice);
        }
        const timeSeconds = this.context.currentTime;
        const placement = this.spatial(position);
        const mix = BOW_AUDIO_MIX;
        const fadeProgress = Math.max(0, Math.min(1, (charge - mix.drawFadeStart) / (mix.drawSilentCharge - mix.drawFadeStart)));
        const fade = 1 - fadeProgress * fadeProgress * (3 - 2 * fadeProgress);
        voice.gain.gain.setTargetAtTime(placement.gain * (mix.drawBase + charge * mix.drawCharge) * fade, timeSeconds, mix.drawSmooth);
        voice.source.playbackRate.setTargetAtTime(0.65 + charge * 0.7, timeSeconds, 0.06);
        voice.pan.pan.setTargetAtTime(placement.pan, timeSeconds, 0.06);
    }
    /**
     * Plays the release layer and stops the owning draw loop when supplied.
     *
     * @param position - Optional source position in world-space meters.
     * @param id - Optional player identifier whose draw loop should stop.
     */
    release(position, id) {
        if (id !== undefined) {
            this.draw(id, 0);
        }
        this.play('release', position);
    }
    /** Plays the non-spatialized confirmation layer for a local headshot. */
    headshotConfirm() {
        const voice = this.play('head');
        if (voice) {
            voice.gain.gain.value = BOW_AUDIO_MIX.headConfirm;
            this.headshotConfirmations++;
        }
    }
    /**
     * Plays a spatialized impact layer at a world-space point.
     *
     * @param position - Impact position in world-space meters.
     * @param kind - Surface or body impact layer to play.
     */
    impact(position, kind) {
        const voice = this.play(kind, position);
        if (kind === 'head' && voice) {
            voice.gain.gain.value = Math.min(BOW_AUDIO_MIX.headWorldCap, voice.gain.gain.value * BOW_AUDIO_MIX.headWorldBoost);
        }
    }
    /**
     * Plays a whizz at the swept segment's closest point when it crosses the listener shell.
     *
     * @param from - Arrow segment start in world-space meters.
     * @param to - Arrow segment end in world-space meters.
     * @returns Whether an audible whizz voice was created.
     */
    whizz(from, to) {
        if (!shouldArrowWhizz(from, to, this.listener)) {
            return false;
        }
        const deltaX = to.x - from.x;
        const deltaY = to.y - from.y;
        const deltaZ = to.z - from.z;
        const progress = ((this.listener.x - from.x) * deltaX +
            (this.listener.y - from.y) * deltaY +
            (this.listener.z - from.z) * deltaZ) /
            (deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ);
        const passPoint = {
            x: from.x + deltaX * progress,
            y: from.y + deltaY * progress,
            z: from.z + deltaZ * progress,
        };
        const distance = Math.hypot(passPoint.x - this.listener.x, passPoint.y - this.listener.y, passPoint.z - this.listener.z);
        const voice = this.play('whizz', passPoint);
        if (voice && this.context) {
            voice.gain.gain.value *= Math.max(0, 1 - (distance - 0.3) / 2.1);
            const context = this.context;
            const firstPan = this.spatial(from).pan;
            const lastPan = this.spatial(to).pan;
            voice.pan.pan.setValueAtTime(firstPan, context.currentTime);
            voice.pan.pan.linearRampToValueAtTime(lastPan, context.currentTime + 0.25);
        }
        return Boolean(voice);
    }
    /** Fades every voice and suspends the graph after its short release envelope. */
    suspend() {
        this.paused = true;
        for (const voice of [...this.voices]) {
            this.stopVoice(voice);
        }
        this.draws.clear();
        const context = this.context;
        if (context) {
            setTimeout(() => {
                if (this.paused && this.context === context) {
                    void context.suspend().catch((error) => {
                        console.warn('Bow audio context could not be suspended.', { error });
                    });
                }
            }, 40);
        }
    }
    /** Stops every voice, clears cached buffers, and retires the current audio graph. */
    dispose() {
        this.paused = true;
        const context = this.context;
        const master = this.master;
        const compressor = this.compressor;
        const limiter = this.limiter;
        const voices = [...this.voices];
        if (context && master) {
            const now = context.currentTime;
            master.gain.cancelScheduledValues(now);
            master.gain.setTargetAtTime(0, now, 0.006);
            for (const voice of voices) {
                try {
                    voice.source.stop(now + 0.035);
                }
                catch (error) {
                    console.warn('Bow audio voice was already stopped during disposal.', { error });
                }
            }
        }
        this.voices = [];
        this.draws.clear();
        this.buffers.clear();
        this.recordings = {};
        this.recordingLoad = null;
        this.context = null;
        this.master = null;
        this.compressor = null;
        this.limiter = null;
        // Capture only the retiring graph: a subsequent resume creates a separate context.
        // The fallback also frees stopped/suspended contexts whose audio clock cannot advance.
        setTimeout(() => {
            for (const voice of voices) {
                this.finish(voice);
            }
            master?.disconnect();
            compressor?.disconnect();
            limiter?.disconnect();
            void context?.close().catch((error) => {
                console.warn('Retired bow audio context could not be closed.', { error });
            });
        }, 40);
    }
}
