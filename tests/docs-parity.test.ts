import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * CLAUDE.md used to be a symlink to NCODE.md. On Git-for-Windows clones with
 * core.symlinks disabled, the symlink checks out as an 8-byte text file
 * containing only "NCODE.md", so Claude Code on Windows reads a useless stub
 * instead of the project guidance. CLAUDE.md is therefore a real regular file
 * that must stay byte-identical to NCODE.md.
 *
 * Line endings: byte-equality is safe here because both files are committed
 * with LF and checked out through the same working tree — with no
 * .gitattributes, any core.autocrlf translation applies identically to both,
 * so their bytes stay in lockstep on every platform.
 */

const REPO_ROOT = path.join(__dirname, "..");
const FIX_HINT =
  "CLAUDE.md must stay a byte-identical copy of NCODE.md — edit NCODE.md, then run: cp NCODE.md CLAUDE.md " +
  "(if the edit was made to CLAUDE.md, port it into NCODE.md first — the cp overwrites CLAUDE.md)";

test("CLAUDE.md is a regular file, not a symlink", () => {
  const stat = fs.lstatSync(path.join(REPO_ROOT, "CLAUDE.md"));
  assert.equal(
    stat.isSymbolicLink(),
    false,
    `CLAUDE.md must not be a symlink (it breaks on Git-for-Windows clones with core.symlinks disabled). ${FIX_HINT}`
  );
  assert.equal(stat.isFile(), true, `CLAUDE.md must be a regular file. ${FIX_HINT}`);
});

test("CLAUDE.md byte-equals NCODE.md", () => {
  const claude = fs.readFileSync(path.join(REPO_ROOT, "CLAUDE.md"));
  const ncode = fs.readFileSync(path.join(REPO_ROOT, "NCODE.md"));
  assert.equal(claude.equals(ncode), true, FIX_HINT);
});
