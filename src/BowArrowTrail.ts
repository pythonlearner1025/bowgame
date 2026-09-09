/**
 * Renders pooled, camera-facing ribbons from collision-clipped arrow samples.
 * It does not integrate arrow physics or decide when an arrow collides.
 */

import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  ShaderMaterial,
  Vector3,
} from 'threepipe';

// Trails fade after 160 milliseconds so fast arrows remain readable without long streaks.
export const ARROW_TRAIL_SECONDS = 0.16;

// Thirty-two pooled ribbons cover the maximum expected simultaneous arrows without churn.
export const ARROW_TRAIL_CAPACITY = 32;

// Twenty-four samples give each short ribbon enough curvature at the 120 Hz simulation rate.
const TRAIL_POINT_CAPACITY = 24;

// The 4.6-centimeter ribbon width stays visible without hiding the arrow shaft.
const TRAIL_WIDTH_METERS = 0.046;

// Every sample contributes two vertices, one on either side of the ribbon centerline.
const VERTICES_PER_POINT = 2;
const THIRD_INDEX_OFFSET = 2;
const FOURTH_INDEX_OFFSET = 3;

// Each adjacent pair of points forms two triangles with six indices.
const INDICES_PER_SEGMENT = 6;

// A position attribute stores three components per vertex.
const POSITION_COMPONENTS = 3;

// Four leading samples taper the trail smoothly behind the arrow.
const TAPER_POINT_COUNT = 4;

// The ribbon's peak opacity preserves the original pale streak appearance.
const MAX_TRAIL_ALPHA = 0.92;

// A 1.35 exponent makes the tail disappear faster than a linear fade.
const TRAIL_ALPHA_EXPONENT = 1.35;

// Squared cross products below this threshold cannot define a stable camera-facing side.
const SIDE_VECTOR_EPSILON_SQUARED = 1e-8;

const VERTEX_SHADER = `
  attribute float trailAlpha;
  varying float vAlpha;
  void main() {
    vAlpha = trailAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(0.97, 0.975, 0.95, vAlpha);
  }
`;

/** A generation-checked reference to one pooled trail slot. */
export interface ArrowTrailHandle {
  slot: number;
  generation: number;
}

interface TrailSlot {
  mesh: Mesh;
  positions: Float32Array;
  alpha: Float32Array;
  points: Vector3[];
  times: Float64Array;
  count: number;
  generation: number;
  isActive: boolean;
  isStopped: boolean;
  lastSampleTime: number;
}

/** Maintains a fixed-capacity pool of short ballistic arrow ribbons. */
export class BowArrowTrails {
  readonly root = new Group();

  private slots: TrailSlot[] = [];
  private serial = 0;

  // Reused vectors keep the 120 Hz trail update free of per-point allocations. The collision
  // benchmark established a sub-millisecond CPU budget for the full simulation step.
  private readonly tangentScratch = new Vector3();
  private readonly cameraDirectionScratch = new Vector3();
  private readonly sideScratch = new Vector3();

  private readonly material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide,
    toneMapped: false,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
  });

  /** Creates an empty pool root; GPU slots are allocated only when first needed. */
  constructor() {
    this.root.name = 'K3D_BALLISTIC_ARROW_STREAKS';
  }

  // Allocates one GPU ribbon and its fixed-size sample storage.
  private makeSlot(): TrailSlot {
    const positions = new Float32Array(
      TRAIL_POINT_CAPACITY * VERTICES_PER_POINT * POSITION_COMPONENTS,
    );
    const alpha = new Float32Array(TRAIL_POINT_CAPACITY * VERTICES_PER_POINT);
    const indices: number[] = [];

    for (let i = 0; i < TRAIL_POINT_CAPACITY - 1; i += 1) {
      const firstVertex = i * VERTICES_PER_POINT;
      indices.push(
        firstVertex,
        firstVertex + 1,
        firstVertex + THIRD_INDEX_OFFSET,
        firstVertex + 1,
        firstVertex + FOURTH_INDEX_OFFSET,
        firstVertex + THIRD_INDEX_OFFSET,
      );
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, POSITION_COMPONENTS));
    geometry.setAttribute('trailAlpha', new BufferAttribute(alpha, 1));
    geometry.setIndex(indices);
    geometry.setDrawRange(0, 0);

    const trailMesh = new Mesh(geometry, this.material);
    trailMesh.frustumCulled = false;
    trailMesh.visible = false;
    trailMesh.renderOrder = 2;
    this.root.add(trailMesh);

    return {
      mesh: trailMesh,
      positions,
      alpha,
      points: Array.from({ length: TRAIL_POINT_CAPACITY }, () => new Vector3()),
      times: new Float64Array(TRAIL_POINT_CAPACITY),
      count: 0,
      generation: 0,
      isActive: false,
      isStopped: false,
      lastSampleTime: 0,
    };
  }

  /**
   * Starts a trail at one world-space position.
   *
   * @param position - First collision-clipped arrow position in world meters.
   * @param time - Current simulation time in seconds.
   * @returns A generation-checked handle for subsequent samples.
   */
  spawn(position: Vector3, time: number): ArrowTrailHandle {
    let slotIndex = this.slots.findIndex((slot) => !slot.isActive);

    if (slotIndex < 0 && this.slots.length < ARROW_TRAIL_CAPACITY) {
      slotIndex = this.slots.length;
      this.slots.push(this.makeSlot());
    }

    if (slotIndex < 0) {
      slotIndex = this.findOldestSlotIndex();
    }

    const slot = this.slots[slotIndex];
    this.serial += 1;
    slot.generation = this.serial;
    slot.isActive = true;
    slot.isStopped = false;
    slot.count = 1;
    slot.points[0].copy(position);
    slot.times[0] = time;
    slot.lastSampleTime = time;
    slot.mesh.visible = false;

    return { slot: slotIndex, generation: slot.generation };
  }

  // Chooses the least recently sampled slot when the fixed pool is exhausted.
  private findOldestSlotIndex(): number {
    return this.slots.reduce((oldestIndex, slot, index) => {
      const oldestSlot = this.slots[oldestIndex];

      return slot.lastSampleTime < oldestSlot.lastSampleTime ? index : oldestIndex;
    }, 0);
  }

  // Rejects handles that refer to a slot reused by a newer arrow.
  private getSlot(handle: ArrowTrailHandle): TrailSlot | undefined {
    const slot = this.slots[handle.slot];
    const isCurrentGeneration = slot?.generation === handle.generation;

    return slot?.isActive && isCurrentGeneration ? slot : undefined;
  }

  /**
   * Appends one collision-clipped point to an active trail.
   *
   * @param handle - Trail handle returned by `spawn`.
   * @param position - Arrow position in world meters.
   * @param time - Current simulation time in seconds.
   * @returns Nothing.
   */
  sample(handle: ArrowTrailHandle, position: Vector3, time: number): void {
    const slot = this.getSlot(handle);

    if (!slot || slot.isStopped) {
      return;
    }

    if (slot.count === TRAIL_POINT_CAPACITY) {
      this.dropOldestPoint(slot);
    }

    slot.points[slot.count].copy(position);
    slot.times[slot.count] = time;
    slot.count += 1;
    slot.lastSampleTime = time;
  }

  // Shifts the small fixed sample window after it reaches capacity.
  private dropOldestPoint(slot: TrailSlot): void {
    for (let i = 1; i < TRAIL_POINT_CAPACITY; i += 1) {
      slot.points[i - 1].copy(slot.points[i]);
      slot.times[i - 1] = slot.times[i];
    }

    slot.count -= 1;
  }

  /**
   * Stops accepting samples while allowing the visible ribbon to fade naturally.
   *
   * @param handle - Trail handle returned by `spawn`.
   * @returns Nothing.
   */
  stop(handle: ArrowTrailHandle): void {
    const slot = this.getSlot(handle);

    if (slot) {
      slot.isStopped = true;
    }
  }

  /**
   * Immediately deactivates one trail slot.
   *
   * @param handle - Trail handle returned by `spawn`.
   * @returns Nothing.
   */
  remove(handle: ArrowTrailHandle): void {
    const slot = this.getSlot(handle);

    if (slot) {
      slot.isActive = false;
      slot.mesh.visible = false;
    }
  }

  /**
   * Rebuilds active ribbons to face the current camera and applies time-based fade.
   *
   * @param time - Current simulation time in seconds.
   * @param cameraPosition - Camera position in world meters.
   * @returns Nothing.
   */
  update(time: number, cameraPosition: Vector3): void {
    for (const slot of this.slots) {
      if (!slot.isActive) {
        continue;
      }

      if (time - slot.lastSampleTime >= ARROW_TRAIL_SECONDS) {
        slot.isActive = false;
        slot.mesh.visible = false;
        continue;
      }

      this.updateSlot(slot, time, cameraPosition);
    }
  }

  // Rewrites one slot's dynamic vertex and alpha attributes.
  private updateSlot(slot: TrailSlot, time: number, cameraPosition: Vector3): void {
    const startIndex = this.findVisibleStartIndex(slot, time);
    const visiblePointCount = slot.count - startIndex;
    slot.mesh.visible = visiblePointCount >= VERTICES_PER_POINT;

    for (let visibleIndex = 0; visibleIndex < visiblePointCount; visibleIndex += 1) {
      const pointIndex = startIndex + visibleIndex;
      this.writePointVertices(slot, pointIndex, visibleIndex, startIndex, time, cameraPosition);
    }

    const segmentCount = Math.max(0, visiblePointCount - 1);
    slot.mesh.geometry.setDrawRange(0, segmentCount * INDICES_PER_SEGMENT);
    slot.mesh.geometry.getAttribute('position').needsUpdate = true;
    slot.mesh.geometry.getAttribute('trailAlpha').needsUpdate = true;
  }

  // Skips samples old enough to have fully faded, retaining one for segment continuity.
  private findVisibleStartIndex(slot: TrailSlot, time: number): number {
    let startIndex = 0;

    while (startIndex < slot.count - 1 && time - slot.times[startIndex] >= ARROW_TRAIL_SECONDS) {
      startIndex += 1;
    }

    return startIndex;
  }

  // Keeping scalar arguments here avoids allocating an options object for every trail point in
  // the 120 Hz hot path; the four-capsule benchmark leaves less than a millisecond for a step.
  // eslint-disable-next-line max-params
  private writePointVertices(
    slot: TrailSlot,
    pointIndex: number,
    visibleIndex: number,
    startIndex: number,
    time: number,
    cameraPosition: Vector3,
  ): void {
    const point = slot.points[pointIndex];
    const nextPointIndex = Math.min(slot.count - 1, pointIndex + 1);
    const previousPointIndex = Math.max(startIndex, pointIndex - 1);
    this.tangentScratch
      .copy(slot.points[nextPointIndex])
      .sub(slot.points[previousPointIndex])
      .normalize();
    this.cameraDirectionScratch.copy(cameraPosition).sub(point).normalize();
    this.sideScratch.crossVectors(this.tangentScratch, this.cameraDirectionScratch);

    if (this.sideScratch.lengthSq() < SIDE_VECTOR_EPSILON_SQUARED) {
      this.sideScratch.set(1, 0, 0);
    } else {
      this.sideScratch.normalize();
    }

    const ageSeconds = Math.max(0, time - slot.times[pointIndex]);
    const fade = Math.max(0, 1 - ageSeconds / ARROW_TRAIL_SECONDS);
    const taper = Math.min(1, (visibleIndex + 1) / TAPER_POINT_COUNT);
    const halfWidth = (TRAIL_WIDTH_METERS / 2) * Math.sqrt(fade) * taper;

    for (let edgeIndex = 0; edgeIndex < VERTICES_PER_POINT; edgeIndex += 1) {
      const vertexIndex = visibleIndex * VERTICES_PER_POINT + edgeIndex;
      const positionOffset = vertexIndex * POSITION_COMPONENTS;
      const sideSign = edgeIndex === 0 ? -1 : 1;
      slot.positions[positionOffset] = point.x + this.sideScratch.x * halfWidth * sideSign;
      slot.positions[positionOffset + 1] = point.y + this.sideScratch.y * halfWidth * sideSign;
      slot.positions[positionOffset + 2] = point.z + this.sideScratch.z * halfWidth * sideSign;
      slot.alpha[vertexIndex] = MAX_TRAIL_ALPHA * Math.pow(fade, TRAIL_ALPHA_EXPONENT) * taper;
    }
  }

  /**
   * Hides and resets every pooled trail without releasing GPU resources.
   *
   * @returns Nothing.
   */
  clear(): void {
    for (const slot of this.slots) {
      slot.isActive = false;
      slot.mesh.visible = false;
      slot.count = 0;
    }
  }

  /**
   * Releases every pooled geometry, the shared material, and the scene root.
   *
   * @returns Nothing.
   */
  dispose(): void {
    for (const slot of this.slots) {
      slot.mesh.geometry.dispose();
    }

    this.material.dispose();
    this.root.removeFromParent();
    this.slots = [];
  }
}
