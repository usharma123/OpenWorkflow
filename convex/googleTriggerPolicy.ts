export type SheetRowEvent = {
  key: string;
  rowNumber: number;
  row: Record<string, unknown>;
  values: unknown[];
};

function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function sheetRowChanges(
  values: unknown[][],
  previousFingerprints: string[],
): { events: SheetRowEvent[]; fingerprints: string[] } {
  const headers = (values[0] ?? []).map((value, index) => String(value || `column_${index + 1}`));
  const rows = values.slice(1);
  const fingerprints = rows.map((row, index) => `${index + 2}:${fingerprint(JSON.stringify(row))}`);
  const known = new Set(previousFingerprints);
  const events = rows.flatMap((row, index) => {
    const key = fingerprints[index];
    if (known.has(key)) return [];
    return [{
      key,
      rowNumber: index + 2,
      row: Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ""])),
      values: row,
    }];
  });
  return { events, fingerprints: fingerprints.slice(-500) };
}
