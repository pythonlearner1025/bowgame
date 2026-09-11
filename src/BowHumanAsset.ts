/**
 * Loads the bundled CC0 human data and binds it to third- and first-person skeletons.
 * It does not choose gameplay animation states or perform inverse-kinematics timing.
 */

/*
 * Skin colors, rig offsets, and anatomical proportions are calibrated model data. They remain
 * beside the mesh and inverse-kinematics operations they control.
 */
/* eslint-disable no-magic-numbers */

import {
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Uint16BufferAttribute,
  Group,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
  Texture,
  TextureLoader,
  SRGBColorSpace,
  Vector3,
  Quaternion,
} from 'threepipe';
import { handOrientation, poseHandFingers, type HandSide } from './BowHandPose.js';
import { bowAssetUrl } from './BowAssetUrl.js';
import type { HumanRig } from './BowVisuals.js';
/** One bone from the serialized bundled skeleton. */
export interface AssetBone {
  name: string;
  parent: number;
  position: number[];
  head: number[];
  tail: number[];
}
/** Parsed positions, skinning weights, skeleton, and optional eye mesh. */
export interface HumanAsset {
  positions: number[];
  uvs: number[];
  indices: number[];
  skinIndex: number[];
  skinWeight: number[];
  bones: AssetBone[];
  eyes?: HumanAsset;
}

interface SolveArmOptions {
  side: HandSide;
  goal: Vector3;
  guide: Vector3;
  isRelaxed: boolean;
  roll: Quaternion;
}
let asset: HumanAsset | undefined;
let skinTexture: Texture | undefined;
let eyeTexture: Texture | undefined;
let pending: Promise<void> | undefined;
const HUMAN_ASSET_URL = bowAssetUrl('bow-survivor/male-adult-rigged.json');
const SKIN_TEXTURE_URL = bowAssetUrl('bow-survivor/skin-male.png');
const EYE_TEXTURE_URL = bowAssetUrl('bow-survivor/eyes-brown.png');

/**
 * Reads the currently cached anatomy and skin texture for first-person arm construction.
 *
 * @returns Cached asset and texture references, which may still be unavailable before preload.
 */
export function getHumanArmSource(): {
  asset: HumanAsset | undefined;
  skinTexture: Texture | undefined;
} {
  return { asset, skinTexture };
}

/**
 * Loads bundled CC0 anatomy exactly once from local player assets.
 *
 * @returns A shared promise that resolves after model and textures are cached.
 */
export function preloadHumanAsset(): Promise<void> {
  return (pending ??= Promise.all([
    fetch(HUMAN_ASSET_URL).then((response) => {
      if (!response.ok) {
        throw new Error('Adult model unavailable');
      }

      return response.json() as Promise<HumanAsset>;
    }),
    new TextureLoader().loadAsync(SKIN_TEXTURE_URL),
    new TextureLoader().loadAsync(EYE_TEXTURE_URL),
  ]).then(([data, map, eyes]) => {
    asset = data;
    skinTexture = map;
    eyeTexture = eyes;
    map.colorSpace = SRGBColorSpace;
    eyes.colorSpace = SRGBColorSpace;
    map.anisotropy = 8;
  }));
}

const vectorFromArray = (values: number[]) => new Vector3().fromArray(values);

/**
 * Averages normals across OBJ UV-seam duplicates without changing UV coordinates.
 *
 * @param geometry - Mutable skinned body geometry.
 * @returns Nothing; the normal attribute is created and updated in place.
 */
function smoothAnatomyNormals(geometry: BufferGeometry): void {
  geometry.computeVertexNormals();
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const sums = new Map<string, Vector3>();
  const key = (i: number) =>
    `${positions.getX(i).toFixed(5)},${positions.getY(i).toFixed(5)},${positions.getZ(i).toFixed(5)}`;

  for (let i = 0; i < positions.count; i++) {
    const positionKey = key(i);
    const sum = sums.get(positionKey) ?? new Vector3();
    sum.add(new Vector3().fromBufferAttribute(normals, i));
    sums.set(positionKey, sum);
  }

  for (let i = 0; i < positions.count; i++) {
    const sum = sums.get(key(i));

    if (!sum) {
      throw new Error('Anatomy normal group was not created');
    }

    const normal = sum.clone().normalize();
    normals.setXYZ(i, normal.x, normal.y, normal.z);
  }

  normals.needsUpdate = true;
}

/**
 * Replaces a procedural human surface with a connected GPU-skinned bundled body.
 *
 * @param human - Procedural rig whose public inverse-kinematics controls remain in use.
 * @param index - Stable character index used to select the existing skin-tone palette.
 * @param source - Parsed bundled human asset, or `undefined` before preload completes.
 * @returns Whether an asset was available and attached.
 */
export function attachHumanAsset(
  human: HumanRig,
  index: number,
  source: HumanAsset | undefined = asset,
): boolean {
  if (!source) {
    return false;
  }

  const data = source;
  human.root.traverse((object) => {
    if ('isMesh' in object && object.isMesh && object.name !== 'Minimal weathered modesty wrap') {
      object.visible = false;
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(data.positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(data.uvs, 2));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(data.skinIndex, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(data.skinWeight, 4));
  geometry.setIndex(data.indices);
  smoothAnatomyNormals(geometry);
  const material = new MeshStandardMaterial({
    map: skinTexture ?? null,
    color: [0xdcc8b8, 0x9d7e68, 0xe2ccba, 0xb99a82, 0xc3ac94, 0xb09179][index % 6],
    roughness: 0.83,
    metalness: 0,
  });
  const surface = new SkinnedMesh(geometry, material);
  surface.name = 'CC0 connected adult male anatomy';
  surface.castShadow = true;
  surface.receiveShadow = true;
  surface.frustumCulled = false;
  const bones = data.bones.map((info) => {
    const bone = new Bone();
    bone.name = info.name;
    bone.position.fromArray(info.position);

    return bone;
  });

  for (let i = 0; i < bones.length; i++) {
    const parent = data.bones[i].parent;
    if (parent < 0) {
      surface.add(bones[i]);
    } else {
      bones[parent].add(bones[i]);
    }
  }

  const visual = new Group();
  visual.name = 'Grounded survivor surface';
  visual.position.y = -0.04;
  human.root.add(visual);
  const cover = human.root.getObjectByName('Minimal weathered modesty wrap');
  if (cover) {
    visual.add(cover);
  }
  visual.add(surface);
  visual.updateMatrixWorld(true);
  surface.updateMatrixWorld(true);
  surface.bind(new Skeleton(bones));

  if (data.eyes) {
    const eyeData = data.eyes;
    const eyeGeometry = new BufferGeometry();
    eyeGeometry.setAttribute('position', new Float32BufferAttribute(eyeData.positions, 3));
    eyeGeometry.setAttribute('uv', new Float32BufferAttribute(eyeData.uvs, 2));
    eyeGeometry.setAttribute('skinIndex', new Uint16BufferAttribute(eyeData.skinIndex, 4));
    eyeGeometry.setAttribute('skinWeight', new Float32BufferAttribute(eyeData.skinWeight, 4));
    eyeGeometry.setIndex(eyeData.indices);
    eyeGeometry.computeVertexNormals();
    const eyes = new SkinnedMesh(
      eyeGeometry,
      new MeshStandardMaterial({ map: eyeTexture ?? null, roughness: 0.35 }),
    );
    eyes.name = 'Anatomical eyes';
    eyes.frustumCulled = false;
    visual.add(eyes);
    eyes.bind(surface.skeleton, surface.bindMatrix);
  }

  const nameIndices = new Map(data.bones.map((boneInfo, i) => [boneInfo.name, i]));
  const find = (name: string) => nameIndices.get(name) ?? -1;

  // Rest coordinates are editor-local. Surface may move in world with the bot, so solve using local matrices.
  const poseBone = (index: number, worldRotation: Quaternion) => {
    const parent = data.bones[index].parent;
    const parentRotation = new Quaternion();

    if (parent >= 0) {
      const chain: number[] = [];
      let parentIndex = parent;

      while (parentIndex >= 0) {
        chain.unshift(parentIndex);
        parentIndex = data.bones[parentIndex].parent;
      }

      for (const boneIndex of chain) {
        parentRotation.multiply(bones[boneIndex].quaternion);
      }
    }

    bones[index].quaternion.copy(parentRotation.invert().multiply(worldRotation));
  };

  const localHead = (index: number) =>
    surface.worldToLocal(bones[index].getWorldPosition(new Vector3()));

  const solveArm = ({ side, goal, guide, isRelaxed, roll }: SolveArmOptions) => {
    const upper = find(`upperarm01.${side}`);
    const lower = find(`lowerarm01.${side}`);
    const wrist = find(`wrist.${side}`);

    if (upper < 0 || lower < 0 || wrist < 0) {
      return;
    }

    const upperRest = vectorFromArray(data.bones[lower].head).sub(
      vectorFromArray(data.bones[upper].head),
    );
    const lowerRest = vectorFromArray(data.bones[wrist].head).sub(
      vectorFromArray(data.bones[lower].head),
    );
    const shoulder = localHead(upper);
    const upperLength = upperRest.length();
    const lowerLength = lowerRest.length();
    // Wrist sits behind the palm. Fingers wrap the bow/string instead of placing the wrist on the grip.
    let wristOffset: Vector3;

    if (isRelaxed) {
      wristOffset = new Vector3(0, 0.035, 0);
    } else {
      const gripOffset =
        side === 'L' ? new Vector3(-0.038, -0.026, 0.106) : new Vector3(0.01, -0.023, 0.145);
      wristOffset = gripOffset.applyQuaternion(roll);
    }

    const target = goal.clone().add(wristOffset);
    target.y += 0.04;
    const direction = target.clone().sub(shoulder),
      distance = Math.min(direction.length(), upperLength + lowerLength - 0.001);
    direction.normalize();
    const alongDistance =
      (upperLength * upperLength - lowerLength * lowerLength + distance * distance) /
      (2 * distance);
    const height = Math.sqrt(
      Math.max(0, upperLength * upperLength - alongDistance * alongDistance),
    );
    const bend = guide
      .clone()
      .sub(shoulder)
      .addScaledVector(direction, -guide.clone().sub(shoulder).dot(direction))
      .normalize();
    const elbow = shoulder
      .clone()
      .addScaledVector(direction, alongDistance)
      .addScaledVector(bend, height);
    poseBone(
      upper,
      new Quaternion().setFromUnitVectors(
        upperRest.clone().normalize(),
        elbow.clone().sub(shoulder).normalize(),
      ),
    );
    const actualElbow = localHead(lower);
    poseBone(
      lower,
      new Quaternion().setFromUnitVectors(
        lowerRest.clone().normalize(),
        target.clone().sub(actualElbow).normalize(),
      ),
    );

    if (isRelaxed) {
      const middle = find(`finger3-1.${side}`);
      const rest = vectorFromArray(data.bones[middle].head)
        .sub(vectorFromArray(data.bones[wrist].head))
        .normalize();
      poseBone(wrist, new Quaternion().setFromUnitVectors(rest, new Vector3(0, -1, 0)));
    } else {
      const direction = (
        side === 'L' ? new Vector3(0.03, 0.16, -1) : new Vector3(0.28, 0.1, -1)
      ).normalize();
      poseBone(
        wrist,
        roll.clone().multiply(handOrientation(data, side, direction, new Vector3(0, -1, 0))),
      );
    }

    poseHandFingers({
      data,
      bones,
      side,
      isHooked: side === 'R',
      openness: isRelaxed ? 1 : 0,
    });
  };

  human.applyPose = (relaxed: boolean) => {
    solveArm({
      side: 'L',
      goal: human.left.hand.position,
      guide: human.left.elbow.position,
      isRelaxed: relaxed,
      roll: human.left.hand.quaternion,
    });
    solveArm({
      side: 'R',
      goal: human.right.hand.position,
      guide: human.right.elbow.position,
      isRelaxed: relaxed,
      roll: human.right.hand.quaternion,
    });

    for (let i = 0; i < 2; i++) {
      const side: HandSide = i === 0 ? 'L' : 'R';
      const upper = find(`upperleg01.${side}`);
      const lower = find(`lowerleg01.${side}`);

      if (upper >= 0) {
        bones[upper].quaternion.setFromAxisAngle(
          new Vector3(1, 0, 0),
          human.legs[i].root.rotation.x,
        );
      }

      if (lower >= 0) {
        bones[lower].quaternion.setFromAxisAngle(
          new Vector3(1, 0, 0),
          human.legs[i].shin.rotation.x,
        );
      }
    }

    surface.updateMatrixWorld(true);
  };

  human.applyPose(true);

  return true;
}
