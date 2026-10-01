/** Shared integer tracks for the source grid. Native layout still owns the boxes and text. */
export function tableTracks(available: number, tracks: Array<{ width?: number; minWidth?: number; grow?: number }>): number[] {
  const widths = tracks.map(track => track.width ?? track.minWidth ?? 0);
  const flexible = new Set(tracks.flatMap((track, index) => track.grow ? [index] : []));
  let remaining = available - tracks.reduce((sum, track) => sum + (track.grow ? 0 : track.width ?? track.minWidth ?? 0), 0);
  while (flexible.size) {
    const weight = [...flexible].reduce((sum, index) => sum + tracks[index].grow!, 0);
    const frozen = [...flexible].filter(index => remaining * tracks[index].grow! / weight < (tracks[index].minWidth ?? 0));
    if (frozen.length) {
      for (const index of frozen) { remaining -= widths[index]; flexible.delete(index); }
      continue;
    }
    let boundary = 0, previous = 0;
    for (const index of flexible) {
      boundary += remaining * tracks[index].grow! / weight;
      const next = Math.round(boundary);
      widths[index] = next - previous; previous = next;
    }
    break;
  }
  return widths;
}
