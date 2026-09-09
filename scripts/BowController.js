/**
 * Owns draw, charge, aim, release, cancel, recoil, and first-person bow viewmodel state.
 * It does not move the player, resolve collisions, award damage, or parse network messages.
 */
import { Line, Quaternion, Vector3 } from 'threepipe';
import { createArrowModel } from './ArrowSystem.js';
import { attachFirstPersonArm } from './BowHandRig.js';
import { BOW_DRAW_SECONDS } from './BowPhysics.js';
import { BOW_RELEASE_SECONDS, blendReferencePoses, referenceArrow, referenceRotation, referenceScreenPoint, sampleReferenceAction, sampleReferenceTimeline, } from './BowReferenceClip.js';
import { deformBow, firstPersonSkin, makeArm, makeFieldBow, poseArm } from './BowVisuals.js';
/** Runs the local bow state machine and applies its pose to the first-person rig. */
export class BowController {
    viewer;
    state;
    world;
    arrows;
    callbacks;
    /**
     * Connects bow state to the viewer, world, projectile system, and local side effects.
     *
     * @param options - Viewer, state, world, projectile, camera, and audio dependencies.
     */
    constructor(options) {
        this.viewer = options.viewer;
        this.state = options.state;
        this.world = options.world;
        this.arrows = options.arrows;
        this.callbacks = options.callbacks;
    }
    /** Creates the bow, held arrow, and two skinned first-person arms. */
    start() {
        this.state.bow = makeFieldBow();
        this.state.bow.scale.setScalar(0.9);
        this.world.root.add(this.state.bow);
        this.state.heldArrow = createArrowModel();
        this.world.root.add(this.state.heldArrow);
        const skin = firstPersonSkin();
        this.state.leftArm = makeArm(skin, -1);
        this.state.rightArm = makeArm(skin, 1);
        attachFirstPersonArm(this.state.leftArm, -1);
        attachFirstPersonArm(this.state.rightArm, 1);
        this.state.arm = this.state.leftArm.root;
        this.state.hand = this.state.rightArm.root;
        this.world.root.add(this.state.arm, this.state.hand);
    }
    /**
     * Starts draw or aim state for an accepted gameplay mouse press.
     *
     * @param event - Mouse press already accepted by the player input owner.
     */
    handleMouseDown(event) {
        if (event.button === 0 && this.state.hp > 0 && !this.state.winner) {
            if (this.state.cooldown <= 0 && this.state.cancelTime < 0) {
                this.state.drawing = true;
            }
            else {
                this.state.queuedDraw = true;
            }
        }
        if (event.button === 2) {
            this.state.aiming = true;
        }
    }
    /**
     * Releases, cancels, or exits aim state for one gameplay mouse release.
     *
     * @param event - Mouse release routed by the player input owner.
     */
    handleMouseUp(event) {
        if (event.button === 0) {
            this.releasePrimary();
        }
        if (event.button === 2) {
            this.state.aiming = false;
        }
    }
    releasePrimary() {
        this.state.queuedDraw = false;
        if (!this.state.drawing) {
            return;
        }
        const from = this.sampleLivePose();
        if (this.state.charge > 0.6 && this.state.hp > 0 && !this.state.winner) {
            this.firePlayer(from, this.state.charge);
            this.state.recoil = 1;
            this.state.releaseTime = 0;
            this.state.releasedCharge = this.state.charge;
            this.state.releaseFrom = from;
            this.state.cancelFrom = null;
            this.state.cancelTime = -1;
            this.state.cooldown = BOW_RELEASE_SECONDS;
        }
        else if (this.state.charge > 0) {
            this.state.cancelFrom = from;
            this.state.cancelTime = 0;
        }
        this.state.drawing = false;
        this.state.charge = 0;
    }
    /** Cancels any partial draw and clears aim state when gameplay loses focus. */
    handleBlur() {
        if (this.state.drawing && this.state.charge > 0) {
            this.state.cancelFrom = this.sampleLivePose();
            this.state.cancelTime = 0;
        }
        this.state.drawing = false;
        this.state.charge = 0;
        this.state.queuedDraw = false;
        this.state.aiming = false;
    }
    /**
     * Advances aim, release, cancel, cooldown, queued draw, and recoil transitions.
     *
     * @param dt - Fixed simulation duration in seconds.
     */
    stepTransitions(dt) {
        this.state.aimBlend += Math.max(-dt / 0.4, Math.min(dt / 0.4, Number(this.state.aiming) - this.state.aimBlend));
        this.stepRelease(dt);
        this.stepCancel(dt);
        this.state.cooldown = Math.max(0, this.state.cooldown - dt);
        if (this.state.queuedDraw &&
            this.state.cooldown <= 0 &&
            this.state.cancelTime < 0 &&
            this.state.hp > 0 &&
            !this.state.winner) {
            this.state.drawing = true;
            this.state.charge = 0;
            this.state.queuedDraw = false;
        }
        this.state.recoil = Math.max(0, this.state.recoil - dt * 5);
    }
    /**
     * Advances charge after movement, matching the original fixed-step statement order.
     *
     * @param dt - Fixed simulation duration in seconds.
     */
    stepCharge(dt) {
        if (this.state.hp > 0 && this.state.drawing) {
            this.state.charge = Math.min(1, this.state.charge + dt / BOW_DRAW_SECONDS);
        }
    }
    stepRelease(dt) {
        if (this.state.releaseTime < 0) {
            return;
        }
        this.state.releaseTime += dt;
        if (this.state.releaseTime >= BOW_RELEASE_SECONDS) {
            this.state.releaseTime = -1;
            this.state.releaseFrom = null;
        }
    }
    stepCancel(dt) {
        if (this.state.cancelTime < 0) {
            return;
        }
        this.state.cancelTime += dt;
        if (this.state.cancelTime >= 0.3) {
            this.state.cancelTime = -1;
            this.state.cancelFrom = null;
        }
    }
    /**
     * Launches one local shot from the rendered reference arrowhead and camera ray.
     *
     * @param pose - Current reference pose defining the rendered arrowhead.
     * @param charge - Normalized bow charge from zero to one.
     */
    firePlayer(pose, charge) {
        // The rendered arrowhead is the sight: launch from that same point along its camera ray.
        this.callbacks.updateCamera();
        const camera = this.viewer.scene.mainCamera;
        const tip = referenceArrow(pose).tip;
        const origin = tip.clone().applyQuaternion(camera.quaternion).add(camera.position);
        const direction = tip.clone().normalize().applyQuaternion(camera.quaternion);
        this.arrows.fire(origin, direction, -1, charge);
    }
    /**
     * Samples current input-driven reference transitions using simulation time only.
     *
     * @returns Current local archer pose in normalized reference coordinates.
     */
    sampleLivePose() {
        if (this.state.releaseTime >= 0) {
            return this.sampleReleasePose();
        }
        if (this.state.cancelTime >= 0 && this.state.cancelFrom) {
            return this.sampleCancelPose();
        }
        return sampleReferenceAction(this.state.charge, -1, this.state.aimBlend);
    }
    sampleReleasePose() {
        const target = sampleReferenceAction(0, this.state.releaseTime, this.state.aimBlend);
        if (!this.state.releaseFrom) {
            return target;
        }
        const progress = Math.min(1, this.state.releaseTime / 0.14);
        const smoothProgress = progress * progress * (3 - 2 * progress);
        return {
            ...blendReferencePoses(this.state.releaseFrom, target, smoothProgress),
            arrowVisible: false,
            rightVisible: false,
            phase: target.phase,
        };
    }
    sampleCancelPose() {
        const from = this.state.cancelFrom;
        const target = sampleReferenceAction(0);
        const progress = Math.min(1, this.state.cancelTime / 0.3);
        const smoothProgress = progress * progress * (3 - 2 * progress);
        // Keep the same arrow in the hand while it is lowered completely below the viewport.
        target.arrowTip = [from.arrowTip[0], 1.35];
        target.arrowNear = [from.arrowNear[0], 1.95];
        const pose = blendReferencePoses(from, target, smoothProgress);
        return {
            ...pose,
            arrowVisible: from.arrowVisible && progress < 1,
            rightVisible: from.rightVisible && progress < 1,
            arrowSeated: from.arrowSeated,
            phase: 'cancel',
        };
    }
    /**
     * Applies the current bow pose to the first-person viewmodel at the supplied camera.
     *
     * @param camera - Main camera already positioned for the current frame.
     */
    updateViewModel(camera) {
        if (this.state.preview) {
            this.state.charge = this.state.preview.draw ?? 0;
        }
        const release = this.state.preview?.release ?? this.state.releaseTime;
        const pose = this.getViewPose(release);
        this.state.posePhase = pose.phase;
        const localRotation = referenceRotation(pose);
        const grip = referenceScreenPoint(...pose.grip);
        const scale = 0.9;
        this.state.bow.position.copy(grip).applyQuaternion(camera.quaternion).add(camera.position);
        this.state.bow.quaternion.copy(camera.quaternion).multiply(localRotation);
        this.state.bow.scale.setScalar(scale);
        deformBow(this.state.bow, pose.tension, release >= 0 ? Math.sin(release * 115) * Math.exp(-release * 24) * 0.025 : 0);
        const context = { camera, pose, localRotation, grip, scale };
        this.poseHands(context);
        this.applyArrowPose(context);
    }
    getViewPose(release) {
        if (this.state.preview?.referenceTime !== undefined) {
            return sampleReferenceTimeline(this.state.preview.referenceTime);
        }
        if (this.state.preview) {
            return sampleReferenceAction(this.state.preview.draw ?? 0, release, (this.state.preview.aim ?? this.state.aiming) ? 1 : 0);
        }
        return this.sampleLivePose();
    }
    poseHands(context) {
        this.state.arm.position.copy(context.camera.position);
        this.state.hand.position.copy(context.camera.position);
        this.state.arm.quaternion.copy(context.camera.quaternion);
        this.state.hand.quaternion.copy(context.camera.quaternion);
        const arrow = referenceArrow(context.pose);
        const pull = context.pose.arrowVisible
            ? arrow.nock
            : referenceScreenPoint(...context.pose.right);
        this.state.leftArm?.setFingerRelease?.(context.pose.leftOpen);
        this.state.rightArm?.setFingerRelease?.(context.pose.rightOpen);
        if (this.state.leftArm) {
            poseArm(this.state.leftArm, new Vector3(-0.68, -0.55, 0.12), new Vector3(-0.54, -0.42, -0.35), context.grip, context.localRotation);
        }
        if (this.state.rightArm && context.pose.rightVisible) {
            poseArm(this.state.rightArm, new Vector3(0.5, -0.6, 0.08), new Vector3(0.48, -0.45, -0.06), pull, new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -0.15));
        }
        this.state.hand.visible = this.state.hp > 0 && context.pose.rightVisible;
        this.state.arm.visible = this.state.hp > 0;
        this.state.bow.visible = this.state.hp > 0;
    }
    applyArrowPose(context) {
        const arrow = referenceArrow(context.pose);
        if (context.pose.arrowVisible && context.pose.arrowSeated) {
            const localNock = arrow.nock
                .clone()
                .sub(context.grip)
                .applyQuaternion(context.localRotation.clone().invert())
                .divideScalar(context.scale);
            const string = this.state.bow.userData.bowString;
            const points = string.geometry.getAttribute('position');
            points.setXYZ(1, localNock.x, localNock.y, localNock.z);
            points.needsUpdate = true;
            string.geometry.computeBoundingSphere();
        }
        this.state.heldArrow.position
            .copy(arrow.nock)
            .add(new Vector3(0, 0, -0.28 * context.scale).applyQuaternion(arrow.rotation))
            .applyQuaternion(context.camera.quaternion)
            .add(context.camera.position);
        this.state.heldArrow.quaternion.copy(context.camera.quaternion).multiply(arrow.rotation);
        this.state.heldArrow.scale.setScalar(context.scale);
        this.state.heldArrow.visible = this.state.hp > 0 && context.pose.arrowVisible;
    }
    /** Hides every first-person viewmodel element for character and flight previews. */
    hideViewModel() {
        this.state.bow.visible = false;
        this.state.arm.visible = false;
        this.state.hand.visible = false;
        this.state.heldArrow.visible = false;
    }
    /**
     * Updates the continuous draw audio for the local bow.
     *
     * @param isActive - Whether simulation and combat are active this frame.
     */
    updateDrawAudio(isActive) {
        const draw = isActive && this.state.hp > 0 && this.state.drawing ? this.state.charge : 0;
        this.callbacks.getAudio()?.draw(-1, draw);
    }
}
