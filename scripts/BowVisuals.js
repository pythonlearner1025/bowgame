import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, SphereGeometry, CylinderGeometry, TubeGeometry, CatmullRomCurve3, Vector3, Quaternion, Color, DataTexture, RGBAFormat, SRGBColorSpace, RepeatWrapping, Line, LineBasicMaterial } from 'threepipe';
const V = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const up = V(0, 1, 0);
const smooth = (v) => { const t = Math.max(0, Math.min(1, v)); return t * t * (3 - 2 * t); };
function add(parent, geometry, material, name, position = V(), scale = V(1, 1, 1)) {
    const m = new Mesh(geometry, material);
    m.name = name;
    m.position.copy(position);
    m.scale.copy(scale);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
}
function oval(parent, material, name, p, s) { return add(parent, new SphereGeometry(1, 24, 18), material, name, p, s); }
/** Elliptical anatomical cross-sections; continuous normals avoid cylinder/sphere joint silhouettes. */
function loft(sections, segments = 32, sculpt) {
    const vertices = [], uv = [], indices = [];
    for (let j = 0; j < sections.length; j++)
        for (let i = 0; i <= segments; i++) {
            const [y, rx, rz, offset = 0] = sections[j], a = i / segments * Math.PI * 2;
            const v = sculpt?.(Math.sin(a) * rx, y, Math.cos(a) * rz + offset, a) ?? V(Math.sin(a) * rx, y, Math.cos(a) * rz + offset);
            vertices.push(v.x, v.y, v.z);
            uv.push(i / segments, j / (sections.length - 1));
            if (j && i) {
                const n = j * (segments + 1) + i;
                if (sections[0][0] < sections[sections.length - 1][0])
                    indices.push(n, n - 1, n - segments - 2, n, n - segments - 2, n - segments - 1);
                else
                    indices.push(n, n - segments - 2, n - 1, n, n - segments - 1, n - segments - 2);
            }
        }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
}
function skinMaterial(tone) {
    const size = 256, data = new Uint8Array(size * size * 4);
    let seed = 9127;
    for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            const grain = (seed / 4294967296 - .5) * 12;
            const mottling = 4 * Math.sin(x * .11) * Math.sin(y * .08) + 3 * Math.sin(x * .37 + y * .21);
            const j = (y * size + x) * 4;
            data[j] = 218 + grain + mottling;
            data[j + 1] = 198 + grain + mottling;
            data[j + 2] = 179 + grain + mottling;
            data[j + 3] = 255;
        }
    const map = new DataTexture(data, size, size, RGBAFormat);
    map.colorSpace = SRGBColorSpace;
    map.wrapS = map.wrapT = RepeatWrapping;
    map.needsUpdate = true;
    const m = new MeshStandardMaterial({ color: tone, map, roughness: .82, metalness: 0 });
    m.bumpMap = map;
    m.bumpScale = .0013;
    return m;
}
function span(m, a, b) { m.position.copy(a); m.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize()); m.scale.y = a.distanceTo(b); }
export function makeArm(skin, side) {
    const root = new Group();
    root.name = side < 0 ? 'Left articulated arm' : 'Right articulated arm';
    const upper = add(root, loft([[0, .063, .059], [.12, .081, .076], [.35, .084, .081], [.7, .067, .064], [1, .046, .046]]), skin, 'Deltoid to elbow');
    const lower = add(root, loft([[0, .049, .05], [.2, .064, .057], [.46, .06, .052], [.75, .046, .037], [1, .032, .029]]), skin, 'Tapered forearm');
    upper.scale.x = upper.scale.z = .85;
    lower.scale.x = lower.scale.z = .83;
    const elbow = oval(root, skin, 'Elbow', V(), V(.045, .052, .047));
    const shoulder = oval(root, skin, 'Rounded deltoid', V(), V(.082, .088, .078));
    const hand = new Group();
    hand.name = 'Articulated hand';
    root.add(hand);
    oval(hand, skin, 'Palm', V(.009 * side, 0, .018), V(.043, .053, .024));
    // Fingers curl over the grip. Individual phalanges and subtle nails remain readable close up.
    const nails = new MeshStandardMaterial({ color: 0xbba18c, roughness: .69 });
    for (let i = 0; i < 4; i++) {
        const y = .038 - i * .025;
        const knuckle = oval(hand, skin, 'Finger proximal joint', V(-.029 * side, y, -.008), V(.018, .013, .02));
        knuckle.rotation.y = side * .25;
        oval(hand, skin, 'Curled middle phalanx', V(-.033 * side, y, -.031), V(.013, .012, .017));
        oval(hand, skin, 'Finger tip', V(-.017 * side, y, -.043), V(.02, .011, .011));
        oval(hand, nails, 'Fingernail', V(-.006 * side, y, -.05), V(.009, .007, .0018));
    }
    const thumb = oval(hand, skin, 'Opposed thumb', V(.019 * side, .043, -.014), V(.023, .017, .038));
    thumb.rotation.y = side * .65;
    return { root, upper, lower, elbow, hand, shoulder };
}
export function poseArm(arm, shoulder, elbow, wrist, handRotation = new Quaternion()) {
    span(arm.upper, shoulder, elbow);
    span(arm.lower, elbow, wrist);
    arm.elbow.position.copy(elbow);
    arm.shoulder.position.copy(shoulder);
    arm.hand.position.copy(wrist);
    arm.hand.quaternion.copy(handRotation);
    arm.applyPose?.(shoulder, elbow, wrist, handRotation);
}
/** Original adult anatomy, using pre-October-2017 references; no extracted game assets. */
export function makeHuman(index = 0) {
    const root = new Group();
    root.name = 'Adult male survivor';
    const skin = skinMaterial([0xb88a6d, 0x92664f, 0xc19a7d, 0xa57458, 0xb38c6d, 0x9e755c][index % 6]);
    const sections = [[.83, .085, .08], [.9, .162, .119], [.99, .168, .125], [1.07, .139, .105], [1.16, .141, .104], [1.25, .17, .119], [1.34, .206, .128], [1.41, .214, .117], [1.47, .196, .096], [1.51, .13, .079], [1.55, .072, .07]];
    const torso = loft(sections, 48, (x, y, z, a) => {
        const front = Math.max(0, -Math.cos(a));
        // Pectorals flow into sternum, obliques taper to a restrained waist, with soft abdominal planes.
        const chest = Math.exp(-Math.pow((y - 1.355) / .09, 2)) * .033 * Math.exp(-Math.pow((Math.abs(x) - .105) / .095, 2));
        const abs = Math.exp(-Math.pow((y - 1.18) / .15, 2)) * .009 * (.5 + .5 * Math.cos((y - 1.12) * 52)) * Math.exp(-Math.pow((Math.abs(x) - .046) / .038, 2));
        return V(x, y, z - front * (chest + abs));
    });
    add(root, torso, skin, 'Continuous sculpted torso');
    add(root, loft([[1.49, .072, .067], [1.54, .063, .061], [1.6, .057, .057], [1.65, .065, .063]], 32), skin, 'Neck and trapezius');
    for (const side of [-1, 1]) {
        const collar = oval(root, skin, 'Clavicle', V(side * .104, 1.476, -.071), V(.105, .019, .024));
        collar.rotation.z = side * .12;
        const nippleMat = new MeshStandardMaterial({ color: new Color(skin.color).multiplyScalar(.68), roughness: .94 });
        oval(root, nippleMat, 'Subtle chest detail', V(side * .104, 1.34, -.146), V(.007, .006, .0018));
    }
    const navelMat = new MeshStandardMaterial({ color: new Color(skin.color).multiplyScalar(.60), roughness: 1 });
    oval(root, navelMat, 'Navel', V(0, 1.104, -.104), V(.007, .009, .002));
    // Smooth non-explicit lower-body coverage; body remains bare above/below the narrow waist wrap.
    const wrap = new MeshStandardMaterial({ color: 0x57463b, roughness: 1 });
    add(root, loft([[.858, .16, .124], [.882, .17, .132], [.96, .174, .135], [.994, .163, .128]], 40), wrap, 'Minimal weathered modesty wrap');
    const legs = [];
    for (const side of [-1, 1]) {
        const leg = new Group();
        leg.name = side < 0 ? 'Left hip joint' : 'Right hip joint';
        leg.position.set(side * .092, .91, 0);
        root.add(leg);
        const thigh = add(leg, loft([[0, .089, .102], [-.09, .096, .108], [-.23, .082, .09], [-.36, .059, .062], [-.44, .051, .054]], 32), skin, 'Thigh anatomy');
        thigh.rotation.z = side * -.035;
        const shin = new Group();
        shin.position.set(side * .015, -.43, 0);
        leg.add(shin);
        oval(shin, skin, 'Kneecap', V(0, 0, -.017), V(.054, .059, .054));
        add(shin, loft([[0, .051, .052], [-.09, .065, .074, .016], [-.19, .059, .069, .014], [-.3, .038, .041], [-.39, .033, .036]], 32), skin, 'Calf and ankle');
        oval(shin, skin, 'Bare heel', V(0, -.398, .015), V(.042, .052, .055));
        oval(shin, skin, 'Bare foot', V(0, -.418, -.069), V(.047, .041, .112));
        for (let toe = 0; toe < 5; toe++)
            oval(shin, skin, 'Toe', V((toe - 2) * .018, -.419, -.159 + toe * .007), V(.011 - toe * .0007, .019, .03 - toe * .002));
        legs.push({ root: leg, shin });
    }
    // Head silhouette: bald adult cranium, narrow temples, defined cheek and jaw rather than a sphere.
    const head = loft([[1.565, .035, .035, -.014], [1.59, .059, .057, -.013], [1.63, .075, .064, -.006], [1.67, .082, .071], [1.72, .081, .074, .004], [1.77, .08, .079, .01], [1.82, .061, .069, .014], [1.85, .03, .038, .016], [1.856, .002, .003, .016]], 48);
    add(root, head, skin, 'Bald adult head');
    const socket = new MeshStandardMaterial({ color: new Color(skin.color).multiplyScalar(.61), roughness: .97 });
    const eyeWhite = new MeshStandardMaterial({ color: 0x93938b, roughness: .5 });
    const iris = new MeshStandardMaterial({ color: 0x373a2d, roughness: .53 });
    const lip = new MeshStandardMaterial({ color: new Color(skin.color).multiplyScalar(.71), roughness: .91 });
    for (const side of [-1, 1]) {
        oval(root, skin, 'Ear', V(side * .082, 1.692, .003), V(.015, .033, .021));
        oval(root, socket, 'Ear concha', V(side * .092, 1.691, -.009), V(.005, .018, .008));
        oval(root, socket, 'Eye socket', V(side * .032, 1.712, -.064), V(.025, .014, .008));
        oval(root, eyeWhite, 'Eye', V(side * .032, 1.712, -.071), V(.018, .007, .006));
        oval(root, iris, 'Iris', V(side * .031, 1.712, -.077), V(.006, .006, .0016));
        const brow = oval(root, skin, 'Brow ridge', V(side * .03, 1.73, -.064), V(.031, .012, .014));
        brow.rotation.z = side * -.13;
        oval(root, skin, 'Cheek plane', V(side * .045, 1.685, -.058), V(.03, .025, .015));
        oval(root, socket, 'Nostril', V(side * .01, 1.673, -.087), V(.005, .003, .003));
    }
    oval(root, skin, 'Nose bridge', V(0, 1.7, -.074), V(.01, .027, .018));
    oval(root, skin, 'Nose tip', V(0, 1.679, -.09), V(.016, .012, .013));
    oval(root, skin, 'Muzzle plane', V(0, 1.653, -.062), V(.028, .024, .011));
    oval(root, lip, 'Upper lip', V(0, 1.653, -.074), V(.024, .004, .003));
    oval(root, skin, 'Lower lip', V(0, 1.646, -.074), V(.022, .005, .005));
    oval(root, skin, 'Chin', V(0, 1.611, -.057), V(.039, .023, .017));
    const left = makeArm(skin, -1), right = makeArm(skin, 1);
    root.add(left.root, right.root);
    const human = { root, left, right, legs, skin };
    poseHuman(human, 0, 0, true);
    return human;
}
export function poseHuman(h, draw, walk, relaxed = false) {
    const d = smooth(draw), l = V(-.245, 1.44, 0), r = V(.245, 1.44, 0);
    if (relaxed) {
        poseArm(h.left, l, V(-.28, 1.16, .013), V(-.27, .93, -.012));
        poseArm(h.right, r, V(.29, 1.15, .018), V(.28, .925, -.017));
    }
    else {
        poseArm(h.left, l, V(-.3, 1.34, -.31), V(-.24, 1.38, -.59));
        poseArm(h.right, r, V(.33 + d * .13, 1.21 + d * .23, -.12 + d * .11), V(-.24, 1.38, -.49 + d * .39));
    }
    h.legs[0].root.rotation.x = walk * .43;
    h.legs[1].root.rotation.x = -walk * .43;
    h.legs[0].shin.rotation.x = Math.max(0, -walk) * .55;
    h.legs[1].shin.rotation.x = Math.max(0, walk) * .55;
}
function recurveFinish() {
    const size = 128, data = new Uint8Array(size * size * 4);
    let seed = 7823;
    for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            const noise = (seed / 4294967296 - .5) * 8, wear = Math.pow(Math.max(0, Math.sin(x * .41 + y * .15)), 22) * 48;
            const i = (y * size + x) * 4;
            data[i] = 110 + noise + wear;
            data[i + 1] = 75 + noise + wear * .65;
            data[i + 2] = 46 + noise + wear * .4;
            data[i + 3] = 255;
        }
    const map = new DataTexture(data, size, size, RGBAFormat);
    map.colorSpace = SRGBColorSpace;
    map.wrapS = map.wrapT = RepeatWrapping;
    map.needsUpdate = true;
    return new MeshStandardMaterial({ color: 0xc1a17c, map, roughness: .9, metalness: 0 });
}
/** Original dark recurve recreation from the supplied clip: angular riser and open twin limbs. */
export function makeFieldBow() {
    const group = new Group();
    group.name = 'Dark open-limb recurve bow';
    const finish = recurveFinish(), grip = new MeshStandardMaterial({ color: 0x27262b, roughness: .85 });
    const riser = loft([[-.43, .038, .027], [-.35, .055, .031], [-.25, .061, .033], [-.19, .035, .029], [-.08, .025, .028], [0, .024, .027], [.1, .025, .026], [.22, .033, .029], [.28, .058, .034], [.40, .046, .027], [.44, .036, .025]], 12);
    const body = add(group, riser, finish, 'Sculpted recurve riser');
    body.scale.set(.67, .72, .62);
    add(group, loft([[-.08, .027, .030], [-.06, .028, .031], [.075, .027, .031], [.09, .025, .029]], 20), grip, 'Contoured hand grip');
    const cord = new MeshStandardMaterial({ color: 0xbca382, roughness: .97 });
    const coils = [];
    for (let i = 0; i <= 480; i++) {
        const t = i / 480, y = .185 + t * .115, angle = t * Math.PI * 2 * 18, radius = .036 + Math.sin(t * Math.PI) * .004;
        coils.push(V(Math.cos(angle) * radius, y, Math.sin(angle) * .025));
    }
    add(group, new TubeGeometry(new CatmullRomCurve3(coils), 480, .0028, 6, false), cord, 'Tan braided rope riser binding');
    const rails = [];
    for (const side of [-1, 1]) {
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(65 * 9 * 3), 3));
        const indices = [];
        for (let j = 1; j <= 64; j++)
            for (let i = 1; i <= 8; i++) {
                const n = j * 9 + i;
                indices.push(n, n - 1, n - 10, n, n - 10, n - 9);
            }
        geometry.setIndex(indices);
        const rail = add(group, geometry, finish, 'Flexible open limb rail');
        rail.userData.railSide = side;
        rails.push(rail);
    }
    const string = new Line(new BufferGeometry().setFromPoints([V(), V(), V()]), new LineBasicMaterial({ color: 0x6d6574 }));
    string.name = 'Bowstring anchored to tips and nock';
    group.add(string);
    group.userData.bowLimb = rails[0];
    group.userData.bowRails = rails;
    group.userData.bowString = string;
    deformBow(group, 0);
    return group;
}
export function bowNock(draw) { return V(0, .115, .145 + .68 * draw); }
/** Updates the existing rail buffers; arrow and string retain one shared nock throughout the clip. */
export function deformBow(group, draw, vibration = 0) {
    const rails = group.userData.bowRails;
    if (!rails)
        return;
    if (group.userData.lastVisualDraw === draw && group.userData.lastVisualVibration === vibration)
        return;
    group.userData.lastVisualDraw = draw;
    group.userData.lastVisualVibration = vibration;
    for (const rail of rails) {
        const p = rail.geometry.getAttribute('position'), side = rail.userData.railSide;
        for (let j = 0; j <= 64; j++) {
            const t = j / 32 - 1, at = Math.abs(t), y = t * (1.04 - .075 * draw), gap = .028 * smooth((at - .18) / .17) * (1 - Math.pow(at, 7)), z = -.09 * Math.sin(at * Math.PI) + draw * .18 * at * at + vibration * at;
            const radius = .008 * (1 - .40 * at);
            for (let i = 0; i <= 8; i++) {
                const a = i / 8 * Math.PI * 2;
                p.setXYZ(j * 9 + i, side * gap + Math.cos(a) * radius, y, z + Math.sin(a) * radius * 1.35);
            }
        }
        p.needsUpdate = true;
        rail.geometry.computeVertexNormals();
        rail.geometry.computeBoundingSphere();
    }
    const line = group.userData.bowString, sp = line.geometry.getAttribute('position');
    const tip = 1.04 - .075 * draw, z = draw * .18 + vibration, nock = bowNock(draw);
    sp.setXYZ(0, 0, -tip, z);
    sp.setXYZ(1, nock.x, nock.y, nock.z);
    sp.setXYZ(2, 0, tip, z);
    sp.needsUpdate = true;
    line.geometry.computeBoundingSphere();
}
/** Seconds are deterministic for inspection, and shared by the actual input/physics path. */
export function sampleBowPose(charge, releaseSeconds = -1, releaseCharge = 1, time = 0, aiming = false) {
    let draw = smooth(charge), kick = 0, vibration = 0, reload = 0, phase = charge >= 1 ? 'hold' : charge > 0 ? 'draw' : 'ready';
    let arrowVisible = true;
    if (releaseSeconds >= 0 && releaseSeconds < 1.05) {
        const t = releaseSeconds;
        draw = smooth(releaseCharge) * (1 - smooth(t / .065));
        kick = Math.sin(Math.min(1, t / .11) * Math.PI) * Math.exp(-t * 7);
        vibration = Math.sin(t * 115) * Math.exp(-t * 24) * .035 * releaseCharge;
        reload = Math.sin(smooth((t - .16) / .84) * Math.PI);
        arrowVisible = t > .91;
        phase = t < .12 ? 'release' : t < .86 ? 'nock' : 'recover';
    }
    const hold = draw > .96 ? Math.sin(time * 13) * .002 : 0;
    const grip = V((aiming ? .09 : .23) - draw * .105 + hold, -.285 + draw * .13 - kick * .026 - reload * .13, -.88 - draw * .045 + kick * .036);
    const roll = -.30 + draw * .20 + kick * .085 - reload * .35;
    const pull = bowNock(draw);
    pull.x += releaseSeconds >= 0 && releaseSeconds < .16 ? smooth(releaseSeconds / .16) * .07 : 0;
    if (reload) {
        pull.x += reload * .24;
        pull.y += reload * .58;
        pull.z += reload * .18;
    }
    return { draw, grip, roll, pull, vibration, arrowVisible, phase };
}
export function firstPersonSkin() { return skinMaterial(0xc0a28b); }
