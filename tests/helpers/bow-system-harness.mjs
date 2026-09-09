/** Provides small browser and viewer fakes for isolated runtime-system tests. */

/** Minimal CSS declaration that records writes made by cached UI setters. */
export class FakeStyle {
  writes = 0;
  values = new Map();
  cssText = '';

  /**
   * Stores one CSS property and counts the mutation.
   * @param {string} property - CSS property name.
   * @param {string} value - Rendered property value.
   */
  setProperty(property, value) {
    this.writes++;
    this.values.set(property, value);
  }
}

/** Minimal DOM element used by the HUD and entry-overlay tests. */
export class FakeElement {
  attributes = new Map();
  children = [];
  dataset = {};
  style = new FakeStyle();
  parentElement = null;
  textWrites = 0;
  _textContent = '';
  className = '';
  disabled = false;
  id = '';
  isContentEditable = false;
  name = '';
  onclick = null;
  onkeydown = null;
  placeholder = '';
  spellcheck = false;
  title = '';
  type = '';
  value = '';

  /**
   * Creates an element with a browser-style upper-case tag name.
   * @param {string} tagName - DOM-style element tag name.
   */
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
  }

  /**
   * Returns the currently rendered text.
   * @returns {string} Current text content.
   */
  get textContent() {
    return this._textContent;
  }

  /** Records a text mutation. */
  set textContent(value) {
    this.textWrites++;
    this._textContent = value;
  }

  /**
   * Appends children in DOM order.
   * @param {...FakeElement} children - Child elements appended in order.
   */
  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  /**
   * Replaces all current children.
   * @param {...FakeElement} children - Replacement child elements.
   */
  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  /** Removes this element from its parent. */
  remove() {
    if (!this.parentElement) {
      return;
    }

    const index = this.parentElement.children.indexOf(this);

    if (index >= 0) {
      this.parentElement.children.splice(index, 1);
    }

    this.parentElement = null;
  }

  /**
   * Stores one element attribute.
   * @param {string} name - Attribute name.
   * @param {string} value - Attribute value.
   */
  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  /**
   * Removes one element attribute.
   * @param {string} name - Attribute name.
   */
  removeAttribute(name) {
    this.attributes.delete(name);
  }

  /**
   * Returns one stored attribute.
   * @param {string} name - Attribute name.
   * @returns {string | null} Stored value or null when absent.
   */
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  /** Makes this element the fake document's active element. */
  focus() {
    globalThis.document.activeElement = this;
  }

  /** Clears focus when this element owns it. */
  blur() {
    if (globalThis.document.activeElement === this) {
      globalThis.document.activeElement = null;
    }
  }

  /** Invokes a configured button click handler. */
  click() {
    this.onclick?.();
  }

  /**
   * Supplies deterministic canvas bounds to the HUD.
   * @returns {{left: number, top: number, width: number, height: number}} Fixed viewport bounds.
   */
  getBoundingClientRect() {
    return { left: 10, top: 20, width: 800, height: 450 };
  }

  /** Accepts listeners needed by player-controller lifecycle tests. */
  addEventListener() {}

  /** Removes listeners accepted by the fake. */
  removeEventListener() {}

  /**
   * Grants pointer lock to this element.
   * @returns {Promise<void>} An already-resolved pointer-lock request.
   */
  requestPointerLock() {
    globalThis.document.pointerLockElement = this;

    return Promise.resolve();
  }

  /**
   * Supplies an inert two-dimensional canvas context for seeded arena textures.
   * @returns {object} No-op drawing context with working gradient handles.
   */
  getContext() {
    const context = {
      createRadialGradient() {
        return { addColorStop() {} };
      },
    };

    return new Proxy(context, {
      get: (target, property) => target[property] ?? (() => {}),
    });
  }
}

class FakeStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

/**
 * Installs the browser globals required before importing Threepipe-backed modules.
 * @returns {void} Nothing.
 */
export function installBrowserGlobals() {
  globalThis.ImageData ??= class ImageData {};
  globalThis.HTMLElement = FakeElement;
  globalThis.HTMLInputElement = FakeElement;
  globalThis.HTMLButtonElement = FakeElement;
  const body = new FakeElement('body');
  const documentValue = {
    activeElement: null,
    body,
    pointerLockElement: null,
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    addEventListener() {},
    removeEventListener() {},
    exitPointerLock() {
      this.pointerLockElement = null;
    },
  };
  globalThis.document = documentValue;
  globalThis.localStorage = new FakeStorage();
  globalThis.location = { href: 'http://localhost/', search: '' };
  globalThis.window = {
    location: globalThis.location,
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
}

/**
 * Imports one freshly compiled runtime module after browser globals exist.
 * @param {string} name - Compiled module filename without its extension.
 * @returns {Promise<object>} Imported module namespace.
 */
export function loadSystem(name) {
  return import(new URL(`../../scripts/${name}.js`, import.meta.url));
}

/**
 * Returns unchanged test match settings shared by isolated systems.
 * @returns {object} Minimal valid bow match configuration.
 */
export function makeConfig() {
  return {
    version: 1,
    kind: 'bow-deathmatch',
    botCount: 1,
    scoreLimit: 1,
    difficulty: 'normal',
    obstacles: [],
    playerSpawn: { x: 0, y: 0, z: 0 },
    botSpawns: [{ x: 4, y: 0, z: -6 }],
  };
}

/**
 * Creates a small viewer with real Three groups and camera math.
 * @returns {Promise<object>} Minimal Threepipe-compatible viewer.
 */
export async function makeViewer() {
  const { Group, PerspectiveCamera, Vector3 } = await import('threepipe');
  const scene = new Group();
  scene.modelRoot = new Group();
  scene.add(scene.modelRoot);
  scene.mainCamera = new PerspectiveCamera(60, 1, 0.1, 200);
  scene.mainCamera.target = new Vector3();
  scene.mainCamera.controls = { enabled: true };
  const canvas = new FakeElement('canvas');
  const container = new FakeElement('main');

  return {
    canvas,
    container,
    scene,
    renderManager: { renderScale: 2 },
    dirtyCalls: 0,
    setDirty() {
      this.dirtyCalls++;
    },
  };
}

installBrowserGlobals();
