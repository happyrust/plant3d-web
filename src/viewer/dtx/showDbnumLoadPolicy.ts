// ponytail: cap the debug overview until view-dependent streaming/culling is implemented.
const SAFE_MAX_OBJECTS = 20_000;
const SAFE_MAX_TRIANGLES = 2_500_000;

export function shouldStopShowDbnumLoad(
  stats: { objects: number; triangles: number },
  fullLoad = false,
): boolean {
  return !fullLoad && (
    stats.objects >= SAFE_MAX_OBJECTS || stats.triangles >= SAFE_MAX_TRIANGLES
  );
}
