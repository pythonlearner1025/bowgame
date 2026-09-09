/**
 * Owns player input, camera-relative movement, capsule resolution, jumping, and camera updates.
 * It delegates bow transitions, respawn rules, UI entry, audio, and projectiles to their owners.
 */
import { Vector3 } from 'threepipe';
import { GRAVITY, moveWithCover } from './BowPhysics.js';
// Ground support remains jumpable for one tenth of a second after an edge departure.
const COYOTE_WINDOW_SECONDS = 0.1;
// The original 4.8-meter-per-second impulse preserves the established jump arc.
const JUMP_SPEED_METERS_PER_SECOND = 4.8;
/** Converts browser input into movement and applies the resulting first-person camera. */
export class PlayerController {
    viewer;
    state;
    world;
    bow;
    bots;
    getConfig;
    callbacks;
    cameraRestore = null;
    /**
     * Creates an inert controller around its player, viewmodel, and side-effect dependencies.
     *
     * @param options - Viewer, state, world, bow, bot pose, settings, and lifecycle callbacks.
     */
    constructor(options) {
        this.viewer = options.viewer;
        this.state = options.state;
        this.world = options.world;
        this.bow = options.bow;
        this.bots = options.bots;
        this.getConfig = options.getConfig;
        this.callbacks = options.callbacks;
    }
    /** Captures camera settings, installs input listeners, and selects the gameplay field of view. */
    start() {
        const camera = this.viewer.scene.mainCamera;
        const perspectiveCamera = camera;
        this.cameraRestore = {
            position: camera.position.clone(),
            quaternion: camera.quaternion.clone(),
            target: camera.target?.clone(),
            fov: perspectiveCamera.fov,
            controls: camera.controls?.enabled,
        };
        window.addEventListener('keydown', this.onKeyDown, true);
        window.addEventListener('keyup', this.onKeyUp, true);
        window.addEventListener('mousedown', this.onMouseDown, true);
        window.addEventListener('mouseup', this.onMouseUp, true);
        window.addEventListener('mousemove', this.onMouseMove, true);
        window.addEventListener('blur', this.onBlur);
        document.addEventListener('pointerlockchange', this.onLock);
        this.viewer.canvas.addEventListener('contextmenu', this.onContext);
        if (camera.controls) {
            camera.controls.enabled = false;
        }
        perspectiveCamera.fov = 76;
        perspectiveCamera.updateProjectionMatrix?.();
    }
    /** Removes input listeners, exits pointer lock, and restores the captured camera settings. */
    stop() {
        window.removeEventListener('keydown', this.onKeyDown, true);
        window.removeEventListener('keyup', this.onKeyUp, true);
        window.removeEventListener('mousedown', this.onMouseDown, true);
        window.removeEventListener('mouseup', this.onMouseUp, true);
        window.removeEventListener('mousemove', this.onMouseMove, true);
        window.removeEventListener('blur', this.onBlur);
        document.removeEventListener('pointerlockchange', this.onLock);
        this.viewer.canvas.removeEventListener('contextmenu', this.onContext);
        if (document.pointerLockElement === this.viewer.canvas) {
            document.exitPointerLock();
        }
        this.state.keys.clear();
        this.state.active = false;
        this.state.hadPointerLock = false;
        this.restoreCamera();
    }
    restoreCamera() {
        if (!this.cameraRestore) {
            return;
        }
        const camera = this.viewer.scene.mainCamera;
        const restore = this.cameraRestore;
        const perspectiveCamera = camera;
        camera.position.copy(restore.position);
        camera.quaternion.copy(restore.quaternion);
        if (restore.target) {
            camera.target?.copy(restore.target);
        }
        if (camera.controls && restore.controls !== undefined) {
            camera.controls.enabled = restore.controls;
        }
        perspectiveCamera.fov = restore.fov;
        perspectiveCamera.updateProjectionMatrix?.();
        this.cameraRestore = null;
    }
    isTyping(target) {
        const element = target;
        return Boolean(element &&
            (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)));
    }
    /**
     * Handles accepted movement, restart, and mute key presses.
     * @param event - Keyboard press routed from the capture-phase window listener.
     */
    onKeyDown = (event) => {
        if (!this.state.running ||
            this.isTyping(event.target) ||
            ![
                'KeyW',
                'KeyA',
                'KeyS',
                'KeyD',
                'ArrowUp',
                'ArrowDown',
                'ArrowLeft',
                'ArrowRight',
                'ShiftLeft',
                'ShiftRight',
                'Space',
                'KeyR',
                'KeyM',
            ].includes(event.code)) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.code === 'KeyR' && !event.repeat) {
            if (!this.callbacks.isOnline()) {
                this.callbacks.restart();
            }
        }
        else if (event.code === 'KeyM' && !event.repeat) {
            const audio = this.callbacks.getAudio();
            if (audio) {
                audio.setMuted(!audio.isMuted());
            }
        }
        else {
            this.state.keys.add(event.code);
        }
    };
    /**
     * Handles movement key releases and prevents editor shortcuts when consumed.
     * @param event - Keyboard release routed from the capture-phase window listener.
     */
    onKeyUp = (event) => {
        if (this.state.keys.delete(event.code)) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    };
    onContext = (event) => event.preventDefault();
    /**
     * Routes canvas presses to entry or the bow state machine.
     * @param event - Mouse press routed from the capture-phase window listener.
     */
    onMouseDown = (event) => {
        if (!this.state.running || event.target !== this.viewer.canvas) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!this.state.active) {
            this.callbacks.enter();
            return;
        }
        this.bow.handleMouseDown(event);
    };
    /**
     * Routes gameplay mouse releases to the bow state machine.
     * @param event - Mouse release routed from the capture-phase window listener.
     */
    onMouseUp = (event) => {
        if (!this.state.running) {
            return;
        }
        this.bow.handleMouseUp(event);
    };
    /**
     * Applies pointer-lock or primary-drag mouse deltas to yaw and pitch.
     * @param event - Mouse movement carrying relative pointer deltas in pixels.
     */
    onMouseMove = (event) => {
        if (!this.state.running || !this.state.active) {
            return;
        }
        // MouseEvent.buttons is a documented bit flag; bit 0 represents the primary button.
        if (document.pointerLockElement !== this.viewer.canvas && !(event.buttons & 1)) {
            return;
        }
        this.state.yaw -= event.movementX * (this.state.aiming ? 0.0011 : 0.0018);
        this.state.pitch = Math.max(-1.25, Math.min(1.25, this.state.pitch - event.movementY * (this.state.aiming ? 0.0011 : 0.0018)));
        event.stopImmediatePropagation();
    };
    /** Clears held input, cancels drawing, pauses play, and suspends audio after focus loss. */
    onBlur = () => {
        this.state.keys.clear();
        this.bow.handleBlur();
        this.state.active = false;
        this.callbacks.getAudio()?.suspend();
    };
    /** Tracks real pointer-lock acquisition so Escape pauses only after a successful lock. */
    onLock = () => {
        if (document.pointerLockElement === this.viewer.canvas) {
            this.state.hadPointerLock = true;
            this.state.active = true;
        }
        else if (this.state.hadPointerLock) {
            this.state.hadPointerLock = false;
            this.onBlur();
        }
    };
    /**
     * Advances local movement and collision resolution by one fixed simulation step.
     * @param dt - Fixed simulation duration in seconds.
     */
    step(dt) {
        if (this.state.hp <= 0) {
            this.callbacks.stepRespawn();
            return;
        }
        const x = Number(this.state.keys.has('KeyD') || this.state.keys.has('ArrowRight')) -
            Number(this.state.keys.has('KeyA') || this.state.keys.has('ArrowLeft'));
        const z = Number(this.state.keys.has('KeyS') || this.state.keys.has('ArrowDown')) -
            Number(this.state.keys.has('KeyW') || this.state.keys.has('ArrowUp'));
        const length = Math.hypot(x, z) || 1;
        const isSprinting = (this.state.keys.has('ShiftLeft') || this.state.keys.has('ShiftRight')) &&
            !this.state.drawing;
        let speed = 4.5;
        if (this.state.drawing) {
            speed = 2.6;
        }
        else if (isSprinting) {
            speed = 7;
        }
        const dx = ((x * Math.cos(this.state.yaw) + z * Math.sin(this.state.yaw)) / length) * speed * dt;
        const dz = ((-x * Math.sin(this.state.yaw) + z * Math.cos(this.state.yaw)) / length) * speed * dt;
        this.move(dx, dz, dt);
    }
    move(dx, dz, dt) {
        if (this.world.collision) {
            this.state.velocity.x = dx / dt;
            this.state.velocity.z = dz / dt;
            const hasSupport = this.world.collision.hasSupport(this.state.player);
            const isSupported = hasSupport && this.state.velocity.y <= 0;
            if (isSupported) {
                this.state.grounded = true;
                this.state.coyoteSecondsRemaining = COYOTE_WINDOW_SECONDS;
            }
            else {
                this.state.grounded = false;
                this.state.coyoteSecondsRemaining = Math.max(0, this.state.coyoteSecondsRemaining - dt);
            }
            if (this.state.keys.has('Space') && this.state.coyoteSecondsRemaining > 0) {
                this.state.velocity.y = JUMP_SPEED_METERS_PER_SECOND;
                this.state.grounded = false;
                this.state.coyoteSecondsRemaining = 0;
            }
            this.state.velocity.y -= GRAVITY * dt;
            this.state.grounded = this.world.collision.move(this.state.player, this.state.velocity, dt);
            if (this.state.grounded) {
                this.state.coyoteSecondsRemaining = COYOTE_WINDOW_SECONDS;
            }
            return;
        }
        // Legacy geometry-free harness callers; the hosted arena always owns a BVH.
        this.state.player.copy(moveWithCover(this.state.player, dx, dz, this.getConfig().obstacles));
        if (this.state.keys.has('Space') && this.state.player.y === 0) {
            this.state.velocity.y = JUMP_SPEED_METERS_PER_SECOND;
        }
        this.state.velocity.y -= GRAVITY * dt;
        this.state.player.y = Math.max(0, this.state.player.y + this.state.velocity.y * dt);
        if (this.state.player.y === 0) {
            this.state.velocity.y = 0;
        }
    }
    /** Updates camera transform, first-person pose, preview views, trails, and listener orientation. */
    updateCamera() {
        if (!this.state.running) {
            return;
        }
        const camera = this.viewer.scene.mainCamera;
        this.world.trails?.update(this.state.elapsed, camera.position);
        if (this.state.preview?.view === 'character') {
            this.updateCharacterPreview();
            return;
        }
        if (camera.controls) {
            camera.controls.enabled = false;
        }
        const isWalking = this.state.keys.size > 0 && this.state.hp > 0 && this.state.active;
        camera.position.copy(this.state.player).add(new Vector3(0, this.state.hp > 0 ? 1.66 : 0.55, 0));
        if (isWalking) {
            camera.position.y += Math.sin(this.state.elapsed * 10) * 0.025;
        }
        camera.rotation.set(this.state.pitch, this.state.yaw, 0, 'YXZ');
        const direction = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        camera.target?.copy(camera.position).add(direction);
        this.setFieldOfView(76);
        camera.setDirty?.({ change: 'transform' });
        this.callbacks
            .getAudio()
            ?.setListener(camera.position, new Vector3(1, 0, 0).applyQuaternion(camera.quaternion));
        this.bow.updateViewModel(camera);
        this.updateFlightPreview();
        this.world.trails?.update(this.state.elapsed, camera.position);
    }
    updateCharacterPreview() {
        const preview = this.state.preview;
        if (!preview) {
            return;
        }
        const camera = this.viewer.scene.mainCamera;
        const bot = this.state.bots[0];
        this.bow.hideViewModel();
        this.state.bots.forEach((candidate, index) => {
            candidate.mesh.visible = index === 0;
        });
        const angle = ((preview.orbit ?? 0) * Math.PI) / 180;
        bot.mesh.position.set(0, 0, 17);
        bot.mesh.rotation.set(0, 0, 0);
        bot.leftLeg.rotation.set(0, 0, 0);
        bot.rightLeg.rotation.set(0, 0, 0);
        this.bots.updatePose(bot, {
            draw: preview.draw ?? 0,
            isRelaxed: preview.draw === 0 && (preview.release ?? -1) < 0,
            release: preview.release,
        });
        camera.position.set(Math.sin(angle) * 3.15, 0.98, 17 - Math.cos(angle) * 3.15);
        camera.lookAt(0, 0.98, 17);
        camera.target?.set(0, 0.98, 17);
        this.setFieldOfView((preview.draw ?? 0) > 0 || (preview.release ?? -1) >= 0 ? 48 : 40);
        camera.setDirty?.({ change: 'transform' });
    }
    updateFlightPreview() {
        if (this.state.preview?.flightSeconds === undefined) {
            return;
        }
        this.state.heldArrow.visible = false;
        if (this.state.preview.flightSide && this.state.arrows[0]) {
            const camera = this.viewer.scene.mainCamera;
            const point = this.state.arrows[0].position;
            this.bow.hideViewModel();
            camera.position.copy(point).add(new Vector3(8, 2, 5));
            camera.lookAt(point.x, point.y, point.z + 3);
            camera.target?.set(point.x, point.y, point.z + 3);
            camera.setDirty?.({ change: 'transform' });
        }
    }
    setFieldOfView(fieldOfView) {
        const camera = this.viewer.scene.mainCamera;
        camera.fov = fieldOfView;
        camera.updateProjectionMatrix?.();
    }
}
