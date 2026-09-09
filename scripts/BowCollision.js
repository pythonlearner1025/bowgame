import { Box3, BufferGeometry, DoubleSide, Float32BufferAttribute, Line3, Matrix4, Ray, Vector3 } from 'three';
import { MeshBVH, CENTER } from 'three-mesh-bvh';
export const PLAYER_RADIUS = .38;
export const PLAYER_HEIGHT = 1.8;
export const WALKABLE_Y = Math.cos(50 * Math.PI / 180);
const SKIN = .0001;
/** Immutable world-space triangles. Build before render batching hides the originals. */
export class BowCollision {
    geometry = new BufferGeometry();
    bvh;
    buildMs;
    solidMeshes;
    triangles;
    closedTriangles;
    line = new Line3();
    box = new Box3();
    trianglePoint = new Vector3();
    capsulePoint = new Vector3();
    normal = new Vector3();
    faceNormal = new Vector3();
    ray = new Ray();
    axisRay = new Ray(new Vector3(), new Vector3(0, 1, 0));
    direction = new Vector3();
    steps = 0;
    totalMs = 0;
    maxMs = 0;
    constructor(arena) {
        const start = performance.now(), vertices = [], closed = [];
        let count = 0;
        arena.updateWorldMatrix(true, true);
        const instance = new Matrix4(), world = new Matrix4(), point = new Vector3();
        arena.traverse(object => {
            const mesh = object;
            if (!mesh.isMesh || mesh.userData.bowSolid !== true)
                return;
            const instanced = mesh;
            const copies = instanced.isInstancedMesh ? instanced.count : 1;
            const position = mesh.geometry.getAttribute('position'), index = mesh.geometry.index;
            const length = index ? index.count : position.count;
            const begin = mesh.geometry.drawRange.start;
            const end = Math.min(length, begin + mesh.geometry.drawRange.count);
            for (let copy = 0; copy < copies; copy++) {
                world.copy(mesh.matrixWorld);
                if (instanced.isInstancedMesh) {
                    instanced.getMatrixAt(copy, instance);
                    world.multiply(instance);
                }
                // Reverse reflected instances so authored outward normals stay outward.
                const reflected = world.determinant() < 0;
                for (let i = begin; i + 2 < end; i += 3) {
                    closed.push(mesh.geometry.type === 'PlaneGeometry' ? 0 : 1);
                    for (const offset of reflected ? [0, 2, 1] : [0, 1, 2]) {
                        point.fromBufferAttribute(position, index ? index.getX(i + offset) : i + offset).applyMatrix4(world);
                        vertices.push(point.x, point.y, point.z);
                    }
                }
                count++;
            }
        });
        if (!vertices.length)
            throw new Error('Arena has no solid collision geometry');
        this.geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
        this.bvh = new MeshBVH(this.geometry, { strategy: CENTER, maxLeafSize: 8, indirect: true });
        this.closedTriangles = new Uint8Array(closed);
        this.solidMeshes = count;
        this.triangles = vertices.length / 9;
        this.buildMs = performance.now() - start;
        console.info(`[BowCollision] ${this.triangles} triangles / ${count} solids; build ${this.buildMs.toFixed(2)} ms`);
    }
    segment(a, b) {
        this.direction.subVectors(b, a);
        const length = this.direction.length();
        if (length < 1e-10)
            return null;
        this.ray.set(a, this.direction.divideScalar(length));
        const hit = this.bvh.raycastFirst(this.ray, DoubleSide, 0, length);
        return hit ? { t: hit.distance / length, point: hit.point, normal: hit.face.normal } : null;
    }
    setCapsule(feet, radius) {
        this.line.start.copy(feet).y += radius;
        this.line.end.copy(feet).y += PLAYER_HEIGHT - radius;
        this.axisRay.origin.copy(this.line.start);
        this.box.makeEmpty().expandByPoint(this.line.start).expandByPoint(this.line.end).expandByScalar(radius + SKIN);
    }
    /** Resolve small motion slices, project velocity for wall sliding, and classify support by face AND contact normal. */
    move(feet, velocity, dt, radius = PLAYER_RADIUS) {
        const start = performance.now();
        const slices = Math.max(1, Math.ceil(velocity.length() * dt / (radius * .4)));
        let grounded = false;
        for (let slice = 0; slice < slices; slice++) {
            feet.addScaledVector(velocity, dt / slices);
            grounded = this.resolve(feet, velocity, radius);
        }
        const ms = performance.now() - start;
        this.steps++;
        this.totalMs += ms;
        this.maxMs = Math.max(this.maxMs, ms);
        return grounded;
    }
    resolve(feet, velocity, radius = PLAYER_RADIUS) {
        let grounded = false;
        for (let pass = 0; pass < 8; pass++) {
            this.setCapsule(feet, radius);
            let correction = 0;
            this.bvh.shapecast({
                intersectsBounds: box => box.intersectsBox(this.box),
                intersectsTriangle: triangle => {
                    const distance = triangle.closestPointToSegment(this.line, this.trianglePoint, this.capsulePoint);
                    if (distance > radius + SKIN)
                        return false;
                    triangle.getNormal(this.faceNormal);
                    this.normal.subVectors(this.capsulePoint, this.trianglePoint);
                    if (distance > 1e-9)
                        this.normal.divideScalar(distance);
                    else
                        this.normal.copy(this.faceNormal);
                    if (this.faceNormal.y >= WALKABLE_Y && this.normal.y >= WALKABLE_Y && velocity.y <= .01)
                        grounded = true;
                    let depth = Math.max(0, radius + SKIN - distance);
                    // Uphill input must not turn a steep face into an elevator. Keep ceiling/downward contacts vertical.
                    if (this.faceNormal.y < WALKABLE_Y && this.normal.y > 0 && this.normal.y < .999) {
                        const horizontal = Math.hypot(this.normal.x, this.normal.z);
                        this.normal.y = 0;
                        this.normal.divideScalar(horizontal);
                        depth /= horizontal;
                    }
                    feet.addScaledVector(this.normal, depth);
                    this.line.start.addScaledVector(this.normal, depth);
                    this.line.end.addScaledVector(this.normal, depth);
                    correction = Math.max(correction, depth);
                    const into = velocity.dot(this.normal);
                    if (into < 0)
                        velocity.addScaledVector(this.normal, -into);
                    return false;
                },
            });
            if (correction < SKIN * .5)
                break;
        }
        return grounded;
    }
    penetration(feet, radius = PLAYER_RADIUS) {
        this.setCapsule(feet, radius);
        let depth = 0;
        this.bvh.shapecast({ intersectsBounds: box => box.intersectsBox(this.box), intersectsTriangle: triangle => {
                depth = Math.max(depth, radius - triangle.closestPointToSegment(this.line, this.trianglePoint, this.capsulePoint));
                // Endpoint/edge distance alone misses a triangle pierced through its interior by the capsule axis.
                const crossing = this.axisRay.intersectTriangle(triangle.a, triangle.b, triangle.c, false, this.trianglePoint);
                if (crossing && crossing.y <= this.line.end.y)
                    depth = Math.max(depth, radius);
                return false;
            } });
        return depth;
    }
    /** Search nearby supporting surfaces, ordered by displacement, including tops above an embedded spawn. */
    spawn(wanted, radius = PLAYER_RADIUS) {
        const candidates = [];
        for (let ring = 0; ring <= 16; ring++) {
            const samples = ring ? ring * 8 : 1;
            for (let i = 0; i < samples; i++) {
                const angle = i / samples * Math.PI * 2;
                const x = wanted.x + Math.cos(angle) * ring * .25, z = wanted.z + Math.sin(angle) * ring * .25;
                const ray = new Ray(new Vector3(x, 150, z), new Vector3(0, -1, 0));
                for (const hit of this.bvh.raycast(ray, DoubleSide)) {
                    if (hit.face.normal.y < WALKABLE_Y)
                        continue;
                    const feet = hit.point.clone();
                    feet.y += SKIN;
                    if (this.penetration(feet, radius) > SKIN)
                        continue;
                    // A wholly embedded capsule need not touch a triangle. First upward crossing must be an entrance (ceiling), not an exit.
                    const insideRay = new Ray(feet.clone().add(new Vector3(0, PLAYER_HEIGHT / 2, 0)), new Vector3(0, 1, 0));
                    const above = this.bvh.raycast(insideRay, DoubleSide).filter(hit => this.closedTriangles[hit.faceIndex]).sort((a, b) => a.distance - b.distance)[0];
                    if (above && above.face.normal.y > 0)
                        continue;
                    candidates.push(feet);
                }
            }
            candidates.sort((a, b) => a.distanceToSquared(wanted) - b.distanceToSquared(wanted));
            if (candidates.length && candidates[0].distanceTo(wanted) < (ring + 1) * .25)
                return candidates[0];
        }
        if (!candidates.length)
            throw new Error('No free supported spawn near requested position');
        return candidates[0];
    }
    stats() { return { buildMs: this.buildMs, triangles: this.triangles, solidMeshes: this.solidMeshes, steps: this.steps, meanStepMs: this.steps ? this.totalMs / this.steps : 0, maxStepMs: this.maxMs }; }
    dispose() { this.geometry.dispose(); }
}
