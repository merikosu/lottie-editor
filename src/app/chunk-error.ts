/**
 * A part of the app that is loaded on demand could not be fetched (offline, or the app was
 * updated and the old file is gone): trying again in place cannot help, reloading does.
 */
export function isChunkLoadError(error: Error): boolean {
  return (
    error.name === 'ChunkLoadError' ||
    /dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(
      error.message,
    )
  )
}
