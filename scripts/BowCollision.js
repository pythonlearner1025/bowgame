/**
 * Builds immutable world-space arena collision and resolves arrows, capsules, and spawn points.
 * It does not move scene objects, integrate gravity, or rebuild for dynamic geometry.
 */
import { Box3, BufferGeometry, DoubleSide, Float32BufferAttribute, Line3, Matrix4, Ray, Vector3, } from 'three';
import { CENTER, MeshBVH } from 'three-mesh-bvh';
// The local player uses a 38-centimeter upright collision radius.
export const PLAYER_RADIUS = 0.38;
// Player and bot collision capsules are 1.8 meters tall from feet to head.
export const PLAYER_HEIGHT = 1.8;
// Surfaces up to fifty degrees from horizontal can support a standing actor.
const MAX_WALKABLE_ANGLE_DEGREES = 50;
const DEGREES_PER_HALF_TURN = 180;
const MAX_WALKABLE_ANGLE_RADIANS = (MAX_WALKABLE_ANGLE_DEGREES * Math.PI) / DEGREES_PER_HALF_TURN;
export const WALKABLE_Y = Math.cos(MAX_WALKABLE_ANGLE_RADIANS);
// A tenth-millimeter skin prevents repeated zero-depth contacts at triangle boundaries.
const COLLISION_SKIN_METERS = 0.0001;
// Motion is subdivided below forty percent of the radius to prevent capsule tunnelling.
const MOTION_SLICE_RADIUS_FRACTION = 0.4;
// Eight projection passes resolve corners where several static triangles overlap.
const MAX_RESOLUTION_PASSES = 8;
// Smaller corrections are below half the collision skin and can stop iterating.
const RESOLUTION_STOP_FRACTION = 0.5;
const RESOLUTION_STOP_DEPTH_METERS = COLLISION_SKIN_METERS * RESOLUTION_STOP_FRACTION;
// Segment lengths below this threshold have no stable ray direction.
const SEGMENT_EPSILON_METERS = 1e-10;
// Contact distances below this threshold use the triangle face normal directly.
const CONTACT_NORMAL_EPSILON_METERS = 1e-9;
// This upward-velocity tolerance preserves support during tiny solver corrections.
const GROUNDED_VERTICAL_SPEED_TOLERANCE = 0.01;
// Normals this close to vertical need no steep-face horizontal projection.
const VERTICAL_NORMAL_Y_LIMIT = 0.999;
// Spawn recovery samples quarter-meter rings out to four meters.
const SPAWN_RING_COUNT = 16;
const SPAWN_RING_STEP_METERS = 0.25;
const SPAWN_SAMPLES_PER_RING = 8;
// Spawn rays begin well above every current arena surface.
const SPAWN_RAY_HEIGHT_METERS = 150;
// Eight triangles per BVH leaf balanced construction and query cost in the measured arena.
const BVH_MAX_LEAF_TRIANGLES = 8;
// Three position components form each vertex and three vertices form each triangle.
const POSITION_COMPONENTS = 3;
const VERTICES_PER_TRIANGLE = 3;
const VALUES_PER_TRIANGLE = POSITION_COMPONENTS * VERTICES_PER_TRIANGLE;
// Plane geometry is deliberately open; other authored solid meshes are treated as closed shells.
const OPEN_TRIANGLE = 0;
const CLOSED_TRIANGLE = 1;
// Appends triangles from one mesh instance, correcting winding when its transform is reflected.
function collectMeshInstance(mesh, worldMatrix, vertices, closedTriangles) {
    const positions = mesh.geometry.getAttribute('position');
    const indices = mesh.geometry.index;
    const availableIndexCount = indices ? indices.count : positions.count;
    const firstIndex = mesh.geometry.drawRange.start;
    const finalIndex = Math.min(availableIndexCount, firstIndex + mesh.geometry.drawRange.count);
    const isReflected = worldMatrix.determinant() < 0;
    const vertexOffsets = isReflected ? [0, 2, 1] : [0, 1, 2];
    const transformedPoint = new Vector3();
    for (let triangleIndex = firstIndex; triangleIndex + 2 < finalIndex; triangleIndex += VERTICES_PER_TRIANGLE) {
        const isClosed = mesh.geometry.type === 'PlaneGeometry' ? OPEN_TRIANGLE : CLOSED_TRIANGLE;
        closedTriangles.push(isClosed);
        for (const vertexOffset of vertexOffsets) {
            const positionIndex = indices
                ? indices.getX(triangleIndex + vertexOffset)
                : triangleIndex + vertexOffset;
            transformedPoint.fromBufferAttribute(positions, positionIndex).applyMatrix4(worldMatrix);
            vertices.push(transformedPoint.x, transformedPoint.y, transformedPoint.z);
        }
    }
}
// Expands every marked mesh and instanced-mesh transform into one immutable world-space buffer.
function collectArenaGeometry(arena) {
    const vertices = [];
    const closedTriangles = [];
    const instanceMatrix = new Matrix4();
    const worldMatrix = new Matrix4();
    let solidMeshes = 0;
    arena.updateWorldMatrix(true, true);
    arena.traverse((object) => {
        const mesh = object;
        if (!mesh.isMesh || mesh.userData.bowSolid !== true) {
            return;
        }
        const instancedMesh = mesh;
        const instanceCount = instancedMesh.isInstancedMesh ? instancedMesh.count : 1;
        for (let instanceIndex = 0; instanceIndex < instanceCount; instanceIndex += 1) {
            worldMatrix.copy(mesh.matrixWorld);
            if (instancedMesh.isInstancedMesh) {
                instancedMesh.getMatrixAt(instanceIndex, instanceMatrix);
                worldMatrix.multiply(instanceMatrix);
            }
            collectMeshInstance(mesh, worldMatrix, vertices, closedTriangles);
            solidMeshes += 1;
        }
    });
    return { vertices, closedTriangles, solidMeshes };
}
/** Provides immutable triangle queries for the static arena. */
export class BowCollision {
    geometry = new BufferGeometry();
    bvh;
    buildMs;
    solidMeshes;
    triangles;
    closedTriangles;
    capsuleLine = new Line3();
    capsuleBounds = new Box3();
    trianglePoint = new Vector3();
    capsulePoint = new Vector3();
    contactNormal = new Vector3();
    faceNormal = new Vector3();
    segmentRay = new Ray();
    capsuleAxisRay = new Ray(new Vector3(), new Vector3(0, 1, 0));
    segmentDirection = new Vector3();
    steps = 0;
    totalMs = 0;
    maxMs = 0;
    /**
     * Collects all marked solid arena triangles and builds one immutable BVH.
     *
     * @param arena - Runtime arena root in world coordinates, where Y is up and units are meters.
     */
    constructor(arena) {
        const startedAt = performance.now();
        const collected = collectArenaGeometry(arena);
        if (collected.vertices.length === 0) {
            throw new Error('Arena has no solid collision geometry');
        }
        this.geometry.setAttribute('position', new Float32BufferAttribute(collected.vertices, POSITION_COMPONENTS));
        this.bvh = new MeshBVH(this.geometry, {
            strategy: CENTER,
            maxLeafSize: BVH_MAX_LEAF_TRIANGLES,
            indirect: true,
        });
        this.closedTriangles = new Uint8Array(collected.closedTriangles);
        this.solidMeshes = collected.solidMeshes;
        this.triangles = collected.vertices.length / VALUES_PER_TRIANGLE;
        this.buildMs = performance.now() - startedAt;
        console.info(`[BowCollision] ${this.triangles} triangles / ${this.solidMeshes} solids; ` +
            `build ${this.buildMs.toFixed(2)} ms`);
    }
    /**
     * Finds the nearest static-world intersection along a finite segment.
     *
     * @param start - Segment start in world meters.
     * @param end - Segment end in world meters.
     * @returns Hit fraction, point, and face normal, or `null` when unobstructed.
     */
    segment(start, end) {
        this.segmentDirection.subVectors(end, start);
        const segmentLength = this.segmentDirection.length();
        if (segmentLength < SEGMENT_EPSILON_METERS) {
            return null;
        }
        this.segmentRay.set(start, this.segmentDirection.divideScalar(segmentLength));
        const hit = this.bvh.raycastFirst(this.segmentRay, DoubleSide, 0, segmentLength);
        if (!hit?.face) {
            return null;
        }
        return {
            t: hit.distance / segmentLength,
            point: hit.point,
            normal: hit.face.normal,
        };
    }
    // Updates reusable capsule and broad-phase bounds for one feet position.
    setCapsule(feet, radius) {
        this.capsuleLine.start.copy(feet).y += radius;
        this.capsuleLine.end.copy(feet).y += PLAYER_HEIGHT - radius;
        this.capsuleAxisRay.origin.copy(this.capsuleLine.start);
        this.capsuleBounds
            .makeEmpty()
            .expandByPoint(this.capsuleLine.start)
            .expandByPoint(this.capsuleLine.end)
            .expandByScalar(radius + COLLISION_SKIN_METERS);
    }
    /**
     * Integrates one small motion interval and projects velocity for wall sliding.
     *
     * @param feet - Mutable capsule-foot position in world meters.
     * @param velocity - Mutable velocity in meters per second.
     * @param dt - Simulation interval in seconds.
     * @param radius - Capsule radius in meters.
     * @returns Whether the final motion slice found walkable support.
     */
    move(feet, velocity, dt, radius = PLAYER_RADIUS) {
        const startedAt = performance.now();
        const movementDistance = velocity.length() * dt;
        const maxSliceDistance = radius * MOTION_SLICE_RADIUS_FRACTION;
        const sliceCount = Math.max(1, Math.ceil(movementDistance / maxSliceDistance));
        let isGrounded = false;
        for (let sliceIndex = 0; sliceIndex < sliceCount; sliceIndex += 1) {
            feet.addScaledVector(velocity, dt / sliceCount);
            isGrounded = this.resolve(feet, velocity, radius);
        }
        const durationMs = performance.now() - startedAt;
        this.steps += 1;
        this.totalMs += durationMs;
        this.maxMs = Math.max(this.maxMs, durationMs);
        return isGrounded;
    }
    /**
     * Removes capsule penetration and velocity directed into static triangles.
     *
     * @param feet - Mutable capsule-foot position in world meters.
     * @param velocity - Mutable velocity in meters per second.
     * @param radius - Capsule radius in meters.
     * @returns Whether any resolved contact was walkable support.
     */
    resolve(feet, velocity, radius = PLAYER_RADIUS) {
        let isGrounded = false;
        for (let pass = 0; pass < MAX_RESOLUTION_PASSES; pass += 1) {
            const result = this.resolvePass(feet, velocity, radius);
            isGrounded ||= result.isGrounded;
            if (result.maxCorrection < RESOLUTION_STOP_DEPTH_METERS) {
                break;
            }
        }
        return isGrounded;
    }
    // Resolves all triangles overlapping the capsule during one projection pass.
    resolvePass(feet, velocity, radius) {
        this.setCapsule(feet, radius);
        let isGrounded = false;
        let maxCorrection = 0;
        this.bvh.shapecast({
            intersectsBounds: (bounds) => bounds.intersectsBox(this.capsuleBounds),
            intersectsTriangle: (triangle) => {
                const contact = this.resolveTriangleContact(triangle, feet, velocity, radius);
                isGrounded ||= contact.isGrounded;
                maxCorrection = Math.max(maxCorrection, contact.correction);
                return false;
            },
        });
        return { isGrounded, maxCorrection };
    }
    // Resolves one capsule/triangle contact and returns its support and correction data.
    resolveTriangleContact(triangle, feet, velocity, radius) {
        const distance = triangle.closestPointToSegment(this.capsuleLine, this.trianglePoint, this.capsulePoint);
        if (distance > radius + COLLISION_SKIN_METERS) {
            return { isGrounded: false, correction: 0 };
        }
        triangle.getNormal(this.faceNormal);
        this.contactNormal.subVectors(this.capsulePoint, this.trianglePoint);
        if (distance > CONTACT_NORMAL_EPSILON_METERS) {
            this.contactNormal.divideScalar(distance);
        }
        else {
            this.contactNormal.copy(this.faceNormal);
        }
        const isGrounded = this.faceNormal.y >= WALKABLE_Y &&
            this.contactNormal.y >= WALKABLE_Y &&
            velocity.y <= GROUNDED_VERTICAL_SPEED_TOLERANCE;
        let correction = Math.max(0, radius + COLLISION_SKIN_METERS - distance);
        // Uphill input must not turn a steep face into an elevator. Ceiling and downward contacts
        // retain their vertical component so the solver can push the capsule out correctly.
        const needsHorizontalProjection = this.faceNormal.y < WALKABLE_Y &&
            this.contactNormal.y > 0 &&
            this.contactNormal.y < VERTICAL_NORMAL_Y_LIMIT;
        if (needsHorizontalProjection) {
            const horizontalLength = Math.hypot(this.contactNormal.x, this.contactNormal.z);
            this.contactNormal.y = 0;
            this.contactNormal.divideScalar(horizontalLength);
            correction /= horizontalLength;
        }
        feet.addScaledVector(this.contactNormal, correction);
        this.capsuleLine.start.addScaledVector(this.contactNormal, correction);
        this.capsuleLine.end.addScaledVector(this.contactNormal, correction);
        const velocityIntoSurface = velocity.dot(this.contactNormal);
        if (velocityIntoSurface < 0) {
            velocity.addScaledVector(this.contactNormal, -velocityIntoSurface);
        }
        return { isGrounded, correction };
    }
    /**
     * Measures the deepest current capsule penetration into static triangles.
     *
     * @param feet - Capsule-foot position in world meters.
     * @param radius - Capsule radius in meters.
     * @returns Maximum penetration depth in meters.
     */
    penetration(feet, radius = PLAYER_RADIUS) {
        this.setCapsule(feet, radius);
        let penetrationDepth = 0;
        this.bvh.shapecast({
            intersectsBounds: (bounds) => bounds.intersectsBox(this.capsuleBounds),
            intersectsTriangle: (triangle) => {
                penetrationDepth = Math.max(penetrationDepth, radius -
                    triangle.closestPointToSegment(this.capsuleLine, this.trianglePoint, this.capsulePoint));
                // Endpoint and edge distances miss a triangle pierced through its interior by the axis.
                const crossing = this.capsuleAxisRay.intersectTriangle(triangle.a, triangle.b, triangle.c, false, this.trianglePoint);
                if (crossing && crossing.y <= this.capsuleLine.end.y) {
                    penetrationDepth = Math.max(penetrationDepth, radius);
                }
                return false;
            },
        });
        return penetrationDepth;
    }
    /**
     * Finds the nearest sampled free position on walkable static support.
     *
     * @param wanted - Requested capsule-foot position in world meters.
     * @param radius - Capsule radius in meters.
     * @returns The nearest supported sampled position.
     * @throws When no free supported point exists within four horizontal meters.
     */
    spawn(wanted, radius = PLAYER_RADIUS) {
        const candidates = [];
        for (let ring = 0; ring <= SPAWN_RING_COUNT; ring += 1) {
            this.collectSpawnRing(candidates, wanted, radius, ring);
            candidates.sort((first, second) => first.distanceToSquared(wanted) - second.distanceToSquared(wanted));
            const nearest = candidates[0];
            const completedSearchRadius = (ring + 1) * SPAWN_RING_STEP_METERS;
            if (nearest && nearest.distanceTo(wanted) < completedSearchRadius) {
                return nearest;
            }
        }
        if (candidates.length === 0) {
            throw new Error('No free supported spawn near requested position');
        }
        return candidates[0];
    }
    // Appends every free, walkable intersection sampled on one horizontal search ring.
    collectSpawnRing(candidates, wanted, radius, ring) {
        const sampleCount = ring === 0 ? 1 : ring * SPAWN_SAMPLES_PER_RING;
        for (let i = 0; i < sampleCount; i += 1) {
            const angleRadians = (i / sampleCount) * Math.PI * 2;
            const sampleRadius = ring * SPAWN_RING_STEP_METERS;
            const x = wanted.x + Math.cos(angleRadians) * sampleRadius;
            const z = wanted.z + Math.sin(angleRadians) * sampleRadius;
            const ray = new Ray(new Vector3(x, SPAWN_RAY_HEIGHT_METERS, z), new Vector3(0, -1, 0));
            for (const hit of this.bvh.raycast(ray, DoubleSide)) {
                const candidate = this.makeSpawnCandidate(hit, radius);
                if (candidate) {
                    candidates.push(candidate);
                }
            }
        }
    }
    // Validates support, surface penetration, and closed-shell containment for one ray hit.
    makeSpawnCandidate(hit, radius) {
        if (!hit.face || hit.face.normal.y < WALKABLE_Y) {
            return null;
        }
        const feet = hit.point.clone();
        feet.y += COLLISION_SKIN_METERS;
        if (this.penetration(feet, radius) > COLLISION_SKIN_METERS) {
            return null;
        }
        // A wholly embedded capsule need not touch a triangle. Its first upward closed-shell crossing
        // must be an exit face; an upward-facing entrance means the capsule is inside solid geometry.
        const insideRay = new Ray(feet.clone().add(new Vector3(0, PLAYER_HEIGHT / 2, 0)), new Vector3(0, 1, 0));
        const above = this.bvh
            .raycast(insideRay, DoubleSide)
            .filter((candidateHit) => {
            const faceIndex = candidateHit.faceIndex;
            return faceIndex !== undefined && Boolean(this.closedTriangles[faceIndex]);
        })
            .sort((first, second) => first.distance - second.distance)[0];
        return above?.face && above.face.normal.y > 0 ? null : feet;
    }
    /**
     * Copies collision build and query timing diagnostics.
     *
     * @returns Construction counts and cumulative capsule timings in milliseconds.
     */
    stats() {
        return {
            buildMs: this.buildMs,
            triangles: this.triangles,
            solidMeshes: this.solidMeshes,
            steps: this.steps,
            meanStepMs: this.steps > 0 ? this.totalMs / this.steps : 0,
            maxStepMs: this.maxMs,
        };
    }
    /**
     * Releases the immutable collision geometry owned by this instance.
     *
     * @returns Nothing.
     */
    dispose() {
        this.geometry.dispose();
    }
}
