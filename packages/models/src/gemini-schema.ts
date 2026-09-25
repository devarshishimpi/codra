// Adapts for `responseJsonSchema`, not `responseSchema` -- an OpenAPI subset that rejects the `additionalProperties` our grammars need.

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
    ? (value as string[])
    : null;
}

// `{required: [...]}` and nothing else.
function requiredOnly(branch: unknown): string[] | null {
  if (!isObject(branch) || Object.keys(branch).length !== 1) return null;
  return stringArray(branch.required);
}

function adapt(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(adapt);
  if (!isObject(node)) return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) out[key] = adapt(value);
  if (!isObject(out.properties)) return out;

  // Collapse a union of bare-`required` branches onto its first branch: read as complete
  // alternatives, the sibling `properties` are silently dropped at a 200 and no 400 fires.
  for (const keyword of ["anyOf", "oneOf"] as const) {
    const union = out[keyword];
    const branches = Array.isArray(union) ? union.map(requiredOnly) : [];
    if (branches.length > 0 && branches.every((keys) => keys !== null)) {
      delete out[keyword];
      out.required = [
        ...new Set([...(stringArray(out.required) ?? []), ...branches[0]!]),
      ];
    }
  }

  // `propertyOrdering` belongs to the legacy OpenAPI `responseSchema`; inside `responseJsonSchema`
  // Gemini rejects it with a bare 400 "invalid argument". Declaration order (`evidence` first)
  // already carries the ordering, so drop the keyword rather than send it.
  delete out.propertyOrdering;
  return out;
}

// Returns a copy: the caller's schema may be a shared module singleton.
export function toGeminiResponseJsonSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  return adapt(schema) as Record<string, unknown>;
}
