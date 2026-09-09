/**
 * Owns remote avatar creation, transform interpolation, rig posing, and remote hit volumes.
 * It does not parse protocol messages, award scores, or advance projectiles.
 */
import { Vector3 } from 'threepipe';
import { createArrowModel } from './ArrowSystem.js';
import { attachHumanAsset } from './BowHumanAsset.js';
import { makeFieldBow, makeHuman } from './BowVisuals.js';
import { disposeGroup } from './GameWorld.js';
/** Creates and advances peer avatars from the latest network snapshot. */
export class RemotePlayers {
    state;
    world;
    bots;
    getSlotSpawn;
    /**
     * Connects remote avatars to shared state, world rendering, bot rig poses, and slot spawns.
     *
     * @param state - Mutable simulation state shared by all systems.
     * @param world - Runtime root that owns remote avatar resources.
     * @param bots - Shared archer rig pose implementation.
     * @param getSlotSpawn - Returns a collision-valid spawn for an online slot.
     */
    constructor(state, world, bots, getSlotSpawn) {
        this.state = state;
        this.world = world;
        this.bots = bots;
        this.getSlotSpawn = getSlotSpawn;
    }
    /**
     * Creates a remote human and bow rig at its collision-valid slot spawn.
     *
     * @param id - Stable session player identifier.
     * @param name - Sanitized display name.
     * @param slot - Stable zero-based room slot.
     * @returns Newly allocated remote player state and rendered rig.
     */
    create(id, name, slot) {
        const human = makeHuman(slot);
        attachHumanAsset(human, slot);
        const remoteRoot = human.root;
        remoteRoot.name = `REMOTE_${id}`;
        const bow = makeFieldBow();
        bow.scale.setScalar(1);
        bow.position.set(-0.22, 1.56, -0.6);
        remoteRoot.add(bow);
        const heldArrow = createArrowModel();
        heldArrow.scale.setScalar(1);
        remoteRoot.add(heldArrow);
        const spawn = this.getSlotSpawn(slot);
        remoteRoot.position.copy(spawn);
        this.world.root.add(remoteRoot);
        const player = {
            id,
            slot,
            seq: -1,
            target: spawn.clone(),
            targetYaw: 0,
            targetPitch: 0,
            targetDraw: 0,
            anim: 'ready',
            mesh: remoteRoot,
            name,
            hp: 100,
            kills: 0,
            deaths: 0,
            cooldown: 0,
            respawn: 0,
            phase: slot * 2.1,
            draw: 0,
            leftLeg: human.legs[0].root,
            rightLeg: human.legs[1].root,
            bow,
            human,
            release: -1,
            heldArrow,
        };
        this.bots.updatePose(player, { draw: 0 });
        this.state.remotePlayers.set(id, player);
        return player;
    }
    /**
     * Synchronizes avatar membership, targets, score, and alive state from a session snapshot.
     *
     * @param snapshot - Current detached session state.
     */
    sync(snapshot) {
        const wanted = new Set();
        for (const slot of snapshot.players) {
            if (slot.local) {
                continue;
            }
            wanted.add(slot.id);
            const player = this.state.remotePlayers.get(slot.id) ?? this.create(slot.id, slot.name, slot.slot);
            player.name = slot.name;
            player.slot = slot.slot;
            player.kills = snapshot.scores[slot.id] ?? 0;
            player.deaths = slot.deaths;
            if (slot.seq >= 0) {
                player.seq = slot.seq;
                player.target.set(slot.pos.x, slot.pos.y, slot.pos.z);
                player.targetYaw = slot.yaw;
                player.targetPitch = slot.pitch;
                player.targetDraw = slot.draw;
                player.anim = slot.anim;
            }
            if (slot.anim === 'dead') {
                player.hp = 0;
                player.mesh.visible = false;
            }
            else if (player.hp <= 0) {
                player.hp = 100;
                player.mesh.visible = true;
            }
        }
        for (const [id, player] of this.state.remotePlayers) {
            if (!wanted.has(id)) {
                disposeGroup(player.mesh);
                this.state.remotePlayers.delete(id);
            }
        }
    }
    /**
     * Advances remote transforms and release animation by one fixed step.
     *
     * @param dt - Fixed simulation duration in seconds.
     */
    step(dt) {
        for (const player of this.state.remotePlayers.values()) {
            const before = player.mesh.position.clone();
            const blend = 1 - Math.exp(-dt * 12);
            player.mesh.position.lerp(player.target, blend);
            player.mesh.rotation.y += (player.targetYaw - player.mesh.rotation.y) * blend;
            player.draw += (player.targetDraw - player.draw) * blend;
            const isMoving = before.distanceTo(player.mesh.position) > dt * 0.2;
            player.walk =
                player.anim === 'walk' || isMoving ? Math.sin(this.state.elapsed * 7 + player.phase) : 0;
            if (player.anim === 'release') {
                if (player.release < 0) {
                    player.release = 0;
                }
                else {
                    player.release = Math.min(1.05, player.release + dt);
                }
            }
            else {
                player.release = -1;
            }
        }
    }
    /** Applies interpolated draw, walk, release, and pitch values to living remote rigs. */
    updatePoses() {
        for (const player of this.state.remotePlayers.values()) {
            if (player.hp > 0) {
                this.bots.updatePose(player, {
                    draw: player.draw,
                    walk: player.walk,
                    release: player.release,
                });
                player.bow.rotation.x += player.targetPitch * 0.25;
            }
        }
    }
    /**
     * Returns living remote hit-volume anchors, optionally excluding the relayed shooter.
     *
     * @param excludedPlayerId - Optional shooter identifier omitted from visual-only collisions.
     * @returns Detached candidate records referencing current avatar positions.
     */
    getHitCandidates(excludedPlayerId) {
        return [...this.state.remotePlayers.values()]
            .filter((player) => player.id !== excludedPlayerId)
            .map((player) => ({
            position: player.mesh.position,
            hp: player.hp,
            index: player.id,
        }));
    }
    /**
     * Marks one announced remote victim dead and hides its avatar.
     *
     * @param playerId - Session identifier of the announced victim.
     */
    setDead(playerId) {
        const player = this.state.remotePlayers.get(playerId);
        if (player) {
            player.hp = 0;
            player.mesh.visible = false;
        }
    }
    /** Restores remote health, visibility, and target positions for a new round. */
    resetRound() {
        for (const player of this.state.remotePlayers.values()) {
            player.hp = 100;
            player.mesh.visible = true;
            player.target.copy(this.getSlotSpawn(player.slot));
        }
    }
    /** Drops avatar references after the world owner has disposed their shared root. */
    clear() {
        this.state.remotePlayers.clear();
    }
}
