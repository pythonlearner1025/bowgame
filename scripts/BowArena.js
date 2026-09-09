import { BoxGeometry, BufferGeometry, CanvasTexture, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, Mesh, MeshStandardMaterial, Object3D, PlaneGeometry, RepeatWrapping, SRGBColorSpace, SphereGeometry, Vector3, } from 'threepipe';
/** Seeded, entirely local environment; no asset requests or external game assets. */
export function buildBowArena() {
    const group = new Group();
    group.name = 'K3D_BOW_DEMO_ARENA';
    const obstacles = [];
    let seed = 73429;
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    const texture = (kind) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 512;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = { earth: '#686449', bark: '#514940', stone: '#85857b', wood: '#807260' }[kind];
        ctx.fillRect(0, 0, 512, 512);
        // Broad mottling under fine grain makes stone and dirt read at both viewing scales.
        if (kind === 'earth' || kind === 'stone') {
            for (let i = 0; i < 220; i++) {
                const x = random() * 512, y = random() * 512;
                const radius = 12 + random() * 95;
                const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
                gradient.addColorStop(0, random() > 0.5 ? 'rgba(29,39,24,0.23)' : 'rgba(194,186,145,0.19)');
                gradient.addColorStop(1, 'rgba(100,100,80,0)');
                ctx.fillStyle = gradient;
                ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
            }
        }
        for (let i = 0; i < 17000; i++) {
            const n = random();
            ctx.fillStyle = `rgba(${n > 0.5 ? '205,201,166' : '25,29,22'},${0.04 + random() * 0.15})`;
            const x = random() * 512;
            const y = random() * 512;
            const w = kind === 'bark' || kind === 'wood' ? 0.5 + random() * 2 : 1 + random() * 8;
            const h = kind === 'bark' || kind === 'wood' ? 8 + random() * 70 : 1 + random() * 7;
            ctx.fillRect(x, y, w, h);
        }
        const map = new CanvasTexture(canvas);
        map.colorSpace = SRGBColorSpace;
        map.wrapS = map.wrapT = RepeatWrapping;
        map.repeat.set(kind === 'earth' ? 24 : 2, kind === 'earth' ? 24 : 2);
        map.anisotropy = 8;
        return map;
    };
    const earth = new MeshStandardMaterial({ map: texture('earth'), roughness: 1, color: 0xc1bfa2 });
    const bark = new MeshStandardMaterial({ map: texture('bark'), roughness: 1 });
    const stone = new MeshStandardMaterial({ map: texture('stone'), roughness: 0.97, color: 0xa7aaa1 });
    const stoneDark = new MeshStandardMaterial({ map: stone.map, roughness: 1, color: 0x687065 });
    const wood = new MeshStandardMaterial({ map: texture('wood'), roughness: 0.95 });
    const rust = new MeshStandardMaterial({ color: 0x765444, metalness: 0.38, roughness: 0.87 });
    const steel = new MeshStandardMaterial({ color: 0x4b5551, metalness: 0.6, roughness: 0.65 });
    const canvas = new MeshStandardMaterial({ color: 0x70715a, roughness: 1, side: DoubleSide });
    earth.bumpMap = earth.map;
    earth.bumpScale = 0.09;
    bark.bumpMap = bark.map;
    bark.bumpScale = 0.1;
    stone.bumpMap = stone.map;
    stone.bumpScale = 0.16;
    stoneDark.bumpMap = stone.map;
    stoneDark.bumpScale = 0.16;
    wood.bumpMap = wood.map;
    wood.bumpScale = 0.055;
    const add = (geometry, material, name, x, y, z, sx = 1, sy = 1, sz = 1) => {
        const mesh = new Mesh(geometry, material);
        mesh.name = name;
        mesh.userData.bowSolid = true;
        mesh.position.set(x, y, z);
        mesh.scale.set(sx, sy, sz);
        mesh.castShadow = mesh.receiveShadow = true;
        group.add(mesh);
        return mesh;
    };
    const box = new BoxGeometry(1, 1, 1);
    const rockGeometry = new SphereGeometry(1, 32, 22);
    const positions = rockGeometry.getAttribute('position');
    // Smooth weathered surfaces with broad asymmetric erosion and fine undulations.
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
        const distortion = 1 + 0.15 * Math.sin(x * 4 + z * 3) * Math.cos(y * 4)
            + 0.045 * Math.sin(x * 13 - z * 8) * Math.cos(y * 11);
        positions.setXYZ(i, x * distortion, y * distortion, z * distortion);
    }
    rockGeometry.computeVertexNormals();
    const ground = add(new PlaneGeometry(230, 230), earth, 'Forest floor', 0, -0.04, 0);
    ground.rotation.x = -Math.PI / 2;
    ground.castShadow = false;
    const rock = (x, z, radius, height, collision = true) => {
        const mesh = add(rockGeometry, random() > 0.4 ? stone : stoneDark, 'Weathered granite', x, height * 0.36 - 0.12, z, radius, height * 0.65, radius * (0.8 + random() * 0.3));
        mesh.rotation.y = random() * Math.PI;
        if (collision)
            obstacles.push({ x, z, r: radius * 0.95, height });
    };
    [[-8, 8, 2.2, 2.7], [9, 5, 2.1, 2.4], [-12, -7, 2.7, 3.4], [13, -11, 2.5, 2.7],
        [-2, -15, 2, 2.4], [17, 14, 2.3, 2.5], [-18, 17, 1.8, 2.2], [3, 10, 1.1, 1.2],
        [-18, 0, 1.7, 2.2], [19, -2, 1.8, 2.4]].forEach(([x, z, r, h]) => rock(x, z, r, h));
    for (let i = 0; i < 24; i++) {
        const angle = i / 24 * Math.PI * 2;
        const distance = 30 + random() * 8;
        rock(Math.sin(angle) * distance, Math.cos(angle) * distance, 3 + random() * 3, 4 + random() * 7, false);
    }
    for (let i = 0; i < 12; i++) {
        const angle = i / 12 * Math.PI * 2;
        rock(Math.sin(angle) * 83, Math.cos(angle) * 83, 15 + random() * 8, 20 + random() * 18, false);
    }
    // Needle sprays are drawn locally and alpha tested, preserving the irregular gaps of pine boughs.
    const needleCanvas = document.createElement('canvas');
    needleCanvas.width = needleCanvas.height = 256;
    const needleContext = needleCanvas.getContext('2d');
    const stroke = (x1, y1, x2, y2, color, width) => {
        needleContext.strokeStyle = color;
        needleContext.lineWidth = width;
        needleContext.beginPath();
        needleContext.moveTo(x1, y1);
        needleContext.lineTo(x2, y2);
        needleContext.stroke();
    };
    stroke(128, 247, 128, 13, '#514f36', 3);
    for (let tier = 0; tier < 14; tier++) {
        const y = 25 + tier * 15;
        const extent = 13 + tier * 5.9;
        for (const side of [-1, 1]) {
            const endX = 128 + extent * side;
            const endY = y - 20 - random() * 18;
            stroke(128, y + 11, endX, endY, '#474e32', 1.8);
            for (let n = 0; n < 30; n++) {
                const t = n / 30;
                const nx = 128 + (endX - 128) * t;
                const ny = y + 11 + (endY - y - 11) * t;
                const length = 8 + random() * 15;
                const shade = ['#4f663c', '#657547', '#344b2e', '#7b8453'][Math.floor(random() * 4)];
                stroke(nx, ny, nx + side * length * 0.55, ny - length, shade, 1.5);
                stroke(nx, ny, nx + side * length, ny + length * 0.24, shade, 1.5);
            }
        }
    }
    const needleMap = new CanvasTexture(needleCanvas);
    needleMap.colorSpace = SRGBColorSpace;
    needleMap.anisotropy = 8;
    const needleMaterial = new MeshStandardMaterial({ map: needleMap, color: 0xb0bc91,
        alphaTest: 0.38, side: DoubleSide, roughness: 1 });
    const needles = new InstancedMesh(new PlaneGeometry(1, 1), needleMaterial, 7000);
    needles.name = 'Detailed pine needle boughs';
    needles.castShadow = needles.receiveShadow = true;
    const branches = new InstancedMesh(new CylinderGeometry(0.028, 0.095, 1, 6), bark, 1800);
    branches.name = 'Tapered pine branches';
    branches.castShadow = branches.receiveShadow = true;
    let needleCount = 0, branchCount = 0;
    const part = new Object3D();
    const up = new Vector3(0, 1, 0);
    const trunk = new CylinderGeometry(0.07, 0.43, 1, 14, 5);
    const tree = (x, z, height, collision) => {
        add(trunk, bark, 'Pine trunk', x, height * 0.5, z, 1, height, 1);
        const rotation = random() * Math.PI * 2;
        for (let tier = 0; tier < 7; tier++) {
            const fraction = 0.35 + tier * 0.088;
            const radius = height * (0.245 - tier * 0.029);
            for (let arm = 0; arm < 6; arm++) {
                const angle = rotation + arm * Math.PI / 3 + tier * 0.72 + random() * 0.3;
                const length = radius * (0.78 + random() * 0.4);
                const root = new Vector3(x, height * fraction, z);
                const tip = new Vector3(x + Math.cos(angle) * length, height * fraction - length * 0.15 + random() * 0.25, z + Math.sin(angle) * length);
                const direction = tip.clone().sub(root);
                part.position.copy(root).addScaledVector(direction, 0.5);
                part.quaternion.setFromUnitVectors(up, direction.clone().normalize());
                part.scale.set(1 - tier * 0.08, direction.length(), 1 - tier * 0.08);
                part.updateMatrix();
                branches.setMatrixAt(branchCount++, part.matrix);
                for (let spray = 0; spray < 4; spray++) {
                    part.position.copy(root).addScaledVector(direction, 0.3 + spray * 0.19);
                    part.position.y += 0.07;
                    // Crossed, sloping sprays catch light from every view and avoid solid conical crowns.
                    part.rotation.set(-0.65 - random() * 0.7, -angle + Math.PI / 2, (spray % 2 ? 0.7 : -0.7));
                    part.scale.set(length * 0.7, length * 0.93, 1);
                    part.updateMatrix();
                    needles.setMatrixAt(needleCount++, part.matrix);
                }
            }
        }
        if (collision)
            obstacles.push({ x, z, r: 0.5, height });
    };
    for (let i = 0; i < 34; i++) {
        const angle = i / 34 * Math.PI * 2 + random() * 0.12;
        const distance = 25 + random() * 15;
        tree(Math.sin(angle) * distance, Math.cos(angle) * distance, 10 + random() * 8, distance < 29);
    }
    [[-15, 9], [15, 18], [-20, -13], [18, -15], [7, -21], [-10, -20]].forEach(([x, z]) => tree(x, z, 10 + random() * 3, true));
    needles.count = needleCount;
    branches.count = branchCount;
    group.add(needles, branches);
    // A broken hunting outpost: low stone cover, timber supports, slatted barricades and shelter.
    const wall = (x, z, length, angle, height = 1.5) => {
        const mesh = add(box, stone, 'Ruined stone wall', x, height / 2, z, length, height, 0.7);
        mesh.rotation.y = angle;
        const count = Math.ceil(length / 0.8);
        for (let i = 0; i <= count; i++) {
            const t = (i / count - 0.5) * length;
            obstacles.push({ x: x + Math.cos(angle) * t, z: z - Math.sin(angle) * t, r: 0.48, height });
        }
        for (let i = 0; i < 5; i++) {
            const t = (i / 4 - 0.5) * length;
            add(rockGeometry, stoneDark, 'Broken wall cap', x + Math.cos(angle) * t, height, z - Math.sin(angle) * t, 0.5, 0.2 + random() * 0.12, 0.44);
        }
    };
    wall(-5.5, -1.5, 5.5, 0.12);
    wall(5.5, -6.5, 4.3, -0.28);
    wall(-8, -3.8, 3.8, Math.PI / 2, 1.7);
    const crate = (x, z, size) => {
        add(box, wood, 'Supply crate', x, size / 2, z, size, size, size);
        for (const offset of [-0.36, 0.36])
            add(box, steel, 'Crate strap', x + size * offset, size / 2, z, 0.075, size + 0.03, size + 0.04);
        obstacles.push({ x, z, r: size * 0.68, height: size });
    };
    crate(5, -3.4, 1.2);
    crate(6.7, -3.7, 0.95);
    crate(-6, -4.9, 1);
    for (const x of [9, 14]) {
        for (const z of [-20, -16]) {
            add(box, wood, 'Shelter post', x, 1.6, z, 0.18, 3.2, 0.18);
            obstacles.push({ x, z, r: 0.23, height: 3.2 });
        }
    }
    const roof = add(new PlaneGeometry(5.8, 4.8), canvas, 'Weathered shelter tarp', 11.5, 3.2, -18);
    roof.rotation.set(-Math.PI / 2, 0.1, 0.035);
    for (let i = 0; i < 9; i++) {
        const plank = add(box, i % 3 ? wood : rust, 'Salvaged barricade plank', -11 + i * 0.33, 0.8, -13, 0.27, 1.6 + random() * 0.25, 0.13);
        plank.rotation.z = (random() - 0.5) * 0.09;
    }
    obstacles.push({ x: -9.7, z: -13, r: 1.65, height: 1.7 });
    const log = add(new CylinderGeometry(0.34, 0.45, 5, 12), bark, 'Fallen pine', -13, 0.36, 13);
    log.rotation.set(0, 0.6, Math.PI / 2);
    // Fallen timber is solid and supports parkour like its visible surface.
    // Instancing supplies dense ground detail with two draw calls.
    const blades = new BufferGeometry();
    blades.setAttribute('position', new Float32BufferAttribute([
        -0.1, 0, 0, 0.1, 0, 0, 0.04, 0.65, 0.04,
        0, 0, -0.1, 0, 0, 0.1, -0.04, 0.5, 0.04,
        -0.07, 0, -0.07, 0.07, 0, 0.07, 0.09, 0.43, 0.02,
    ], 3));
    blades.computeVertexNormals();
    const grassMaterial = new MeshStandardMaterial({ color: 0x696d3d, roughness: 1, side: DoubleSide });
    const grass = new InstancedMesh(blades, grassMaterial, 3400);
    grass.name = 'Dry forest grasses';
    const matrix = new Object3D();
    let grassCount = 0;
    for (let i = 0; i < 4500 && grassCount < 3400; i++) {
        const x = (random() - 0.5) * 105, z = (random() - 0.5) * 105;
        // Worn central crossing and spawn area remain readable.
        if (Math.abs(x) < 3.7 || Math.abs(z + 2) < 2.2 || Math.hypot(x, z - 17) < 3)
            continue;
        matrix.position.set(x, 0, z);
        matrix.rotation.y = random() * Math.PI;
        matrix.scale.setScalar(0.5 + random() * 1.2);
        matrix.updateMatrix();
        grass.setMatrixAt(grassCount++, matrix.matrix);
    }
    grass.count = grassCount;
    grass.receiveShadow = true;
    group.add(grass);
    const pebbles = new InstancedMesh(rockGeometry, stoneDark, 160);
    pebbles.name = 'Forest scree';
    for (let i = 0; i < 160; i++) {
        matrix.position.set((random() - 0.5) * 58, 0.025, (random() - 0.5) * 58);
        matrix.rotation.set(random(), random() * Math.PI, random());
        const s = 0.06 + random() * 0.15;
        matrix.scale.set(s * 1.7, s * 0.5, s);
        matrix.updateMatrix();
        pebbles.setMatrixAt(i, matrix.matrix);
    }
    pebbles.receiveShadow = true;
    group.add(pebbles);
    return {
        group, obstacles,
        botSpawns: [new Vector3(-14, 0, -17), new Vector3(0, 0, -23), new Vector3(20, 0, -6)],
        playerSpawn: new Vector3(0, 0, 17),
    };
}
