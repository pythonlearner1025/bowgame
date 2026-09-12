/** Resolves trusted browser-loaded game assets relative to the emitted script directory. */
/**
 * Resolves one project-owned path below the project's assets directory.
 *
 * @param path - Literal path supplied by a project-owned asset caller.
 * @returns An absolute same-origin URL that works in editor, check, and release layouts.
 */
export function bowAssetUrl(path) {
    return new URL(`../assets/${path}`, import.meta.url).href;
}
