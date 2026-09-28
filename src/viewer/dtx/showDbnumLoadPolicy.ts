// ponytail: keep the startup overview interactive; tree actions load detail on demand.
const SAFE_MAX_OBJECTS = 5_000;
const SAFE_MAX_TRIANGLES = 1_000_000;

export function shouldStopShowDbnumLoad(
  stats: { objects: number; triangles: number },
  fullLoad = false,
): boolean {
  return !fullLoad && (
    stats.objects >= SAFE_MAX_OBJECTS || stats.triangles >= SAFE_MAX_TRIANGLES
  );
}
