/**
 * Rebuilds first-person arms from the bundled CC0 skinned human mesh and skeleton.
 * It does not load assets, choose gameplay poses, or create the third-person body.
 */
/*
 * Skin thresholds, anatomical offsets, and wrist directions are calibrated rig data. They stay
 * beside the deformation they control so the source model adaptation remains auditable.
 */
/* eslint-disable no-magic-numbers */
import { Bone, BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, MeshStandardMaterial, Skeleton, SkinnedMesh, Vector3, Quaternion, } from 'threepipe';
import { getHumanArmSource } from './BowHumanAsset.js';
import { handOrientation, poseHandFingers } from './BowHandPose.js';
const vectorFromArray = (values) => new Vector3().fromArray(values);
const unit = (x, y, z) => new Vector3(x, y, z).normalize();
function findNearestSegmentPoint(point, segments) {
    let nearestPoint = new Vector3();
    let nearestDistanceSquared = Infinity;
    for (const segment of segments) {
        const axis = segment.tail.clone().sub(segment.head);
        const fraction = Math.max(0, Math.min(1, point.clone().sub(segment.head).dot(axis) / axis.lengthSq()));
        const candidatePoint = segment.head.clone().addScaledVector(axis, fraction);
        const distanceSquared = point.distanceToSquared(candidatePoint);
        if (distanceSquared < nearestDistanceSquared) {
            nearestDistanceSquared = distanceSquared;
            nearestPoint = candidatePoint;
        }
    }
    return nearestPoint;
}
/**
 * Reuses the CC0 human's continuous palm, nails, knuckles, forearm, UVs, and skin weights.
 *
 * @param arm - First-person procedural arm rig that receives the skinned surface and pose hook.
 * @param side - Negative for the left arm or positive for the right arm.
 * @param source - Parsed bundled human asset, or `null` before it has loaded.
 * @returns Whether a source asset was available and attached.
 */
export function attachFirstPersonArm(arm, side, source = getHumanArmSource().asset) {
    if (!source) {
        return false;
    }
    const data = source;
    const letter = side < 0 ? 'L' : 'R';
    const find = (name) => data.bones.findIndex((boneInfo) => boneInfo.name === `${name}.${letter}`);
    const upper = find('upperarm01');
    const lower = find('lowerarm01');
    const wrist = find('wrist');
    // The prefix pattern selects only the arm and hand chains from the complete body skeleton.
    const allowed = new Set(data.bones.flatMap((boneInfo, i) => boneInfo.name.endsWith(`.${letter}`) &&
        /^(upperarm|lowerarm|wrist|finger|metacarpal)/.test(boneInfo.name)
        ? [i]
        : []));
    const keep = (i) => {
        let weight = 0;
        for (let j = 0; j < 4; j++)
            if (allowed.has(data.skinIndex[i * 4 + j]))
                weight += data.skinWeight[i * 4 + j];
        return weight > 0.985;
    };
    const oldIndices = [];
    for (let i = 0; i < data.indices.length; i += 3) {
        const firstIndex = data.indices[i];
        const secondIndex = data.indices[i + 1];
        const thirdIndex = data.indices[i + 2];
        if (keep(firstIndex) && keep(secondIndex) && keep(thirdIndex)) {
            oldIndices.push(firstIndex, secondIndex, thirdIndex);
        }
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
        const remappedIndex = remap.get(old);
        if (remappedIndex === undefined) {
            throw new Error('First-person arm vertex remap was not created');
        }
        indices.push(remappedIndex);
    }
    // Match the source viewmodel's broad forearms while leaving every longitudinal joint center unchanged.
    const armSegments = ['upperarm01', 'upperarm02', 'lowerarm01', 'lowerarm02'].map((name) => {
        const info = data.bones[find(name)];
        return { head: vectorFromArray(info.head), tail: vectorFromArray(info.tail) };
    });
    for (let i = 0; i < positions.length; i += 3) {
        const point = new Vector3(positions[i], positions[i + 1], positions[i + 2]);
        let weight = 0;
        for (let j = 0; j < 4; j++)
            if (/^(upperarm|lowerarm)/.test(data.bones[skinIndex[(i / 3) * 4 + j]].name))
                weight += skinWeight[(i / 3) * 4 + j];
        if (weight > 0.01) {
            const nearest = findNearestSegmentPoint(point, armSegments);
            point
                .sub(nearest)
                .multiplyScalar(1 + 0.72 * weight)
                .add(nearest);
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
    const normal = geometry.getAttribute('normal');
    const points = geometry.getAttribute('position');
    const shared = new Map();
    const key = (i) => `${points.getX(i).toFixed(5)},${points.getY(i).toFixed(5)},${points.getZ(i).toFixed(5)}`;
    for (let i = 0; i < points.count; i++) {
        const positionKey = key(i);
        const summedNormal = shared.get(positionKey) ?? new Vector3();
        summedNormal.add(new Vector3().fromBufferAttribute(normal, i));
        shared.set(positionKey, summedNormal);
    }
    for (let i = 0; i < points.count; i++) {
        const summedNormal = shared.get(key(i));
        if (!summedNormal) {
            throw new Error('First-person arm normal group was not created');
        }
        const normalized = summedNormal.clone().normalize();
        normal.setXYZ(i, normalized.x, normalized.y, normalized.z);
    }
    const material = new MeshStandardMaterial({
        map: getHumanArmSource().skinTexture ?? null,
        color: 0xffdfbd,
        emissive: 0x6c3210,
        emissiveIntensity: 0.4,
        roughness: 0.8,
        metalness: 0,
    });
    const surface = new SkinnedMesh(geometry, material);
    surface.name = `Anatomical ${letter} viewmodel arm and hand`;
    surface.frustumCulled = false;
    surface.castShadow = false;
    surface.receiveShadow = false;
    const bones = data.bones.map((info) => {
        const bone = new Bone();
        bone.name = info.name;
        bone.position.fromArray(info.position);
        return bone;
    });
    for (let i = 0; i < bones.length; i++) {
        const parent = data.bones[i].parent;
        if (parent < 0)
            surface.add(bones[i]);
        else
            bones[parent].add(bones[i]);
    }
    arm.root.traverse((object) => {
        if ('isMesh' in object && object.isMesh) {
            object.visible = false;
        }
    });
    arm.root.add(surface);
    arm.root.updateMatrixWorld(true);
    surface.bind(new Skeleton(bones));
    let openness = 0;
    arm.setFingerRelease = (value) => {
        openness = Math.max(0, Math.min(1, value));
    };
    const restUpper = vectorFromArray(data.bones[lower].head).sub(vectorFromArray(data.bones[upper].head));
    const restLower = vectorFromArray(data.bones[wrist].head).sub(vectorFromArray(data.bones[lower].head));
    const worldRotation = (index) => {
        const chain = [];
        let i = index;
        while (i >= 0) {
            chain.unshift(i);
            i = data.bones[i].parent;
        }
        const rotation = new Quaternion();
        for (const i of chain) {
            rotation.multiply(bones[i].quaternion);
        }
        return rotation;
    };
    const orient = (index, rotation) => bones[index].quaternion.copy(worldRotation(data.bones[index].parent).invert().multiply(rotation));
    const last = {
        shoulder: new Vector3(Infinity, 0, 0),
        elbow: new Vector3(),
        grip: new Vector3(),
        roll: new Quaternion(),
        openness: -1,
    };
    arm.applyPose = (shoulder, elbow, grip, roll) => {
        if (openness === last.openness &&
            shoulder.equals(last.shoulder) &&
            elbow.equals(last.elbow) &&
            grip.equals(last.grip) &&
            roll.equals(last.roll))
            return;
        last.shoulder.copy(shoulder);
        last.elbow.copy(elbow);
        last.grip.copy(grip);
        last.roll.copy(roll);
        last.openness = openness;
        const loadOpen = side < 0 ? Math.max(0, Math.min(1, (openness - 0.15) / 0.8)) : 0;
        const offset = side < 0
            ? new Vector3(-0.082, -0.114, 0.092)
                .applyQuaternion(roll)
                .lerp(new Vector3(-0.025, 0.06, 0.055), loadOpen)
            : new Vector3(0.085, -0.06, -0.02);
        const target = grip.clone().add(offset);
        const parent = data.bones[upper].parent;
        bones[upper].position.copy(shoulder).sub(vectorFromArray(data.bones[parent].head));
        orient(upper, new Quaternion().setFromUnitVectors(restUpper.clone().normalize(), elbow.clone().sub(shoulder).normalize()));
        const upperTwist = find('upperarm02');
        const lowerTwist = find('lowerarm02');
        const upperScale = shoulder.distanceTo(elbow) / restUpper.length();
        bones[upperTwist].position
            .copy(vectorFromArray(data.bones[upperTwist].position))
            .multiplyScalar(upperScale);
        bones[lower].position
            .copy(vectorFromArray(data.bones[lower].position))
            .multiplyScalar(upperScale);
        orient(lower, new Quaternion().setFromUnitVectors(restLower.clone().normalize(), target.clone().sub(elbow).normalize()));
        const scale = elbow.distanceTo(target) / restLower.length();
        bones[lowerTwist].position
            .copy(vectorFromArray(data.bones[lowerTwist].position))
            .multiplyScalar(scale);
        bones[wrist].position.copy(vectorFromArray(data.bones[wrist].position)).multiplyScalar(scale);
        const gripOrientation = roll
            .clone()
            .multiply(handOrientation(data, letter, unit(0.155, 0.837, -0.52), new Vector3(-0.607, -0.75, -1.389)));
        const wristOrientation = side < 0
            ? gripOrientation.slerp(handOrientation(data, letter, unit(0.995, 0.05, -0.1), new Vector3(-0.05, 0.995, 0)), loadOpen)
            : handOrientation(data, letter, unit(-0.55, 0.8, -0.23), new Vector3(0, -0.25, -1));
        orient(wrist, wristOrientation);
        bones[wrist].scale.setScalar(1.35);
        poseHandFingers({ data, bones, side: letter, isHooked: side > 0, openness });
        surface.updateMatrixWorld(true);
        surface.skeleton.update();
    };
    return true;
}
