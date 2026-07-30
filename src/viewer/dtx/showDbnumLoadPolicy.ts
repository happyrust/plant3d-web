export function shouldStopShowDbnumLoad(
  _stats: { objects: number; triangles: number },
  _fullLoad = false,
): boolean {
  return false;
}
