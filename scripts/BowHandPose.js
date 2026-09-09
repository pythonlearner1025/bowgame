/**
 * Derives anatomical wrist orientation and finger curls from the bundled human rig data.
 * It does not load the asset, position arms, or animate whole-body movement.
 */
/*
 * Curl angles and millimeter-scale offsets are authored pose data calibrated to this hand rig.
 * They remain inline beside the affected joints so the anatomical shape can be reviewed directly.
 */
/* eslint-disable no-magic-numbers */
import { Bone, Matrix4, Quaternion, Vector3 } from 'threepipe';
const HOOKED_FINGER_ANGLES = [
    [0.24, 1.1, 0.56],
    [0.28, 1.13, 0.6],
    [0.32, 1.12, 0.61],
    [0.8, 1.1, 0.65],
];
const RELAXED_FINGER_ANGLES = [0.7, 1.05, 0.62];
const HOOKED_ROOT_OFFSETS_METERS = [0.006, 0, -0.005, -0.011];
function vectorFromArray(values) {
    return new Vector3().fromArray(values);
}
function findBoneData(data, name, side) {
    const boneData = data.bones.find((candidate) => candidate.name === `${name}.${side}`);
    if (!boneData) {
        throw new Error(`Human rig is missing required bone ${name}.${side}`);
    }
    return boneData;
}
function makeOrientationFrame(direction, across) {
    const xAxis = direction.clone().normalize();
    const yAxis = across.clone().addScaledVector(xAxis, -across.dot(xAxis)).normalize();
    const zAxis = xAxis.clone().cross(yAxis);
    return new Matrix4().makeBasis(xAxis, yAxis, zAxis);
}
/**
 * Matches both a hand's long axis and knuckle row to avoid arbitrary wrist roll.
 *
 * @param data - Parsed bundled human asset containing rest-pose bone coordinates.
 * @param side - Left or right hand suffix used by the rig.
 * @param direction - Desired world-space direction from wrist toward fingers.
 * @param across - Desired world-space direction across the knuckle row.
 * @returns The quaternion that maps the rest-pose hand frame to the desired frame.
 */
export function handOrientation(data, side, direction, across) {
    const middleFinger = findBoneData(data, 'finger3-1', side);
    const wrist = findBoneData(data, 'wrist', side);
    const littleFinger = findBoneData(data, 'finger5-1', side);
    const indexFinger = findBoneData(data, 'finger2-1', side);
    const restDirection = vectorFromArray(middleFinger.head).sub(vectorFromArray(wrist.head));
    const restAcross = vectorFromArray(littleFinger.head).sub(vectorFromArray(indexFinger.head));
    const desiredFrame = makeOrientationFrame(direction, across);
    const restFrameInverse = makeOrientationFrame(restDirection, restAcross).invert();
    return new Quaternion().setFromRotationMatrix(desiredFrame.multiply(restFrameInverse));
}
function makeBoneIndexFinder(data, side) {
    return (name) => data.bones.findIndex((boneData) => boneData.name === `${name}.${side}`);
}
function requireBoneIndex(index, name, side) {
    if (index < 0) {
        throw new Error(`Human rig is missing required bone ${name}.${side}`);
    }
    return index;
}
function poseLongFingers(options, across) {
    const { data, bones, side, isHooked, openness = 0 } = options;
    const findIndex = makeBoneIndexFinder(data, side);
    const curlSign = side === 'L' ? 1 : -1;
    for (let fingerNumber = 2; fingerNumber <= 5; fingerNumber += 1) {
        const angleIndex = fingerNumber - 2;
        const angles = isHooked ? HOOKED_FINGER_ANGLES[angleIndex] : RELAXED_FINGER_ANGLES;
        const rootName = `finger${fingerNumber}-1`;
        const rootIndex = requireBoneIndex(findIndex(rootName), rootName, side);
        bones[rootIndex].position.copy(vectorFromArray(data.bones[rootIndex].position));
        if (isHooked) {
            bones[rootIndex].position.addScaledVector(across, HOOKED_ROOT_OFFSETS_METERS[angleIndex]);
        }
        for (let jointNumber = 1; jointNumber <= 3; jointNumber += 1) {
            const jointName = `finger${fingerNumber}-${jointNumber}`;
            const jointIndex = findIndex(jointName);
            if (jointIndex < 0) {
                continue;
            }
            const openFraction = openness * (isHooked ? 0.72 : 0.95);
            const angle = curlSign * angles[jointNumber - 1] * (1 - openFraction);
            bones[jointIndex].quaternion.setFromAxisAngle(across, angle);
        }
    }
}
function poseThumb(options, across) {
    const { data, bones, side, isHooked } = options;
    const findIndex = makeBoneIndexFinder(data, side);
    const firstIndex = requireBoneIndex(findIndex('finger1-1'), 'finger1-1', side);
    const secondIndex = requireBoneIndex(findIndex('finger1-2'), 'finger1-2', side);
    const thirdIndex = requireBoneIndex(findIndex('finger1-3'), 'finger1-3', side);
    const wristIndex = requireBoneIndex(findIndex('wrist'), 'wrist', side);
    const middleIndex = requireBoneIndex(findIndex('finger3-1'), 'finger3-1', side);
    const curlSign = side === 'L' ? 1 : -1;
    const thumbDirection = vectorFromArray(data.bones[secondIndex].head)
        .sub(vectorFromArray(data.bones[firstIndex].head))
        .normalize();
    const palmDirection = vectorFromArray(data.bones[middleIndex].head)
        .sub(vectorFromArray(data.bones[wristIndex].head))
        .normalize();
    const thumbAxis = thumbDirection.clone().cross(palmDirection).normalize();
    const palmNormal = palmDirection.clone().cross(across).multiplyScalar(-curlSign).normalize();
    const jointAngles = [
        [firstIndex, isHooked ? 0.32 : 0.2],
        [secondIndex, isHooked ? 0.44 : 0.7],
        [thirdIndex, isHooked ? 0.22 : 0.4],
    ];
    for (const [jointIndex, angle] of jointAngles) {
        const jointData = data.bones[jointIndex];
        const direction = vectorFromArray(jointData.tail)
            .sub(vectorFromArray(jointData.head))
            .normalize();
        const axis = direction.cross(palmNormal).normalize();
        bones[jointIndex].quaternion.setFromAxisAngle(axis, angle);
    }
    const oppositionAngle = isHooked ? 0.1 : 0.9;
    bones[firstIndex].quaternion.premultiply(new Quaternion().setFromAxisAngle(thumbAxis, oppositionAngle));
}
/**
 * Applies native joint-axis curls and thumb opposition to one hand rig.
 *
 * @param options - Asset, live bones, side, grip mode, and normalized openness.
 * @returns Nothing; the supplied live bones are mutated in place.
 */
export function poseHandFingers(options) {
    const { data, side } = options;
    const findIndex = makeBoneIndexFinder(data, side);
    const littleFingerIndex = requireBoneIndex(findIndex('finger5-1'), 'finger5-1', side);
    const indexFingerIndex = requireBoneIndex(findIndex('finger2-1'), 'finger2-1', side);
    const across = vectorFromArray(data.bones[littleFingerIndex].head)
        .sub(vectorFromArray(data.bones[indexFingerIndex].head))
        .normalize();
    poseLongFingers(options, across);
    poseThumb(options, across);
}
