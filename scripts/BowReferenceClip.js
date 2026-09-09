import { Euler, Quaternion, Vector3 } from 'threepipe';
export const BOW_LOAD_DRAW_SECONDS = 1.15;
export const BOW_RELEASE_SECONDS = .65;
const pose = (grip, rotation, tension = 0, extra = {}) => ({ grip, rotation, tension, right: [.76, 1.22, .22], rightVisible: false, arrowVisible: false, arrowSeated: true, leftOpen: 0, rightOpen: 0, phase: 'carry', arrowTip: [.615, .608], arrowNear: [.745, 1.10], ...extra });
// Screen measurements use the supplied UQgjv5H7CZs clip, 1920×1080, centered by image height.
// World/camera motion is intentionally excluded: these tracks describe only the weapon and hands.
const carry = pose([.568, .949, .65], [.12, .08, -1.34]);
const ready = pose([.505, .670, .84], [0, 0, -.46], 1, { arrowVisible: true, phase: 'hold', arrowTip: [.5, .5], arrowNear: [.5, 1.10] });
const aimed = pose([.487, .647, .84], [0, 0, -.52], 1, { arrowVisible: true, phase: 'aim', arrowTip: [.5, .5], arrowNear: [.5, 1.10] });
const load = [
    { t: 0, pose: carry },
    { t: .12, pose: pose([.616, .965, .50], [-.85, -.6, .72], 0, { leftOpen: .6, upperTip: [.43, .64], phase: 'turn' }) },
    { t: .30, pose: pose([.598, .933, .53], [-.78, -.42, .62], 0, { leftOpen: .95, upperTip: [.398, .505], phase: 'load' }) },
    { t: .45, pose: pose([.720, .975, .61], [.05, .08, -1.19], 0, { arrowVisible: true, arrowSeated: false, rightVisible: true, right: [.805, 1.035, .27], phase: 'fetch' }) },
    { t: .54, pose: pose([.739, .937, .65], [0, 0, -1.06], 0, { arrowVisible: true, arrowSeated: false, rightVisible: true, right: [.80, 1.06, .27], arrowTip: [.723, .678], arrowNear: [.785, 1.08], phase: 'nock' }) },
    { t: .60, pose: pose([.698, .875, .73], [0, .02, -.73], 0, { arrowVisible: true, arrowSeated: true, rightVisible: true, right: [.706, .995, .28], rightOpen: .2, phase: 'nock' }) },
    { t: .73, pose: pose([.620, .735, .80], [0, 0, -.43], .25, { arrowVisible: true, rightVisible: true, right: [.724, 1.075, .25], rightOpen: .12, phase: 'draw' }) },
    { t: .94, pose: pose([.615, .705, .81], [0, 0, -.36], .78, { arrowVisible: true, phase: 'draw' }) },
    { t: 1.15, pose: ready },
];
const mix = (a, b, t) => a + (b - a) * t;
function blend(a, b, t) {
    return { ...(t < .5 ? a : b), grip: a.grip.map((v, i) => mix(v, b.grip[i], t)), rotation: a.rotation.map((v, i) => mix(v, b.rotation[i], t)), right: a.right.map((v, i) => mix(v, b.right[i], t)), tension: mix(a.tension, b.tension, t), arrowTip: a.arrowTip.map((v, i) => mix(v, b.arrowTip[i], t)), arrowNear: a.arrowNear.map((v, i) => mix(v, b.arrowNear[i], t)), leftOpen: mix(a.leftOpen, b.leftOpen, t), rightOpen: mix(a.rightOpen, b.rightOpen, t) };
}
function track(keys, seconds) {
    if (seconds <= keys[0].t)
        return { ...keys[0].pose };
    for (let i = 1; i < keys.length; i++)
        if (seconds <= keys[i].t) {
            const u = (seconds - keys[i - 1].t) / (keys[i].t - keys[i - 1].t), s = u * u * (3 - 2 * u);
            return blend(keys[i - 1].pose, keys[i].pose, s);
        }
    return { ...keys[keys.length - 1].pose };
}
export function sampleReferenceAction(charge, release = -1, aim = 0) {
    if (release >= 0) {
        const from = blend(ready, aimed, aim), recoil = { ...from, grip: [from.grip[0] + .012, from.grip[1] + .032, from.grip[2] - .015], tension: 0, arrowVisible: false, phase: 'release', rightVisible: false, arrowSeated: false, right: [.69, 1.12, .26] };
        return track([{ t: 0, pose: { ...from, arrowVisible: false, phase: 'release' } }, { t: .065, pose: recoil }, { t: .22, pose: { ...carry, grip: [.58, 1.10, .60], phase: 'lower' } }, { t: .43, pose: { ...carry, grip: [.55, 1.15, .65], phase: 'lower' } }, { t: BOW_RELEASE_SECONDS, pose: carry }], release);
    }
    if (charge <= 0)
        return { ...carry };
    const result = track(load, Math.min(1, charge) * BOW_LOAD_DRAW_SECONDS);
    if (charge > .82)
        return blend(result, { ...aimed, tension: result.tension }, aim * Math.min(1, (charge - .82) / .18));
    return result;
}
/** Reproduce the observed equip, draw-cancel, shot and reload chronology; this preview never fires gameplay arrows. */
export function sampleReferenceTimeline(time) {
    if (time < .78)
        return { ...carry, grip: [.568 + Math.sin(time * 9) * .015, .949 + Math.sin(time * 12) * .008, .65] };
    if (time < 1.34)
        return track([{ t: .78, pose: carry }, { t: 1, pose: pose([.335, .930, .65], [.05, .05, -.81]) }, { t: 1.34, pose: carry }], time);
    if (time < 1.96)
        return { ...carry };
    if (time < 3.13)
        return sampleReferenceAction((time - 1.96) / BOW_LOAD_DRAW_SECONDS);
    if (time < 3.53)
        return track([{ t: 3.13, pose: ready }, { t: 3.4, pose: { ...aimed, grip: [.5464, .6620, .84], rotation: [0, 0, -.410], arrowTip: [.5, .5], arrowNear: [.5, 1.10] } }, { t: 3.53, pose: aimed }], time);
    if (time < 3.97)
        return track([{ t: 3.53, pose: aimed }, { t: 3.80, pose: { ...carry, tension: 0, arrowVisible: true, phase: 'cancel' } }, { t: 3.97, pose: { ...carry, phase: 'carry' } }], time);
    if (time < 6.22)
        return { ...carry, grip: [.565 + Math.sin(time * 8) * .015, .958 + Math.sin(time * 10) * .009, .65] };
    if (time < 6.48)
        return track([{ t: 6.22, pose: carry }, { t: 6.36, pose: { ...ready, grip: [.57, .77, .81], tension: .55 } }, { t: 6.48, pose: aimed }], time);
    if (time < 8.466667)
        return { ...aimed };
    if (time < 9.10)
        return sampleReferenceAction(0, time - 8.466667, 1);
    if (time < 9.70)
        return track([{ t: 9.1, pose: carry }, { t: 9.3, pose: pose([.404, .907, .56], [-.25, -.30, .46], 0, { leftOpen: .95, upperTip: [.229, .273], phase: 'load' }) }, { t: 9.515, pose: { ...load[3].pose, arrowVisible: false, rightVisible: false } }, { t: 9.55, pose: { ...load[4].pose, grip: [.715, .968, .65] } }, { t: 9.60, pose: { ...load[4].pose, grip: [.698, .952, .65], arrowTip: [.698, .693], arrowNear: [.746, 1.10] } }, { t: 9.70, pose: load[5].pose }], time);
    return sampleReferenceAction((time - 9.10) / BOW_LOAD_DRAW_SECONDS);
}
export function referenceScreenPoint(u, v, depth, fov = 76) {
    const height = 2 * depth * Math.tan(fov * Math.PI / 360);
    return new Vector3((u - .5) * height * 16 / 9, (.5 - v) * height, -depth);
}
export function referenceRotation(pose) {
    if (pose.upperTip) {
        const origin = referenceScreenPoint(...pose.grip), ray = referenceScreenPoint(pose.upperTip[0], pose.upperTip[1], 1);
        const localTip = new Vector3(0, 1.04 - .075 * pose.tension, .18 * pose.tension), length = localTip.length() * .9;
        const a = ray.lengthSq(), b = ray.dot(origin), c = origin.lengthSq() - length * length;
        const depth = (b + Math.sqrt(Math.max(0, b * b - a * c))) / a, target = ray.multiplyScalar(depth).sub(origin).normalize();
        return new Quaternion().setFromUnitVectors(localTip.normalize(), target);
    }
    return new Quaternion().setFromEuler(new Euler(...pose.rotation, 'YXZ'));
}
/** Solve the arrow's depth from its measured tip ray and fixed physical shaft length. */
export function referenceArrow(pose, length = .9405) {
    const tension = Math.max(0, Math.min(1, pose.tension)), bottom = 1.23 + .67 * tension, nearU = pose.arrowTip[0] + (pose.arrowNear[0] - pose.arrowTip[0]) * (bottom - pose.arrowTip[1]) / (pose.arrowNear[1] - pose.arrowTip[1]);
    const nock = referenceScreenPoint(nearU, bottom, .34 - .22 * tension);
    const ray = referenceScreenPoint(pose.arrowTip[0], pose.arrowTip[1], 1), a = ray.lengthSq(), b = ray.dot(nock), c = nock.lengthSq() - length * length;
    const depth = (b + Math.sqrt(Math.max(0, b * b - a * c))) / a;
    const tip = ray.multiplyScalar(depth), rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), tip.clone().sub(nock).normalize());
    return { nock, tip, rotation };
}
export { blend as blendReferencePoses };
