// K11: the Python `os.path` helpers the guard port relies on, on the cases the differential corpus reaches rarely
// (symlink chains and loops, `~user`, `..` handling). Expected values are what Python 3.12 returns.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	abspath,
	basename,
	dirname,
	expanduser,
	isabs,
	normpath,
	pySplit,
	pyStrip,
	realpath,
	split,
	tempDir,
} from "../../../src/core/permissions/guard/py-path.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "py-path-")));
afterAll(() => rmSync(root, { recursive: true }));

mkdirSync(join(root, "real", "deep"), { recursive: true });
writeFileSync(join(root, "real", "file"), "x");
symlinkSync(join(root, "real"), join(root, "abs-link"));
symlinkSync("real", join(root, "rel-link"));
symlinkSync("rel-link", join(root, "chain"));
symlinkSync("loop-b", join(root, "loop-a"));
symlinkSync("loop-a", join(root, "loop-b"));
symlinkSync("../real/deep", join(root, "real", "up"));

describe("realpath", () => {
	it("follows absolute, relative and chained symlinks", () => {
		expect(realpath(join(root, "abs-link", "file"))).toBe(join(root, "real", "file"));
		expect(realpath(join(root, "rel-link"))).toBe(join(root, "real"));
		expect(realpath(join(root, "chain", "deep"))).toBe(join(root, "real", "deep"));
	});

	it("resolves `..` after a symlink on the target side", () => {
		expect(realpath(join(root, "real", "up", ".."))).toBe(join(root, "real"));
	});

	it("keeps missing parts and symlink loops as written", () => {
		expect(realpath(join(root, "abs-link", "missing", "x"))).toBe(join(root, "real", "missing", "x"));
		expect(realpath(join(root, "loop-a", "x"))).toBe(join(root, "loop-a", "x"));
	});

	it("makes relative paths absolute", () => {
		expect(realpath("some-relative")).toBe(join(process.cwd(), "some-relative"));
	});
});

describe("path helpers", () => {
	it("splits, names and normalizes like os.path", () => {
		expect(split("/a/b/")).toEqual(["/a/b", ""]);
		expect(split("///a")).toEqual(["///", "a"]);
		expect(split("a")).toEqual(["", "a"]);
		expect(dirname("/a/b/c")).toBe("/a/b");
		expect(basename("/a/b/")).toBe("");
		expect(isabs("/x")).toBe(true);
		expect(isabs("x")).toBe(false);
		expect(normpath("//a/./b/../c")).toBe("//a/c");
		expect(normpath("/../..")).toBe("/");
		expect(abspath("x/../y")).toBe(join(process.cwd(), "y"));
	});

	it("expands ~ and ~user", () => {
		const home = (process.env.HOME as string).replace(/\/+$/, "");
		expect(expanduser("~/x")).toBe(`${home}/x`);
		expect(expanduser("~")).toBe(home || "/");
		expect(expanduser("~root/x")).toBe("/root/x");
		expect(expanduser("~no-such-user-k11/x")).toBe("~no-such-user-k11/x");
		expect(expanduser("plain")).toBe("plain");
	});

	it("strips and splits on Python whitespace", () => {
		expect(pyStrip("\u00a0 a\u2003")).toBe("a");
		expect(pySplit(" a \t b\u0085c ")).toEqual(["a", "b", "c"]);
		expect(pySplit("")).toEqual([]);
	});

	it("finds a usable temporary directory", () => {
		expect(tempDir().startsWith("/")).toBe(true);
	});
});
