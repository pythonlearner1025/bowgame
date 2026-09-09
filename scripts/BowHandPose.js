import { Bone, Matrix4, Vector3, Quaternion } from 'threepipe';
const v = (a) => new Vector3().fromArray(a);
/** Match both the long axis and knuckle row; a direction-only rotation leaves arbitrary wrist roll. */
export function handOrientation(data, side, direction, across) {
    const bone = (name) => data.bones.find(b => b.name === name + '.' + side);
    const frame = (d, a) => { const x = d.clone().normalize(), y = a.clone().addScaledVector(x, -a.dot(x)).normalize(), z = x.clone().cross(y); return new Matrix4().makeBasis(x, y, z); };
    const d = v(bone('finger3-1').head).sub(v(bone('wrist').head)), a = v(bone('finger5-1').head).sub(v(bone('finger2-1').head));
    return new Quaternion().setFromRotationMatrix(frame(direction, across).multiply(frame(d, a).invert()));
}
/** Native joint axes and separate saddle-joint thumb opposition retain the connected anatomical surface. */
export function poseHandFingers(data, bones, side, hook, openness = 0) {
    const find = (name) => data.bones.findIndex(b => b.name === name + '.' + side);
    const curlSign = side === 'L' ? 1 : -1;
    const across = v(data.bones[find('finger5-1')].head).sub(v(data.bones[find('finger2-1')].head)).normalize();
    for (let finger = 2; finger <= 5; finger++) {
        const angles = hook ? ([[.24, 1.10, .56], [.28, 1.13, .60], [.32, 1.12, .61], [.80, 1.10, .65]][finger - 2]) : [.70, 1.05, .62];
        const root = find(`finger${finger}-1`);
        bones[root].position.copy(v(data.bones[root].position));
        if (hook)
            bones[root].position.addScaledVector(across, [.006, 0, -.005, -.011][finger - 2]);
        for (let joint = 1; joint <= 3; joint++) {
            const i = find(`finger${finger}-${joint}`);
            if (i >= 0)
                bones[i].quaternion.setFromAxisAngle(across, curlSign * angles[joint - 1] * (1 - openness * (hook ? .72 : .95)));
        }
    }
    const first = find('finger1-1'), second = find('finger1-2'), third = find('finger1-3');
    const thumbDirection = v(data.bones[second].head).sub(v(data.bones[first].head)).normalize();
    const palmDirection = v(data.bones[find('finger3-1')].head).sub(v(data.bones[find('wrist')].head)).normalize();
    const thumbAxis = thumbDirection.clone().cross(palmDirection).normalize();
    const palmNormal = palmDirection.clone().cross(across).multiplyScalar(-curlSign).normalize();
    for (const [joint, amount] of [[first, hook ? .32 : .20], [second, hook ? .44 : .70], [third, hook ? .22 : .40]]) {
        const direction = v(data.bones[joint].tail).sub(v(data.bones[joint].head)).normalize();
        bones[joint].quaternion.setFromAxisAngle(direction.cross(palmNormal).normalize(), amount);
    }
    bones[first].quaternion.premultiply(new Quaternion().setFromAxisAngle(thumbAxis, hook ? .10 : .90));
}
