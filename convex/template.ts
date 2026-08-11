export function valueAtPath(value: unknown, path: string): unknown {
  if (!path) return value;
  return path.split(".").reduce<unknown>((current, key) => {
    if (["__proto__", "prototype", "constructor"].includes(key)) return undefined;
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(key)) return undefined;
      return current[Number(key)];
    }
    if (current && typeof current === "object" && Object.prototype.hasOwnProperty.call(current, key)) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, value);
}

export function renderTemplate(
  template: string,
  input: unknown,
  stepOutputs: Record<string, unknown> = {},
): string {
  return template.replace(
    /\{\{\s*(input|steps\.([A-Za-z0-9_-]+))(?:\.([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*))?\s*\}\}/g,
    (_, root: string, nodeId?: string, path?: string) => {
      const source = root === "input" ? input : stepOutputs[nodeId ?? ""];
      const value = valueAtPath(source, path ?? "");
      if (typeof value === "string") return value;
      return JSON.stringify(value ?? "") ?? "";
    },
  );
}
