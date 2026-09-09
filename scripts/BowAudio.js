export const BOW_AUDIO_VOICES = 16;
export const BOW_AUDIO_MIX = { drawBase: .04, drawCharge: .13, drawFadeStart: .8, drawSilentCharge: .97, drawSmooth: .065, headWorldBoost: 1.75, headWorldCap: 1.28, headConfirm: 1.04 };
export const BOW_RECORDED_AUDIO = { release: '/kite/assets/bow-audio/release-recorded.wav', whizz: '/kite/assets/bow-audio/whizz-recorded.wav' };
export const BOW_RECORDED_MIX = { release: .8, whizz: .9 };
const PROCEDURAL_SOUNDS = ['draw', 'body', 'head', 'cover'];
const recordingBytes = new Map();
function loadRecordingBytes(path) {
    let pending = recordingBytes.get(path);
    if (!pending) {
        pending = (async () => { const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000); try {
            const response = await fetch(path, { signal: controller.signal });
            if (!response.ok)
                throw new Error('Recording request failed');
            return await response.arrayBuffer();
        }
        finally {
            clearTimeout(timer);
        } })();
        recordingBytes.set(path, pending);
        void pending.catch(() => { if (recordingBytes.get(path) === pending)
            recordingBytes.delete(path); });
    }
    return pending;
}
const LENGTHS = { draw: .9, release: .34, flight: .24, whizz: .32, body: .3, head: .34, cover: .3 };
/** Shared offline/browser renderer. Seeded noise, body resonances and fiber transients. */
export function renderBowSound(kind, rate = 24000, seed = 7413) {
    const length = LENGTHS[kind], out = new Float32Array(Math.ceil(length * rate));
    let state = seed | 0, low = 0, slow = 0, phase = 0, peak = 0;
    const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 2147483648 - 1; };
    for (let i = 0; i < out.length; i++) {
        const t = i / rate, u = t / length, n = random();
        low += .14 * (n - low);
        slow += .025 * (n - slow);
        const high = n - low;
        let v = 0;
        if (kind === 'draw') {
            const pulse = .5 + .5 * Math.pow(Math.sin(t * 18 + Math.sin(t * 7)), 4), grain = high * (.025 + .07 * pulse) + low * .75;
            v = grain * (.5 + .5 * Math.sin(Math.PI * u) ** 2) + .04 * Math.sin(2 * Math.PI * (190 * t + 12 * t * t)) * pulse;
        }
        else if (kind === 'release') {
            phase += 2 * Math.PI * (118 + 49 * Math.exp(-t * 35)) / rate;
            const string = (Math.sin(phase) + .35 * Math.sin(phase * 2.03) + .18 * Math.sin(phase * 3.91)) * Math.exp(-t * 19);
            v = .47 * string + .8 * high * Math.exp(-t * 105) + 1.3 * low * Math.exp(-t * 37) + .28 * Math.sin(t * 2 * Math.PI * 71) * Math.exp(-t * 31);
        }
        else if (kind === 'flight' || kind === 'whizz') {
            const pass = Math.sin(Math.PI * u) ** (kind === 'whizz' ? 2.4 : 1.6), sweep = Math.sin(2 * Math.PI * (1600 * t - 1600 * t * t));
            v = (kind === 'whizz' ? .85 : .4) * pass * (high * .7 + low * 1.1 + sweep * .035);
        }
        else {
            const head = kind === 'head', cover = kind === 'cover';
            const crack = high * Math.exp(-t * (head ? 100 : cover ? 160 : 210)) * (head ? 1.65 : cover ? .9 : .3);
            const body = (slow * 4 + low * .9 + Math.sin(t * 2 * Math.PI * (head ? 105 : cover ? 210 : 74)) * .28) * Math.exp(-t * (head ? 24 : cover ? 40 : 20));
            const crunch = (n > 0 ? .8 : -.8) * low * (Math.exp(-Math.abs(t - .025) * 95) + .65 * Math.exp(-Math.abs(t - .055) * 110) + .3 * Math.exp(-Math.abs(t - .105) * 120)) * (head ? 1.4 : cover ? .55 : .45);
            v = crack + body + crunch;
        }
        const edge = Math.min(1, t / .0015, (length - t) / .012), loop = kind === 'draw' ? Math.sin(Math.PI * u) ** .25 : 1;
        out[i] = Math.tanh(v * 1.6) * edge * loop;
        peak = Math.max(peak, Math.abs(out[i]));
    }
    const target = kind === 'head' ? .94 : kind === 'body' ? .76 : kind === 'draw' ? .30 : kind === 'flight' ? .18 : kind === 'whizz' ? .43 : .76;
    for (let i = 0; i < out.length; i++)
        out[i] *= target / (peak || 1);
    return out;
}
/** Closest approach lies inside this swept segment; endpoint proximity alone is insufficient. */
export function shouldArrowWhizz(from, to, listener) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, l2 = dx * dx + dy * dy + dz * dz;
    if (l2 < 1e-8)
        return false;
    const t = ((listener.x - from.x) * dx + (listener.y - from.y) * dy + (listener.z - from.z) * dz) / l2;
    if (t < 0 || t > 1)
        return false;
    const distance = Math.hypot(from.x + dx * t - listener.x, from.y + dy * t - listener.y, from.z + dz * t - listener.z);
    return distance >= .3 && distance <= 2.4;
}
export class BowAudio {
    context = null;
    master = null;
    compressor = null;
    limiter = null;
    played = { draw: 0, release: 0, flight: 0, whizz: 0, body: 0, head: 0, cover: 0 };
    buffers = new Map();
    recordingLoad = null;
    recordings = {};
    voices = [];
    draws = new Map();
    listener = { x: 0, y: 0, z: 0 };
    right = { x: 1, y: 0, z: 0 };
    muted = false;
    volume = .6;
    headshotConfirmations = 0;
    paused = true;
    async resume() {
        if (!this.context) {
            const context = this.context = new AudioContext();
            this.master = context.createGain();
            this.master.gain.value = this.muted ? 0 : this.volume;
            this.compressor = context.createDynamicsCompressor();
            this.compressor.threshold.value = -8;
            this.compressor.knee.value = 10;
            this.compressor.ratio.value = 8;
            this.compressor.attack.value = .002;
            this.compressor.release.value = .12;
            this.limiter = context.createWaveShaper();
            const curve = new Float32Array(2049);
            for (let i = 0; i < curve.length; i++)
                curve[i] = .88 * Math.tanh((i / (curve.length - 1) * 2 - 1) * 1.6);
            this.limiter.curve = curve;
            this.limiter.oversample = '2x';
            this.master.connect(this.compressor);
            this.compressor.connect(this.limiter);
            this.limiter.connect(context.destination);
            for (const kind of PROCEDURAL_SOUNDS) {
                const data = renderBowSound(kind), buffer = context.createBuffer(1, data.length, 24000);
                buffer.copyToChannel(new Float32Array(data), 0);
                this.buffers.set(kind, buffer);
            }
        }
        this.paused = false;
        const context = this.context;
        await context.resume();
        if (this.context !== context)
            return;
        this.recordingLoad ??= this.loadRecordings(context);
        await this.recordingLoad;
    }
    async loadRecordings(context) {
        await Promise.all(Object.keys(BOW_RECORDED_AUDIO).map(async (kind) => {
            const path = BOW_RECORDED_AUDIO[kind];
            this.recordings[kind] = { path, status: 'loading' };
            try {
                // decodeAudioData may detach its input. Keep the cached bytes immutable.
                const bytes = await loadRecordingBytes(path), buffer = await context.decodeAudioData(bytes.slice(0));
                if (this.context !== context)
                    return;
                if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > 3)
                    throw new Error('Invalid recording length');
                this.buffers.set(kind, buffer);
                this.recordings[kind] = { path, status: 'decoded' };
            }
            catch {
                if (this.context === context)
                    this.recordings[kind] = { path, status: 'failed' };
            }
        }));
    }
    getState() { return { state: this.context?.state ?? 'uninitialized', paused: this.paused, muted: this.muted, volume: this.volume, headshotConfirmations: this.headshotConfirmations, voices: this.voices.length, drawLoops: this.draws.size, played: { ...this.played }, recordings: Object.fromEntries(Object.entries(this.recordings).map(([kind, value]) => [kind, { ...value }])), buffers: [...this.buffers].map(([kind, b]) => ({ kind, duration: b.duration, sampleRate: b.sampleRate, channels: b.numberOfChannels, source: kind in BOW_RECORDED_AUDIO ? 'recorded' : 'procedural', path: BOW_RECORDED_AUDIO[kind] ?? null })) }; }
    setListener(position, right) { this.listener = { ...position }; this.right = { ...right }; }
    setMuted(muted) { this.muted = muted; if (this.context && this.master)
        this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.context.currentTime, .012); }
    isMuted() { return this.muted; }
    setVolume(volume) { this.volume = Math.max(0, Math.min(.8, volume)); this.setMuted(this.muted); }
    spatial(position) {
        if (!position)
            return { gain: 1, pan: 0 };
        const dx = position.x - this.listener.x, dy = position.y - this.listener.y, dz = position.z - this.listener.z, d = Math.hypot(dx, dy, dz);
        return { gain: d > 55 ? 0 : 1 / Math.pow(1 + d * .085, 1.2), pan: Math.max(-1, Math.min(1, (dx * this.right.x + dy * this.right.y + dz * this.right.z) / (d || 1))) };
    }
    finish(voice) { if (voice.ended)
        return; voice.ended = true; voice.source.disconnect(); voice.gain.disconnect(); voice.pan.disconnect(); const index = this.voices.indexOf(voice); if (index >= 0)
        this.voices.splice(index, 1); for (const [id, v] of this.draws)
        if (v === voice)
            this.draws.delete(id); }
    stopVoice(voice) { if (voice.ended || !this.context)
        return; const now = this.context.currentTime; voice.gain.gain.cancelScheduledValues(now); voice.gain.gain.setTargetAtTime(0, now, .006); try {
        voice.source.stop(now + .035);
    }
    catch {
        this.finish(voice);
    } }
    play(kind, position, loop = false) {
        const c = this.context, buffer = this.buffers.get(kind);
        if (!c || !buffer || this.paused || c.state !== 'running')
            return;
        const placement = this.spatial(position);
        if (placement.gain < .025)
            return;
        // Stops/disconnects the oldest voice before creating another, so CPU use is bounded.
        if (this.voices.length >= BOW_AUDIO_VOICES) {
            const oldest = this.voices[0];
            try {
                oldest.source.stop();
            }
            catch { }
            this.finish(oldest);
        }
        const source = c.createBufferSource(), gain = c.createGain(), pan = c.createStereoPanner();
        source.buffer = buffer;
        source.loop = loop;
        source.playbackRate.value = kind in BOW_RECORDED_AUDIO ? 1 : loop ? 1 : .97 + Math.random() * .06;
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
    draw(id, charge, position) {
        const existing = this.draws.get(id);
        if (charge <= 0 || charge >= BOW_AUDIO_MIX.drawSilentCharge) {
            if (existing) {
                this.stopVoice(existing);
                this.draws.delete(id);
            }
            return;
        }
        if (!existing && this.draws.size >= 7)
            return;
        const v = existing ?? this.play('draw', position, true);
        if (!v || !this.context)
            return;
        if (!existing)
            this.draws.set(id, v);
        const t = this.context.currentTime, s = this.spatial(position), mix = BOW_AUDIO_MIX;
        const u = Math.max(0, Math.min(1, (charge - mix.drawFadeStart) / (mix.drawSilentCharge - mix.drawFadeStart))), fade = 1 - u * u * (3 - 2 * u);
        v.gain.gain.setTargetAtTime(s.gain * (mix.drawBase + charge * mix.drawCharge) * fade, t, mix.drawSmooth);
        v.source.playbackRate.setTargetAtTime(.65 + charge * .7, t, .06);
        v.pan.pan.setTargetAtTime(s.pan, t, .06);
    }
    release(position, id) { if (id !== undefined)
        this.draw(id, 0); this.play('release', position); }
    headshotConfirm() { const voice = this.play('head'); if (voice) {
        voice.gain.gain.value = BOW_AUDIO_MIX.headConfirm;
        this.headshotConfirmations++;
    } }
    impact(position, kind) { const voice = this.play(kind, position); if (kind === 'head' && voice)
        voice.gain.gain.value = Math.min(BOW_AUDIO_MIX.headWorldCap, voice.gain.gain.value * BOW_AUDIO_MIX.headWorldBoost); }
    whizz(from, to) {
        if (!shouldArrowWhizz(from, to, this.listener))
            return false;
        const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, t = ((this.listener.x - from.x) * dx + (this.listener.y - from.y) * dy + (this.listener.z - from.z) * dz) / (dx * dx + dy * dy + dz * dz);
        const pass = { x: from.x + dx * t, y: from.y + dy * t, z: from.z + dz * t }, distance = Math.hypot(pass.x - this.listener.x, pass.y - this.listener.y, pass.z - this.listener.z);
        const voice = this.play('whizz', pass);
        if (voice && this.context) {
            voice.gain.gain.value *= Math.max(0, 1 - (distance - .3) / 2.1);
            const c = this.context, first = this.spatial(from).pan, last = this.spatial(to).pan;
            voice.pan.pan.setValueAtTime(first, c.currentTime);
            voice.pan.pan.linearRampToValueAtTime(last, c.currentTime + .25);
        }
        return !!voice;
    }
    suspend() { this.paused = true; for (const voice of [...this.voices])
        this.stopVoice(voice); this.draws.clear(); const context = this.context; if (context)
        setTimeout(() => { if (this.paused && this.context === context)
            void context.suspend().catch(() => { }); }, 40); }
    dispose() {
        this.paused = true;
        const context = this.context, master = this.master, compressor = this.compressor, limiter = this.limiter, voices = [...this.voices];
        if (context && master) {
            const now = context.currentTime;
            master.gain.cancelScheduledValues(now);
            master.gain.setTargetAtTime(0, now, .006);
            for (const voice of voices)
                try {
                    voice.source.stop(now + .035);
                }
                catch { }
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
        setTimeout(() => { for (const voice of voices)
            this.finish(voice); master?.disconnect(); compressor?.disconnect(); limiter?.disconnect(); void context?.close().catch(() => { }); }, 40);
    }
}
