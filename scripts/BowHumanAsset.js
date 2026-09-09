import { Bone, BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Group, MeshStandardMaterial, Skeleton, SkinnedMesh, Texture, TextureLoader, SRGBColorSpace, Vector3, Quaternion } from 'threepipe';
import { handOrientation, poseHandFingers } from './BowHandPose.js';
let asset, skinTexture, eyeTexture;
let pending;
const base = '/kite/assets/bow-survivor/';
export function getHumanArmSource() { return { asset, skinTexture }; }
/** Bundled CC0 anatomy is loaded once from this local editor, never a runtime third-party service. */
export function preloadHumanAsset() {
    return pending ??= Promise.all([
        fetch(base + 'male-adult-rigged.json').then(r => { if (!r.ok)
            throw new Error('Adult model unavailable'); return r.json(); }),
        new TextureLoader().loadAsync(base + 'skin-male.png'),
        new TextureLoader().loadAsync(base + 'eyes-brown.png'),
    ]).then(([data, map, eyes]) => { asset = data; skinTexture = map; eyeTexture = eyes; map.colorSpace = eyes.colorSpace = SRGBColorSpace; map.anisotropy = 8; });
}
const v = (a) => new Vector3().fromArray(a);
/** OBJ UV seams duplicate positions. Average surface normals across those seams without changing UVs. */
function smoothAnatomyNormals(g) {
    g.computeVertexNormals();
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), sums = new Map();
    const key = (i) => `${p.getX(i).toFixed(5)},${p.getY(i).toFixed(5)},${p.getZ(i).toFixed(5)}`;
    for (let i = 0; i < p.count; i++) {
        const k = key(i), sum = sums.get(k) ?? new Vector3();
        sum.add(new Vector3().fromBufferAttribute(n, i));
        sums.set(k, sum);
    }
    for (let i = 0; i < p.count; i++) {
        const normal = sums.get(key(i)).clone().normalize();
        n.setXYZ(i, normal.x, normal.y, normal.z);
    }
    n.needsUpdate = true;
}
/** Keep the procedural rig's public IK controls, replacing its surface with a connected GPU-skinned body. */
export function attachHumanAsset(human, index, source = asset) {
    if (!source)
        return false;
    const data = source;
    human.root.traverse((o) => { if (o.isMesh && o.name !== 'Minimal weathered modesty wrap')
        o.visible = false; });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(data.uvs, 2));
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(data.skinIndex, 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(data.skinWeight, 4));
    geometry.setIndex(data.indices);
    smoothAnatomyNormals(geometry);
    const material = new MeshStandardMaterial({ map: skinTexture ?? null, color: [0xdcc8b8, 0x9d7e68, 0xe2ccba, 0xb99a82, 0xc3ac94, 0xb09179][index % 6], roughness: .83, metalness: 0 });
    const surface = new SkinnedMesh(geometry, material);
    surface.name = 'CC0 connected adult male anatomy';
    surface.castShadow = surface.receiveShadow = true;
    surface.frustumCulled = false;
    const bones = data.bones.map(info => { const b = new Bone(); b.name = info.name; b.position.fromArray(info.position); return b; });
    for (let i = 0; i < bones.length; i++) {
        const parent = data.bones[i].parent;
        if (parent < 0)
            surface.add(bones[i]);
        else
            bones[parent].add(bones[i]);
    }
    const visual = new Group();
    visual.name = 'Grounded survivor surface';
    visual.position.y = -.04;
    human.root.add(visual);
    const cover = human.root.getObjectByName('Minimal weathered modesty wrap');
    if (cover)
        visual.add(cover);
    visual.add(surface);
    visual.updateMatrixWorld(true);
    surface.updateMatrixWorld(true);
    surface.bind(new Skeleton(bones));
    if (data.eyes) {
        const e = data.eyes, g = new BufferGeometry();
        g.setAttribute('position', new Float32BufferAttribute(e.positions, 3));
        g.setAttribute('uv', new Float32BufferAttribute(e.uvs, 2));
        g.setAttribute('skinIndex', new Uint16BufferAttribute(e.skinIndex, 4));
        g.setAttribute('skinWeight', new Float32BufferAttribute(e.skinWeight, 4));
        g.setIndex(e.indices);
        g.computeVertexNormals();
        const eyes = new SkinnedMesh(g, new MeshStandardMaterial({ map: eyeTexture ?? null, roughness: .35 }));
        eyes.name = 'Anatomical eyes';
        eyes.frustumCulled = false;
        visual.add(eyes);
        eyes.bind(surface.skeleton, surface.bindMatrix);
    }
    const nameIndices = new Map(data.bones.map((b, i) => [b.name, i]));
    const find = (name) => nameIndices.get(name) ?? -1;
    // Rest coordinates are editor-local. Surface may move in world with the bot, so solve using local matrices.
    const poseBone = (index, worldRotation) => {
        const parent = data.bones[index].parent;
        const parentRotation = new Quaternion();
        if (parent >= 0) {
            const chain = [];
            let p = parent;
            while (p >= 0) {
                chain.unshift(p);
                p = data.bones[p].parent;
            }
            for (const b of chain)
                parentRotation.multiply(bones[b].quaternion);
        }
        bones[index].quaternion.copy(parentRotation.invert().multiply(worldRotation));
    };
    const localHead = (index) => surface.worldToLocal(bones[index].getWorldPosition(new Vector3()));
    const solveArm = (side, goal, guide, relaxed, roll) => {
        const upper = find('upperarm01.' + side), lower = find('lowerarm01.' + side), wrist = find('wrist.' + side);
        if (upper < 0 || lower < 0 || wrist < 0)
            return;
        const upperRest = v(data.bones[lower].head).sub(v(data.bones[upper].head)), lowerRest = v(data.bones[wrist].head).sub(v(data.bones[lower].head));
        const shoulder = localHead(upper), length1 = upperRest.length(), length2 = lowerRest.length();
        // Wrist sits behind the palm. Fingers wrap the bow/string instead of placing the wrist on the grip.
        const target = goal.clone().add(relaxed ? new Vector3(0, .035, 0) : (side === 'L' ? new Vector3(-.038, -.026, .106) : new Vector3(.010, -.023, .145)).applyQuaternion(roll));
        target.y += .04;
        const direction = target.clone().sub(shoulder), distance = Math.min(direction.length(), length1 + length2 - .001);
        direction.normalize();
        const a = (length1 * length1 - length2 * length2 + distance * distance) / (2 * distance), height = Math.sqrt(Math.max(0, length1 * length1 - a * a));
        const bend = guide.clone().sub(shoulder).addScaledVector(direction, -guide.clone().sub(shoulder).dot(direction)).normalize();
        const elbow = shoulder.clone().addScaledVector(direction, a).addScaledVector(bend, height);
        poseBone(upper, new Quaternion().setFromUnitVectors(upperRest.clone().normalize(), elbow.clone().sub(shoulder).normalize()));
        const actualElbow = localHead(lower);
        poseBone(lower, new Quaternion().setFromUnitVectors(lowerRest.clone().normalize(), target.clone().sub(actualElbow).normalize()));
        if (relaxed) {
            const middle = find('finger3-1.' + side), rest = v(data.bones[middle].head).sub(v(data.bones[wrist].head)).normalize();
            poseBone(wrist, new Quaternion().setFromUnitVectors(rest, new Vector3(0, -1, 0)));
        }
        else {
            const direction = (side === 'L' ? new Vector3(.03, .16, -1) : new Vector3(.28, .1, -1)).normalize();
            poseBone(wrist, roll.clone().multiply(handOrientation(data, side, direction, new Vector3(0, -1, 0))));
        }
        poseHandFingers(data, bones, side, side === 'R', relaxed ? 1 : 0);
    };
    human.applyPose = (relaxed) => {
        solveArm('L', human.left.hand.position, human.left.elbow.position, relaxed, human.left.hand.quaternion);
        solveArm('R', human.right.hand.position, human.right.elbow.position, relaxed, human.right.hand.quaternion);
        for (let i = 0; i < 2; i++) {
            const side = i === 0 ? 'L' : 'R', upper = find('upperleg01.' + side), lower = find('lowerleg01.' + side);
            if (upper >= 0)
                bones[upper].quaternion.setFromAxisAngle(new Vector3(1, 0, 0), human.legs[i].root.rotation.x);
            if (lower >= 0)
                bones[lower].quaternion.setFromAxisAngle(new Vector3(1, 0, 0), human.legs[i].shin.rotation.x);
        }
        surface.updateMatrixWorld(true);
    };
    human.applyPose(true);
    return true;
}
