#!/usr/bin/env bash
# Helpers for install.sh: preflight, pinned pi core, pinned npm deps, third-party fetch and verify.
# Sourced, never executed. Everything fetched is staged under $STAGE and verified there; HOME is
# only written after every check passed (AC4: abort without applying anything).

PI_VERSION=1.5.2
PI_CODE_VERSION=1.7.0
PI_NODE_MIN="22.19.0"
# sha256 of the official release artifacts for pi 1.5.2 (https://pi.dev/api/installer/releases/1.5.2/)
PI_PKG_SHA256=6c433244d03aa280f1aa298035ba59f54afd0c486566771ef83cc5aef318c4cc
PI_LOCK_SHA256=57e3b475e52f630cf903f73b0d2a02c405875af61ce4a845f481dcc798f58005
PI_API=${PI_HARNESS_API:-https://pi.dev/api/installer/releases}

log() { printf 'install: %s\n' "$*" >&2; }
die() { printf 'install: ERROR: %s\n' "$*" >&2; exit 1; }

sha256() { sha256sum "$1" | cut -d' ' -f1; }

preflight() {
  local missing=() c
  for c in node npm git patch jq curl tar sha256sum; do command -v "$c" >/dev/null 2>&1 || missing+=("$c"); done
  [ "${#missing[@]}" -eq 0 ] || die "missing tools: ${missing[*]}"
  node -e 'const a=process.versions.node.split(".").map(Number),b=process.argv[1].split(".").map(Number);
    for(let i=0;i<3;i++){if(a[i]!==b[i])process.exit(a[i]>b[i]?0:1)}' "$PI_NODE_MIN" \
    || die "Node.js >= $PI_NODE_MIN required (pi $PI_VERSION), found $(node -v)"
}

# Agent dir that receives the install (honours HOME, tests use a temp one).
agent_dir() { printf '%s/.pi/agent' "$HOME"; }

# AC4: the repo pins pi-code to exactly $PI_CODE_VERSION (package.json and lock) or nothing is written.
verify_npm_pin() {
  local d=$REPO/npm v
  [ -f "$d/package.json" ] && [ -f "$d/package-lock.json" ] || die "npm/package.json or npm/package-lock.json missing"
  v=$(jq -r '.dependencies["pi-code"] // ""' "$d/package.json")
  [ "$v" = "$PI_CODE_VERSION" ] || die "npm/package.json pins pi-code '$v', expected $PI_CODE_VERSION"
  v=$(jq -r '.packages["node_modules/pi-code"].version // ""' "$d/package-lock.json")
  [ "$v" = "$PI_CODE_VERSION" ] || die "npm/package-lock.json has pi-code '$v', expected $PI_CODE_VERSION"
}

# ---- third-party manifest -------------------------------------------------------------------
# jf <name> <field>: one manifest field of one component ("" when absent).
jf() { jq -r --arg n "$1" ".components[] | select(.name==\$n) | .$2 // \"\"" "$MANIFEST"; }

manifest_names() { # all|required
  if [ "$1" = all ]; then jq -r '.components[].name' "$MANIFEST"; else jq -r '.components[] | select(.required) | .name' "$MANIFEST"; fi
}

safe_rel() { case "$1" in ''|/*|*..*) return 1 ;; esac; }

fetch_git() { # name -> stages the verified tree in $STAGE/out/<name>
  local name=$1 url commit subdir cache src
  url=$(jf "$name" url); commit=$(jf "$name" commit); subdir=$(jf "$name" subdir)
  [[ "$commit" =~ ^[0-9a-f]{40}$ ]] || die "$name: commit must be a full 40-hex SHA"
  case "$url" in https://*) ;; *) die "$name: url must be https" ;; esac
  [ -z "$subdir" ] || safe_rel "$subdir" || die "$name: unsafe subdir"
  cache=$STAGE/git/$(printf '%s %s' "$url" "$commit" | sha256sum | cut -c1-16)
  if [ ! -d "$cache" ]; then
    mkdir -p "$cache"
    git -C "$cache" init -q
    git -C "$cache" fetch -q --depth 1 "$url" "$commit" </dev/null || die "$name: cannot fetch $commit from $url"
    git -C "$cache" checkout -q FETCH_HEAD
  fi
  [ "$(git -C "$cache" rev-parse HEAD)" = "$commit" ] || die "$name: fetched commit differs from manifest $commit"
  src=$cache${subdir:+/$subdir}
  [ -d "$src" ] || die "$name: subdir $subdir missing at $commit"
  mkdir -p "$STAGE/out/$name"
  tar -C "$src" --exclude=.git -cf - . | tar -C "$STAGE/out/$name" -xf -
}

fetch_npm() { # name -> stages the integrity-checked tarball and its production deps
  local name=$1 url integ tgz got out=$STAGE/out/$1
  url=$(jf "$name" url); integ=$(jf "$name" integrity)
  case "$url" in https://registry.npmjs.org/*) ;; *) die "$name: npm url must be on registry.npmjs.org" ;; esac
  tgz=$STAGE/$name.tgz
  curl -fsSL "$url" -o "$tgz" || die "$name: download failed"
  got="sha512-$(node -e 'const c=require("crypto"),f=require("fs");process.stdout.write(c.createHash("sha512").update(f.readFileSync(process.argv[1])).digest("base64"))' "$tgz")"
  [ "$got" = "$integ" ] || die "$name: tarball integrity $got differs from manifest"
  mkdir -p "$out"; tar -xzf "$tgz" -C "$out" --strip-components=1
}

apply_patch() { # name: fail closed
  local name=$1 p=$REPO/patches/third-party/$1.patch out=$STAGE/out/$1
  [ -f "$p" ] || return 0
  patch -d "$out" -p1 -E -s --no-backup-if-mismatch < "$p" || die "$name: patches/third-party/$name.patch does not apply"
  find "$out" -name '*.sh' -exec chmod +x {} +
}

fetch_third_party() { # names...: stage + verify + patch all before anything is written
  local name type lp want got
  for name in "$@"; do
    log "third-party: $name"
    type=$(jf "$name" type); [ -n "$type" ] || die "$name: not in manifest"
    [[ "$name" =~ ^[a-z0-9-]+$ ]] || die "bad component name '$name'"
    safe_rel "$(jf "$name" dest)" || die "$name: unsafe dest"
    case "$type" in git) fetch_git "$name" ;; npm) fetch_npm "$name" ;; *) die "$name: unknown type '$type'" ;; esac
    lp=$STAGE/out/$name/$(jf "$name" license_path); want=$(jf "$name" license_sha256)
    [ -f "$lp" ] || die "$name: LICENSE missing"
    got=$(sha256 "$lp"); [ "$got" = "$want" ] || die "$name: LICENSE sha256 differs from manifest"
    apply_patch "$name"
    if [ "$type" = npm ] && [ -f "$STAGE/out/$name/package-lock.json" ]; then
      (cd "$STAGE/out/$name" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error </dev/null) \
        || die "$name: npm ci failed"
    fi
  done
}

backup_dir() { # lazily created, 0700
  if [ -z "${BACKUP:-}" ]; then
    BACKUP=$HOME/.pi-backup/${TS:-$(date +%Y%m%dT%H%M%S)}
    mkdir -p "$BACKUP"; chmod 700 "$HOME/.pi-backup" "$BACKUP"
  fi
}

install_third_party() { # names... (already staged): copy into <agent>/<dest>
  local name dest
  for name in "$@"; do
    dest=$(agent_dir)/$(jf "$name" dest)
    if [ -e "$dest" ] || [ -L "$dest" ]; then
      backup_dir; mkdir -p "$BACKUP/third-party-replaced/$(dirname "$(jf "$name" dest)")"
      mv "$dest" "$BACKUP/third-party-replaced/$(jf "$name" dest)"
      log "$name: previous $dest moved to $BACKUP/third-party-replaced/"
    fi
    mkdir -p "$(dirname "$dest")"
    cp -a "$STAGE/out/$name" "$dest"
  done
}

# ---- pi core 1.5.2 (managed layout of the official installer) -------------------------------
# The official `curl https://pi.dev/install.sh | sh` always installs "latest" and cannot pin a
# version, so this reproduces its managed layout (install/releases/<v>, current-version, launcher)
# from the same release API for exactly $PI_VERSION, with the artifact hashes pinned above.
install_pi_core() {
  local a rel tmp="$STAGE/pi-core"
  a=$(agent_dir); rel=$a/install/releases/$PI_VERSION
  if [ "$(cat "$a/install/current-version" 2>/dev/null)" = "$PI_VERSION" ] && [ -x "$rel/node_modules/.bin/pi" ]; then
    log "pi $PI_VERSION already installed"; return 0
  fi
  mkdir -p "$tmp"
  curl -fsSL "$PI_API/$PI_VERSION/package.json" -o "$tmp/package.json" || die "cannot download pi $PI_VERSION package.json"
  curl -fsSL "$PI_API/$PI_VERSION/package-lock.json" -o "$tmp/package-lock.json" || die "cannot download pi $PI_VERSION lock"
  [ "$(sha256 "$tmp/package.json")" = "$PI_PKG_SHA256" ] || die "pi $PI_VERSION package.json hash mismatch"
  [ "$(sha256 "$tmp/package-lock.json")" = "$PI_LOCK_SHA256" ] || die "pi $PI_VERSION package-lock.json hash mismatch"
  log "installing pi $PI_VERSION (npm ci, scripts off)"
  (cd "$tmp" && npm ci --ignore-scripts --omit=dev --include=optional --no-fund --no-audit --loglevel=error </dev/null) \
    || die "npm ci for pi $PI_VERSION failed"
  [ -x "$tmp/node_modules/.bin/pi" ] || die "pi executable missing after npm ci"
  mkdir -p "$a/install/releases" "$a/bin"
  [ ! -e "$rel" ] || { backup_dir; mkdir -p "$BACKUP/pi-core-replaced"; mv "$rel" "$BACKUP/pi-core-replaced/$PI_VERSION"; }
  mv "$tmp" "$rel"
  printf '%s\n' "$PI_VERSION" > "$a/install/current-version"
  printf '{\n  "kind": "pi-managed-install",\n  "schemaVersion": 1,\n  "layout": "releases-v1",\n  "entrypoint": {\n    "type": "symlink",\n    "path": "%s/.local/bin/pi"\n  }\n}\n' "$HOME" > "$a/install/managed-install.json"
  write_launcher "$a/bin/pi"
}

# Same contract as the official launcher: resolve the managed release from current-version.
write_launcher() {
  cat > "$1" <<'LAUNCHER'
#!/bin/sh
case "$0" in
  */*) pi_launcher="$0" ;;
  *) pi_launcher=$(command -v "$0") || exit 127 ;;
esac
while [ -L "$pi_launcher" ]; do
  pi_link=$(readlink "$pi_launcher") || exit 1
  case "$pi_link" in
    /*) pi_launcher="$pi_link" ;;
    *) pi_launcher=${pi_launcher%/*}/$pi_link ;;
  esac
done
pi_agent_dir=${pi_launcher%/*}
pi_agent_dir=${pi_agent_dir%/*}
pi_current_file=$pi_agent_dir/install/current-version
IFS= read -r pi_current_version < "$pi_current_file" || { echo "Could not read $pi_current_file" >&2; exit 1; }
case "$pi_current_version" in
  ""|.|..|*[!0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz._+-]*) echo "invalid $pi_current_file" >&2; exit 1 ;;
esac
pi_release_bin=$pi_agent_dir/install/releases/$pi_current_version/node_modules/.bin/pi
[ -x "$pi_release_bin" ] || { echo "Managed Pi executable is missing: $pi_release_bin" >&2; exit 1; }
PI_MANAGED_INSTALL_ROOT=$pi_agent_dir/install
export PI_MANAGED_INSTALL_ROOT
exec "$pi_release_bin" "$@"
LAUNCHER
  chmod 755 "$1"
}

install_npm_deps() { # pi-code 1.7.0 exact, from the repo's lock
  local n; n=$(agent_dir)/npm
  mkdir -p "$n"
  for f in package.json package-lock.json; do
    if [ -f "$n/$f" ] && ! cmp -s "$n/$f" "$REPO/npm/$f"; then
      backup_dir; mkdir -p "$BACKUP/npm-replaced"; cp -a "$n/$f" "$BACKUP/npm-replaced/$f"
    fi
    cp "$REPO/npm/$f" "$n/$f"
  done
  log "npm ci in $n (pi-code $PI_CODE_VERSION)"
  (cd "$n" && npm ci --ignore-scripts --no-audit --no-fund --loglevel=error </dev/null) || die "npm ci failed"
  [ "$(jq -r .version "$n/node_modules/pi-code/package.json")" = "$PI_CODE_VERSION" ] || die "pi-code is not $PI_CODE_VERSION after npm ci"
}

install_ext_deps() { # extensions with a package.json: npm ci in the REPO dir (symlinked files resolve modules by realpath)
  local p d
  [ "${PI_HARNESS_SKIP_EXT_DEPS:-0}" != 1 ] || { log "skipping extension npm ci (PI_HARNESS_SKIP_EXT_DEPS=1)"; return 0; }
  for p in "$REPO"/extensions/*/package.json; do
    [ -f "$p" ] || continue
    d=${p%/package.json}
    log "npm ci --omit=dev in extensions/${d##*/}"
    (cd "$d" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error </dev/null) || die "npm ci failed in $d"
  done
}
