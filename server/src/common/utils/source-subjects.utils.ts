export function normalizeSourceSubjects(values: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    for (const part of value.split(/[|｜;；\r\n]+/u)) {
      const name = part.trim().replace(/\s+/gu, ' ');
      const key = name.toLocaleLowerCase('en');
      if (!name || name.length > 120 || seen.has(key)) continue;
      seen.add(key);
      result.push(name);
      if (result.length === 50) return result;
    }
  }
  return result;
}
