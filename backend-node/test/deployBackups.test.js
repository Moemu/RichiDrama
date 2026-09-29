const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

const root = path.join(__dirname, '..', '..');
const BACKUP_SCRIPT = path.join(root, 'deploy', 'backup-data.sh');
const RESTORE_SCRIPT = path.join(root, 'deploy', 'restore-data.sh');
const LIB_SCRIPT = path.join(root, 'deploy', 'lib.sh');
const BACKLOG_SCRIPT = path.join(root, 'deploy', 'prune-release-backlog');

// The deployment scripts only accept absolute POSIX paths, and Git Bash exposes
// Windows drives under /c, so every host path is handed over in that form.
const shellPath = (value) => value.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (m, drive) => `/${drive.toLowerCase()}`);
const revision = (seed) => seed.toString(16).padStart(40, '0');

const tempDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `minidrama-${name}-`));

function makeSqliteDb(file, marker) {
  const db = new Database(file);
  db.exec('CREATE TABLE probe (marker TEXT)');
  db.prepare('INSERT INTO probe (marker) VALUES (?)').run(marker);
  db.close();
}

function readMarker(file) {
  const db = new Database(file, { readonly: true });
  try {
    return db.prepare('SELECT marker FROM probe').get().marker;
  } finally {
    db.close();
  }
}

function runBash(script, vars) {
  const exports = Object.entries(vars || {})
    .map(([key, value]) => `export ${key}='${String(value).replace(/'/g, "'\\''")}'`)
    .join('\n');
  return spawnSync('bash', ['-c', `${exports}\n${script}`], { encoding: 'utf8' });
}

// A stand-in for the application container: it answers the runtime probes and
// writes the online SQLite snapshot the backup script asks for, so archive
// assembly, certification and restore run end to end without Docker.
const SHIM = `#!/usr/bin/env bash
set -u
to_host() { printf '%s%s' "$MINIDRAMA_DATA_DIR" "\${1#/app/backend-node/data}"; }
case "\${1:-}" in
  info) [[ "\${SHIM_NO_DOCKER:-0}" == 1 ]] && exit 1; exit 0 ;;
  inspect|stop|start) [[ "\${1}" == inspect && "\${SHIM_NO_CONTAINER:-0}" == 1 ]] && exit 1; exit 0 ;;
  compose) exit 1 ;;
  exec)
    shift
    target=''
    while [[ "\${1:-}" != node ]]; do
      if [[ "\${1:-}" == -e ]]; then
        shift
        [[ "\${1%%=*}" == SNAPSHOT_TARGET ]] && target="\${1#*=}"
      fi
      shift
    done
    shift 2
    host="$(to_host "\$target")"
    case "\${1:-}" in
      *backup*)
        mkdir -p "\$(dirname "\$host")"
        cp "$SHIM_SNAPSHOT_DB" "\$host" ;;
      *integrity_check*)
        if [[ -s "\$host" ]]; then
          if [[ "\${SHIM_DROP_SNAPSHOT:-0}" == 1 ]]; then rm -f -- "\$host"; fi
          printf 'ok\\n'
        else
          exit 1
        fi ;;
      *) exit 9 ;;
    esac
    exit 0 ;;
  *) exit 8 ;;
esac
`;

function withShim(script, vars) {
  const bootstrap = `
set -euo pipefail
mkdir -p "$SHIM_DIR"
cat > "$SHIM_DIR/docker" <<'DOCKER_SHIM'
${SHIM}DOCKER_SHIM
chmod 755 "$SHIM_DIR/docker"
export PATH="$SHIM_DIR:$PATH"
# Never let a host docker binary receive these commands.
[[ "$(command -v docker)" == "$SHIM_DIR/docker" ]] || { echo 'docker shim is not first on PATH' >&2; exit 70; }
${script}`;
  return runBash(bootstrap, vars);
}

function seedDataDir(dir) {
  fs.mkdirSync(path.join(dir, 'storage', 'video'), { recursive: true });
  makeSqliteDb(path.join(dir, 'drama_generator.db'), 'LIVE');
  fs.writeFileSync(path.join(dir, 'drama_generator.db-wal'), 'WAL-PAGES');
  fs.writeFileSync(path.join(dir, 'drama_generator.db-shm'), 'SHM');
  fs.writeFileSync(path.join(dir, 'storage', 'video', 'a.mp4'), 'MP4-BYTES');
  // Deployment scratch inside the data mount: a staged snapshot left behind by a
  // crashed release, plus directories that are not recovery data at all.
  fs.mkdirSync(path.join(dir, '.deploy-snapshots'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.deploy-snapshots', 'snapshot-1-ghost.db'), 'GHOST');
  fs.mkdirSync(path.join(dir, '.release-backup-staging', '20200101T000000Z'), { recursive: true });
  makeSqliteDb(path.join(dir, '.release-backup-staging', '20200101T000000Z', 'drama_generator.db'), 'GHOST');
  fs.mkdirSync(path.join(dir, '.manual-backups'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.manual-backups', 'old.tar.gz'), 'GHOST');
}

function fixture() {
  const dirs = {
    data: tempDir('data'), backups: tempDir('backups'), restored: tempDir('restored'),
    project: tempDir('project'), shim: tempDir('shim'),
  };
  // What the container-side online backup produces.
  makeSqliteDb(path.join(dirs.shim, 'snapshot.db'), 'SNAPSHOT');
  const vars = {
    SHIM_DIR: shellPath(dirs.shim), PROJECT_DIR: shellPath(dirs.project),
    MINIDRAMA_DATA_DIR: shellPath(dirs.data), MINIDRAMA_BACKUP_DIR: shellPath(dirs.backups),
    BACKUP_SCRIPT: shellPath(BACKUP_SCRIPT), RESTORE_SCRIPT: shellPath(RESTORE_SCRIPT),
    RESTORED: shellPath(dirs.restored), SHIM_SNAPSHOT_DB: shellPath(path.join(dirs.shim, 'snapshot.db')),
    BACKLOG_SCRIPT: shellPath(BACKLOG_SCRIPT),
  };
  return { dirs, vars };
}

const LIST_ARCHIVE = `
case "$archive" in
  *.zst) zstd -dc -q -- "$archive" | tar -tf - | sed 's/^/MEMBER /' ;;
  *) gzip -dc -- "$archive" | tar -tf - | sed 's/^/MEMBER /' ;;
esac`;

function parse(run) {
  assert.equal(run.status, 0, `${run.stderr}\n${run.stdout}`);
  const lines = run.stdout.split('\n');
  return {
    lines,
    field: (name) => lines.find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1).trim(),
    members: lines.filter((line) => line.startsWith('MEMBER ')).map((line) => line.slice(7)),
  };
}

test('full archive carries one consistent database snapshot and no deployment scratch', () => {
  const { dirs, vars } = fixture();
  seedDataDir(dirs.data);

  const run = withShim(`
set -euo pipefail
mkdir -p "$MINIDRAMA_DATA_DIR/.backup-staging/20200102T000000Z"
cp "$SHIM_SNAPSHOT_DB" "$MINIDRAMA_DATA_DIR/.backup-staging/20200102T000000Z/drama_generator.db"
bash "$BACKUP_SCRIPT" --full --quiet
archive="$(find "$MINIDRAMA_BACKUP_DIR" -maxdepth 1 -type f -name 'minidrama-data-*.tar.*' | head -n1)"
printf 'ARCHIVE=%s\\n' "$archive"${LIST_ARCHIVE}
printf 'STAGING_LEFT=%s\\n' "$(find "$MINIDRAMA_DATA_DIR/.backup-staging" -mindepth 1 -maxdepth 1 | wc -l)"
MINIDRAMA_DATA_DIR="$RESTORED" bash "$RESTORE_SCRIPT" "$archive" --confirm
printf 'RESTORED_MP4=%s\\n' "$(cat "$RESTORED/storage/video/a.mp4")"
printf 'RESTORED_GHOSTS=%s\\n' "$(find "$RESTORED" -mindepth 1 -maxdepth 1 -name '.*' | wc -l)"
rm -rf "$MINIDRAMA_DATA_DIR/.backup-staging"
rm -f "$archive"
bash "$BACKUP_SCRIPT" --full --quiet
printf 'CLEAN_STAGING=%s\\n' "$(test -d "$MINIDRAMA_DATA_DIR/.backup-staging" && echo present || echo absent)"
`, vars);
  const got = parse(run);

  assert.match(got.field('ARCHIVE'), /minidrama-data-\d{8}T\d{6}Z\.tar\.(zst|gz)$/);
  assert.equal(got.members.filter((name) => /(^|\/)drama_generator\.db$/.test(name)).length, 1,
    `expected one database copy in the archive, got ${got.members}`);
  assert.ok(got.members.some((name) => /(^|\/)storage\/video\/a\.mp4$/.test(name)), 'the media tree must be archived');
  for (const excluded of ['.manual-backups', '.deploy-snapshots', '.release-backup-staging', '.backup-staging', 'db-wal', 'db-shm', 'GHOST']) {
    assert.ok(!got.members.some((name) => name.includes(excluded)), `${excluded} must not be archived: ${got.members}`);
  }
  // This run's staged snapshot is removed, but a snapshot another backup is
  // still assembling is left alone.
  assert.equal(got.field('STAGING_LEFT'), '1');
  assert.equal(got.field('CLEAN_STAGING'), 'absent');

  // The restored database must be the verified online snapshot, not the live file.
  assert.equal(readMarker(path.join(dirs.restored, 'drama_generator.db')), 'SNAPSHOT');
  assert.equal(got.field('RESTORED_MP4'), 'MP4-BYTES');
  assert.equal(got.field('RESTORED_GHOSTS'), '0');
});

test('an idle database is archived and certified before older archives go', () => {
  const { dirs, vars } = fixture();
  seedDataDir(dirs.data);
  fs.writeFileSync(path.join(dirs.backups, 'minidrama-data-20260901T000000Z.tar.gz'), 'x');

  const run = withShim(`
set -euo pipefail
export SHIM_NO_CONTAINER=1
bash "$BACKUP_SCRIPT" --full --quiet 2> "$SHIM_DIR/notice"
archive="$(find "$MINIDRAMA_BACKUP_DIR" -maxdepth 1 -type f -name 'minidrama-data-*.tar.*' -printf '%T@ %p\n' | sort -nr | head -n1 | cut -d' ' -f2-)"
printf 'ARCHIVE=%s\\n' "$archive"${LIST_ARCHIVE}
printf 'STAGING=%s\\n' "$(test -d "$MINIDRAMA_DATA_DIR/.backup-staging" && echo present || echo absent)"
printf 'NOTICE=%s\\n' "$(tr '\\n' ' ' < "$SHIM_DIR/notice")"
printf 'COUNT=%s\\n' "$(find "$MINIDRAMA_BACKUP_DIR" -maxdepth 1 -type f -name 'minidrama-data-*' | wc -l)"
MINIDRAMA_DATA_DIR="$RESTORED" bash "$RESTORE_SCRIPT" "$archive" --confirm
`, vars);
  const got = parse(run);

  assert.match(got.field('NOTICE'), /No RichiDrama container is running/);
  assert.equal(got.field('STAGING'), 'absent');
  // Without a container the live files, write-ahead log included, are archived.
  assert.equal(got.members.filter((name) => /(^|\/)drama_generator\.db$/.test(name)).length, 1);
  assert.ok(got.members.some((name) => name.includes('db-wal')), 'the idle archive must keep the write-ahead log');
  for (const excluded of ['.manual-backups', '.deploy-snapshots', '.release-backup-staging']) {
    assert.ok(!got.members.some((name) => name.includes(excluded)), `${excluded} must not be archived: ${got.members}`);
  }
  assert.equal(readMarker(path.join(dirs.restored, 'drama_generator.db')), 'LIVE');
});

test('an unreachable Docker daemon cannot replace the last trustworthy archive', () => {
  const { dirs, vars } = fixture();
  seedDataDir(dirs.data);
  const previous = path.join(dirs.backups, 'minidrama-data-20260901T000000Z.tar.gz');
  fs.writeFileSync(previous, 'x');

  const refused = withShim(`
set -euo pipefail
export SHIM_NO_DOCKER=1
status=0
bash "$BACKUP_SCRIPT" --full --quiet 2> "$SHIM_DIR/notice" || status=$?
printf 'STATUS=%s\\n' "$status"
printf 'NOTICE=%s\\n' "$(tr '\\n' ' ' < "$SHIM_DIR/notice")"
printf 'PREVIOUS=%s\\n' "$(test -f "$MINIDRAMA_BACKUP_DIR/minidrama-data-20260901T000000Z.tar.gz" && echo kept || echo collected)"
`, vars);
  const first = parse(refused);
  assert.equal(first.field('STATUS'), '1');
  assert.match(first.field('NOTICE'), /Docker is unreachable/);
  assert.match(first.field('NOTICE'), /allow-unverified-database/);
  assert.equal(first.field('PREVIOUS'), 'kept');

  const override = withShim(`
set -euo pipefail
export SHIM_NO_DOCKER=1
bash "$BACKUP_SCRIPT" --full --quiet --allow-unverified-database 2> "$SHIM_DIR/notice"
printf 'NOTICE=%s\\n' "$(tr '\\n' ' ' < "$SHIM_DIR/notice")"
printf 'COUNT=%s\\n' "$(find "$MINIDRAMA_BACKUP_DIR" -maxdepth 1 -type f -name 'minidrama-data-*' | wc -l)"
`, vars);
  const second = parse(override);
  assert.match(second.field('NOTICE'), /archiving database files that no run can certify/);
  assert.equal(second.field('COUNT'), '2', 'an uncertified archive must not collect the previous one');
});

test('a diagnostic about the staged database leaves no archive behind', () => {
  const { dirs, vars } = fixture();
  seedDataDir(dirs.data);
  fs.writeFileSync(path.join(dirs.backups, 'minidrama-data-20260901T000000Z.tar.gz'), 'x');

  const run = withShim(`
set -euo pipefail
export SHIM_DROP_SNAPSHOT=1
status=0
bash "$BACKUP_SCRIPT" --full --quiet 2> "$SHIM_DIR/notice" || status=$?
printf 'STATUS=%s\\n' "$status"
printf 'NOTICE=%s\\n' "$(tr '\\n' ' ' < "$SHIM_DIR/notice")"
printf 'ARCHIVES=%s\\n' "$(find "$MINIDRAMA_BACKUP_DIR" -maxdepth 1 -type f -name 'minidrama-data-*' | wc -l)"
printf 'STAGING=%s\\n' "$(test -d "$MINIDRAMA_DATA_DIR/.backup-staging" && echo present || echo absent)"
`, vars);
  const got = parse(run);
  assert.equal(got.field('STATUS'), '1');
  assert.match(got.field('NOTICE'), /allowed to be missing/);
  assert.equal(got.field('ARCHIVES'), '1', 'a failed run must neither add nor collect an archive');
  assert.equal(got.field('STAGING'), 'absent');
});

test('a restore validates the whole archive before it touches the live data', () => {
  const { dirs, vars } = fixture();
  const archive = path.join(dirs.backups, 'minidrama-data-20260929T000000Z.tar.gz');
  fs.writeFileSync(archive, 'not a gzip stream at all');
  fs.mkdirSync(path.join(dirs.restored, 'keepme'), { recursive: true });
  fs.writeFileSync(path.join(dirs.restored, 'keepme', 'marker.txt'), 'PRECIOUS');

  const run = withShim(`
set -euo pipefail
status=0
MINIDRAMA_DATA_DIR="$RESTORED" bash "$RESTORE_SCRIPT" "$BROKEN_ARCHIVE" --confirm 2> "$SHIM_DIR/notice" || status=$?
printf 'STATUS=%s\\n' "$status"
printf 'NOTICE=%s\\n' "$(tr '\\n' ' ' < "$SHIM_DIR/notice")"
printf 'SURVIVED=%s\\n' "$(cat "$RESTORED/keepme/marker.txt" 2>/dev/null || echo gone)"
`, { ...vars, BROKEN_ARCHIVE: shellPath(archive) });
  const got = parse(run);
  assert.equal(got.field('STATUS'), '1');
  assert.match(got.field('NOTICE'), /Archive integrity check failed/);
  assert.equal(got.field('SURVIVED'), 'PRECIOUS', 'a bad archive must not destroy the live data directory');
});

test('full archive retention drops the oldest archives of both formats', () => {
  const { dirs, vars } = fixture();
  fs.mkdirSync(dirs.data, { recursive: true });
  makeSqliteDb(path.join(dirs.data, 'drama_generator.db'), 'LIVE');
  for (const [name, stamp] of [['minidrama-data-20260901T000000Z.tar.gz', '202609010000'],
    ['minidrama-data-20260902T000000Z.tar.zst', '202609020000'],
    ['minidrama-data-20260903T000000Z.tar.gz', '202609030000']]) {
    const file = path.join(dirs.backups, name);
    fs.writeFileSync(file, 'x');
    runBash(`touch -t ${stamp} '${shellPath(file)}'`, {});
  }

  const run = withShim(`
set -euo pipefail
FULL_BACKUP_RETAIN_COUNT=2 bash "$BACKUP_SCRIPT" --full --quiet
find "$MINIDRAMA_BACKUP_DIR" -maxdepth 1 -type f -name 'minidrama-data-*' -printf '%f\\n' | sort
`, vars);
  assert.equal(run.status, 0, `${run.stderr}\n${run.stdout}`);
  const kept = run.stdout.split('\n').filter((name) => /^minidrama-data-/.test(name));
  assert.equal(kept.length, 2, `retention kept ${kept}`);
  assert.ok(kept.some((name) => /^minidrama-data-\d{8}T\d{6}Z\.tar\.(zst|gz)$/.test(name)), 'the new archive must survive');
  assert.ok(kept.includes('minidrama-data-20260903T000000Z.tar.gz'), `the newest existing archive must survive: ${kept}`);
  assert.ok(!kept.includes('minidrama-data-20260901T000000Z.tar.gz'), `the oldest archive survived: ${kept}`);
  assert.ok(!kept.includes('minidrama-data-20260902T000000Z.tar.zst'), `the second oldest archive survived: ${kept}`);
});

test('an archive whose idle database cannot be certified is discarded', () => {
  const { dirs, vars } = fixture();
  fs.mkdirSync(dirs.data, { recursive: true });
  fs.writeFileSync(path.join(dirs.data, 'drama_generator.db'), 'this is not a database');
  const previous = path.join(dirs.backups, 'minidrama-data-20260901T000000Z.tar.gz');
  fs.writeFileSync(previous, 'x');

  const run = withShim(`
set -euo pipefail
export SHIM_NO_CONTAINER=1
status=0
bash "$BACKUP_SCRIPT" --full --quiet 2> "$SHIM_DIR/notice" || status=$?
printf 'STATUS=%s\\n' "$status"
printf 'NOTICE=%s\\n' "$(tr '\\n' ' ' < "$SHIM_DIR/notice")"
printf 'COUNT=%s\\n' "$(find "$MINIDRAMA_BACKUP_DIR" -maxdepth 1 -type f -name 'minidrama-data-*' | wc -l)"
`, vars);
  const got = parse(run);
  assert.equal(got.field('STATUS'), '1');
  assert.match(got.field('NOTICE'), /Backup discarded/);
  assert.equal(got.field('COUNT'), '1', 'an uncertified archive must not stay to displace the last good one');
  assert.equal(fs.existsSync(previous), true);
});

test('a restore refuses a database that fails its integrity check', () => {
  const { dirs, vars } = fixture();
  const staging = tempDir('corrupt');
  const database = path.join(staging, 'drama_generator.db');
  makeSqliteDb(database, 'LIVE');
  // Keep the file header but destroy the page content: the archive then passes
  // a header check while the database itself is unreadable.
  fs.truncateSync(database, 64);
  const archive = path.join(dirs.backups, 'minidrama-data-20260929T000000Z.tar.gz');
  runBash(`tar -czf '${shellPath(archive)}' -C '${shellPath(staging)}' drama_generator.db`, {});
  fs.mkdirSync(path.join(dirs.restored, 'keepme'), { recursive: true });
  fs.writeFileSync(path.join(dirs.restored, 'keepme', 'marker.txt'), 'PRECIOUS');

  const run = withShim(`
set -euo pipefail
status=0
MINIDRAMA_DATA_DIR="$RESTORED" bash "$RESTORE_SCRIPT" "$CORRUPT_ARCHIVE" --confirm 2> "$SHIM_DIR/notice" || status=$?
printf 'STATUS=%s\\n' "$status"
printf 'NOTICE=%s\\n' "$(tr '\\n' ' ' < "$SHIM_DIR/notice")"
printf 'SURVIVED=%s\\n' "$(cat "$RESTORED/keepme/marker.txt" 2>/dev/null || echo gone)"
`, { ...vars, CORRUPT_ARCHIVE: shellPath(archive), PROJECT_DIR: shellPath(root) });
  const got = parse(run);
  assert.equal(got.field('STATUS'), '1');
  assert.match(got.field('NOTICE'), /failed its integrity check/);
  assert.equal(got.field('SURVIVED'), 'PRECIOUS', 'an unreadable database must never replace live data');

  const bypassed = withShim(`
set -euo pipefail
MINIDRAMA_DATA_DIR="$RESTORED" bash "$RESTORE_SCRIPT" "$CORRUPT_ARCHIVE" --confirm --skip-database-check 2> "$SHIM_DIR/notice"
printf 'NOTICE=%s\\n' "$(tr '\\n' ' ' < "$SHIM_DIR/notice")"
printf 'RESTORED=%s\\n' "$(test -f "$RESTORED/drama_generator.db" && echo present || echo absent)"
printf 'WIPED=%s\\n' "$(test -f "$RESTORED/keepme/marker.txt" && echo present || echo gone)"
`, { ...vars, CORRUPT_ARCHIVE: shellPath(archive), PROJECT_DIR: shellPath(root) });
  const second = parse(bypassed);
  assert.match(second.field('NOTICE'), /Skipping the SQLite integrity check/);
  assert.equal(second.field('RESTORED'), 'present');
  assert.equal(second.field('WIPED'), 'gone', 'the confirmed restore must replace the data directory');
});

function releaseFixture() {
  const dir = tempDir('releases');
  const created = [];
  for (let index = 0; index < 8; index += 1) {
    const sha = revision(0xa00 + index);
    const releaseDir = path.join(dir, sha);
    fs.mkdirSync(path.join(releaseDir, 'source'), { recursive: true });
    fs.writeFileSync(path.join(releaseDir, 'source', 'Dockerfile'), 'FROM node');
    fs.mkdirSync(path.join(releaseDir, 'preflight-data'), { recursive: true });
    fs.writeFileSync(path.join(releaseDir, 'preflight-data', 'drama_generator.db'), 'PREFLIGHT');
    fs.writeFileSync(path.join(releaseDir, 'production-before.db'), 'SNAPSHOT');
    fs.writeFileSync(path.join(releaseDir, 'succeeded'), '');
    runBash(`touch -t 202609${10 + index}0000 '${shellPath(path.join(releaseDir, 'succeeded'))}'`, {});
    if (index < 6) fs.writeFileSync(path.join(releaseDir, '.gc-stamp'), '');
    created.push(sha);
  }
  // Two directories from before the collection policy shipped, one of them the
  // preview currently being deployed.
  const current = revision(0xa90);
  for (const sha of [current, revision(0xa91)]) {
    fs.mkdirSync(path.join(dir, sha, 'source'), { recursive: true });
    fs.writeFileSync(path.join(dir, sha, 'source', 'Dockerfile'), 'FROM node');
  }
  // Two aborted releases: they never wrote a success marker, so their only
  // lasting artefact is the pre-release database. One predates the policy.
  const aborted = revision(0xa92);
  const legacyAborted = revision(0xa93);
  for (const sha of [aborted, legacyAborted]) {
    const releaseDir = path.join(dir, sha);
    fs.mkdirSync(path.join(releaseDir, 'source'), { recursive: true });
    fs.writeFileSync(path.join(releaseDir, 'source', 'Dockerfile'), 'FROM node');
    fs.mkdirSync(path.join(releaseDir, 'preflight-data'), { recursive: true });
    fs.writeFileSync(path.join(releaseDir, 'preflight-data', 'drama_generator.db'), 'PREFLIGHT');
    fs.writeFileSync(path.join(releaseDir, 'production-before.db'), 'ABORTED-SNAPSHOT');
  }
  fs.writeFileSync(path.join(dir, aborted, '.gc-stamp'), '');
  fs.writeFileSync(path.join(dir, 'rollback.env'), `PREVIOUS_REVISION=${created[7]}\nCANDIDATE_REVISION=${created[0]}\n`);
  fs.writeFileSync(path.join(dir, 'active-revision'), `${created[0]}\n`);
  return { dir, created, current, aborted, legacyAborted };
}

function remainingDirs(dir) {
  const run = runBash(`find '$ROOT' -mindepth 1 -maxdepth 1 -type d -printf '%f\\n' | sort`, { ROOT: shellPath(dir) });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim().split('\n');
}

function collect(dir, invocation, extraVars = {}) {
  const run = runBash(`
set -euo pipefail
source "$LIB_SCRIPT"
${invocation}
find "$MINIDRAMA_RELEASE_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\\n' | sort
`, { LIB_SCRIPT: shellPath(LIB_SCRIPT), MINIDRAMA_RELEASE_ROOT: shellPath(dir), ...extraVars });
  assert.equal(run.status, 0, `${run.stderr}\n${run.stdout}`);
  return run.stdout.trim().split('\n');
}

test('release collection only ever touches directories it created itself', () => {
  const { dir, created, current, aborted, legacyAborted } = releaseFixture();
  const remaining = collect(dir, 'MINIDRAMA_KEEP_RELEASES=3 MINIDRAMA_GC_CURRENT_SHA="$CURRENT" prune_release_artifacts', { CURRENT: current });

  // created[0..5] carry the collection stamp, so the keep window of 3 ranks
  // them: created[5], created[4], created[3] stay, created[1] and created[2]
  // go, and created[0] survives because active-revision names it. created[6],
  // created[7] and both preview directories predate the policy, so they remain
  // exactly as they were.
  assert.ok(remaining.includes(created[0]), `referenced release is missing from ${remaining}`);
  assert.ok(remaining.includes(created[3]), `newest collectible release is missing from ${remaining}`);
  assert.ok(remaining.includes(created[6]), `untracked release was collected: ${remaining}`);
  assert.ok(remaining.includes(created[7]), `untracked release was collected: ${remaining}`);
  assert.ok(remaining.includes(current), `the release being deployed is missing from ${remaining}`);
  assert.ok(remaining.includes(revision(0xa91)), `untracked preview was collected: ${remaining}`);
  assert.ok(!remaining.includes(created[2]), `superseded release survived: ${remaining}`);

  // A kept release loses only what Git can reproduce.
  assert.ok(fs.existsSync(path.join(dir, created[0], 'production-before.db')), 'a kept release keeps its database snapshot');
  assert.ok(fs.existsSync(path.join(dir, created[0], 'source')), 'a kept release keeps its source tree');
  assert.ok(!fs.existsSync(path.join(dir, created[0], 'preflight-data')), 'the preflight copy must be collected');
  assert.ok(fs.existsSync(path.join(dir, created[6], 'preflight-data')), 'untouched history keeps every file it had');

  // An aborted release has no success marker, so it never occupies a keep slot.
  // Its pre-release database is the only copy of the state before that attempt.
  assert.ok(remaining.includes(aborted), `aborted release was deleted with its snapshot: ${remaining}`);
  assert.equal(fs.readFileSync(path.join(dir, aborted, 'production-before.db'), 'utf8'), 'ABORTED-SNAPSHOT');
  assert.ok(!fs.existsSync(path.join(dir, aborted, 'source')), 'the reproducible source tree of an aborted release must go');
  assert.ok(!fs.existsSync(path.join(dir, aborted, 'preflight-data')), 'the preflight copy of an aborted release must go');
  assert.ok(fs.existsSync(path.join(dir, legacyAborted, 'source')), 'pre-policy history is untouched');
});

test('the backlog opt-in collects pre-policy history but keeps recovery points', () => {
  const { dir, created, current, legacyAborted } = releaseFixture();
  const remaining = collect(dir, 'MINIDRAMA_KEEP_RELEASES=3 MINIDRAMA_GC_CURRENT_SHA="$CURRENT" MINIDRAMA_GC_INCLUDE_LEGACY=1 prune_release_artifacts', { CURRENT: current });

  assert.ok(!remaining.includes(revision(0xa91)), `pre-policy history survived the opt-in: ${remaining}`);
  assert.ok(remaining.includes(created[0]), `referenced release is missing from ${remaining}`);
  assert.ok(remaining.includes(created[7]) || remaining.includes(created[6]), `the newest history lost its snapshot: ${remaining}`);
  for (const sha of remaining) {
    assert.ok(!fs.existsSync(path.join(dir, sha, 'preflight-data')), `${sha} still holds a preflight copy`);
  }
  // The pre-policy aborted release keeps its unique snapshot as well.
  assert.ok(remaining.includes(legacyAborted), `pre-policy aborted release was deleted: ${remaining}`);
  assert.equal(fs.readFileSync(path.join(dir, legacyAborted, 'production-before.db'), 'utf8'), 'ABORTED-SNAPSHOT');
  assert.ok(!fs.existsSync(path.join(dir, legacyAborted, 'source')), 'its source tree must still be collected');
});

test('source extraction stamps every new release directory', () => {
  const dir = tempDir('releases');
  const incoming = tempDir('incoming');
  const sha = revision(0xb00);
  const archive = path.join(incoming, `${sha}.tar.gz`);
  const staging = tempDir('stage');
  fs.mkdirSync(path.join(staging, 'backend-node'), { recursive: true });
  fs.writeFileSync(path.join(staging, 'Dockerfile'), 'FROM node');
  fs.writeFileSync(path.join(staging, 'backend-node', 'package.json'), '{}');
  runBash(`tar -czf '${shellPath(archive)}' -C '${shellPath(staging)}' .`, {});
  const vars = { LIB_SCRIPT: shellPath(LIB_SCRIPT), MINIDRAMA_RELEASE_ROOT: shellPath(dir),
    MINIDRAMA_INCOMING_ROOT: shellPath(incoming), SHA: sha };

  const fresh = runBash(`
set -euo pipefail
source "$LIB_SCRIPT"
prepare_source "$SHA" > /dev/null
find "$RELEASE_ROOT" -mindepth 2 -maxdepth 2 -name .gc-stamp
`, vars);
  assert.equal(fresh.status, 0, `${fresh.stderr}\n${fresh.stdout}`);
  assert.equal(fresh.stdout.trim(), shellPath(path.join(dir, sha, '.gc-stamp')));

  // Retrying an older SHA reuses a directory that predates the policy. It must
  // not be converted into something the nightly collection may delete.
  const legacySha = revision(0xb01);
  const legacyDir = path.join(dir, legacySha);
  fs.mkdirSync(path.join(legacyDir, 'preflight-data'), { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'production-before.db'), 'HISTORY');
  fs.copyFileSync(archive, path.join(incoming, `${legacySha}.tar.gz`));
  const reused = runBash(`
set -euo pipefail
source "$LIB_SCRIPT"
prepare_source "$LEGACY_SHA" > /dev/null
printf 'STAMP=%s\\n' "$(test -f "$RELEASE_ROOT/$LEGACY_SHA/.gc-stamp" && echo present || echo absent)"
`, { ...vars, LEGACY_SHA: legacySha });
  assert.equal(reused.status, 0, `${reused.stderr}\n${reused.stdout}`);
  assert.match(reused.stdout, /STAMP=absent/);
});
