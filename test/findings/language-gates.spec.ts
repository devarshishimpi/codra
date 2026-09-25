import { describe, expect, it } from "vitest";
import {
  commentSyntaxFor,
  stripCommentsAndStrings,
} from "@codraoss/core/claim-checks";

// Precision varies 5.8x by language in the measured corpus (Go 0.52, Python 0.09) while every gate was
// global, and the comment-syntax table sent everything outside six extensions to the JavaScript
// default. The second is the quieter bug: the presence index and the rule scanner both strip comments
// before matching, so a `#`-commented file read as JavaScript keeps its prose as if it were code.

describe("commentSyntaxFor", () => {
  const strip = (path: string, source: string) =>
    stripCommentsAndStrings(source, commentSyntaxFor(path));

  it("knows the hash-comment languages it always knew", () => {
    for (const path of ["a.py", "b.rb", "c.sh", "d.yaml", "e.yml", "f.toml"]) {
      expect(commentSyntaxFor(path).line).toEqual(["#"]);
    }
  });

  // These used to be read as JavaScript, so `# calls validateInput()` looked like a call to
  // `validateInput` and could refute a correct "this is never validated" finding.
  it("knows the ones it used to get wrong", () => {
    for (const path of [
      "main.tf",
      "script.r",
      "lib.pl",
      "mod.jl",
      "app.ex",
      "Makefile",
      "Dockerfile",
    ]) {
      expect(commentSyntaxFor(path).line).toEqual(["#"]);
    }
  });

  it("does not mistake an extensionless filename for an extension", () => {
    // `'Dockerfile'.split('.').pop()` is 'Dockerfile', which matched nothing and fell through to JS.
    expect(commentSyntaxFor("deploy/Dockerfile").line).toEqual(["#"]);
    expect(commentSyntaxFor("Gemfile").line).toEqual(["#"]);
  });

  it("keeps the dash and semicolon families apart from JavaScript", () => {
    expect(commentSyntaxFor("q.sql").line).toEqual(["--"]);
    expect(commentSyntaxFor("init.lua").line).toEqual(["--"]);
    expect(commentSyntaxFor("core.clj").line).toEqual([";"]);
  });

  it("still defaults to JavaScript for the languages that use it", () => {
    for (const path of ["a.ts", "b.tsx", "c.js", "d.go", "e.java", "f.rs"]) {
      expect(commentSyntaxFor(path).line).toEqual(["//"]);
    }
  });

  // The behaviour all of the above exists for.
  it("strips a hash comment instead of leaving its text to match as code", () => {
    const stripped = strip(
      "main.tf",
      'resource "x" "y" {} # validateInput is handled elsewhere',
    );

    expect(stripped).not.toContain("validateInput");
  });

  it("leaves a hash inside a JavaScript string alone", () => {
    expect(strip("a.ts", 'const anchor = "#top";')).not.toContain("top");
  });
});
