/**
 * Reconstructs bow-and-hand poses from measurements of the supplied reference clip.
 * It does not move the camera, advance gameplay, or fire simulation arrows.
 */
/*
 * Numeric values in this module are measured keyframes, screen coordinates, and calibrated
 * interpolation timing. Keeping the dataset inline preserves its traceability to the source clip.
 */
/* eslint-disable no-magic-numbers */
import { Euler, Quaternion, Vector3 } from 'threepipe';
export const BOW_LOAD_DRAW_SECONDS = 1.15;
export const BOW_RELEASE_SECONDS = 0.65;
const pose = (grip, rotation, tension = 0, extra = {}) => ({
    grip,
    rotation,
    tension,
    right: [0.76, 1.22, 0.22],
    rightVisible: false,
    arrowVisible: false,
    arrowSeated: true,
    leftOpen: 0,
    rightOpen: 0,
    phase: 'carry',
    arrowTip: [0.615, 0.608],
    arrowNear: [0.745, 1.1],
    ...extra,
});
// Screen measurements use the supplied UQgjv5H7CZs clip, 1920×1080, centered by image height.
// World/camera motion is intentionally excluded: these tracks describe only the weapon and hands.
const carry = pose([0.568, 0.949, 0.65], [0.12, 0.08, -1.34]);
const ready = pose([0.505, 0.67, 0.84], [0, 0, -0.46], 1, {
    arrowVisible: true,
    phase: 'hold',
    arrowTip: [0.5, 0.5],
    arrowNear: [0.5, 1.1],
});
const aimed = pose([0.487, 0.647, 0.84], [0, 0, -0.52], 1, {
    arrowVisible: true,
    phase: 'aim',
    arrowTip: [0.5, 0.5],
    arrowNear: [0.5, 1.1],
});
const load = [
    { timeSeconds: 0, pose: carry },
    {
        timeSeconds: 0.12,
        pose: pose([0.616, 0.965, 0.5], [-0.85, -0.6, 0.72], 0, {
            leftOpen: 0.6,
            upperTip: [0.43, 0.64],
            phase: 'turn',
        }),
    },
    {
        timeSeconds: 0.3,
        pose: pose([0.598, 0.933, 0.53], [-0.78, -0.42, 0.62], 0, {
            leftOpen: 0.95,
            upperTip: [0.398, 0.505],
            phase: 'load',
        }),
    },
    {
        timeSeconds: 0.45,
        pose: pose([0.72, 0.975, 0.61], [0.05, 0.08, -1.19], 0, {
            arrowVisible: true,
            arrowSeated: false,
            rightVisible: true,
            right: [0.805, 1.035, 0.27],
            phase: 'fetch',
        }),
    },
    {
        timeSeconds: 0.54,
        pose: pose([0.739, 0.937, 0.65], [0, 0, -1.06], 0, {
            arrowVisible: true,
            arrowSeated: false,
            rightVisible: true,
            right: [0.8, 1.06, 0.27],
            arrowTip: [0.723, 0.678],
            arrowNear: [0.785, 1.08],
            phase: 'nock',
        }),
    },
    {
        timeSeconds: 0.6,
        pose: pose([0.698, 0.875, 0.73], [0, 0.02, -0.73], 0, {
            arrowVisible: true,
            arrowSeated: true,
            rightVisible: true,
            right: [0.706, 0.995, 0.28],
            rightOpen: 0.2,
            phase: 'nock',
        }),
    },
    {
        timeSeconds: 0.73,
        pose: pose([0.62, 0.735, 0.8], [0, 0, -0.43], 0.25, {
            arrowVisible: true,
            rightVisible: true,
            right: [0.724, 1.075, 0.25],
            rightOpen: 0.12,
            phase: 'draw',
        }),
    },
    {
        timeSeconds: 0.94,
        pose: pose([0.615, 0.705, 0.81], [0, 0, -0.36], 0.78, { arrowVisible: true, phase: 'draw' }),
    },
    { timeSeconds: 1.15, pose: ready },
];
const mix = (start, end, fraction) => start + (end - start) * fraction;
/**
 * Blends the numeric fields of two measured poses and selects discrete fields at halfway.
 *
 * @param start - Pose used at interpolation fraction zero.
 * @param end - Pose used at interpolation fraction one.
 * @param fraction - Interpolation fraction, normally from zero to one.
 * @returns A newly allocated blended pose.
 */
export function blendReferencePoses(start, end, fraction) {
    return {
        ...(fraction < 0.5 ? start : end),
        grip: start.grip.map((value, i) => mix(value, end.grip[i], fraction)),
        rotation: start.rotation.map((value, i) => mix(value, end.rotation[i], fraction)),
        right: start.right.map((value, i) => mix(value, end.right[i], fraction)),
        tension: mix(start.tension, end.tension, fraction),
        arrowTip: start.arrowTip.map((value, i) => mix(value, end.arrowTip[i], fraction)),
        arrowNear: start.arrowNear.map((value, i) => mix(value, end.arrowNear[i], fraction)),
        leftOpen: mix(start.leftOpen, end.leftOpen, fraction),
        rightOpen: mix(start.rightOpen, end.rightOpen, fraction),
    };
}
function track(keyframes, seconds) {
    if (seconds <= keyframes[0].timeSeconds) {
        return { ...keyframes[0].pose };
    }
    for (let i = 1; i < keyframes.length; i++) {
        const current = keyframes[i];
        if (seconds <= current.timeSeconds) {
            const previous = keyframes[i - 1];
            const linearFraction = (seconds - previous.timeSeconds) / (current.timeSeconds - previous.timeSeconds);
            // Smoothstep interpolation gives zero velocity at both measured keyframes.
            const smoothFraction = linearFraction * linearFraction * (3 - 2 * linearFraction);
            return blendReferencePoses(previous.pose, current.pose, smoothFraction);
        }
    }
    return { ...keyframes[keyframes.length - 1].pose };
}
/**
 * Samples the interactive draw or release track.
 *
 * @param charge - Normalized draw charge from zero to one.
 * @param release - Seconds since release, or a negative value while not releasing.
 * @param aim - Normalized steady-aim blend from zero to one.
 * @returns A newly allocated weapon-and-hand pose.
 */
export function sampleReferenceAction(charge, release = -1, aim = 0) {
    if (release >= 0) {
        const from = blendReferencePoses(ready, aimed, aim);
        const recoil = {
            ...from,
            grip: [
                from.grip[0] + 0.012,
                from.grip[1] + 0.032,
                from.grip[2] - 0.015,
            ],
            tension: 0,
            arrowVisible: false,
            phase: 'release',
            rightVisible: false,
            arrowSeated: false,
            right: [0.69, 1.12, 0.26],
        };
        return track([
            { timeSeconds: 0, pose: { ...from, arrowVisible: false, phase: 'release' } },
            { timeSeconds: 0.065, pose: recoil },
            { timeSeconds: 0.22, pose: { ...carry, grip: [0.58, 1.1, 0.6], phase: 'lower' } },
            { timeSeconds: 0.43, pose: { ...carry, grip: [0.55, 1.15, 0.65], phase: 'lower' } },
            { timeSeconds: BOW_RELEASE_SECONDS, pose: carry },
        ], release);
    }
    if (charge <= 0) {
        return { ...carry };
    }
    const result = track(load, Math.min(1, charge) * BOW_LOAD_DRAW_SECONDS);
    if (charge > 0.82)
        return blendReferencePoses(result, { ...aimed, tension: result.tension }, aim * Math.min(1, (charge - 0.82) / 0.18));
    return result;
}
/**
 * Reproduces the observed equip, draw-cancel, shot, and reload chronology.
 *
 * @param time - Seconds elapsed in the fixed reference-preview timeline.
 * @returns A newly allocated preview pose; no gameplay arrow is fired.
 */
export function sampleReferenceTimeline(time) {
    if (time < 0.78)
        return {
            ...carry,
            grip: [0.568 + Math.sin(time * 9) * 0.015, 0.949 + Math.sin(time * 12) * 0.008, 0.65],
        };
    if (time < 1.34)
        return track([
            { timeSeconds: 0.78, pose: carry },
            { timeSeconds: 1, pose: pose([0.335, 0.93, 0.65], [0.05, 0.05, -0.81]) },
            { timeSeconds: 1.34, pose: carry },
        ], time);
    if (time < 1.96)
        return { ...carry };
    if (time < 3.13)
        return sampleReferenceAction((time - 1.96) / BOW_LOAD_DRAW_SECONDS);
    if (time < 3.53)
        return track([
            { timeSeconds: 3.13, pose: ready },
            {
                timeSeconds: 3.4,
                pose: {
                    ...aimed,
                    grip: [0.5464, 0.662, 0.84],
                    rotation: [0, 0, -0.41],
                    arrowTip: [0.5, 0.5],
                    arrowNear: [0.5, 1.1],
                },
            },
            { timeSeconds: 3.53, pose: aimed },
        ], time);
    if (time < 3.97)
        return track([
            { timeSeconds: 3.53, pose: aimed },
            { timeSeconds: 3.8, pose: { ...carry, tension: 0, arrowVisible: true, phase: 'cancel' } },
            { timeSeconds: 3.97, pose: { ...carry, phase: 'carry' } },
        ], time);
    if (time < 6.22)
        return {
            ...carry,
            grip: [0.565 + Math.sin(time * 8) * 0.015, 0.958 + Math.sin(time * 10) * 0.009, 0.65],
        };
    if (time < 6.48)
        return track([
            { timeSeconds: 6.22, pose: carry },
            { timeSeconds: 6.36, pose: { ...ready, grip: [0.57, 0.77, 0.81], tension: 0.55 } },
            { timeSeconds: 6.48, pose: aimed },
        ], time);
    if (time < 8.466667)
        return { ...aimed };
    if (time < 9.1)
        return sampleReferenceAction(0, time - 8.466667, 1);
    if (time < 9.7)
        return track([
            { timeSeconds: 9.1, pose: carry },
            {
                timeSeconds: 9.3,
                pose: pose([0.404, 0.907, 0.56], [-0.25, -0.3, 0.46], 0, {
                    leftOpen: 0.95,
                    upperTip: [0.229, 0.273],
                    phase: 'load',
                }),
            },
            { timeSeconds: 9.515, pose: { ...load[3].pose, arrowVisible: false, rightVisible: false } },
            { timeSeconds: 9.55, pose: { ...load[4].pose, grip: [0.715, 0.968, 0.65] } },
            {
                timeSeconds: 9.6,
                pose: {
                    ...load[4].pose,
                    grip: [0.698, 0.952, 0.65],
                    arrowTip: [0.698, 0.693],
                    arrowNear: [0.746, 1.1],
                },
            },
            { timeSeconds: 9.7, pose: load[5].pose },
        ], time);
    return sampleReferenceAction((time - 9.1) / BOW_LOAD_DRAW_SECONDS);
}
/**
 * Projects a normalized reference-frame point into camera-local meters.
 *
 * @param horizontalCoordinate - Horizontal normalized screen coordinate.
 * @param verticalCoordinate - Vertical normalized screen coordinate.
 * @param depth - Positive depth from the camera in meters.
 * @param fieldOfViewDegrees - Vertical camera field of view in degrees.
 * @returns The corresponding camera-local position, with forward along negative Z.
 */
export function referenceScreenPoint(horizontalCoordinate, verticalCoordinate, depth, fieldOfViewDegrees = 76) {
    const height = 2 * depth * Math.tan((fieldOfViewDegrees * Math.PI) / 360);
    return new Vector3(((horizontalCoordinate - 0.5) * height * 16) / 9, (0.5 - verticalCoordinate) * height, -depth);
}
/**
 * Reconstructs weapon rotation from measured Euler values or an upper-limb screen ray.
 *
 * @param pose - Sampled reference pose to orient.
 * @returns The weapon quaternion in camera-local coordinates.
 */
export function referenceRotation(pose) {
    if (pose.upperTip) {
        const origin = referenceScreenPoint(...pose.grip);
        const ray = referenceScreenPoint(pose.upperTip[0], pose.upperTip[1], 1);
        const localTip = new Vector3(0, 1.04 - 0.075 * pose.tension, 0.18 * pose.tension);
        const length = localTip.length() * 0.9;
        const rayLengthSquared = ray.lengthSq();
        const rayOriginDotProduct = ray.dot(origin);
        const constant = origin.lengthSq() - length * length;
        const discriminant = rayOriginDotProduct * rayOriginDotProduct - rayLengthSquared * constant;
        const depth = (rayOriginDotProduct + Math.sqrt(Math.max(0, discriminant))) / rayLengthSquared;
        const target = ray.multiplyScalar(depth).sub(origin).normalize();
        return new Quaternion().setFromUnitVectors(localTip.normalize(), target);
    }
    return new Quaternion().setFromEuler(new Euler(...pose.rotation, 'YXZ'));
}
/**
 * Solves arrow depth from its measured tip ray and fixed physical shaft length.
 *
 * @param pose - Sampled reference pose containing arrow screen coordinates.
 * @param length - Physical arrow length in meters.
 * @returns Camera-local nock, tip, and orientation.
 */
export function referenceArrow(pose, length = 0.9405) {
    const tension = Math.max(0, Math.min(1, pose.tension));
    const bottom = 1.23 + 0.67 * tension;
    const nearU = pose.arrowTip[0] +
        ((pose.arrowNear[0] - pose.arrowTip[0]) * (bottom - pose.arrowTip[1])) /
            (pose.arrowNear[1] - pose.arrowTip[1]);
    const nock = referenceScreenPoint(nearU, bottom, 0.34 - 0.22 * tension);
    const ray = referenceScreenPoint(pose.arrowTip[0], pose.arrowTip[1], 1);
    const rayLengthSquared = ray.lengthSq();
    const rayNockDotProduct = ray.dot(nock);
    const constant = nock.lengthSq() - length * length;
    const discriminant = rayNockDotProduct * rayNockDotProduct - rayLengthSquared * constant;
    const depth = (rayNockDotProduct + Math.sqrt(Math.max(0, discriminant))) / rayLengthSquared;
    const tip = ray.multiplyScalar(depth);
    const rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), tip.clone().sub(nock).normalize());
    return { nock, tip, rotation };
}
