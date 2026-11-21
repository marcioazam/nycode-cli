// Bash rules of the guard: what each command and shell construct asks or denies. Port of `check_segment` and
// `check_bash` of guard.py; rule text and order are the oracle's.
import { basename, expanduser, PY_SPACE } from "../py-path.ts";
import { checkGit } from "./git.ts";
import {
	DEEP,
	FETCHERS,
	type Finding,
	HARD_DEPTH,
	longMatch,
	MAX_DEPTH,
	maskHeredocs,
	nestedCommands,
	normPath,
	SHELLS,
	segments,
	shortFlags,
	stripPrefixes,
	substitutions,
	targetDirs,
	tokenize,
} from "./parse.ts";
import { checkSelfKill, fullMatchPattern, matchesSelf, selfKillMessage } from "./self-kill.ts";

const DISK_RE =
	/^\/dev\/(sd[a-z]|nvme\p{Nd}|hd[a-z]|vd[a-z]|xvd[a-z]|mmcblk\p{Nd}|disk\p{Nd}|disk\/|dm-\p{Nd}|mapper\/|loop\p{Nd}|md\p{Nd})/u;
const SAFE_DEV_RE = /^\/dev\/(null|stdout|stderr|tty|shm\/|fd\/)/;
const POWER_CMDS = new Set(["shutdown", "reboot", "poweroff", "halt"]);
const SYSTEMCTL_POWER = new Set(["poweroff", "reboot", "halt", "kexec"]);
const SFDISK_READ_FLAGS = new Set([
	...["-l", "--list", "-s", "--show-size", "-d", "--dump", "-J", "--json", "-F", "--list-free"],
	...["-V", "--verify", "-h", "--help"],
]);
const S = `[${PY_SPACE}]`;
const FORK_BOMB_RE = new RegExp(`([^${PY_SPACE}]+)${S}*\\(\\)${S}*\\{${S}*\\1${S}*\\|${S}*\\1${S}*&${S}*\\}`, "u");
const REDIRECTS = new Set([">", ">>", ">|", "&>", ">&", "&>>"]);

const has = (flags: Set<string>, ...names: string[]): boolean => names.some((n) => flags.has(n));

function catastrophicRmTargets(): Set<string> {
	const home = expanduser("~");
	const system = [
		"/home",
		"/usr",
		"/etc",
		"/bin",
		"/sbin",
		"/lib",
		"/lib64",
		"/boot",
		"/var",
		"/opt",
		"/root",
		"/srv",
	];
	// biome-ignore lint/suspicious/noTemplateCurlyInString: the literal text a shell command contains
	return new Set(["", "~", "$HOME", "${HOME}", home, ...system]);
}

function catastrophicRmTarget(target: string): boolean {
	if (target === "" || !"/~$".includes(target[0])) return false;
	return catastrophicRmTargets().has(normPath(target).replace(/(\/\*?)+$/, ""));
}

/** Targets of `kill` without the signal specification (-9, -KILL, -s X, -n X, --). */
function killTargets(args: string[]): Set<string> {
	let i = 0;
	if (args.length > 0 && (args[0] === "-s" || args[0] === "-n" || args[0] === "--signal")) i = 2;
	else if (args.length > 0 && args[0].startsWith("-") && args[0] !== "--") i = 1;
	if (i < args.length && args[i] === "--") i++;
	return new Set(args.slice(i));
}

/** Findings of one command segment, and its command name (undefined when it has none). */
function checkSegment(
	argv: string[],
	piped: boolean,
	prevNames: Set<string>,
	cmd: string,
	depth: number,
	cwd: string,
): [Finding[], string | undefined] {
	if (depth > HARD_DEPTH) return [[DEEP], undefined];
	const found: Finding[] = depth > MAX_DEPTH ? [DEEP] : [];
	const [real, priv] = stripPrefixes(argv);
	if (priv) found.push(["ask", "comando com privilégio (sudo/su/doas)"]);
	if (real.length === 0) return [found, undefined];
	const name = basename(real[0]);
	const args = real.slice(1);
	const flags = shortFlags(args);
	const positional = args.filter((a) => !a.startsWith("-"));

	if (piped && SHELLS.has(name) && [...prevNames].some((p) => FETCHERS.has(p))) {
		found.push(["deny", "download com pipe direto para shell"]);
	}
	argv.forEach((t, i) => {
		if (REDIRECTS.has(t) && i + 1 < argv.length && DISK_RE.test(normPath(argv[i + 1]))) {
			found.push(["deny", `escrita direta em disco ${argv[i + 1]}`]);
		}
	});
	const [scripts, argvs] = nestedCommands(name, args);
	for (const script of scripts) found.push(...checkBash(script, cwd, depth + 1, cmd));
	for (const sub of argvs) found.push(...checkSegment(sub, false, new Set(), cmd, depth + 1, cwd)[0]);

	if (name === "rm") {
		const rec = has(flags, "-r", "-R", "--recursive") || longMatch(flags, "--recursive");
		const force = has(flags, "-f", "--force") || longMatch(flags, "--force");
		if (rec && force) found.push(["deny", "rm recursivo forçado"]);
		else if (rec) found.push(["ask", "rm recursivo"]);
		if (rec && positional.some(catastrophicRmTarget)) {
			found.push(["deny", "rm recursivo em diretório raiz, home ou sistema"]);
		}
	} else if (name.startsWith("mkfs")) {
		found.push(["deny", "formatação de sistema de arquivos"]);
	} else if (
		name === "dd" &&
		args.some(
			(a) =>
				a.startsWith("of=/") && normPath(a.slice(3)).startsWith("/dev/") && !SAFE_DEV_RE.test(normPath(a.slice(3))),
		)
	) {
		found.push(["deny", "dd escrevendo em dispositivo"]);
	} else if (name === "tee" && positional.some((a) => DISK_RE.test(normPath(a)))) {
		found.push(["deny", "tee escrevendo em dispositivo de bloco"]);
	} else if (
		(name === "cp" || name === "mv") &&
		[...positional.slice(-1), ...targetDirs(args)].some((t) => DISK_RE.test(normPath(t)))
	) {
		found.push(["deny", `${name} escrevendo em dispositivo de bloco`]);
	} else if (name === "wipefs" && has(flags, "-a", "--all", "-o", "--offset")) {
		found.push(["deny", "wipefs apagando assinaturas"]);
	} else if (name === "cryptsetup" && positional.some((a) => ["luksFormat", "erase", "luksErase"].includes(a))) {
		found.push(["deny", "cryptsetup destruindo cabeçalho LUKS"]);
	} else if (name === "blkdiscard") {
		found.push(["deny", "blkdiscard apaga o dispositivo"]);
	} else if (name === "sgdisk" && has(flags, "-Z", "-z", "--zap-all", "--zap")) {
		found.push(["deny", "sgdisk apagando tabela de partições"]);
	} else if (name === "parted" && positional.some((a) => a === "mklabel" || a === "mktable")) {
		found.push(["deny", "parted mklabel apaga a tabela de partições"]);
	} else if (
		name === "sfdisk" &&
		positional.some((a) => a.startsWith("/dev/")) &&
		![...flags].some((f) => SFDISK_READ_FLAGS.has(f))
	) {
		found.push(["deny", "sfdisk reescrevendo tabela de partições"]);
	} else if (POWER_CMDS.has(name) && !flags.has("-c")) {
		found.push(["deny", `${name} desliga/reinicia a máquina`]);
	} else if (name === "systemctl" && positional.some((a) => SYSTEMCTL_POWER.has(a))) {
		found.push(["deny", "systemctl desliga/reinicia a máquina"]);
	} else if ((name === "init" || name === "telinit") && positional.length > 0 && ["0", "6"].includes(positional[0])) {
		found.push(["deny", `${name} desliga/reinicia a máquina`]);
	} else if (name === "chmod" || name === "chown" || name === "chgrp") {
		const rec = has(flags, "-R", "--recursive");
		if (rec && positional.some((a) => normPath(a) === "/")) found.push(["deny", `${name} recursivo na raiz`]);
		else if (rec) found.push(["ask", `${name} recursivo`]);
	} else if (name === "shred") {
		found.push(["ask", "shred"]);
	} else if (name === "kill" || name === "pkill" || name === "killall") {
		if (
			args.some((a) => a === "-9" || a === "-KILL" || a === "-SIGKILL") ||
			(args.includes("-s") && args.some((a) => a === "KILL" || a === "9"))
		) {
			found.push(["ask", "kill -9"]);
		}
		if (name === "kill") {
			const targets = killTargets(args);
			if (targets.has("-1") || targets.has("1")) found.push(["deny", "kill em todos os processos ou no PID 1"]);
		}
		const pattern = name === "pkill" ? fullMatchPattern(args) : undefined;
		if (pattern && matchesSelf(pattern, cmd)) found.push(["deny", selfKillMessage("pkill")]);
	} else if (name === "docker" || name === "podman") {
		if (args.some((a) => a === "rm" || a === "rmi" || a === "prune"))
			found.push(["ask", `${name} removendo recursos`]);
	} else if (["npm", "pnpm", "yarn", "bun"].includes(name) && positional.includes("publish")) {
		found.push(["ask", `${name} publish`]);
	} else if (name === "git") {
		found.push(...checkGit(args, cwd));
	}
	return [found, name];
}

/** Findings of a whole shell command line. `root` is the outermost line, the one a self-matching kill pattern meets. */
export function checkBash(cmdInput: string, cwd = "", depth = 0, root?: string): Finding[] {
	if (depth > HARD_DEPTH) return [DEEP];
	const top = root ?? cmdInput;
	const cmd = cmdInput.replaceAll("\\\n", ""); // line continuation
	const found: Finding[] = depth > MAX_DEPTH ? [DEEP] : [];
	const bodyFree = maskHeredocs(cmd); // a heredoc body that no shell reads is text, not commands
	if (depth === 0) {
		if (FORK_BOMB_RE.test(bodyFree)) found.push(["deny", "fork bomb"]);
		found.push(...checkSelfKill(cmd));
	}
	for (const sub of substitutions(bodyFree)) found.push(...checkBash(sub, cwd, depth + 1, top));
	let prevNames = new Set<string>();
	for (const [argv, piped] of segments(tokenize(bodyFree))) {
		if (!piped) prevNames = new Set();
		const [findings, name] = checkSegment(argv, piped, prevNames, top, depth, cwd);
		found.push(...findings);
		if (name) prevNames.add(name);
	}
	return found;
}
