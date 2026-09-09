/**
 * Records bounded client performance/network telemetry without controlling gameplay or rendering.
 * Thresholds and capacities below define the telemetry schema and sampling policy.
 */
/* eslint-disable no-magic-numbers -- These values are telemetry thresholds and schema constants. */
const FRAME_CAPACITY = 512;
const TELEMETRY_SECONDS = 300;
const round = (value) => Number(value.toFixed(2));
const epochIso = (performanceTime) => new Date(performance.timeOrigin + performanceTime).toISOString();
/**
 * Counts the UTF-8 bytes needed to transmit a JavaScript string.
 *
 * @param value - Text whose encoded byte length is required.
 * @returns Number of bytes in the UTF-8 encoding.
 */
export function utf8ByteLength(value) {
    let bytes = 0;
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code < 0x80) {
            bytes++;
        }
        else if (code < 0x800) {
            bytes += 2;
        }
        else if (code >= 0xd800 &&
            code <= 0xdbff &&
            i + 1 < value.length &&
            value.charCodeAt(i + 1) >= 0xdc00 &&
            value.charCodeAt(i + 1) <= 0xdfff) {
            bytes += 4;
            i++;
        }
        else {
            bytes += 3;
        }
    }
    return bytes;
}
/**
 * Summarizes frame durations after sorting the supplied sample array in place.
 *
 * @param values - Frame durations in milliseconds.
 * @returns Sample count and the p50, p95, and maximum duration in milliseconds.
 */
export function summarizeFrameTimes(values) {
    if (!values.length) {
        return { count: 0, p50: 0, p95: 0, max: 0 };
    }
    // The style guide explicitly permits conventional `(a, b)` numeric sort callbacks.
    // eslint-disable-next-line id-length
    values.sort((a, b) => a - b);
    const percentile = (fraction) => values[Math.min(values.length - 1, Math.floor(values.length * fraction))];
    return {
        count: values.length,
        p50: round(percentile(0.5)),
        p95: round(percentile(0.95)),
        max: round(values[values.length - 1]),
    };
}
/** Stores a fixed number of recent values without allocating on every insertion. */
export class TelemetryRing {
    capacity;
    values;
    next = 0;
    count = 0;
    /**
     * Creates a ring with a fixed positive capacity.
     *
     * @param capacity - Maximum number of retained values.
     */
    constructor(capacity) {
        this.capacity = capacity;
        if (!Number.isInteger(capacity) || capacity < 1) {
            throw new Error('Telemetry ring capacity must be positive');
        }
        this.values = new Array(capacity);
    }
    /**
     * Appends a value, overwriting the oldest entry after capacity is reached.
     *
     * @param value - Value to retain.
     */
    push(value) {
        this.values[this.next] = value;
        this.next = (this.next + 1) % this.capacity;
        this.count = Math.min(this.count + 1, this.capacity);
    }
    /**
     * Returns stored values in oldest-to-newest order.
     *
     * @returns A new ordered array of retained values.
     */
    toArray() {
        const result = [];
        const start = (this.next - this.count + this.capacity) % this.capacity;
        for (let i = 0; i < this.count; i++) {
            const value = this.values[(start + i) % this.capacity];
            if (value !== undefined) {
                result.push(value);
            }
        }
        return result;
    }
    /**
     * Returns the number of currently retained values.
     *
     * @returns Current retained value count.
     */
    get length() {
        return this.count;
    }
}
/** Five-minute client recorder. Per-frame work writes only into fixed typed arrays. */
export class BowPerformance {
    viewer = null;
    ring = new TelemetryRing(TELEMETRY_SECONDS);
    frameTimes = new Float32Array(FRAME_CAPACITY);
    cpuTimes = new Float32Array(FRAME_CAPACITY);
    frameCount = 0;
    activeFrames = 0;
    rendered = 0;
    previousRendered = 0;
    renderStart = 0;
    renderMs = 0;
    calls = 0;
    triangles = 0;
    gpuMs = null;
    query = null;
    pending = [];
    frames = 0;
    gl = null;
    extension = null;
    inbound = Object.create(null);
    outbound = Object.create(null);
    rAFGaps = [];
    rttSamples = [];
    reconnects = [];
    socketCloses = [];
    canvasChanges = [];
    longTasks = [];
    remoteStateAt = new Map();
    lastCanvas = null;
    sampleStarted = performance.now();
    interval = null;
    observer = null;
    overlay = null;
    overlayVisible = false;
    /** Installs keyboard and long-task observers; call dispose to remove them. */
    constructor() {
        if (typeof window !== 'undefined') {
            window.addEventListener('keydown', this.onKeyDown, true);
        }
        if (typeof PerformanceObserver !== 'undefined' &&
            PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
            this.observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    this.longTasks.push({ at: epochIso(entry.startTime), durationMs: round(entry.duration) });
                }
            });
            this.observer.observe({ type: 'longtask', buffered: true });
        }
    }
    /**
     * Attaches render hooks and begins one-second telemetry sampling for a viewer.
     *
     * @param viewer - Threepipe viewer whose render and canvas metrics will be observed.
     */
    attachViewer(viewer) {
        if (this.viewer === viewer) {
            return;
        }
        this.detachViewer();
        this.viewer = viewer;
        const renderingContext = viewer.renderManager.renderer.getContext();
        this.gl = renderingContext;
        this.extension = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
        viewer.addEventListener('preRender', this.beforeRender);
        viewer.addEventListener('postRender', this.afterRender);
        this.captureCanvas(performance.now());
        this.sampleStarted = performance.now();
        this.interval = window.setInterval(() => this.flush(performance.now()), 1000);
    }
    /** Detaches render hooks and releases outstanding GPU timing queries. */
    detachViewer() {
        if (this.viewer) {
            this.viewer.removeEventListener('preRender', this.beforeRender);
            this.viewer.removeEventListener('postRender', this.afterRender);
        }
        if (this.interval !== null) {
            window.clearInterval(this.interval);
        }
        this.interval = null;
        if (this.query && this.gl && this.extension) {
            this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
            this.gl.deleteQuery(this.query);
        }
        for (const query of this.pending) {
            try {
                this.gl?.deleteQuery(query);
            }
            catch (error) {
                console.warn('A pending bow telemetry GPU query could not be deleted.', { error });
            }
        }
        this.query = null;
        this.pending = [];
        this.viewer = null;
        this.gl = null;
        this.extension = null;
    }
    beforeRender = () => {
        this.renderStart = performance.now();
        if (!this.extension || !this.gl) {
            return;
        }
        const renderingContext = this.gl;
        const extension = this.extension;
        while (this.pending.length &&
            renderingContext.getQueryParameter(this.pending[0], renderingContext.QUERY_RESULT_AVAILABLE)) {
            const query = this.pending.shift();
            if (!query) {
                continue;
            }
            if (!renderingContext.getParameter(extension.GPU_DISJOINT_EXT)) {
                this.gpuMs = renderingContext.getQueryParameter(query, renderingContext.QUERY_RESULT) / 1e6;
            }
            renderingContext.deleteQuery(query);
        }
        if (++this.frames % 12 === 0 &&
            this.pending.length < 3 &&
            !renderingContext.getQuery(extension.TIME_ELAPSED_EXT, renderingContext.CURRENT_QUERY)) {
            this.query = renderingContext.createQuery();
            if (this.query) {
                renderingContext.beginQuery(extension.TIME_ELAPSED_EXT, this.query);
            }
        }
    };
    afterRender = () => {
        this.rendered++;
        this.renderMs = performance.now() - this.renderStart;
        if (!this.viewer) {
            return;
        }
        const renderer = this.viewer.renderManager.renderer;
        this.calls = renderer.info.render.calls;
        this.triangles = renderer.info.render.triangles;
        if (this.query && this.gl && this.extension) {
            this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
            this.pending.push(this.query);
            this.query = null;
        }
    };
    /**
     * Records one animation frame and detects visible requestAnimationFrame gaps.
     *
     * @param at - Frame timestamp on the Performance timeline in milliseconds.
     * @param frameMs - Time since the previous animation frame in milliseconds.
     * @param cpuMs - Runtime CPU duration for this frame in milliseconds.
     * @param active - Whether gameplay was active during this frame.
     */
    record(at, frameMs, cpuMs, active) {
        const index = this.frameCount % FRAME_CAPACITY;
        this.frameTimes[index] = Math.max(0, frameMs);
        this.cpuTimes[index] = Math.max(0, cpuMs);
        this.frameCount++;
        if (active) {
            this.activeFrames++;
        }
        if (frameMs > 100) {
            this.rAFGaps.push({
                at: epochIso(at),
                gapMs: round(frameMs),
                visible: document.visibilityState === 'visible',
            });
        }
        this.captureCanvas(at);
    }
    /**
     * Records the count and encoded byte size of one protocol message.
     *
     * @param direction - Whether the message entered or left the client.
     * @param type - Protocol discriminator for aggregation.
     * @param bytes - Encoded message length in bytes.
     */
    recordNetwork(direction, type, bytes) {
        const counters = direction === 'inbound' ? this.inbound : this.outbound;
        counters[type] ??= { count: 0, bytes: 0 };
        const entry = counters[type];
        entry.count++;
        entry.bytes += bytes;
    }
    /**
     * Records one reconnect attempt and its scheduled delay.
     *
     * @param attempt - One-based reconnect attempt number.
     * @param delayMs - Scheduled retry delay in milliseconds.
     */
    recordReconnect(attempt, delayMs) {
        this.reconnects.push({ at: new Date().toISOString(), attempt, delayMs: round(delayMs) });
    }
    /**
     * Records one WebSocket close code and clean-close state.
     *
     * @param code - WebSocket close status code.
     * @param wasClean - Whether the browser observed a clean close handshake.
     */
    recordSocketClose(code, wasClean) {
        this.socketCloses.push({ at: new Date().toISOString(), code, wasClean });
    }
    /**
     * Records a round-trip time sample in milliseconds.
     *
     * @param rttMs - Measured round-trip time in milliseconds.
     */
    recordRtt(rttMs) {
        this.rttSamples.push(round(rttMs));
    }
    /**
     * Reconciles the tracked remote-player set with the latest room snapshot.
     *
     * @param playerIds - Complete set of current remote player identifiers.
     */
    setRemotePlayers(playerIds) {
        const wanted = new Set(playerIds);
        for (const id of this.remoteStateAt.keys()) {
            if (!wanted.has(id)) {
                this.remoteStateAt.delete(id);
            }
        }
        for (const id of wanted) {
            if (!this.remoteStateAt.has(id)) {
                this.remoteStateAt.set(id, null);
            }
        }
    }
    /**
     * Records the arrival time for one remote player's state update.
     *
     * @param playerId - Remote player identifier.
     */
    recordRemoteState(playerId) {
        this.remoteStateAt.set(playerId, performance.now());
    }
    /**
     * Removes a departed remote player from staleness tracking.
     *
     * @param playerId - Departing remote player identifier.
     */
    removeRemotePlayer(playerId) {
        this.remoteStateAt.delete(playerId);
    }
    canvasMetrics() {
        if (!this.viewer) {
            return null;
        }
        const canvas = this.viewer.canvas;
        const renderer = this.viewer.renderManager.renderer;
        return {
            width: canvas.width,
            height: canvas.height,
            clientWidth: canvas.clientWidth,
            clientHeight: canvas.clientHeight,
            devicePixelRatio,
            rendererPixelRatio: renderer.getPixelRatio(),
            renderScale: this.viewer.renderManager.renderScale,
        };
    }
    captureCanvas(at) {
        if (!this.viewer) {
            return;
        }
        const canvas = this.viewer.canvas;
        const renderer = this.viewer.renderManager.renderer;
        const last = this.lastCanvas;
        const width = canvas.width;
        const height = canvas.height;
        const clientWidth = canvas.clientWidth;
        const clientHeight = canvas.clientHeight;
        const currentDevicePixelRatio = devicePixelRatio;
        const rendererPixelRatio = renderer.getPixelRatio();
        const renderScale = this.viewer.renderManager.renderScale;
        if (last &&
            last.width === width &&
            last.height === height &&
            last.clientWidth === clientWidth &&
            last.clientHeight === clientHeight &&
            last.devicePixelRatio === currentDevicePixelRatio &&
            last.rendererPixelRatio === rendererPixelRatio &&
            last.renderScale === renderScale) {
            return;
        }
        const next = {
            width,
            height,
            clientWidth,
            clientHeight,
            devicePixelRatio: currentDevicePixelRatio,
            rendererPixelRatio,
            renderScale,
        };
        this.canvasChanges.push({ at: epochIso(at), from: last, to: next });
        this.lastCanvas = next;
    }
    totals(byType) {
        let count = 0;
        let bytes = 0;
        for (const value of Object.values(byType)) {
            count += value.count;
            bytes += value.bytes;
        }
        return { count, bytes, byType };
    }
    frameValues(source) {
        const count = Math.min(this.frameCount, FRAME_CAPACITY);
        const values = [];
        const start = this.frameCount > FRAME_CAPACITY ? this.frameCount % FRAME_CAPACITY : 0;
        for (let i = 0; i < count; i++) {
            values.push(source[(start + i) % FRAME_CAPACITY]);
        }
        return values;
    }
    flush(now, force = false) {
        const windowMs = now - this.sampleStarted;
        if (!force && windowMs < 900) {
            return;
        }
        const stalePlayers = [...this.remoteStateAt].map(([playerId, recordedAt]) => ({
            playerId,
            ms: recordedAt === null ? null : round(Math.max(0, now - recordedAt)),
        }));
        const staleValues = stalePlayers.flatMap((player) => (player.ms === null ? [] : [player.ms]));
        const sample = {
            at: epochIso(now),
            windowMs: round(windowMs),
            visible: document.visibilityState === 'visible',
            activeFrames: this.activeFrames,
            frameTimeMs: summarizeFrameTimes(this.frameValues(this.frameTimes)),
            gameCpuMs: summarizeFrameTimes(this.frameValues(this.cpuTimes)),
            renders: this.rendered - this.previousRendered,
            rAFGaps: this.rAFGaps,
            rttMs: this.rttSamples,
            network: { inbound: this.totals(this.inbound), outbound: this.totals(this.outbound) },
            reconnects: this.reconnects,
            socketCloses: this.socketCloses,
            canvas: this.canvasMetrics(),
            canvasChanges: this.canvasChanges,
            longTasks: this.longTasks,
            remoteStateStaleness: {
                players: stalePlayers,
                maxMs: staleValues.length ? Math.max(...staleValues) : null,
            },
        };
        this.ring.push(sample);
        this.previousRendered = this.rendered;
        this.frameCount = 0;
        this.activeFrames = 0;
        this.inbound = Object.create(null);
        this.outbound = Object.create(null);
        this.rAFGaps = [];
        this.rttSamples = [];
        this.reconnects = [];
        this.socketCloses = [];
        this.canvasChanges = [];
        this.longTasks = [];
        this.sampleStarted = now;
        this.refreshOverlay(sample);
    }
    ensureOverlay() {
        if (this.overlay) {
            return this.overlay;
        }
        const overlay = document.createElement('pre');
        overlay.id = 'kite3d-bow-debug';
        overlay.style.cssText =
            'position:fixed;z-index:20000;left:10px;bottom:10px;margin:0;padding:9px 11px;background:#07100ddd;border:1px solid #82927b;color:#dff0d7;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;pointer-events:none;white-space:pre;display:none';
        document.body.append(overlay);
        this.overlay = overlay;
        return overlay;
    }
    refreshOverlay(sample) {
        if (!this.overlayVisible) {
            return;
        }
        const overlay = this.ensureOverlay();
        const frame = sample.frameTimeMs;
        const networkInbound = sample.network.inbound;
        const networkOutbound = sample.network.outbound;
        const staleMs = sample.remoteStateStaleness.maxMs;
        const rttMs = sample.rttMs.at(-1);
        const value = `BOW DEBUG · F8 hide · F9 export\nframe ${frame.p50}/${frame.p95}/${frame.max} ms · gaps ${sample.rAFGaps.length} · long ${sample.longTasks.length}\nRTT ${rttMs ?? '—'} ms · remote stale ${staleMs ?? '—'} ms\nWS ↓ ${networkInbound.count}/${networkInbound.bytes} B · ↑ ${networkOutbound.count}/${networkOutbound.bytes} B\ncanvas ${sample.canvas?.width ?? 0}×${sample.canvas?.height ?? 0} · DPR ${sample.canvas?.devicePixelRatio ?? 0} · scale ${sample.canvas?.renderScale ?? 0}`;
        if (overlay.textContent !== value) {
            overlay.textContent = value;
        }
    }
    onKeyDown = (event) => {
        if (event.code === 'F8') {
            event.preventDefault();
            this.overlayVisible = !this.overlayVisible;
            const overlay = this.ensureOverlay();
            overlay.style.display = this.overlayVisible ? 'block' : 'none';
            const latest = this.ring.toArray().at(-1);
            if (latest) {
                this.refreshOverlay(latest);
            }
        }
        else if (event.code === 'F9') {
            event.preventDefault();
            this.download();
        }
    };
    /**
     * Returns a portable five-minute telemetry export, flushing the current window first.
     *
     * @returns Versioned JSON-compatible telemetry export.
     */
    exportData() {
        this.flush(performance.now(), true);
        return {
            schemaVersion: 1,
            exportedAt: new Date().toISOString(),
            timeOrigin: new Date(performance.timeOrigin).toISOString(),
            userAgent: navigator.userAgent,
            samples: this.ring.toArray(),
        };
    }
    /** Downloads the current telemetry export as a timestamped JSON file. */
    download() {
        const blob = new Blob([JSON.stringify(this.exportData(), null, 2)], {
            type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `bowgame-telemetry-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }
    /**
     * Returns the latest compact diagnostics used by the runtime and E2E probes.
     *
     * @returns Latest render, GPU, canvas, and sample-count diagnostics.
     */
    summary() {
        const sample = this.ring.toArray().at(-1);
        const canvas = this.canvasMetrics();
        return {
            visible: document.visibilityState === 'visible',
            allVisible: sample?.frameTimeMs ?? null,
            activeCombat: { frames: sample?.activeFrames ?? 0 },
            lastRenderCpuMs: round(this.renderMs),
            lastGpuMs: this.gpuMs === null ? null : round(this.gpuMs),
            drawCalls: this.calls,
            triangles: this.triangles,
            canvas,
            gpuTimerSupported: Boolean(this.extension),
            hardwareConcurrency: navigator.hardwareConcurrency,
            rendererGeometries: this.viewer?.renderManager.renderer.info.memory.geometries ?? 0,
            telemetrySamples: this.ring.length,
        };
    }
    /** Removes every observer, timer, render hook, keyboard handler, and overlay node. */
    dispose() {
        this.detachViewer();
        window.removeEventListener('keydown', this.onKeyDown, true);
        this.observer?.disconnect();
        this.observer = null;
        this.overlay?.remove();
        this.overlay = null;
    }
}
