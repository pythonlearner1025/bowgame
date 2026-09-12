/**
 * Owns name entry, saved-name controls, enter flow, and solo or online modal presentation.
 * It does not render active-play health, scores, death notices, or simulation state.
 */
import type { ThreeViewer } from 'threepipe';
import { BowAudio } from './BowAudio.js';
import {
  clearPlayerName,
  randomPlayerName,
  readPlayerName,
  sanitizePlayerNameInput,
  savePlayerName,
} from './BowPlayerName.js';
import type { BowSettings } from './BowSettings.js';
import type { BowGameConfig, GameState } from './GameState.js';
import { BOW_ROOM_CAP } from './BowProtocol.js';
import { SettingsPanel } from './SettingsPanel.js';

/** Settings dependency plus network and match actions used by the entry overlay. */
export interface EntryOverlayCallbacks {
  settings: BowSettings;
  isOnline: () => boolean;
  isConnected: () => boolean;
  getNetworkName: () => string | null;
  setNetworkName: (name: string) => void;
  restart: () => void;
}

/** Creates and updates the modal layer shown before entry, while paused, or between rounds. */
export class EntryOverlay {
  private elements: Record<string, HTMLElement> = {};
  private values: Record<string, string | boolean> = Object.create(null);
  private settingsPanel: SettingsPanel;

  /**
   * Connects modal UI to the viewer, shared state, match settings, and network actions.
   *
   * @param viewer - Viewer whose canvas receives pointer lock.
   * @param state - Mutable simulation and presentation state.
   * @param getConfig - Returns required solo match settings.
   * @param callbacks - Network name, connection, and restart actions.
   */
  constructor(
    private viewer: ThreeViewer,
    private state: GameState,
    private getConfig: () => BowGameConfig,
    private callbacks: EntryOverlayCallbacks,
  ) {
    this.settingsPanel = new SettingsPanel(callbacks.settings);
  }

  /**
   * Builds the centered modal, name field, and entry controls inside the HUD overlay.
   * @param overlay - Parent HUD element that contains the modal.
   */
  start(overlay: HTMLElement): void {
    this.values = Object.create(null);
    const modal = this.createElement(
      'modal',
      overlay,
      'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(440px,85%);background:rgba(24,25,22,.96);border:1px solid #6c5d45;border-top:2px solid #9b4b2b;padding:32px;text-align:center;pointer-events:auto;box-shadow:0 20px 70px #0008;',
    );
    const title = this.createElement(
      'title',
      modal,
      'font-size:27px;font-weight:800;letter-spacing:5px;margin-bottom:12px',
      'BOWGAME',
    );
    title.removeAttribute('data-hud');
    const description = this.createElement(
      'description',
      modal,
      'color:#bfc6b4;line-height:1.8;font-size:13px;white-space:pre-line;margin-bottom:24px',
    );
    description.removeAttribute('data-hud');
    this.makeNameField(modal);
    this.makeButtons(modal);
    this.settingsPanel.start(modal);
    this.update();
  }

  private createElement(id: string, parent: HTMLElement, style = '', text = ''): HTMLDivElement {
    const element = document.createElement('div');
    element.dataset.hud = id;
    element.style.cssText = style;
    element.textContent = text;
    parent.append(element);
    this.elements[id] = element;
    this.values[`text:${id}`] = text;

    return element;
  }

  private makeNameField(modal: HTMLElement): void {
    const storedName = readPlayerName();
    this.state.playerName = storedName ?? this.callbacks.getNetworkName() ?? randomPlayerName();
    const nameField = this.createElement('nameField', modal, 'position:relative;margin:0 0 18px');
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'Archer name');
    input.name = 'username';
    input.setAttribute('autocomplete', 'nickname');
    input.maxLength = 24;
    input.spellcheck = false;
    input.placeholder = this.state.playerName;
    input.style.cssText =
      'box-sizing:border-box;display:block;width:100%;padding:11px 40px 11px 12px;background:#111713;color:#ecece3;border:1px solid #727564;text-align:center;font:700 13px system-ui,sans-serif;letter-spacing:1px';
    nameField.append(input);
    this.elements.name = input;
    this.makeClearButton(nameField, input, Boolean(storedName));
    input.onkeydown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        (this.elements.button as HTMLButtonElement).click();
      }
    };
  }

  private makeClearButton(
    nameField: HTMLElement,
    input: HTMLInputElement,
    hasStoredName: boolean,
  ): void {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.setAttribute('aria-label', 'Clear saved name');
    clear.title = 'Clear saved name';
    clear.textContent = '×';
    clear.style.cssText = `display:${hasStoredName ? 'block' : 'none'};position:absolute;right:1px;top:1px;bottom:1px;width:36px;border:0;background:transparent;color:#cf9273;font-size:22px;cursor:pointer`;
    clear.onclick = () => this.clearSavedName(input);
    nameField.append(clear);
    this.elements.clearName = clear;
  }

  private clearSavedName(input: HTMLInputElement): void {
    clearPlayerName();
    this.state.playerName = randomPlayerName();
    input.value = '';
    input.placeholder = this.state.playerName;
    this.setStyle('clearName', 'display', 'none');
    input.focus();
  }

  private makeButtons(modal: HTMLElement): void {
    const button = document.createElement('button');
    button.textContent = 'ENTER ARENA';
    button.style.cssText =
      'background:#bdc593;border:0;padding:13px 26px;color:#22291b;font-weight:800;letter-spacing:2px;cursor:pointer';
    button.onclick = () => {
      if (this.state.winner && !this.callbacks.isOnline()) {
        this.callbacks.restart();
      }

      this.enter();
    };
    modal.append(button);
    this.elements.button = button;
    this.values['text:button'] = 'ENTER ARENA';

    if (this.callbacks.isOnline()) {
      this.makeSoloButton(modal);
    }
  }

  private makeSoloButton(modal: HTMLElement): void {
    const solo = document.createElement('button');
    solo.textContent = 'PLAY SOLO';
    solo.style.cssText =
      'display:none;margin:14px auto 0;background:transparent;border:1px solid #9da283;padding:10px 20px;color:#d8dacb;font-weight:700;letter-spacing:2px;cursor:pointer';
    solo.onclick = () => {
      const url = new URL(location.href);
      url.searchParams.delete('online');
      url.searchParams.set('solo', '1');
      location.href = url.href;
    };
    modal.append(solo);
    this.elements.solo = solo;
  }

  /** Applies the entered name, requests pointer lock, activates play, and resumes audio. */
  enter(): void {
    this.settingsPanel.cancelCapture();

    if (this.state.preview) {
      this.callbacks.restart();
    }

    this.applyPlayerName();

    if (!this.callbacks.isConnected()) {
      return;
    }

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    try {
      const pending = this.viewer.canvas.requestPointerLock();

      if (pending instanceof Promise) {
        void pending.catch((error: unknown) => {
          console.warn('Pointer lock request was rejected.', { error });
          this.state.message = 'Pointer lock unavailable — drag on canvas to aim';
          this.state.messageUntil = this.state.elapsed + 8;
        });
      }
    } catch (error: unknown) {
      console.warn('Pointer lock is unavailable in this browser.', { error });
    }

    this.state.active = true;
    this.state.sounds ??= new BowAudio();
    this.state.sounds.resume().catch((error: unknown) => {
      console.warn('Bow audio could not be resumed.', { error });
    });
  }

  private applyPlayerName(): void {
    const input = this.elements.name as HTMLInputElement | undefined;

    if (!input) {
      return;
    }

    const chosenName = sanitizePlayerNameInput(input.value);
    const savedName = readPlayerName();

    if (chosenName) {
      this.state.playerName = savePlayerName(chosenName);
    } else {
      this.state.playerName = savedName ?? this.state.playerName ?? input.placeholder;
    }

    input.value = '';
    input.placeholder = this.state.playerName;
    this.callbacks.setNetworkName(this.state.playerName);
    this.setStyle('clearName', 'display', readPlayerName() ? 'block' : 'none');
  }

  /** Updates modal visibility, text, and controls only when rendered values change. */
  update(): void {
    this.settingsPanel.update();

    if (this.callbacks.isOnline()) {
      this.updateOnline();
    } else {
      this.updateSolo();
    }
  }

  /**
   * Returns whether this modal belongs to an online runtime.
   *
   * @returns Whether a live session exists for this runtime.
   */
  isOnline(): boolean {
    return this.callbacks.isOnline();
  }

  /**
   * Returns whether the settings panel is reserving the next key press.
   *
   * @returns Whether gameplay key handling must yield to binding capture.
   */
  isCapturingKey(): boolean {
    return this.settingsPanel.isCapturingKey();
  }

  private updateSolo(): void {
    const config = this.getConfig();
    const show = (!this.state.active || Boolean(this.state.winner)) && !this.state.preview;
    this.setStyle('modal', 'display', show ? 'block' : 'none');
    let title = 'BOWGAME';
    let description = `${config.botCount} hunters. First to ${config.scoreLimit} eliminations.\nHold to draw. Release to fire. Lead moving targets.\nArrows drop with distance. Rocks stop arrows.\nHeadshots deal extra damage. Respawn is automatic.`;

    if (this.state.winner) {
      title = this.state.winner === 'YOU' ? 'VICTORY' : 'MATCH OVER';
      description = `${this.state.winner} reached ${config.scoreLimit} eliminations.\nYour score: ${this.state.kills} kills / ${this.state.deaths} deaths`;
    }

    let buttonText = 'ENTER ARENA';

    if (this.state.winner) {
      buttonText = 'PLAY AGAIN';
    } else if (this.state.elapsed > 0) {
      buttonText = 'RESUME HUNT';
    }

    this.setText('title', title);
    this.setText('description', description);
    this.setText('button', buttonText);
  }

  private updateOnline(): void {
    const status = this.state.networkSnapshot?.status ?? 'connecting';
    const limit = this.state.networkSnapshot?.scoreLimit ?? 20;
    const isBlocked = ['full', 'reconnecting', 'disconnected', 'connecting'].includes(status);
    const show = !this.state.active || Boolean(this.state.winner) || isBlocked;
    this.setStyle('modal', 'display', show ? 'block' : 'none');
    let title = 'BOWGAME';

    if (status === 'full') {
      title = 'SERVER FULL';
    } else if (this.state.winner === 'YOU') {
      title = 'VICTORY';
    } else if (this.state.winner) {
      title = 'ROUND OVER';
    }

    this.setText('title', title);
    this.setText('description', this.getOnlineDescription(status, limit));
    const isDisabled = isBlocked || Boolean(this.state.winner);
    this.setDisabled('button', isDisabled);
    this.setStyle('button', 'opacity', isDisabled ? '.55' : '1');
    this.setOnlineButtonText(status, isBlocked);
    this.setStyle(
      'nameField',
      'display',
      this.state.winner || status === 'full' ? 'none' : 'block',
    );
    this.setStyle('solo', 'display', isBlocked ? 'block' : 'none');
  }

  private getOnlineDescription(status: string, limit: number): string {
    if (status === 'full') {
      return `The main room already has ${BOW_ROOM_CAP} archers.\nTry again later or continue in solo mode.`;
    }

    if (status === 'reconnecting' || status === 'disconnected') {
      return 'Connection lost. Reconnecting with backoff.\nYou can continue immediately in solo mode.';
    }

    if (status === 'connecting') {
      return 'Connecting to the main room…';
    }

    if (this.state.winner) {
      return `${this.state.winner} reached ${limit} eliminations.\nThe next round begins in about 5 seconds.`;
    }

    return `${this.state.networkSnapshot?.players.length ?? 0} archers online. First to ${limit} eliminations.\n\nHeadshots deal extra damage. Respawn is automatic.`;
  }

  private setOnlineButtonText(status: string, isBlocked: boolean): void {
    let buttonText = 'ENTER ARENA';

    if (this.state.winner) {
      buttonText = 'ROUND RESTARTS SOON';
    } else if (status === 'full') {
      buttonText = 'ROOM UNAVAILABLE';
    } else if (isBlocked) {
      buttonText = 'CONNECTING…';
    } else if (this.state.elapsed > 0) {
      buttonText = 'RESUME HUNT';
    }

    this.setText('button', buttonText);
  }

  private setText(id: string, value: string): void {
    const key = `text:${id}`;

    if (this.values[key] === value) {
      return;
    }

    this.values[key] = value;
    this.elements[id].textContent = value;
  }

  private setStyle(id: string, property: string, value: string): void {
    const key = `style:${id}:${property}`;

    if (this.values[key] === value) {
      return;
    }

    this.values[key] = value;
    this.elements[id].style.setProperty(property, value);
  }

  private setDisabled(id: string, value: boolean): void {
    const key = `disabled:${id}`;

    if (this.values[key] === value) {
      return;
    }

    this.values[key] = value;
    (this.elements[id] as HTMLButtonElement).disabled = value;
  }

  /** Clears detached element references after the parent HUD overlay is removed. */
  stop(): void {
    this.settingsPanel.stop();
    this.elements = {};
    this.values = Object.create(null);
  }
}
