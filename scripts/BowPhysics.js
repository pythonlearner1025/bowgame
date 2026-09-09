/**
 * Provides dependency-free bow ballistics and legacy cylinder collision helpers.
 * It does not own mesh collision, scene state, or frame timing.
 */
// Earth-normal gravity preserves the original arrow and jump trajectories in meters per second.
export const GRAVITY = 9.81;
// A full draw takes 1.15 seconds so quick shots remain possible but weaker.
export const BOW_DRAW_SECONDS = 1.15;
// An uncharged arrow starts at 18 m/s, matching the original close-range response.
const MIN_ARROW_SPEED_METERS_PER_SECOND = 18;
// A full draw adds 38 m/s, producing the original 56 m/s maximum arrow speed.
const ARROW_SPEED_RANGE_METERS_PER_SECOND = 38;
// An uncharged body shot deals 24 health points.
const MIN_SHOT_DAMAGE = 24;
// A full draw adds 46 health points before any headshot multiplier.
const SHOT_DAMAGE_RANGE = 46;
// Headshots deal 1.8 times body damage, preserving the existing two-hit combat balance.
const HEADSHOT_DAMAGE_MULTIPLIER = 1.8;
// Squared lengths below this threshold are treated as zero to avoid unstable division.
const SQUARED_LENGTH_EPSILON = 1e-12;
// The legacy movement helper keeps geometry-free callers inside the original 27-meter arena.
const LEGACY_ARENA_RADIUS_METERS = 27;
// Two resolution passes handle overlaps between neighboring legacy cylinders.
const COVER_RESOLUTION_PASSES = 2;
// Separations below this distance cannot provide a stable push direction.
const COVER_DIRECTION_EPSILON_METERS = 0.0001;
// The original player collision radius is retained for geometry-free callers.
const DEFAULT_ACTOR_RADIUS_METERS = 0.38;
// Quadratic equations use four times the leading and constant coefficients.
const QUADRATIC_DISCRIMINANT_FACTOR = 4;
/**
 * Computes arrow launch speed from a normalized draw charge.
 *
 * @param charge - Draw charge, clamped to the inclusive range from zero to one.
 * @returns Arrow speed in meters per second.
 */
export function shotSpeed(charge) {
    const normalizedCharge = Math.min(1, Math.max(0, charge));
    return MIN_ARROW_SPEED_METERS_PER_SECOND + normalizedCharge * ARROW_SPEED_RANGE_METERS_PER_SECOND;
}
/**
 * Computes integer damage for an arrow hit.
 *
 * @param charge - Draw charge, clamped to the inclusive range from zero to one.
 * @param isHeadshot - Whether the hit receives the headshot multiplier.
 * @returns Damage in health points.
 */
export function shotDamage(charge, isHeadshot = false) {
    const normalizedCharge = Math.min(1, Math.max(0, charge));
    const bodyDamage = MIN_SHOT_DAMAGE + normalizedCharge * SHOT_DAMAGE_RANGE;
    const damageMultiplier = isHeadshot ? HEADSHOT_DAMAGE_MULTIPLIER : 1;
    return Math.round(bodyDamage * damageMultiplier);
}
/**
 * Finds the earliest intersection between a line segment and a sphere.
 *
 * @param start - Segment start position in meters.
 * @param end - Segment end position in meters.
 * @param center - Sphere center position in meters.
 * @param radius - Sphere radius in meters.
 * @returns The segment fraction from zero to one, or `null` when there is no hit.
 */
export function segmentSphere(start, end, center, radius) {
    const directionX = end.x - start.x;
    const directionY = end.y - start.y;
    const directionZ = end.z - start.z;
    const offsetX = start.x - center.x;
    const offsetY = start.y - center.y;
    const offsetZ = start.z - center.z;
    const directionLengthSquared = directionX * directionX + directionY * directionY + directionZ * directionZ;
    const offsetFromSurfaceSquared = offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ - radius * radius;
    if (offsetFromSurfaceSquared <= 0) {
        return 0;
    }
    if (directionLengthSquared < SQUARED_LENGTH_EPSILON) {
        return null;
    }
    // This is the smaller root of the quadratic ray/sphere intersection equation.
    const linearCoefficient = 2 * (offsetX * directionX + offsetY * directionY + offsetZ * directionZ);
    const discriminant = linearCoefficient * linearCoefficient -
        QUADRATIC_DISCRIMINANT_FACTOR * directionLengthSquared * offsetFromSurfaceSquared;
    if (discriminant < 0) {
        return null;
    }
    const intersectionFraction = (-linearCoefficient - Math.sqrt(discriminant)) / (2 * directionLengthSquared);
    const isOnSegment = intersectionFraction >= 0 && intersectionFraction <= 1;
    return isOnSegment ? intersectionFraction : null;
}
/**
 * Finds the earliest intersection with a capped vertical cylinder.
 *
 * @param start - Segment start position in meters.
 * @param end - Segment end position in meters.
 * @param cover - Cylinder origin, radius, and height in meters.
 * @returns The segment fraction from zero to one, or `null` when there is no hit.
 */
export function segmentCover(start, end, cover) {
    const directionX = end.x - start.x;
    const directionY = end.y - start.y;
    const directionZ = end.z - start.z;
    const offsetX = start.x - cover.x;
    const offsetZ = start.z - cover.z;
    const horizontalLengthSquared = directionX * directionX + directionZ * directionZ;
    const linearCoefficient = 2 * (offsetX * directionX + offsetZ * directionZ);
    const offsetFromSideSquared = offsetX * offsetX + offsetZ * offsetZ - cover.r * cover.r;
    let entryFraction = 0;
    let exitFraction = 1;
    if (horizontalLengthSquared < SQUARED_LENGTH_EPSILON) {
        if (offsetFromSideSquared > 0) {
            return null;
        }
    }
    else {
        const discriminant = linearCoefficient * linearCoefficient -
            QUADRATIC_DISCRIMINANT_FACTOR * horizontalLengthSquared * offsetFromSideSquared;
        if (discriminant < 0) {
            return null;
        }
        const squareRoot = Math.sqrt(discriminant);
        entryFraction = Math.max(entryFraction, (-linearCoefficient - squareRoot) / (2 * horizontalLengthSquared));
        exitFraction = Math.min(exitFraction, (-linearCoefficient + squareRoot) / (2 * horizontalLengthSquared));
    }
    if (Math.abs(directionY) < SQUARED_LENGTH_EPSILON) {
        const isOutsideVerticalRange = start.y < 0 || start.y > cover.height;
        if (isOutsideVerticalRange) {
            return null;
        }
    }
    else {
        const floorFraction = -start.y / directionY;
        const ceilingFraction = (cover.height - start.y) / directionY;
        entryFraction = Math.max(entryFraction, Math.min(floorFraction, ceilingFraction));
        exitFraction = Math.min(exitFraction, Math.max(floorFraction, ceilingFraction));
    }
    return entryFraction <= exitFraction ? entryFraction : null;
}
// Moves a point outside one cylindrical obstacle when their horizontal radii overlap.
function resolveCoverOverlap(position, cover, radius) {
    const offsetX = position.x - cover.x;
    const offsetZ = position.z - cover.z;
    const distance = Math.hypot(offsetX, offsetZ);
    const minimumDistance = cover.r + radius;
    if (distance >= minimumDistance) {
        return;
    }
    if (distance > COVER_DIRECTION_EPSILON_METERS) {
        position.x = cover.x + (offsetX / distance) * minimumDistance;
        position.z = cover.z + (offsetZ / distance) * minimumDistance;
        return;
    }
    position.x = cover.x + minimumDistance;
}
/**
 * Applies legacy flat-ground movement against cylindrical cover and the old arena boundary.
 *
 * @param position - Current actor position in meters.
 * @param movementX - Requested X-axis displacement in meters.
 * @param movementZ - Requested Z-axis displacement in meters.
 * @param covers - Vertical cylindrical obstacles to resolve.
 * @param radius - Actor radius in meters.
 * @returns A new resolved position; input objects are not mutated.
 */
// Preserve the five-argument legacy API used by geometry-free integrations.
// eslint-disable-next-line max-params
export function moveWithCover(position, movementX, movementZ, covers, radius = DEFAULT_ACTOR_RADIUS_METERS) {
    const nextPosition = {
        x: position.x + movementX,
        y: position.y,
        z: position.z + movementZ,
    };
    const distanceFromOrigin = Math.hypot(nextPosition.x, nextPosition.z);
    if (distanceFromOrigin > LEGACY_ARENA_RADIUS_METERS) {
        nextPosition.x *= LEGACY_ARENA_RADIUS_METERS / distanceFromOrigin;
        nextPosition.z *= LEGACY_ARENA_RADIUS_METERS / distanceFromOrigin;
    }
    for (let pass = 0; pass < COVER_RESOLUTION_PASSES; pass += 1) {
        for (const cover of covers) {
            resolveCoverOverlap(nextPosition, cover, radius);
        }
    }
    return nextPosition;
}
