#!/usr/bin/env node
/**
 * `pnpm app:macos` — build `dist-app/Pax Galactica.app`, a self-contained Mac
 * app that starts the game's server and opens it in the default browser, the
 * way a game launcher does.
 *
 * What goes in the bundle:
 *
 * - **The packed game** (`pnpm pack`: `dist`, `prompts`, `bin`), with its
 *   production dependencies installed by npm at the versions this clone runs.
 *   The Claude Agent SDK brings its own Claude binary for this architecture, so
 *   subscription sign-in works from the app as it does from a clone.
 * - **The official Node runtime** from nodejs.org, at the version this script
 *   runs on, checksum-verified and cached in `dist-app/cache`. Not this
 *   script's own binary: a Homebrew Node links against libraries under
 *   /opt/homebrew and would not start on another Mac.
 * - **A stay-open AppleScript applet** (`osacompile -s`) as the app itself, so
 *   it has a Dock icon, Quit works, and clicking the icon again reopens the
 *   browser. It calls `Contents/Resources/launch.sh`, which does the work.
 *
 * Saves live in ~/.paxgalactica/saves, as for any installed copy, and the log
 * in ~/Library/Logs/Pax Galactica.log. The app is ad-hoc signed: it runs on the
 * Mac that built it, and on another Mac after right-click → Open.
 *
 *   node scripts/build-macos-app.mjs [--arch arm64|x64]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist-app');
const CACHE = join(OUT, 'cache');
const STAGE = join(OUT, 'stage');
const APP_NAME = 'Pax Galactica';
const APP = join(OUT, `${APP_NAME}.app`);
// The runtime this clone builds and tests with, so the app runs what was tested.
const NODE_VERSION = process.version;

if (process.platform !== 'darwin') {
  console.error('A Mac app is built on a Mac: osacompile, codesign and iconutil are macOS tools.');
  process.exit(1);
}
const argv = process.argv.slice(2);
const archAt = argv.indexOf('--arch');
const arch = archAt >= 0 ? argv[archAt + 1] : process.arch;
if (arch !== 'arm64' && arch !== 'x64') {
  console.error(`--arch is arm64 or x64, not ${arch}.`);
  process.exit(1);
}

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const step = (text) => console.log(`\n== ${text}`);

/* --- 1. The game, packed and given its production dependencies --------- */
step('Packing the game (tsc, vite build, pnpm pack)');
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
run('pnpm', ['pack', '--pack-destination', STAGE], { cwd: ROOT });
const tarball = readdirSync(STAGE).find((f) => f.endsWith('.tgz'));
if (!tarball) throw new Error('pnpm pack wrote no tarball.');
run('tar', ['-xzf', join(STAGE, tarball), '-C', STAGE]);
const GAME = join(STAGE, 'package');

// The versions this clone actually runs, so the app is the game that was tested.
const pkg = JSON.parse(readFileSync(join(GAME, 'package.json'), 'utf8'));
for (const dep of Object.keys(pkg.dependencies ?? {})) {
  pkg.dependencies[dep] = JSON.parse(readFileSync(join(ROOT, 'node_modules', dep, 'package.json'), 'utf8')).version;
}
delete pkg.scripts;
delete pkg.devDependencies;
writeFileSync(join(GAME, 'package.json'), JSON.stringify(pkg, null, 2));

step(`Installing production dependencies for darwin-${arch}`);
run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock', `--cpu=${arch}`, '--os=darwin'], {
  cwd: GAME,
});

/* --- 2. The official Node runtime ---------------------------------------- */
step(`Node ${NODE_VERSION} for darwin-${arch}`);
mkdirSync(CACHE, { recursive: true });
const nodeName = `node-${NODE_VERSION}-darwin-${arch}`;
const nodeTar = join(CACHE, `${nodeName}.tar.gz`);
const base = `https://nodejs.org/dist/${NODE_VERSION}`;
if (!existsSync(nodeTar)) {
  console.log(`Downloading ${base}/${nodeName}.tar.gz`);
  run('curl', ['-fL', '--progress-bar', '-o', `${nodeTar}.part`, `${base}/${nodeName}.tar.gz`]);
  const sums = execFileSync('curl', ['-fsL', `${base}/SHASUMS256.txt`], { encoding: 'utf8' });
  const want = sums.split('\n').find((l) => l.endsWith(`  ${nodeName}.tar.gz`))?.split(/\s+/)[0];
  const got = createHash('sha256').update(readFileSync(`${nodeTar}.part`)).digest('hex');
  if (!want || want !== got) {
    rmSync(`${nodeTar}.part`, { force: true });
    throw new Error(`Checksum mismatch for ${nodeName}.tar.gz: expected ${want ?? 'nothing'}, got ${got}.`);
  }
  run('mv', [`${nodeTar}.part`, nodeTar]);
} else {
  console.log(`Cached at ${nodeTar}`);
}
run('tar', ['-xzf', nodeTar, '-C', STAGE, `${nodeName}/bin/node`, `${nodeName}/LICENSE`]);

/* --- 3. The applet ------------------------------------------------------- */
step('Assembling the app');
rmSync(APP, { recursive: true, force: true });
const applet = join(STAGE, 'applet.applescript');
writeFileSync(
  applet,
  `-- Pax Galactica: start the game's server, open it in the browser, stop it on Quit.
property serverPid : ""

on launcher()
	return quoted form of (POSIX path of (path to me) & "Contents/Resources/launch.sh")
end launcher

on run
	try
		set serverPid to do shell script launcher() & " start"
	on error message
		display dialog "Pax Galactica could not start." & return & return & message buttons {"Quit"} default button 1 with icon stop
		quit
	end try
end run

on reopen
	do shell script launcher() & " open"
end reopen

on quit
	if serverPid is not "" and serverPid is not "external" then
		try
			do shell script launcher() & " stop " & serverPid
		end try
	end if
	continue quit
end quit
`,
);
run('osacompile', ['-s', '-o', APP, applet]);

const RES = join(APP, 'Contents', 'Resources');
cpSync(GAME, join(RES, 'game'), { recursive: true });
mkdirSync(join(RES, 'node', 'bin'), { recursive: true });
copyFileSync(join(STAGE, nodeName, 'bin', 'node'), join(RES, 'node', 'bin', 'node'));
copyFileSync(join(STAGE, nodeName, 'LICENSE'), join(RES, 'node', 'LICENSE'));
chmodSync(join(RES, 'node', 'bin', 'node'), 0o755);

writeFileSync(
  join(RES, 'launch.sh'),
  `#!/bin/bash
# start: run the server if nothing answers on the port yet, open the browser,
#        and print the server's pid ("external" when one was already running).
# open:  open the browser on the game.
# stop <pid>: stop the server this app started.
HERE="$(cd "$(dirname "$0")" && pwd)"
NODE="$HERE/node/bin/node"
SERVER="$HERE/game/dist/server/index.js"
PORT="\${PAXGALACTICA_PORT:-4173}"
URL="http://127.0.0.1:$PORT"
LOG="$HOME/Library/Logs/${APP_NAME}.log"
up() { /usr/bin/curl -fs -o /dev/null --max-time 2 "$URL/api/factions"; }

case "$1" in
  start)
    if up; then /usr/bin/open "$URL"; echo external; exit 0; fi
    mkdir -p "$(dirname "$LOG")"
    echo "--- $(date) starting on $URL" >>"$LOG"
    PAXGALACTICA_PORT="$PORT" nohup "$NODE" "$SERVER" </dev/null >>"$LOG" 2>&1 &
    pid=$!
    for _ in $(seq 1 240); do
      if up; then /usr/bin/open "$URL"; echo "$pid"; exit 0; fi
      if ! kill -0 "$pid" 2>/dev/null; then
        echo "The server stopped while starting. Is port $PORT in use? The log is at $LOG:" >&2
        tail -n 8 "$LOG" >&2
        exit 1
      fi
      sleep 0.25
    done
    echo "The server did not answer within a minute. The log is at $LOG." >&2
    kill "$pid" 2>/dev/null
    exit 1
    ;;
  open) /usr/bin/open "$URL" ;;
  stop) [ -n "$2" ] && kill "$2" 2>/dev/null; exit 0 ;;
  *) echo "usage: launch.sh start|open|stop <pid>" >&2; exit 2 ;;
esac
`,
);
chmodSync(join(RES, 'launch.sh'), 0o755);

// The app's name, id and version; the icon when one has been drawn.
const plist = join(APP, 'Contents', 'Info.plist');
const set = (key, type, value) => {
  try {
    run('/usr/libexec/PlistBuddy', ['-c', `Delete :${key}`, plist], { stdio: 'ignore' });
  } catch {
    // Not there yet.
  }
  run('/usr/libexec/PlistBuddy', ['-c', `Add :${key} ${type} ${value}`, plist]);
};
set('CFBundleName', 'string', APP_NAME);
set('CFBundleDisplayName', 'string', APP_NAME);
set('CFBundleIdentifier', 'string', 'com.paxgalactica.launcher');
set('CFBundleShortVersionString', 'string', pkg.version);
set('CFBundleVersion', 'string', pkg.version);
set('LSMinimumSystemVersion', 'string', '12.0');
const icon = join(ROOT, 'assets', 'app-icon.icns');
if (existsSync(icon)) {
  copyFileSync(icon, join(RES, 'applet.icns'));
  // osacompile also writes its default icon into an asset catalog, which macOS
  // reads before the .icns: without this the app shows the script icon.
  rmSync(join(RES, 'Assets.car'), { force: true });
  try {
    run('/usr/libexec/PlistBuddy', ['-c', 'Delete :CFBundleIconName', plist], { stdio: 'ignore' });
  } catch {
    // Not there.
  }
}

step('Signing (ad hoc)');
run('xattr', ['-cr', APP]);
run('codesign', ['--force', '--deep', '--sign', '-', APP]);

const size = execFileSync('du', ['-sh', APP], { encoding: 'utf8' }).split('\t')[0];
console.log(`\nBuilt ${APP} (${size}). Drag it to /Applications, or double-click it here.`);
