// Uke 7 portabilitets-tester
//
// Dekker:
//   PORT-1: Dockerfile eksisterer + multi-stage + distroless + HEALTHCHECK
//   PORT-2: docker-compose.yml har app + caddy services + healthcheck
//   PORT-3: .github/workflows/docker.yml for GHCR publishing
//   PORT-4: ci.yml har OS-matriks (Linux, macOS, Windows)
//   PORT-5: package.json engines + os + cpu felter
//   PORT-6: install.sh --docker mode + DEPLOY.md §14 + .env handling
//   PORT-7: HEALTHCHECK direktiv i Dockerfile

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}
function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

// ============================================================
// PORT-1: Dockerfile
// ============================================================
describe('Uke7 · PORT-1 Dockerfile', () => {
  test('Dockerfile eksisterer', () => {
    assert.ok(exists('Dockerfile'), 'Dockerfile mangler');
  });

  test('Multi-stage: builder + runtime', () => {
    const df = readFile('Dockerfile');
    assert.ok(/FROM\s+node:20[^ ]*\s+AS\s+builder/i.test(df), 'builder stage mangler');
    assert.ok(
      /FROM\s+[^\s]+\s+AS\s+runtime/i.test(df),
      'runtime stage mangler'
    );
  });

  test('Builder installerer dev-tools for better-sqlite3', () => {
    const df = readFile('Dockerfile');
    assert.ok(/python3/.test(df), 'python3 mangler (trenges for node-gyp)');
    assert.ok(/build-essential/.test(df), 'build-essential mangler');
  });

  test('Runtime dropper privilegier til en non-root bruker', () => {
    const df = readFile('Dockerfile');
    // Either a USER directive, or an entrypoint script that drops via gosu/su-exec.
    const dropsPrivileges =
      /^USER\s+(?!root(?::|\s|$))\S+/m.test(df) ||
      /gosu\s+\S+/.test(df) ||
      /su-exec\s+\S+/.test(df);
    assert.ok(dropsPrivileges, 'runtime kjører som root — mangler USER-direktiv eller gosu/su-exec drop');
  });

  test('Runtime har VOLUME for /app/data', () => {
    const df = readFile('Dockerfile');
    assert.ok(/VOLUME\s+\["\/app\/data"\]/.test(df), 'VOLUME /app/data mangler');
  });

  test('Runtime kjører server/index.js (ENTRYPOINT eller CMD)', () => {
    const df = readFile('Dockerfile');
    assert.ok(
      /(ENTRYPOINT|CMD)\s+\[[^\]]*"server\/index\.js"[^\]]*\]/.test(df),
      'server/index.js mangler i ENTRYPOINT/CMD'
    );
  });

  test('OCI labels er satt', () => {
    const df = readFile('Dockerfile');
    assert.ok(/LABEL\s+org\.opencontainers\.image\.title/.test(df));
    assert.ok(/LABEL\s+org\.opencontainers\.image\.licenses="MIT"/.test(df));
  });
});

// ============================================================
// PORT-7: HEALTHCHECK
// ============================================================
describe('Uke7 · PORT-7 Dockerfile HEALTHCHECK', () => {
  test('HEALTHCHECK direktiv finnes', () => {
    const df = readFile('Dockerfile');
    assert.ok(/HEALTHCHECK\s+/.test(df), 'HEALTHCHECK mangler');
  });

  test('HEALTHCHECK har interval, timeout, retries, start-period', () => {
    const df = readFile('Dockerfile');
    assert.ok(/--interval=/.test(df), '--interval mangler');
    assert.ok(/--timeout=/.test(df), '--timeout mangler');
    assert.ok(/--retries=/.test(df), '--retries mangler');
    assert.ok(/--start-period=/.test(df), '--start-period mangler');
  });

  test('HEALTHCHECK bruker node fetch (ikke wget/curl siden distroless)', () => {
    const df = readFile('Dockerfile');
    const healthSection = df.split('HEALTHCHECK')[1].split('ENTRYPOINT')[0];
    // Intern container-port er default 7777 i Dockerfile (phase 22 —
    // unngår 3000-kollisjoner på self-host-maskiner).
    assert.ok(
      /fetch\(['"]http:\/\/localhost:\d+\/health['"]\)/.test(healthSection),
      'HEALTHCHECK må bruke node fetch til /health'
    );
    assert.ok(!/wget|curl/.test(healthSection), 'HEALTHCHECK må ikke bruke wget/curl (distroless)');
  });
});

// ============================================================
// .dockerignore
// ============================================================
describe('Uke7 · .dockerignore', () => {
  test('.dockerignore eksisterer og ekskluderer node_modules', () => {
    assert.ok(exists('.dockerignore'), '.dockerignore mangler');
    const ig = readFile('.dockerignore');
    assert.ok(/node_modules/.test(ig), 'node_modules ikke ekskludert');
    assert.ok(/\.git/.test(ig), '.git ikke ekskludert');
    assert.ok(/tests/.test(ig), 'tests ikke ekskludert (shipping test-kode)');
    assert.ok(/data/.test(ig), 'data/ ikke ekskludert (må mountes som volum)');
  });
});

// ============================================================
// PORT-2: docker-compose.yml
// ============================================================
describe('Uke7 · PORT-2 docker-compose.yml', () => {
  test('docker-compose.yml eksisterer', () => {
    assert.ok(exists('docker-compose.yml'), 'docker-compose.yml mangler');
  });

  test('Har app + caddy services', () => {
    const yml = readFile('docker-compose.yml');
    assert.ok(/^\s*app:/m.test(yml), 'app service mangler');
    assert.ok(/^\s*caddy:/m.test(yml), 'caddy service mangler');
  });

  test('app service har image fra ghcr.io', () => {
    const yml = readFile('docker-compose.yml');
    assert.ok(/ghcr\.io\/christerfrestad\/familyassistant/.test(yml));
  });

  test('AUTH_TOKEN er valgfri (phase 22 — bootstrap-wizard overtar førstegangs-setup)', () => {
    const yml = readFile('docker-compose.yml');
    // docker-compose.yml skal IKKE hardkode AUTH_TOKEN som påkrevd (:? syntax).
    // Første deploy uten variabler starter bootstrap-wizarden på /setup.html,
    // som persisterer tokenet i /app/data/bootstrap.json. Se DEPLOY.md §16.
    assert.ok(
      /AUTH_TOKEN:\s*\$\{AUTH_TOKEN:-/.test(yml),
      'AUTH_TOKEN skal ha tom default (:- syntax) slik at bootstrap-flyten kan kjøre'
    );
    assert.ok(
      /BOOTSTRAP_ALLOWED:\s*["']?true["']?/.test(yml),
      'BOOTSTRAP_ALLOWED=true aktiverer bootstrap-mode ved første deploy'
    );
  });

  test('Volumes monterer data + caddy', () => {
    const yml = readFile('docker-compose.yml');
    assert.ok(/\.\/data:\/app\/data/.test(yml), 'data-volum mangler');
    assert.ok(/caddy_data:/.test(yml), 'caddy_data volum mangler');
  });

  test('Healthcheck konfigurert', () => {
    const yml = readFile('docker-compose.yml');
    assert.ok(/healthcheck:/.test(yml), 'healthcheck mangler');
    assert.ok(/condition:\s+service_healthy/.test(yml), 'caddy depends_on service_healthy mangler');
  });

  test('Memory limit 512 MB (matcher MEMORY_BUDGET_MB)', () => {
    const yml = readFile('docker-compose.yml');
    assert.ok(/memory:\s+512M/.test(yml), 'memory limit 512M mangler');
  });
});

// ============================================================
// PORT-3: docker.yml workflow
// ============================================================
describe('Uke7 · PORT-3 docker.yml GHCR workflow', () => {
  test('.github/workflows/docker.yml finnes', () => {
    assert.ok(exists('.github/workflows/docker.yml'), 'docker.yml mangler');
  });

  test('Bygger multiarch (amd64 + arm64)', () => {
    const yml = readFile('.github/workflows/docker.yml');
    assert.ok(/linux\/amd64,linux\/arm64/.test(yml), 'multiarch platforms mangler');
  });

  test('Bruker buildx + QEMU for arm64', () => {
    const yml = readFile('.github/workflows/docker.yml');
    assert.ok(/docker\/setup-buildx-action/.test(yml), 'buildx setup mangler');
    assert.ok(/docker\/setup-qemu-action/.test(yml), 'QEMU setup mangler');
  });

  test('Publiserer til ghcr.io', () => {
    const yml = readFile('.github/workflows/docker.yml');
    assert.ok(/REGISTRY:\s+ghcr\.io/.test(yml));
    assert.ok(/docker\/login-action/.test(yml));
  });

  test('Bygger SBOM + provenance', () => {
    const yml = readFile('.github/workflows/docker.yml');
    assert.ok(/provenance:\s*mode=max/.test(yml), 'provenance mode=max mangler');
    assert.ok(/sbom:\s*true/.test(yml), 'sbom: true mangler');
  });

  test('PR-trigger bygger uten push', () => {
    const yml = readFile('.github/workflows/docker.yml');
    assert.ok(/push:\s+\$\{\{\s+github\.event_name\s+!=\s+'pull_request'\s+\}\}/.test(yml));
  });
});

// ============================================================
// PORT-4: CI-matriks
// ============================================================
describe('Uke7 · PORT-4 CI OS-matriks', () => {
  test('ci.yml har ubuntu + macos + windows', () => {
    const yml = readFile('.github/workflows/ci.yml');
    assert.ok(/ubuntu-latest/.test(yml));
    assert.ok(/macos-latest/.test(yml));
    assert.ok(/windows-latest/.test(yml));
  });

  test('Matriks bruker fail-fast: false', () => {
    const yml = readFile('.github/workflows/ci.yml');
    assert.ok(/fail-fast:\s+false/.test(yml), 'fail-fast: false mangler');
  });

  test('Windows har git autocrlf-konfig', () => {
    const yml = readFile('.github/workflows/ci.yml');
    assert.ok(/core\.autocrlf\s+false/.test(yml), 'Windows git autocrlf-konfig mangler');
  });
});

// ============================================================
// PORT-5: package.json engines + os + cpu
// ============================================================
describe('Uke7 · PORT-5 package.json portability-metadata', () => {
  const pkg = JSON.parse(readFile('package.json'));

  test('engines.node har both min og max', () => {
    assert.ok(pkg.engines?.node, 'engines.node mangler');
    assert.ok(/>=20/.test(pkg.engines.node), 'minimum Node 20');
    assert.ok(/<23/.test(pkg.engines.node), 'maks Node ekskluderer 23+ (ikke testet)');
  });

  test('engines.npm er satt', () => {
    assert.ok(pkg.engines?.npm, 'engines.npm mangler');
  });

  test('os array har linux + darwin + win32', () => {
    assert.ok(Array.isArray(pkg.os), 'os må være array');
    assert.ok(pkg.os.includes('linux'));
    assert.ok(pkg.os.includes('darwin'));
    assert.ok(pkg.os.includes('win32'));
  });

  test('cpu array har x64 + arm64', () => {
    assert.ok(Array.isArray(pkg.cpu), 'cpu må være array');
    assert.ok(pkg.cpu.includes('x64'));
    assert.ok(pkg.cpu.includes('arm64'));
  });
});

// ============================================================
// PORT-6: install.sh --docker + DEPLOY.md §14
// ============================================================
describe('Uke7 · PORT-6 install.sh --docker', () => {
  test('install.sh har --docker argument-parsing', () => {
    const sh = readFile('install.sh');
    assert.ok(/--docker/.test(sh), '--docker flag mangler');
    assert.ok(/INSTALL_MODE="docker"/.test(sh), 'INSTALL_MODE=docker mangler');
  });

  test('install.sh har install_docker helper', () => {
    const sh = readFile('install.sh');
    assert.ok(/install_docker\(\)/.test(sh), 'install_docker helper mangler');
    assert.ok(/docker_compose_up\(\)/.test(sh), 'docker_compose_up helper mangler');
    assert.ok(/verify_docker\(\)/.test(sh), 'verify_docker helper mangler');
  });

  test('install.sh har forgrenet hovedflyt', () => {
    const sh = readFile('install.sh');
    assert.ok(/if\s+\[\[\s+"\$INSTALL_MODE"\s+==\s+"docker"\s+\]\]/.test(sh));
  });
});

describe('Uke7 · PORT-6 DEPLOY.md §14', () => {
  test('DEPLOY.md har seksjon 14 Docker-deployment', () => {
    const md = readFile('DEPLOY.md');
    assert.ok(/##\s+14\.\s+Docker-deployment/.test(md), '§14 header mangler');
  });

  test('DEPLOY.md dekker rask-start, oppgradering, backup, troubleshooting', () => {
    const md = readFile('DEPLOY.md');
    assert.ok(/14\.2\s+Rask start/.test(md), '14.2 Rask start mangler');
    assert.ok(/14\.3\s+Oppgradering/.test(md), '14.3 Oppgradering mangler');
    assert.ok(/14\.4\s+Backup/.test(md), '14.4 Backup mangler');
    assert.ok(/14\.5\s+Bruker.*install\.sh.*docker/.test(md), '14.5 install.sh --docker mangler');
    assert.ok(/14\.6\s+Troubleshooting/.test(md), '14.6 Troubleshooting mangler');
  });

  test('DEPLOY.md advarer mot å blande systemd og Docker', () => {
    const md = readFile('DEPLOY.md');
    assert.ok(/14\.7.*systemd.*Docker.*aldri/i.test(md), 'systemd-ELLER-Docker-advarsel mangler');
  });
});
