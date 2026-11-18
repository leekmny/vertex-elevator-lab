/** Shared clock of a comparison run; a drained primary can stop before its peers. */
export function sessionTime(snapshots: readonly { time: number }[]): number {
  return snapshots.reduce((time, snapshot) => Math.max(time, snapshot.time), 0);
}
