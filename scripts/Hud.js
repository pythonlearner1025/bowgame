// Health below thirty-five percent changes to rust as an urgent survival cue.
const LOW_HEALTH_THRESHOLD = 35;
/** Builds the active-play HUD and mutates DOM only when a rendered value changes. */
export class Hud {
    viewer;
    state;
    getConfig;
    entry;
    overlay = null;
    elements = {};
    values = Object.create(null);
    /**
     * Connects HUD presentation to the viewer, shared state, match settings, and entry modal.
     *
     * @param viewer - Viewer whose canvas bounds position the fixed overlay.
     * @param state - Mutable simulation and presentation state.
     * @param getConfig - Returns required solo match settings.
     * @param entry - Name-entry and modal presentation owner.
     */
    constructor(viewer, state, getConfig, entry) {
        this.viewer = viewer;
        this.state = state;
        this.getConfig = getConfig;
        this.entry = entry;
    }
    /** Creates every HUD node, appends the overlay, and performs the initial write. */
    start() {
        this.values = Object.create(null);
        const overlay = document.createElement('div');
        overlay.id = 'kite3d-bow-game-hud';
        overlay.style.cssText =
            'position:fixed;z-index:10000;pointer-events:none;color:#ecece3;font:13px system-ui,sans-serif;overflow:hidden;';
        this.elements.overlay = overlay;
        this.overlay = overlay;
        this.addStyles(overlay);
        this.makeStandings(overlay);
        const hit = this.createElement('hit', overlay);
        hit.setAttribute('aria-hidden', 'true');
        this.makeHealth(overlay);
        this.createElement('damage', overlay, 'position:absolute;inset:0;box-shadow:inset 0 0 100px 30px #a02b22;opacity:0;');
        this.entry.start(overlay);
        (this.viewer.container ?? document.body).append(overlay);
        this.update();
    }
    createElement(id, parent, style = '', text = '') {
        const element = document.createElement('div');
        element.dataset.hud = id;
        element.style.cssText = style;
        element.textContent = text;
        parent.append(element);
        this.elements[id] = element;
        this.values[`text:${id}`] = text;
        return element;
    }
    addStyles(overlay) {
        const style = document.createElement('style');
        style.textContent = `
#kite3d-bow-game-hud{--edge:clamp(14px,2.2vw,28px);font-family:'Arial Narrow','Impact',sans-serif!important;color:#ddd6c5!important;text-shadow:0 1px 2px #000}
#kite3d-bow-game-hud .plate{background-color:rgba(24,25,22,.88);background-image:repeating-linear-gradient(173deg,transparent 0 13px,#d0bb8a0b 14px,transparent 15px 28px),repeating-linear-gradient(91deg,transparent 0 47px,#0003 48px,transparent 49px 77px);border:1px solid #77705b50;box-shadow:0 2px 8px #0005}
#kite3d-bow-game-hud .standings{position:absolute;right:var(--edge);top:var(--edge);width:clamp(180px,19vw,260px);max-width:calc(100% - 28px);border-top:2px solid #9b4b2b}
#kite3d-bow-game-hud [data-hud=score]{padding:10px 12px 8px;font-size:13px;letter-spacing:1.5px;border-bottom:1px solid #b4a68430}
#kite3d-bow-game-hud [data-hud=board]{padding:4px 0}
#kite3d-bow-game-hud .score-row{display:flex;align-items:center;gap:12px;padding:5px 12px;font-size:14px;letter-spacing:1px}
#kite3d-bow-game-hud .score-row.local{background:#d2c6a012;border-left:2px solid #a99d76;padding-left:10px;color:#eee6d2}
#kite3d-bow-game-hud .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
#kite3d-bow-game-hud .tally{font-variant-numeric:tabular-nums}
#kite3d-bow-game-hud [data-hud=feed]{display:grid;gap:4px;margin-top:9px}
#kite3d-bow-game-hud .death-row{display:flex;gap:10px;padding:7px 10px;font-size:12px;letter-spacing:.5px;border-left:2px solid #76462f}
#kite3d-bow-game-hud .death-row .victim{color:#cf9273;text-align:right}
#kite3d-bow-game-hud [data-hud=health]{position:absolute;left:var(--edge);bottom:var(--edge);width:clamp(200px,26vw,360px);max-width:calc(100% - 28px);height:36px;display:flex;align-items:center;padding:0 12px;box-sizing:border-box;clip-path:polygon(0 3%,29% 0,30% 3%,98% 0,100% 90%,73% 100%,72% 96%,0 100%)}
#kite3d-bow-game-hud .health-track{width:100%;height:18px;background:#0d100eb0;border:1px solid #8e8b6b33}
#kite3d-bow-game-hud [data-hud=healthbar]{height:100%;background-color:var(--health-color,#788452);background-image:repeating-linear-gradient(176deg,transparent 0 4px,#242b253d 5px,transparent 6px 9px),repeating-linear-gradient(90deg,transparent 0 39px,#171d2440 40px);transition:width .18s ease-out}
#kite3d-bow-game-hud [data-hud=hit]{position:absolute;left:50%;top:50%;width:18px;height:18px;transform:translate(-50%,-50%) rotate(45deg);background:linear-gradient(#e3cf9e,#e3cf9e) center/100% 2px no-repeat,linear-gradient(#e3cf9e,#e3cf9e) center/2px 100% no-repeat}
@media(max-height:500px){#kite3d-bow-game-hud .score-row{padding-top:2px;padding-bottom:2px}#kite3d-bow-game-hud .death-row{padding-top:3px;padding-bottom:3px}}
@media(prefers-reduced-motion:reduce){#kite3d-bow-game-hud [data-hud=healthbar]{transition:none}}
`;
        overlay.append(style);
    }
    makeStandings(overlay) {
        const standings = this.createElement('standings', overlay);
        standings.className = 'standings';
        const boardPlate = document.createElement('div');
        boardPlate.className = 'plate';
        standings.append(boardPlate);
        boardPlate.append(this.createElement('score', boardPlate), this.createElement('board', boardPlate));
        const feed = this.createElement('feed', standings);
        feed.setAttribute('role', 'log');
        feed.setAttribute('aria-label', 'Live death feed');
    }
    makeHealth(overlay) {
        const health = this.createElement('health', overlay);
        health.className = 'plate';
        health.setAttribute('role', 'progressbar');
        health.setAttribute('aria-label', 'Health');
        health.setAttribute('aria-valuemin', '0');
        health.setAttribute('aria-valuemax', '100');
        const track = document.createElement('div');
        track.className = 'health-track';
        health.append(track);
        track.append(this.createElement('healthbar', track));
    }
    /** Updates all HUD values while skipping unchanged DOM text, style, and attributes. */
    update() {
        if (!this.overlay) {
            return;
        }
        const rect = this.viewer.canvas.getBoundingClientRect();
        this.setStyle('overlay', 'left', `${rect.left}px`);
        this.setStyle('overlay', 'top', `${rect.top}px`);
        this.setStyle('overlay', 'width', `${rect.width}px`);
        this.setStyle('overlay', 'height', `${rect.height}px`);
        const isOnline = this.entry.isOnline();
        const limit = isOnline
            ? (this.state.networkSnapshot?.scoreLimit ?? 20)
            : this.getConfig().scoreLimit;
        this.setText('score', `${String(this.state.kills).padStart(2, '0')} / ${limit} ELIMINATIONS`);
        this.updateLeaderboard(isOnline);
        const health = Math.max(0, Math.min(100, this.state.hp));
        this.setAttribute('health', 'aria-valuenow', String(health));
        this.setStyle('healthbar', 'width', `${health}%`);
        this.setStyle('healthbar', '--health-color', health < LOW_HEALTH_THRESHOLD ? '#a14f37' : '#788452');
        this.setStyle('hit', 'opacity', String(this.state.hit));
        this.setStyle('damage', 'opacity', String(this.state.flash * 0.6));
        this.updateDeathFeed();
        this.entry.update();
    }
    getLeaderboardEntries(isOnline) {
        if (isOnline) {
            return (this.state.networkSnapshot?.players ?? []).map((player) => ({
                name: player.local ? 'YOU' : player.name,
                kills: this.state.networkSnapshot?.scores[player.id] ?? 0,
                isLocal: player.local,
            }));
        }
        return [
            { name: 'YOU', kills: this.state.kills, isLocal: true },
            ...this.state.bots.map((bot) => ({ name: bot.name, kills: bot.kills, isLocal: false })),
        ];
    }
    updateLeaderboard(isOnline) {
        const entries = this.getLeaderboardEntries(isOnline);
        entries.sort((left, right) => right.kills - left.kills ||
            Number(right.isLocal) - Number(left.isLocal) ||
            left.name.localeCompare(right.name));
        const key = JSON.stringify(entries);
        if (this.values['content:board'] === key) {
            return;
        }
        this.values['content:board'] = key;
        this.elements.board.replaceChildren();
        for (const entry of entries) {
            const row = document.createElement('div');
            row.className = `score-row${entry.isLocal ? ' local' : ''}`;
            const name = document.createElement('span');
            name.className = 'name';
            name.textContent = entry.name;
            const tally = document.createElement('span');
            tally.className = 'tally';
            tally.textContent = String(entry.kills).padStart(2, '0');
            row.append(name, tally);
            this.elements.board.append(row);
        }
    }
    updateDeathFeed() {
        const activeEntries = this.state.deathFeed.filter((entry) => entry.expiresAtSeconds > this.state.elapsed);
        if (activeEntries.length !== this.state.deathFeed.length) {
            this.state.deathFeed = activeEntries;
        }
        const key = JSON.stringify(this.state.deathFeed);
        if (this.values['content:feed'] === key) {
            return;
        }
        this.values['content:feed'] = key;
        this.elements.feed.replaceChildren();
        for (const entry of this.state.deathFeed) {
            const row = document.createElement('div');
            row.className = 'death-row plate';
            const killer = document.createElement('span');
            killer.className = 'name';
            killer.textContent = entry.killer;
            const arrow = document.createElement('span');
            arrow.textContent = '→';
            const victim = document.createElement('span');
            victim.className = 'name victim';
            victim.textContent = entry.victim;
            row.append(killer, arrow, victim);
            this.elements.feed.append(row);
        }
    }
    setText(id, value) {
        const key = `text:${id}`;
        if (this.values[key] === value) {
            return;
        }
        this.values[key] = value;
        this.elements[id].textContent = value;
    }
    setStyle(id, property, value) {
        const key = `style:${id}:${property}`;
        if (this.values[key] === value) {
            return;
        }
        this.values[key] = value;
        this.elements[id].style.setProperty(property, value);
    }
    setAttribute(id, attribute, value) {
        const key = `attribute:${id}:${attribute}`;
        if (this.values[key] === value) {
            return;
        }
        this.values[key] = value;
        this.elements[id].setAttribute(attribute, value);
    }
    /** Removes the HUD overlay and clears all detached element and cached-value references. */
    stop() {
        this.overlay?.remove();
        this.overlay = null;
        this.elements = {};
        this.values = Object.create(null);
        this.entry.stop();
    }
}
