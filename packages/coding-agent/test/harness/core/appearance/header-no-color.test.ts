// K10: the built-in header drops its colors under NO_COLOR (it was the ui/a11y plainHeader wrapper in ny-pi).
import { afterEach, describe, expect, it } from "vitest";
import { BuiltInHeader } from "../../../../src/modes/interactive/interactive-mode.ts";

const LOGO = "\x1b[38;2;228;138;122m\x1b[48;2;79;142;179m▀\x1b[0m";
const header = () =>
	new BuiltInHeader(
		() => `${LOGO} v1\nshort`,
		() => `${LOGO} v1\nfull`,
		false,
		0,
		0,
	);
const saved = process.env.NO_COLOR;

afterEach(() => {
	if (saved === undefined) delete process.env.NO_COLOR;
	else process.env.NO_COLOR = saved;
});

describe("BuiltInHeader under NO_COLOR", () => {
	it("keeps the logo colors without NO_COLOR", () => {
		delete process.env.NO_COLOR;
		expect(header().render(40).join("\n")).toContain("\x1b[38;2;228;138;122m");
	});

	it("renders without any escape sequence and keeps expand and invalidate working", () => {
		process.env.NO_COLOR = "1";
		const h = header();
		expect(h.render(40).join("\n")).not.toContain("\x1b");
		expect(h.render(40).join("\n")).toContain("▀ v1");
		expect(h.render(40).join("\n")).toContain("short");
		h.setExpanded(true);
		expect(h.render(40).join("\n")).toContain("full");
	});

	it("an empty NO_COLOR counts as unset", () => {
		process.env.NO_COLOR = "";
		expect(header().render(40).join("\n")).toContain("\x1b[38;2;228;138;122m");
	});
});
