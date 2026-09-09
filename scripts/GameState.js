/**
 * Owns mutable bow simulation data without owning input, rendering, networking, or game rules.
 * Positions and distances use meters in a Y-up world, rotations use radians, and time uses seconds.
 */
import { Group, Quaternion, Vector3 } from 'threepipe';
/** Holds every mutable value advanced by the bow simulation and its presentation. */
export class GameState {
    config;
    running = false;
    grounded = false;
    coyoteSecondsRemaining = 0;
    testClockPaused = false;
    lastWorldImpact = null;
    preview = null;
    bots = [];
    arrows = [];
    remotePlayers = new Map();
    player = new Vector3();
    velocity = new Vector3();
    hp = 100;
    kills = 0;
    deaths = 0;
    deadUntil = 0;
    elapsed = 0;
    winner = '';
    yaw = 0;
    pitch = 0;
    keys = new Set();
    drawing = false;
    charge = 0;
    recoil = 0;
    releaseTime = -1;
    releasedCharge = 0;
    posePhase = 'ready';
    cooldown = 0;
    aiming = false;
    aimBlend = 0;
    queuedDraw = false;
    releaseFrom = null;
    cancelFrom = null;
    cancelTime = -1;
    accumulator = 0;
    flash = 0;
    hit = 0;
    message = '';
    messageUntil = 0;
    active = false;
    hadPointerLock = false;
    playerName = '';
    deathFeed = [];
    networkSnapshot = null;
    networkAccumulator = 0;
    networkSeq = 0;
    arrowSeq = 0;
    receivedHits = new Set();
    lastHudUpdate = -1;
    bow = new Group();
    heldArrow = new Group();
    arm = new Group();
    hand = new Group();
    leftArm;
    rightArm;
    sounds = null;
    /**
     * Creates state around optional serialized match settings.
     *
     * @param config - Serialized match settings, or undefined for an inert runtime.
     */
    constructor(config) {
        this.config = config;
    }
    /** Clears transient round values while retaining allocated render objects and lifetime counters. */
    resetRoundValues() {
        this.deathFeed = [];
        this.hp = 100;
        this.deadUntil = 0;
        this.winner = '';
        this.velocity.set(0, 0, 0);
        this.grounded = false;
        this.coyoteSecondsRemaining = 0;
        this.lastWorldImpact = null;
        this.drawing = false;
        this.charge = 0;
        this.cooldown = 0;
        this.releaseTime = -1;
        this.message = '';
        this.messageUntil = 0;
    }
}
