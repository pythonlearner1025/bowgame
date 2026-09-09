import { Bone, BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, MeshStandardMaterial, Skeleton, SkinnedMesh, Vector3, Quaternion } from 'threepipe';
import { getHumanArmSource } from './BowHumanAsset.js';
import { handOrientation, poseHandFingers } from './BowHandPose.js';
const v = (a) => new Vector3().fromArray(a);
const unit = (x, y, z) => new Vector3(x, y, z).normalize();
/** Reuse the CC0 human's continuous palm, nails, knuckles and forearm, preserving original skin UVs and weights. */
export function attachFirstPersonArm(arm, side, source = getHumanArmSource().asset) {
    if (!source)
        return false;
    const data = source, letter = side < 0 ? 'L' : 'R', find = (name) => data.bones.findIndex(b => b.name === name + '.' + letter);
    const upper = find('upperarm01'), lower = find('lowerarm01'), wrist = find('wrist');
    const allowed = new Set(data.bones.flatMap((b, i) => b.name.endsWith('.' + letter) && /^(upperarm|lowerarm|wrist|finger|metacarpal)/.test(b.name) ? [i] : []));
    const keep = (i) => { let weight = 0; for (let j = 0; j < 4; j++)
        if (allowed.has(data.skinIndex[i * 4 + j]))
            weight += data.skinWeight[i * 4 + j]; return weight > .985; };
    const oldIndices = [];
    for (let i = 0; i < data.indices.length; i += 3) {
        const a = data.indices[i], b = data.indices[i + 1], c = data.indices[i + 2];
        if (keep(a) && keep(b) && keep(c))
            oldIndices.push(a, b, c);
    }
    const remap = new Map(), positions = [], uvs = [], skinIndex = [], skinWeight = [], indices = [];
    for (const old of oldIndices) {
        if (!remap.has(old)) {
            remap.set(old, remap.size);
            positions.push(...data.positions.slice(old * 3, old * 3 + 3));
            uvs.push(...data.uvs.slice(old * 2, old * 2 + 2));
            skinIndex.push(...data.skinIndex.slice(old * 4, old * 4 + 4));
            skinWeight.push(...data.skinWeight.slice(old * 4, old * 4 + 4));
        }
        indices.push(remap.get(old));
    }
    // Match the source viewmodel's broad forearms while leaving every longitudinal joint center unchanged.
    const armSegments = ['upperarm01', 'upperarm02', 'lowerarm01', 'lowerarm02'].map(name => { const info = data.bones[find(name)]; return { head: v(info.head), tail: v(info.tail) }; });
    for (let i = 0; i < positions.length; i += 3) {
        const point = new Vector3(positions[i], positions[i + 1], positions[i + 2]);
        let weight = 0;
        for (let j = 0; j < 4; j++)
            if (/^(upperarm|lowerarm)/.test(data.bones[skinIndex[i / 3 * 4 + j]].name))
                weight += skinWeight[i / 3 * 4 + j];
        if (weight > .01) {
            let nearest = new Vector3(), distance = Infinity;
            for (const segment of armSegments) {
                const axis = segment.tail.clone().sub(segment.head), t = Math.max(0, Math.min(1, point.clone().sub(segment.head).dot(axis) / axis.lengthSq())), center = segment.head.clone().addScaledVector(axis, t), d = point.distanceToSquared(center);
                if (d < distance) {
                    distance = d;
                    nearest = center;
                }
            }
            point.sub(nearest).multiplyScalar(1 + .72 * weight).add(nearest);
            positions[i] = point.x;
            positions[i + 1] = point.y;
            positions[i + 2] = point.z;
        }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(skinIndex, 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(skinWeight, 4));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const normal = geometry.getAttribute('normal'), points = geometry.getAttribute('position'), shared = new Map();
    const key = (i) => `${points.getX(i).toFixed(5)},${points.getY(i).toFixed(5)},${points.getZ(i).toFixed(5)}`;
    for (let i = 0; i < points.count; i++) {
        const k = key(i), n = shared.get(k) ?? new Vector3();
        n.add(new Vector3().fromBufferAttribute(normal, i));
        shared.set(k, n);
    }
    for (let i = 0; i < points.count; i++) {
        const n = shared.get(key(i)).clone().normalize();
        normal.setXYZ(i, n.x, n.y, n.z);
    }
    const material = new MeshStandardMaterial({ map: getHumanArmSource().skinTexture ?? null, color: 0xffdfbd, emissive: 0x6c3210, emissiveIntensity: .40, roughness: .80, metalness: 0 });
    const surface = new SkinnedMesh(geometry, material);
    surface.name = `Anatomical ${letter} viewmodel arm and hand`;
    surface.frustumCulled = false;
    surface.castShadow = false;
    surface.receiveShadow = false;
    const bones = data.bones.map(info => { const bone = new Bone(); bone.name = info.name; bone.position.fromArray(info.position); return bone; });
    for (let i = 0; i < bones.length; i++) {
        const parent = data.bones[i].parent;
        if (parent < 0)
            surface.add(bones[i]);
        else
            bones[parent].add(bones[i]);
    }
    arm.root.traverse((o) => { if (o.isMesh)
        o.visible = false; });
    arm.root.add(surface);
    arm.root.updateMatrixWorld(true);
    surface.bind(new Skeleton(bones));
    let openness = 0;
    arm.setFingerRelease = value => { openness = Math.max(0, Math.min(1, value)); };
    const restUpper = v(data.bones[lower].head).sub(v(data.bones[upper].head)), restLower = v(data.bones[wrist].head).sub(v(data.bones[lower].head));
    const worldRotation = (index) => { const chain = []; let i = index; while (i >= 0) {
        chain.unshift(i);
        i = data.bones[i].parent;
    } const q = new Quaternion(); for (const i of chain)
        q.multiply(bones[i].quaternion); return q; };
    const orient = (index, q) => bones[index].quaternion.copy(worldRotation(data.bones[index].parent).invert().multiply(q));
    const last = { shoulder: new Vector3(Infinity, 0, 0), elbow: new Vector3(), grip: new Vector3(), roll: new Quaternion(), openness: -1 };
    arm.applyPose = (shoulder, elbow, grip, roll) => {
        if (openness === last.openness && shoulder.equals(last.shoulder) && elbow.equals(last.elbow) && grip.equals(last.grip) && roll.equals(last.roll))
            return;
        last.shoulder.copy(shoulder);
        last.elbow.copy(elbow);
        last.grip.copy(grip);
        last.roll.copy(roll);
        last.openness = openness;
        const loadOpen = side < 0 ? Math.max(0, Math.min(1, (openness - .15) / .8)) : 0;
        const offset = side < 0 ? new Vector3(-.082, -.114, .092).applyQuaternion(roll).lerp(new Vector3(-.025, .060, .055), loadOpen) : new Vector3(.085, -.06, -.02);
        const target = grip.clone().add(offset);
        const parent = data.bones[upper].parent;
        bones[upper].position.copy(shoulder).sub(v(data.bones[parent].head));
        orient(upper, new Quaternion().setFromUnitVectors(restUpper.clone().normalize(), elbow.clone().sub(shoulder).normalize()));
        const upper2 = find('upperarm02'), lower2 = find('lowerarm02'), upperScale = shoulder.distanceTo(elbow) / restUpper.length();
        bones[upper2].position.copy(v(data.bones[upper2].position)).multiplyScalar(upperScale);
        bones[lower].position.copy(v(data.bones[lower].position)).multiplyScalar(upperScale);
        orient(lower, new Quaternion().setFromUnitVectors(restLower.clone().normalize(), target.clone().sub(elbow).normalize()));
        const scale = elbow.distanceTo(target) / restLower.length();
        bones[lower2].position.copy(v(data.bones[lower2].position)).multiplyScalar(scale);
        bones[wrist].position.copy(v(data.bones[wrist].position)).multiplyScalar(scale);
        const gripOrientation = roll.clone().multiply(handOrientation(data, letter, unit(.155, .837, -.52), new Vector3(-.607, -.75, -1.389)));
        const wristOrientation = side < 0 ? gripOrientation.slerp(handOrientation(data, letter, unit(.995, .05, -.10), new Vector3(-.05, .995, 0)), loadOpen) : handOrientation(data, letter, unit(-.55, .80, -.23), new Vector3(0, -.25, -1));
        orient(wrist, wristOrientation);
        bones[wrist].scale.setScalar(1.35);
        poseHandFingers(data, bones, letter, side > 0, openness);
        surface.updateMatrixWorld(true);
        surface.skeleton.update();
    };
    return true;
}
