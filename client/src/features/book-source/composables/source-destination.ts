export function selectSourceDestination(libraries: readonly { id: number }[], preferredId: number | null): number | null {
  if (libraries.some((library) => library.id === preferredId)) return preferredId
  return libraries.length === 1 ? libraries[0]!.id : null
}
