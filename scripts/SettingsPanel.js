/**
 * Owns the settings controls mounted inside the entry modal and their key-capture lifecycle.
 * It delegates persistence to BowSettings and does not own simulation or gameplay input state.
 */
import { BOW_ACTIONS, MAX_MOUSE_SENSITIVITY_MULTIPLIER, MIN_MOUSE_SENSITIVITY_MULTIPLIER, } from './BowSettings.js';
const CAPTURE_TEXT = 'PRESS A KEY';
const UNBOUND_TEXT = '—';
const KEY_CODE_PREFIX = 'Key';
const DIGIT_CODE_PREFIX = 'Digit';
const NUMPAD_CODE_PREFIX = 'Numpad';
// Slider increments control the precision available for mouse sensitivity adjustments.
const MOUSE_SENSITIVITY_STEP_MULTIPLIER = 0.05;
// Two decimal places keep the mouse sensitivity readout aligned with the slider precision.
const MOUSE_SENSITIVITY_FRACTION_DIGITS = 2;
const ACTION_LABELS = {
    moveForward: 'Move forward',
    moveBack: 'Move back',
    moveLeft: 'Move left',
    moveRight: 'Move right',
    sprint: 'Sprint',
    jump: 'Jump',
    restart: 'Restart round',
    mute: 'Mute audio',
};
const READABLE_KEY_CODES = {
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ArrowUp: 'Up',
    Backspace: 'Backspace',
    ControlLeft: 'Left Control',
    ControlRight: 'Right Control',
    Delete: 'Delete',
    End: 'End',
    Enter: 'Enter',
    Home: 'Home',
    PageDown: 'Page Down',
    PageUp: 'Page Up',
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
    Space: 'Space',
    Tab: 'Tab',
};
const SECONDARY_BUTTON_STYLE = 'background:transparent;border:1px solid #9da283;padding:10px 20px;color:#d8dacb;font-weight:700;letter-spacing:2px;cursor:pointer';
const KEY_BUTTON_STYLE = 'min-width:128px;background:#111713;border:1px solid #727564;padding:7px 9px;color:#ecece3;font:700 12px system-ui,sans-serif;letter-spacing:.5px;cursor:pointer';
function formatKeyCode(code) {
    const readableCode = READABLE_KEY_CODES[code];
    if (readableCode) {
        return readableCode;
    }
    if (code.startsWith(KEY_CODE_PREFIX) && code.length === KEY_CODE_PREFIX.length + 1) {
        return code.slice(KEY_CODE_PREFIX.length);
    }
    if (code.startsWith(DIGIT_CODE_PREFIX) && code.length === DIGIT_CODE_PREFIX.length + 1) {
        return code.slice(DIGIT_CODE_PREFIX.length);
    }
    if (code.startsWith(NUMPAD_CODE_PREFIX)) {
        return `Numpad ${code.slice(NUMPAD_CODE_PREFIX.length)}`;
    }
    return code;
}
function formatMouseSensitivity(value) {
    return `${value.toFixed(MOUSE_SENSITIVITY_FRACTION_DIGITS)}×`;
}
/** Creates the modal settings section and captures one physical key per requested rebind. */
export class SettingsPanel {
    settings;
    elements = {};
    values = Object.create(null);
    capturingAction = null;
    mouseSensitivityPreview = null;
    isOpen = false;
    /**
     * Connects presentation to the independently persisted settings model.
     *
     * @param settings - Player preferences read and mutated by these controls.
     */
    constructor(settings) {
        this.settings = settings;
    }
    /**
     * Builds the toggle and settings body beneath the modal's existing action buttons.
     *
     * @param modal - Entry modal that owns the settings section's DOM lifetime.
     * @returns Nothing.
     * Installs one capture-phase key listener until stop is called.
     */
    start(modal) {
        this.values = Object.create(null);
        this.makeToggle(modal);
        // Accent-color themes checkbox/range to the palette; custom widgets cost keyboard/screen-reader behavior.
        const panel = this.createElement('settingsPanel', modal, 'display:none;margin:14px 0 0;padding:14px;background:#111713;border:1px solid #4f5347;color:#d8dacb;text-align:left;max-height:min(46vh,380px);overflow:auto;accent-color:#bdc593');
        this.makeInvertControl(panel);
        this.makeMouseSensitivityControl(panel);
        for (const action of BOW_ACTIONS) {
            this.makeActionRow(panel, action);
        }
        this.makeResetButton(panel);
        window.addEventListener('keydown', this.onKeyDown, true);
        this.update();
    }
    makeToggle(modal) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.dataset.hud = 'settingsToggle';
        toggle.textContent = 'SETTINGS';
        toggle.setAttribute('aria-label', 'Toggle settings panel');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.style.cssText = `display:block;margin:14px auto 0;${SECONDARY_BUTTON_STYLE}`;
        toggle.onclick = () => {
            this.isOpen = !this.isOpen;
            if (!this.isOpen) {
                this.capturingAction = null;
            }
            this.update();
        };
        modal.append(toggle);
        this.elements.settingsToggle = toggle;
        this.values['text:settingsToggle'] = 'SETTINGS';
    }
    createElement(id, parent, style = '') {
        const element = document.createElement('div');
        element.dataset.hud = id;
        element.style.cssText = style;
        parent.append(element);
        this.elements[id] = element;
        return element;
    }
    makeInvertControl(panel) {
        const label = document.createElement('label');
        label.style.cssText =
            'display:flex;align-items:center;gap:9px;padding:3px 2px 12px;font:700 13px system-ui,sans-serif;cursor:pointer';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.setAttribute('aria-label', 'Invert mouse Y axis');
        checkbox.onchange = () => {
            this.settings.invertMouseY = checkbox.checked;
            this.update();
        };
        const text = document.createElement('span');
        text.textContent = 'Invert mouse (Y axis)';
        label.append(checkbox, text);
        panel.append(label);
        this.elements.invertMouseY = checkbox;
    }
    makeMouseSensitivityControl(panel) {
        const label = document.createElement('label');
        label.style.cssText =
            'display:block;padding:0 2px 14px;font:700 13px system-ui,sans-serif;cursor:pointer';
        const heading = document.createElement('span');
        heading.style.cssText =
            'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px';
        const text = document.createElement('span');
        text.textContent = 'Mouse sensitivity';
        const readout = document.createElement('span');
        readout.dataset.hud = 'mouseSensitivityReadout';
        heading.append(text, readout);
        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(MIN_MOUSE_SENSITIVITY_MULTIPLIER);
        input.max = String(MAX_MOUSE_SENSITIVITY_MULTIPLIER);
        input.step = String(MOUSE_SENSITIVITY_STEP_MULTIPLIER);
        input.dataset.hud = 'mouseSensitivity';
        input.setAttribute('aria-label', 'Mouse sensitivity');
        input.style.cssText = 'display:block;width:100%;margin:0;cursor:pointer';
        // Input previews the value while change commits once, avoiding a storage write per drag pixel.
        input.oninput = () => {
            const preview = Number(input.value);
            if (!Number.isFinite(preview)) {
                return;
            }
            this.mouseSensitivityPreview = preview;
            this.updateMouseSensitivityPresentation(preview);
        };
        input.onchange = () => {
            this.settings.mouseSensitivity = Number(input.value);
            this.mouseSensitivityPreview = null;
            this.update();
        };
        label.append(heading, input);
        panel.append(label);
        this.elements.mouseSensitivity = input;
        this.elements.mouseSensitivityReadout = readout;
    }
    makeActionRow(panel, action) {
        const row = this.createElement(`settingsRow-${action}`, panel, 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 8px;font:13px system-ui,sans-serif');
        const label = document.createElement('span');
        label.textContent = ACTION_LABELS[action];
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.hud = `settingsKey-${action}`;
        button.style.cssText = KEY_BUTTON_STYLE;
        button.onclick = () => {
            this.capturingAction = action;
            this.update();
        };
        row.append(label, button);
        this.elements[`key-${action}`] = button;
    }
    makeResetButton(panel) {
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.dataset.hud = 'settingsReset';
        reset.textContent = 'RESET DEFAULTS';
        reset.setAttribute('aria-label', 'Reset controls and mouse settings to defaults');
        reset.style.cssText = `display:block;margin:14px auto 0;${SECONDARY_BUTTON_STYLE}`;
        reset.onclick = () => {
            this.settings.resetDefaults();
            this.capturingAction = null;
            this.mouseSensitivityPreview = null;
            this.update();
        };
        panel.append(reset);
        this.elements.settingsReset = reset;
        this.values['text:settingsReset'] = 'RESET DEFAULTS';
    }
    /** Updates visible settings values while skipping unchanged DOM writes. */
    update() {
        if (!this.elements.settingsPanel) {
            return;
        }
        this.setStyle('settingsPanel', 'display', this.isOpen ? 'block' : 'none');
        this.setAttribute('settingsToggle', 'aria-expanded', String(this.isOpen));
        this.setChecked('invertMouseY', this.settings.invertMouseY);
        const mouseSensitivity = this.mouseSensitivityPreview ?? this.settings.mouseSensitivity;
        this.setValue('mouseSensitivity', String(mouseSensitivity));
        this.updateMouseSensitivityPresentation(mouseSensitivity);
        for (const action of BOW_ACTIONS) {
            const bindingText = this.getBindingText(action);
            const buttonText = this.capturingAction === action ? CAPTURE_TEXT : bindingText;
            const accessibleText = this.capturingAction === action
                ? `Choose a key for ${ACTION_LABELS[action]}`
                : `Rebind ${ACTION_LABELS[action]}. Current keys: ${bindingText}`;
            this.setText(`key-${action}`, buttonText);
            this.setAttribute(`key-${action}`, 'aria-label', accessibleText);
        }
    }
    getBindingText(action) {
        const codes = this.settings.getBinding(action);
        if (codes.length === 0) {
            return UNBOUND_TEXT;
        }
        return codes.map((code) => formatKeyCode(code)).join(' / ');
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
    setChecked(id, value) {
        const key = `checked:${id}`;
        if (this.values[key] === value) {
            return;
        }
        this.values[key] = value;
        this.elements[id].checked = value;
    }
    setValue(id, value) {
        const key = `value:${id}`;
        const element = this.elements[id];
        if (this.values[key] === value && element.value === value) {
            return;
        }
        this.values[key] = value;
        element.value = value;
    }
    updateMouseSensitivityPresentation(value) {
        const readout = formatMouseSensitivity(value);
        this.setText('mouseSensitivityReadout', readout);
        this.setAttribute('mouseSensitivity', 'aria-valuetext', readout);
    }
    onKeyDown = (event) => {
        const action = this.capturingAction;
        if (!action) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.code !== 'Escape') {
            this.settings.rebind(action, event.code);
        }
        this.capturingAction = null;
        this.update();
    };
    /**
     * Returns whether the next key press belongs exclusively to this panel.
     *
     * @returns Whether one action is waiting for a replacement key.
     */
    isCapturingKey() {
        return this.capturingAction !== null;
    }
    /** Cancels a pending key capture without changing any binding. */
    cancelCapture() {
        if (!this.capturingAction) {
            return;
        }
        this.capturingAction = null;
        this.update();
    }
    /** Removes the key listener and clears references to modal-owned elements. */
    stop() {
        window.removeEventListener('keydown', this.onKeyDown, true);
        this.capturingAction = null;
        this.mouseSensitivityPreview = null;
        this.isOpen = false;
        this.elements = {};
        this.values = Object.create(null);
    }
}
