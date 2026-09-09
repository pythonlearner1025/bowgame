/**
 * Batches identical static arena meshes into spatially local instanced draws.
 * It preserves authored objects for editing and does not create collision geometry.
 */

import { BufferGeometry, Group, InstancedMesh, Matrix4, Mesh, SphereGeometry } from 'threepipe';

// Eighteen-meter cells keep batch bounds local enough for useful frustum culling.
const BATCH_CELL_SIZE_METERS = 18;

// The scree replacement uses ten radial and six height segments for a low-cost silhouette.
const SCREE_WIDTH_SEGMENTS = 10;
const SCREE_HEIGHT_SEGMENTS = 6;

// Two identical meshes are enough for instancing to reduce separate draw submissions.
const MIN_BATCH_SIZE = 2;

// The procedural distortion frequencies and amplitudes preserve the original scree silhouette.
const LARGE_DISTORTION_AMPLITUDE = 0.15;
const SMALL_DISTORTION_AMPLITUDE = 0.045;
const LARGE_X_FREQUENCY = 4;
const LARGE_Z_FREQUENCY = 3;
const LARGE_Y_FREQUENCY = 4;
const SMALL_X_FREQUENCY = 13;
const SMALL_Z_FREQUENCY = 8;
const SMALL_Y_FREQUENCY = 11;

interface OriginalMeshState {
  mesh: Mesh;
  isVisible: boolean;
  isMatrixAutoUpdateEnabled: boolean;
}

interface GeometryReplacement {
  mesh: InstancedMesh;
  original: BufferGeometry;
  replacement: SphereGeometry;
}

/** Statistics and cleanup for one applied static-scene batching pass. */
export interface BowSceneBatch {
  originalMeshes: number;
  batches: number;
  dispose(): void;
}

type MeshWithSkinFlag = Mesh & { isSkinnedMesh?: boolean };

// Replaces the high-detail instanced scree source with the original deformed low-poly sphere.
function replaceScreeGeometry(mesh: InstancedMesh): GeometryReplacement {
  const replacement = new SphereGeometry(1, SCREE_WIDTH_SEGMENTS, SCREE_HEIGHT_SEGMENTS);
  const positions = replacement.getAttribute('position');

  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    const largeDistortion =
      LARGE_DISTORTION_AMPLITUDE *
      Math.sin(x * LARGE_X_FREQUENCY + z * LARGE_Z_FREQUENCY) *
      Math.cos(y * LARGE_Y_FREQUENCY);
    const smallDistortion =
      SMALL_DISTORTION_AMPLITUDE *
      Math.sin(x * SMALL_X_FREQUENCY - z * SMALL_Z_FREQUENCY) *
      Math.cos(y * SMALL_Y_FREQUENCY);
    const scale = 1 + largeDistortion + smallDistortion;
    positions.setXYZ(i, x * scale, y * scale, z * scale);
  }

  replacement.computeVertexNormals();
  const original = mesh.geometry;
  mesh.geometry = replacement;

  return { mesh, original, replacement };
}

// Creates a stable key from render resources, shadow flags, and the mesh's spatial cell.
function makeBatchKey(mesh: Mesh): string {
  const matrixElements = mesh.matrixWorld.elements;
  const cellX = Math.floor(matrixElements[12] / BATCH_CELL_SIZE_METERS);
  const cellZ = Math.floor(matrixElements[14] / BATCH_CELL_SIZE_METERS);

  const materialKey = Array.isArray(mesh.material)
    ? mesh.material.map((material) => material.uuid).join(',')
    : mesh.material.uuid;

  return [mesh.geometry.uuid, materialKey, mesh.castShadow, mesh.receiveShadow, cellX, cellZ].join(
    ':',
  );
}

// Restores all authored meshes and releases the runtime-only batch resources.
function disposeBatch(
  batches: InstancedMesh[],
  originals: OriginalMeshState[],
  replacements: GeometryReplacement[],
): void {
  for (const batch of batches) {
    batch.removeFromParent();
    batch.dispose();
  }

  for (const state of originals) {
    state.mesh.visible = state.isVisible;
    state.mesh.matrixAutoUpdate = state.isMatrixAutoUpdateEnabled;
  }

  for (const state of replacements) {
    state.mesh.geometry = state.original;
    state.replacement.dispose();
  }
}

/**
 * Batches matching arena meshes while preserving their authored state for cleanup.
 *
 * @param arena - Authored arena root whose world-space meshes are inspected.
 * @param runtime - Runtime root that receives generated instanced meshes.
 * @returns Batch counts and an idempotent-style cleanup operation.
 */
export function batchBowScene(arena: Group, runtime: Group): BowSceneBatch {
  const originals: OriginalMeshState[] = [];
  const batches: InstancedMesh[] = [];
  const replacements: GeometryReplacement[] = [];
  const batchGroups = new Map<string, Mesh[]>();
  arena.updateWorldMatrix(true, true);
  runtime.updateWorldMatrix(true, false);

  arena.traverseVisible((object) => {
    const mesh = object as MeshWithSkinFlag;

    if (!mesh.isMesh || mesh.isSkinnedMesh) {
      return;
    }

    if ((mesh as InstancedMesh).isInstancedMesh) {
      // This pattern accepts the two historical names: `Forest scree` and `Forest_scree`.
      if (/^Forest[ _]scree$/.test(mesh.name)) {
        replacements.push(replaceScreeGeometry(mesh as InstancedMesh));
      }

      return;
    }

    if (Array.isArray(mesh.material)) {
      return;
    }

    const key = makeBatchKey(mesh);
    const group = batchGroups.get(key) ?? [];
    group.push(mesh);
    batchGroups.set(key, group);
  });

  const runtimeInverse = runtime.matrixWorld.clone().invert();
  const localMatrix = new Matrix4();

  for (const meshes of batchGroups.values()) {
    if (meshes.length < MIN_BATCH_SIZE) {
      continue;
    }

    const firstMesh = meshes[0];
    const batch = new InstancedMesh(firstMesh.geometry, firstMesh.material, meshes.length);
    batch.name = `Static arena batch: ${firstMesh.name}`;
    batch.castShadow = firstMesh.castShadow;
    batch.receiveShadow = firstMesh.receiveShadow;

    meshes.forEach((mesh, index) => {
      batch.setMatrixAt(index, localMatrix.copy(runtimeInverse).multiply(mesh.matrixWorld));
      originals.push({
        mesh,
        isVisible: mesh.visible,
        isMatrixAutoUpdateEnabled: mesh.matrixAutoUpdate,
      });
      mesh.visible = false;
      mesh.matrixAutoUpdate = false;
    });
    batch.computeBoundingSphere();
    runtime.add(batch);
    batches.push(batch);
  }

  return {
    originalMeshes: originals.length,
    batches: batches.length,
    dispose(): void {
      disposeBatch(batches, originals, replacements);
    },
  };
}
