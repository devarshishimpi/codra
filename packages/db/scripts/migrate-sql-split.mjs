export function readDollarQuoteTag(sqlText, index) {
  if (sqlText[index] !== "$") return null;

  let cursor = index + 1;
  while (cursor < sqlText.length && /[A-Za-z0-9_]/.test(sqlText[cursor])) {
    cursor += 1;
  }

  if (sqlText[cursor] !== "$") return null;
  return sqlText.slice(index, cursor + 1);
}

export function splitSqlStatements(sqlText) {
  const statements = [];
  let start = 0;
  let index = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  let lineComment = false;
  let blockComment = false;
  let dollarQuoteTag = null;

  while (index < sqlText.length) {
    const char = sqlText[index];
    const next = sqlText[index + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      index += 1;
      continue;
    }

    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (dollarQuoteTag) {
      if (sqlText.startsWith(dollarQuoteTag, index)) {
        index += dollarQuoteTag.length;
        dollarQuoteTag = null;
        continue;
      }
      index += 1;
      continue;
    }

    if (singleQuoted) {
      if (char === "'" && next === "'") {
        index += 2;
        continue;
      }
      if (char === "'") singleQuoted = false;
      index += 1;
      continue;
    }

    if (doubleQuoted) {
      if (char === '"' && next === '"') {
        index += 2;
        continue;
      }
      if (char === '"') doubleQuoted = false;
      index += 1;
      continue;
    }

    if (char === "-" && next === "-") {
      lineComment = true;
      index += 2;
      continue;
    }

    if (char === "/" && next === "*") {
      blockComment = true;
      index += 2;
      continue;
    }

    const tag = readDollarQuoteTag(sqlText, index);
    if (tag) {
      dollarQuoteTag = tag;
      index += tag.length;
      continue;
    }

    if (char === "'") {
      singleQuoted = true;
      index += 1;
      continue;
    }

    if (char === '"') {
      doubleQuoted = true;
      index += 1;
      continue;
    }

    if (char === ";") {
      const statement = sqlText.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }

    index += 1;
  }

  const finalStatement = sqlText.slice(start).trim();
  if (finalStatement) statements.push(finalStatement);

  return statements;
}
