/**
 * Conservatively checks whether JSON.stringify could fit in a storage budget
 * without first allocating the serialized string. Strings are counted at their
 * worst-case JSON escape size (six output characters per UTF-16 code unit).
 */
export function isJsonWithinBudget(value: unknown, maxChars: number) {
  let upperBound = 0;
  const ancestors = new WeakSet<object>();

  const add = (chars: number) => {
    upperBound += chars;
    return upperBound <= maxChars;
  };

  const addString = (text: string) => add(text.length * 6 + 2);

  const visit = (item: unknown, depth: number): boolean => {
    if (depth > 100) return false;
    if (item === null) return add(4);
    if (typeof item === "string") return addString(item);
    if (typeof item === "number") return add(32);
    if (typeof item === "boolean") return add(item ? 5 : 6);
    if (typeof item === "undefined") return add(6);
    if (typeof item !== "object") return false;
    if (ancestors.has(item)) return false;
    ancestors.add(item);

    try {
      if (Array.isArray(item)) {
        if (!add(2)) return false;
        for (let i = 0; i < item.length; i++) {
          if (i > 0 && !add(1)) return false;
          if (!visit(item[i], depth + 1)) return false;
        }
        return true;
      }

      if (!add(2)) return false;
      let first = true;
      for (const key in item) {
        if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
        if (!first && !add(1)) return false;
        first = false;
        if (
          !addString(key) ||
          !add(1) ||
          !visit((item as Record<string, unknown>)[key], depth + 1)
        ) {
          return false;
        }
      }
      return true;
    } finally {
      ancestors.delete(item);
    }
  };

  return visit(value, 0);
}
