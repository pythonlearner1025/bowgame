/**
 * Creates and poses the procedural bow, fallback body, and first-person limb geometry.
 * It does not load the bundled human asset, integrate gameplay, or own scene lifecycle.
 */

/*
 * Cross-sections, colors, and pose coordinates are authored visual data calibrated to the
 * supplied reference clip. They remain inline so each shape can be reviewed as a coherent model.
 */
/* eslint-disable no-magic-numbers */
/* eslint-disable max-params -- Existing public pose helpers and geometric primitives are stable. */

import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TubeGeometry,
  CatmullRomCurve3,
  Vector3,
  Quaternion,
  Color,
  DataTexture,
  RGBAFormat,
  SRGBColorSpace,
  RepeatWrapping,
  Line,
  LineBasicMaterial,
} from 'threepipe';

const vector = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const UP_AXIS = vector(0, 1, 0);

const smooth = (value: number) => {
  const fraction = Math.max(0, Math.min(1, value));

  return fraction * fraction * (3 - 2 * fraction);
};

function add(
  parent: Group,
  geometry: BufferGeometry,
  material: MeshStandardMaterial,
  name: string,
  position = vector(),
  scale = vector(1, 1, 1),
) {
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.position.copy(position);
  mesh.scale.copy(scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);

  return mesh;
}

function oval(
  parent: Group,
  material: MeshStandardMaterial,
  name: string,
  position: Vector3,
  scale: Vector3,
) {
  return add(parent, new SphereGeometry(1, 24, 18), material, name, position, scale);
}

type Section = [number, number, number, number?];

/**
 * Builds continuous elliptical cross-sections without cylinder/sphere joint silhouettes.
 *
 * @param sections - Height, X radius, Z radius, and optional Z offset for each section.
 * @param segments - Radial segment count around each section.
 * @param sculpt - Optional point transform for additional anatomical shaping.
 * @returns A new indexed geometry with continuous vertex normals.
 */
function loft(
  sections: Section[],
  segments = 32,
  sculpt?: (x: number, y: number, z: number, angle: number) => Vector3,
) {
  const vertices: number[] = [];
  const textureCoordinates: number[] = [];
  const indices: number[] = [];

  for (let j = 0; j < sections.length; j++) {
    for (let i = 0; i <= segments; i++) {
      const [y, radiusX, radiusZ, offset = 0] = sections[j];
      const angle = (i / segments) * Math.PI * 2;
      const point =
        sculpt?.(Math.sin(angle) * radiusX, y, Math.cos(angle) * radiusZ + offset, angle) ??
        vector(Math.sin(angle) * radiusX, y, Math.cos(angle) * radiusZ + offset);
      vertices.push(point.x, point.y, point.z);
      textureCoordinates.push(i / segments, j / (sections.length - 1));

      if (j === 0 || i === 0) {
        continue;
      }

      const index = j * (segments + 1) + i;
      const isAscending = sections[0][0] < sections[sections.length - 1][0];

      if (isAscending) {
        indices.push(
          index,
          index - 1,
          index - segments - 2,
          index,
          index - segments - 2,
          index - segments - 1,
        );
      } else {
        indices.push(
          index,
          index - segments - 2,
          index - 1,
          index,
          index - segments - 1,
          index - segments - 2,
        );
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(textureCoordinates, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}

function skinMaterial(tone: number) {
  const size = 256,
    data = new Uint8Array(size * size * 4);
  let seed = 9127;

  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const grain = (seed / 4294967296 - 0.5) * 12;
      const mottling =
        4 * Math.sin(x * 0.11) * Math.sin(y * 0.08) + 3 * Math.sin(x * 0.37 + y * 0.21);
      const j = (y * size + x) * 4;
      data[j] = 218 + grain + mottling;
      data[j + 1] = 198 + grain + mottling;
      data[j + 2] = 179 + grain + mottling;
      data[j + 3] = 255;
    }

  const map = new DataTexture(data, size, size, RGBAFormat);
  map.colorSpace = SRGBColorSpace;
  map.wrapS = RepeatWrapping;
  map.wrapT = RepeatWrapping;
  map.needsUpdate = true;
  const material = new MeshStandardMaterial({ color: tone, map, roughness: 0.82, metalness: 0 });
  material.bumpMap = map;
  material.bumpScale = 0.0013;

  return material;
}

function span(mesh: Mesh, start: Vector3, end: Vector3) {
  mesh.position.copy(start);
  mesh.quaternion.setFromUnitVectors(UP_AXIS, end.clone().sub(start).normalize());
  mesh.scale.y = start.distanceTo(end);
}

/** A procedural arm plus optional hooks installed by the bundled skinned model. */
export interface ArmRig {
  applyPose?: (shoulder: Vector3, elbow: Vector3, grip: Vector3, rotation: Quaternion) => void;
  setFingerRelease?: (openness: number) => void;
  root: Group;
  upper: Mesh;
  lower: Mesh;
  elbow: Mesh;
  hand: Group;
  shoulder: Mesh;
}

/**
 * Creates one fallback articulated arm and hand.
 *
 * @param skin - Shared procedural skin material.
 * @param side - Negative for the left arm or positive for the right arm.
 * @returns A new arm rig ready for inverse-kinematics posing.
 */
export function makeArm(skin: MeshStandardMaterial, side: number): ArmRig {
  const root = new Group();
  root.name = side < 0 ? 'Left articulated arm' : 'Right articulated arm';
  const upper = add(
    root,
    loft([
      [0, 0.063, 0.059],
      [0.12, 0.081, 0.076],
      [0.35, 0.084, 0.081],
      [0.7, 0.067, 0.064],
      [1, 0.046, 0.046],
    ]),
    skin,
    'Deltoid to elbow',
  );
  const lower = add(
    root,
    loft([
      [0, 0.049, 0.05],
      [0.2, 0.064, 0.057],
      [0.46, 0.06, 0.052],
      [0.75, 0.046, 0.037],
      [1, 0.032, 0.029],
    ]),
    skin,
    'Tapered forearm',
  );
  upper.scale.x = 0.85;
  upper.scale.z = 0.85;
  lower.scale.x = 0.83;
  lower.scale.z = 0.83;
  const elbow = oval(root, skin, 'Elbow', vector(), vector(0.045, 0.052, 0.047));
  const shoulder = oval(root, skin, 'Rounded deltoid', vector(), vector(0.082, 0.088, 0.078));
  const hand = new Group();
  hand.name = 'Articulated hand';
  root.add(hand);
  oval(hand, skin, 'Palm', vector(0.009 * side, 0, 0.018), vector(0.043, 0.053, 0.024));
  // Fingers curl over the grip. Individual phalanges and subtle nails remain readable close up.
  const nails = new MeshStandardMaterial({ color: 0xbba18c, roughness: 0.69 });

  for (let i = 0; i < 4; i++) {
    const y = 0.038 - i * 0.025;
    const knuckle = oval(
      hand,
      skin,
      'Finger proximal joint',
      vector(-0.029 * side, y, -0.008),
      vector(0.018, 0.013, 0.02),
    );
    knuckle.rotation.y = side * 0.25;
    oval(
      hand,
      skin,
      'Curled middle phalanx',
      vector(-0.033 * side, y, -0.031),
      vector(0.013, 0.012, 0.017),
    );
    oval(hand, skin, 'Finger tip', vector(-0.017 * side, y, -0.043), vector(0.02, 0.011, 0.011));
    oval(hand, nails, 'Fingernail', vector(-0.006 * side, y, -0.05), vector(0.009, 0.007, 0.0018));
  }

  const thumb = oval(
    hand,
    skin,
    'Opposed thumb',
    vector(0.019 * side, 0.043, -0.014),
    vector(0.023, 0.017, 0.038),
  );
  thumb.rotation.y = side * 0.65;

  return { root, upper, lower, elbow, hand, shoulder };
}

/**
 * Positions one arm from shoulder through elbow to wrist.
 *
 * @param arm - Mutable articulated arm rig.
 * @param shoulder - Shoulder position in the rig's local meters.
 * @param elbow - Elbow position in the rig's local meters.
 * @param wrist - Wrist position in the rig's local meters.
 * @param handRotation - Wrist orientation in the rig's local coordinates.
 * @returns Nothing; the supplied rig is mutated in place.
 */
export function poseArm(
  arm: ArmRig,
  shoulder: Vector3,
  elbow: Vector3,
  wrist: Vector3,
  handRotation = new Quaternion(),
): void {
  span(arm.upper, shoulder, elbow);
  span(arm.lower, elbow, wrist);
  arm.elbow.position.copy(elbow);
  arm.shoulder.position.copy(shoulder);
  arm.hand.position.copy(wrist);
  arm.hand.quaternion.copy(handRotation);
  arm.applyPose?.(shoulder, elbow, wrist, handRotation);
}

interface LegRig {
  root: Group;
  shin: Group;
}
/** A procedural full-body rig whose surface may be replaced by the bundled skinned mesh. */
export interface HumanRig {
  applyPose?: (relaxed: boolean) => void;
  root: Group;
  left: ArmRig;
  right: ArmRig;
  legs: LegRig[];
  skin: MeshStandardMaterial;
}

/**
 * Creates the original procedural adult fallback anatomy without extracted game assets.
 *
 * @param index - Stable character index used to select the skin-tone palette.
 * @returns A new poseable human rig.
 */
export function makeHuman(index = 0): HumanRig {
  const root = new Group();
  root.name = 'Adult male survivor';
  const skin = skinMaterial(
    [0xb88a6d, 0x92664f, 0xc19a7d, 0xa57458, 0xb38c6d, 0x9e755c][index % 6],
  );
  const sections: Section[] = [
    [0.83, 0.085, 0.08],
    [0.9, 0.162, 0.119],
    [0.99, 0.168, 0.125],
    [1.07, 0.139, 0.105],
    [1.16, 0.141, 0.104],
    [1.25, 0.17, 0.119],
    [1.34, 0.206, 0.128],
    [1.41, 0.214, 0.117],
    [1.47, 0.196, 0.096],
    [1.51, 0.13, 0.079],
    [1.55, 0.072, 0.07],
  ];
  const torso = loft(sections, 48, (x, y, z, angle) => {
    const front = Math.max(0, -Math.cos(angle));
    // Pectorals flow into sternum, obliques taper to a restrained waist, with soft abdominal planes.
    const chest =
      Math.exp(-Math.pow((y - 1.355) / 0.09, 2)) *
      0.033 *
      Math.exp(-Math.pow((Math.abs(x) - 0.105) / 0.095, 2));
    const abs =
      Math.exp(-Math.pow((y - 1.18) / 0.15, 2)) *
      0.009 *
      (0.5 + 0.5 * Math.cos((y - 1.12) * 52)) *
      Math.exp(-Math.pow((Math.abs(x) - 0.046) / 0.038, 2));

    return vector(x, y, z - front * (chest + abs));
  });
  add(root, torso, skin, 'Continuous sculpted torso');
  add(
    root,
    loft(
      [
        [1.49, 0.072, 0.067],
        [1.54, 0.063, 0.061],
        [1.6, 0.057, 0.057],
        [1.65, 0.065, 0.063],
      ],
      32,
    ),
    skin,
    'Neck and trapezius',
  );

  for (const side of [-1, 1]) {
    const collar = oval(
      root,
      skin,
      'Clavicle',
      vector(side * 0.104, 1.476, -0.071),
      vector(0.105, 0.019, 0.024),
    );
    collar.rotation.z = side * 0.12;
    const nippleMat = new MeshStandardMaterial({
      color: new Color(skin.color).multiplyScalar(0.68),
      roughness: 0.94,
    });
    oval(
      root,
      nippleMat,
      'Subtle chest detail',
      vector(side * 0.104, 1.34, -0.146),
      vector(0.007, 0.006, 0.0018),
    );
  }

  const navelMat = new MeshStandardMaterial({
    color: new Color(skin.color).multiplyScalar(0.6),
    roughness: 1,
  });
  oval(root, navelMat, 'Navel', vector(0, 1.104, -0.104), vector(0.007, 0.009, 0.002));
  // Smooth non-explicit lower-body coverage; body remains bare above/below the narrow waist wrap.
  const wrap = new MeshStandardMaterial({ color: 0x57463b, roughness: 1 });
  add(
    root,
    loft(
      [
        [0.858, 0.16, 0.124],
        [0.882, 0.17, 0.132],
        [0.96, 0.174, 0.135],
        [0.994, 0.163, 0.128],
      ],
      40,
    ),
    wrap,
    'Minimal weathered modesty wrap',
  );
  const legs: LegRig[] = [];

  for (const side of [-1, 1]) {
    const leg = new Group();
    leg.name = side < 0 ? 'Left hip joint' : 'Right hip joint';
    leg.position.set(side * 0.092, 0.91, 0);
    root.add(leg);
    const thigh = add(
      leg,
      loft(
        [
          [0, 0.089, 0.102],
          [-0.09, 0.096, 0.108],
          [-0.23, 0.082, 0.09],
          [-0.36, 0.059, 0.062],
          [-0.44, 0.051, 0.054],
        ],
        32,
      ),
      skin,
      'Thigh anatomy',
    );
    thigh.rotation.z = side * -0.035;
    const shin = new Group();
    shin.position.set(side * 0.015, -0.43, 0);
    leg.add(shin);
    oval(shin, skin, 'Kneecap', vector(0, 0, -0.017), vector(0.054, 0.059, 0.054));
    add(
      shin,
      loft(
        [
          [0, 0.051, 0.052],
          [-0.09, 0.065, 0.074, 0.016],
          [-0.19, 0.059, 0.069, 0.014],
          [-0.3, 0.038, 0.041],
          [-0.39, 0.033, 0.036],
        ],
        32,
      ),
      skin,
      'Calf and ankle',
    );
    oval(shin, skin, 'Bare heel', vector(0, -0.398, 0.015), vector(0.042, 0.052, 0.055));
    oval(shin, skin, 'Bare foot', vector(0, -0.418, -0.069), vector(0.047, 0.041, 0.112));
    for (let toe = 0; toe < 5; toe++)
      oval(
        shin,
        skin,
        'Toe',
        vector((toe - 2) * 0.018, -0.419, -0.159 + toe * 0.007),
        vector(0.011 - toe * 0.0007, 0.019, 0.03 - toe * 0.002),
      );
    legs.push({ root: leg, shin });
  }

  // Head silhouette: bald adult cranium, narrow temples, defined cheek and jaw rather than a sphere.
  const head = loft(
    [
      [1.565, 0.035, 0.035, -0.014],
      [1.59, 0.059, 0.057, -0.013],
      [1.63, 0.075, 0.064, -0.006],
      [1.67, 0.082, 0.071],
      [1.72, 0.081, 0.074, 0.004],
      [1.77, 0.08, 0.079, 0.01],
      [1.82, 0.061, 0.069, 0.014],
      [1.85, 0.03, 0.038, 0.016],
      [1.856, 0.002, 0.003, 0.016],
    ],
    48,
  );
  add(root, head, skin, 'Bald adult head');
  const socket = new MeshStandardMaterial({
    color: new Color(skin.color).multiplyScalar(0.61),
    roughness: 0.97,
  });
  const eyeWhite = new MeshStandardMaterial({ color: 0x93938b, roughness: 0.5 });
  const iris = new MeshStandardMaterial({ color: 0x373a2d, roughness: 0.53 });
  const lip = new MeshStandardMaterial({
    color: new Color(skin.color).multiplyScalar(0.71),
    roughness: 0.91,
  });

  for (const side of [-1, 1]) {
    oval(root, skin, 'Ear', vector(side * 0.082, 1.692, 0.003), vector(0.015, 0.033, 0.021));
    oval(
      root,
      socket,
      'Ear concha',
      vector(side * 0.092, 1.691, -0.009),
      vector(0.005, 0.018, 0.008),
    );
    oval(
      root,
      socket,
      'Eye socket',
      vector(side * 0.032, 1.712, -0.064),
      vector(0.025, 0.014, 0.008),
    );
    oval(root, eyeWhite, 'Eye', vector(side * 0.032, 1.712, -0.071), vector(0.018, 0.007, 0.006));
    oval(root, iris, 'Iris', vector(side * 0.031, 1.712, -0.077), vector(0.006, 0.006, 0.0016));
    const brow = oval(
      root,
      skin,
      'Brow ridge',
      vector(side * 0.03, 1.73, -0.064),
      vector(0.031, 0.012, 0.014),
    );
    brow.rotation.z = side * -0.13;
    oval(
      root,
      skin,
      'Cheek plane',
      vector(side * 0.045, 1.685, -0.058),
      vector(0.03, 0.025, 0.015),
    );
    oval(root, socket, 'Nostril', vector(side * 0.01, 1.673, -0.087), vector(0.005, 0.003, 0.003));
  }

  oval(root, skin, 'Nose bridge', vector(0, 1.7, -0.074), vector(0.01, 0.027, 0.018));
  oval(root, skin, 'Nose tip', vector(0, 1.679, -0.09), vector(0.016, 0.012, 0.013));
  oval(root, skin, 'Muzzle plane', vector(0, 1.653, -0.062), vector(0.028, 0.024, 0.011));
  oval(root, lip, 'Upper lip', vector(0, 1.653, -0.074), vector(0.024, 0.004, 0.003));
  oval(root, skin, 'Lower lip', vector(0, 1.646, -0.074), vector(0.022, 0.005, 0.005));
  oval(root, skin, 'Chin', vector(0, 1.611, -0.057), vector(0.039, 0.023, 0.017));
  const left = makeArm(skin, -1);
  const right = makeArm(skin, 1);
  root.add(left.root, right.root);
  const human = { root, left, right, legs, skin };
  poseHuman(human, 0, 0, true);

  return human;
}

/**
 * Applies draw and walk values to a full-body fallback rig.
 *
 * @param human - Mutable procedural human rig.
 * @param draw - Normalized bow draw amount from zero to one.
 * @param walk - Signed walk-cycle value in radians.
 * @param isRelaxed - Whether arms hang in their non-combat pose.
 * @returns Nothing; the supplied rig is mutated in place.
 */
export function poseHuman(human: HumanRig, draw: number, walk: number, isRelaxed = false): void {
  const smoothDraw = smooth(draw);
  const leftShoulder = vector(-0.245, 1.44, 0);
  const rightShoulder = vector(0.245, 1.44, 0);

  if (isRelaxed) {
    poseArm(human.left, leftShoulder, vector(-0.28, 1.16, 0.013), vector(-0.27, 0.93, -0.012));
    poseArm(human.right, rightShoulder, vector(0.29, 1.15, 0.018), vector(0.28, 0.925, -0.017));
  } else {
    poseArm(human.left, leftShoulder, vector(-0.3, 1.34, -0.31), vector(-0.24, 1.38, -0.59));
    poseArm(
      human.right,
      rightShoulder,
      vector(0.33 + smoothDraw * 0.13, 1.21 + smoothDraw * 0.23, -0.12 + smoothDraw * 0.11),
      vector(-0.24, 1.38, -0.49 + smoothDraw * 0.39),
    );
  }

  human.legs[0].root.rotation.x = walk * 0.43;
  human.legs[1].root.rotation.x = -walk * 0.43;
  human.legs[0].shin.rotation.x = Math.max(0, -walk) * 0.55;
  human.legs[1].shin.rotation.x = Math.max(0, walk) * 0.55;
}

function recurveFinish() {
  const size = 128,
    data = new Uint8Array(size * size * 4);
  let seed = 7823;

  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = (seed / 4294967296 - 0.5) * 8,
        wear = Math.pow(Math.max(0, Math.sin(x * 0.41 + y * 0.15)), 22) * 48;
      const i = (y * size + x) * 4;
      data[i] = 110 + noise + wear;
      data[i + 1] = 75 + noise + wear * 0.65;
      data[i + 2] = 46 + noise + wear * 0.4;
      data[i + 3] = 255;
    }

  const map = new DataTexture(data, size, size, RGBAFormat);
  map.colorSpace = SRGBColorSpace;
  map.wrapS = RepeatWrapping;
  map.wrapT = RepeatWrapping;
  map.needsUpdate = true;

  return new MeshStandardMaterial({ color: 0xc1a17c, map, roughness: 0.9, metalness: 0 });
}

/**
 * Creates the original dark recurve recreation with angular riser and open twin limbs.
 *
 * @returns A new bow group with mutable rail and string references in `userData`.
 */
export function makeFieldBow(): Group {
  const group = new Group();
  group.name = 'Dark open-limb recurve bow';
  const finish = recurveFinish(),
    grip = new MeshStandardMaterial({ color: 0x27262b, roughness: 0.85 });
  const riser = loft(
    [
      [-0.43, 0.038, 0.027],
      [-0.35, 0.055, 0.031],
      [-0.25, 0.061, 0.033],
      [-0.19, 0.035, 0.029],
      [-0.08, 0.025, 0.028],
      [0, 0.024, 0.027],
      [0.1, 0.025, 0.026],
      [0.22, 0.033, 0.029],
      [0.28, 0.058, 0.034],
      [0.4, 0.046, 0.027],
      [0.44, 0.036, 0.025],
    ],
    12,
  );
  const body = add(group, riser, finish, 'Sculpted recurve riser');
  body.scale.set(0.67, 0.72, 0.62);
  add(
    group,
    loft(
      [
        [-0.08, 0.027, 0.03],
        [-0.06, 0.028, 0.031],
        [0.075, 0.027, 0.031],
        [0.09, 0.025, 0.029],
      ],
      20,
    ),
    grip,
    'Contoured hand grip',
  );
  const cord = new MeshStandardMaterial({ color: 0xbca382, roughness: 0.97 });
  const coils: Vector3[] = [];

  for (let i = 0; i <= 480; i++) {
    const fraction = i / 480;
    const y = 0.185 + fraction * 0.115;
    const angle = fraction * Math.PI * 2 * 18;
    const radius = 0.036 + Math.sin(fraction * Math.PI) * 0.004;
    coils.push(vector(Math.cos(angle) * radius, y, Math.sin(angle) * 0.025));
  }

  add(
    group,
    new TubeGeometry(new CatmullRomCurve3(coils), 480, 0.0028, 6, false),
    cord,
    'Tan braided rope riser binding',
  );
  const rails: Mesh[] = [];

  for (const side of [-1, 1]) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(65 * 9 * 3), 3));
    const indices: number[] = [];

    for (let j = 1; j <= 64; j++)
      for (let i = 1; i <= 8; i++) {
        const index = j * 9 + i;
        indices.push(index, index - 1, index - 10, index, index - 10, index - 9);
      }

    geometry.setIndex(indices);
    const rail = add(group, geometry, finish, 'Flexible open limb rail');
    rail.userData.railSide = side;
    rails.push(rail);
  }

  const string = new Line(
    new BufferGeometry().setFromPoints([vector(), vector(), vector()]),
    new LineBasicMaterial({ color: 0x6d6574 }),
  );
  string.name = 'Bowstring anchored to tips and nock';
  group.add(string);
  group.userData.bowLimb = rails[0];
  group.userData.bowRails = rails;
  group.userData.bowString = string;
  deformBow(group, 0);

  return group;
}

/**
 * Computes the shared bowstring and arrow nock position.
 *
 * @param draw - Normalized bow draw from zero to one.
 * @returns Nock position in bow-local meters.
 */
export function bowNock(draw: number): Vector3 {
  return vector(0, 0.115, 0.145 + 0.68 * draw);
}

/**
 * Updates rail buffers while arrow and string retain one shared nock.
 *
 * @param group - Bow group created by `makeFieldBow`.
 * @param draw - Normalized bow draw from zero to one.
 * @param vibration - Small bow-local Z displacement in meters after release.
 * @returns Nothing; mutable geometry attributes are updated in place.
 */
export function deformBow(group: Group, draw: number, vibration = 0): void {
  const rails = group.userData.bowRails as Mesh[] | undefined;
  if (!rails) {
    return;
  }

  if (group.userData.lastVisualDraw === draw && group.userData.lastVisualVibration === vibration) {
    return;
  }
  group.userData.lastVisualDraw = draw;
  group.userData.lastVisualVibration = vibration;

  for (const rail of rails) {
    const positions = rail.geometry.getAttribute('position');
    const side = rail.userData.railSide;

    for (let j = 0; j <= 64; j++) {
      const verticalFraction = j / 32 - 1;
      const absoluteFraction = Math.abs(verticalFraction);
      const y = verticalFraction * (1.04 - 0.075 * draw);
      const gap =
        0.028 * smooth((absoluteFraction - 0.18) / 0.17) * (1 - Math.pow(absoluteFraction, 7));
      const z =
        -0.09 * Math.sin(absoluteFraction * Math.PI) +
        draw * 0.18 * absoluteFraction * absoluteFraction +
        vibration * absoluteFraction;
      const radius = 0.008 * (1 - 0.4 * absoluteFraction);

      for (let i = 0; i <= 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        positions.setXYZ(
          j * 9 + i,
          side * gap + Math.cos(angle) * radius,
          y,
          z + Math.sin(angle) * radius * 1.35,
        );
      }
    }

    positions.needsUpdate = true;
    rail.geometry.computeVertexNormals();
    rail.geometry.computeBoundingSphere();
  }

  const line = group.userData.bowString as Line;
  const stringPositions = line.geometry.getAttribute('position');
  const tip = 1.04 - 0.075 * draw;
  const z = draw * 0.18 + vibration;
  const nock = bowNock(draw);
  stringPositions.setXYZ(0, 0, -tip, z);
  stringPositions.setXYZ(1, nock.x, nock.y, nock.z);
  stringPositions.setXYZ(2, 0, tip, z);
  stringPositions.needsUpdate = true;
  line.geometry.computeBoundingSphere();
}

/** A deterministic first-person bow pose consumed by the runtime camera and arm rig. */
export interface BowPose {
  draw: number;
  grip: Vector3;
  roll: number;
  pull: Vector3;
  vibration: number;
  arrowVisible: boolean;
  phase: string;
}

/**
 * Samples the deterministic bow pose shared by inspection and live input paths.
 *
 * @param charge - Normalized current draw charge.
 * @param releaseSeconds - Seconds since release, or a negative value when not releasing.
 * @param releaseCharge - Normalized charge captured at release.
 * @param time - Simulation time in seconds, used only for held-bow motion.
 * @param isAiming - Whether the player is using steady aim.
 * @returns A newly allocated first-person bow pose.
 */
export function sampleBowPose(
  charge: number,
  releaseSeconds = -1,
  releaseCharge = 1,
  time = 0,
  isAiming = false,
): BowPose {
  let draw = smooth(charge);
  let kick = 0;
  let vibration = 0;
  let reload = 0;
  let phase = 'ready';

  if (charge >= 1) {
    phase = 'hold';
  } else if (charge > 0) {
    phase = 'draw';
  }
  let arrowVisible = true;

  if (releaseSeconds >= 0 && releaseSeconds < 1.05) {
    const elapsedReleaseSeconds = releaseSeconds;
    draw = smooth(releaseCharge) * (1 - smooth(elapsedReleaseSeconds / 0.065));
    kick =
      Math.sin(Math.min(1, elapsedReleaseSeconds / 0.11) * Math.PI) *
      Math.exp(-elapsedReleaseSeconds * 7);
    vibration =
      Math.sin(elapsedReleaseSeconds * 115) *
      Math.exp(-elapsedReleaseSeconds * 24) *
      0.035 *
      releaseCharge;
    reload = Math.sin(smooth((elapsedReleaseSeconds - 0.16) / 0.84) * Math.PI);
    arrowVisible = elapsedReleaseSeconds > 0.91;

    if (elapsedReleaseSeconds < 0.12) {
      phase = 'release';
    } else if (elapsedReleaseSeconds < 0.86) {
      phase = 'nock';
    } else {
      phase = 'recover';
    }
  }

  const hold = draw > 0.96 ? Math.sin(time * 13) * 0.002 : 0;
  const grip = vector(
    (isAiming ? 0.09 : 0.23) - draw * 0.105 + hold,
    -0.285 + draw * 0.13 - kick * 0.026 - reload * 0.13,
    -0.88 - draw * 0.045 + kick * 0.036,
  );
  const roll = -0.3 + draw * 0.2 + kick * 0.085 - reload * 0.35;
  const pull = bowNock(draw);
  pull.x += releaseSeconds >= 0 && releaseSeconds < 0.16 ? smooth(releaseSeconds / 0.16) * 0.07 : 0;

  if (reload) {
    pull.x += reload * 0.24;
    pull.y += reload * 0.58;
    pull.z += reload * 0.18;
  }

  return { draw, grip, roll, pull, vibration, arrowVisible, phase };
}

/**
 * Creates the original procedural first-person skin material.
 *
 * @returns A new textured material owned by the caller.
 */
export function firstPersonSkin(): MeshStandardMaterial {
  return skinMaterial(0xc0a28b);
}
