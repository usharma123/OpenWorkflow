export function valueAtPath(value: unknown, path: string): unknown {
  if (!path) return value;
  return path.split(".").reduce<unknown>((current, key) => {
    if (current && typeof current === "object") return (current as Record<string, unknown>)[key];
    return undefined;
  }, value);
}

export function renderTemplate(template: string, input: unknown): string {
  return template.replace(/\{\{\s*input(?:\.([\w.]+))?\s*\}\}/g, (_, path?: string) => {
    const value = valueAtPath(input, path ?? "");
    return typeof value === "string" ? value : JSON.stringify(value ?? "");
  });
}
