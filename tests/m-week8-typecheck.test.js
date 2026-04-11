// Uke 8 type-safety tester
//
// Dekker:
//   TS-1: tsconfig.json eksisterer og er gyldig + opt-in checkJs
//   TS-2: Minst 10 filer har '// @ts-check' i topp
//   TS-3: types/openapi.d.ts er generert og har relevante export-types
//   TS-4: npm run typecheck passerer med exit 0
//   TS-5: Refactor-verifisering — tsc fanger syntetisk type-feil i
//         en @ts-check-fil (bevis at gaten faktisk virker)
//   TS-6: docs/TYPE_COVERAGE.md dekker strategi

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/**
 * Cross-platform tsc runner. Bruker direkte node + tsc-binær i stedet
 * for npx.cmd som feiler med EINVAL på Windows Node 24.
 */
function runTsc() {
  const tscBin = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  return spawnSync(process.execPath, [tscBin, '--noEmit'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  });
}

// ============================================================
// TS-1: tsconfig.json
// ============================================================
describe('Uke8 · TS-1 tsconfig.json', () => {
  test('tsconfig.json finnes og er gyldig JSON', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'tsconfig.json')), 'tsconfig.json mangler');
    assert.doesNotThrow(() => JSON.parse(readFile('tsconfig.json')));
  });

  test('tsconfig.json har allowJs + checkJs=false (opt-in) + noEmit', () => {
    const tsc = JSON.parse(readFile('tsconfig.json'));
    assert.equal(tsc.compilerOptions.allowJs, true, 'allowJs må være true');
    assert.equal(
      tsc.compilerOptions.checkJs,
      false,
      'checkJs må være false (opt-in via @ts-check)'
    );
    assert.equal(tsc.compilerOptions.noEmit, true, 'noEmit må være true (kun typecheck)');
  });

  test('tsconfig.json inkluderer server/**/*.js', () => {
    const tsc = JSON.parse(readFile('tsconfig.json'));
    assert.ok(Array.isArray(tsc.include));
    assert.ok(
      tsc.include.some((p) => p.includes('server')),
      'include må dekke server/'
    );
  });

  test('tsconfig.json ekskluderer tests og node_modules', () => {
    const tsc = JSON.parse(readFile('tsconfig.json'));
    assert.ok(
      tsc.exclude.some((p) => p.includes('tests')),
      'tests/ må være ekskludert'
    );
    assert.ok(tsc.exclude.some((p) => p.includes('node_modules')));
  });
});

// ============================================================
// TS-2: @ts-check opt-ins
// ============================================================
describe('Uke8 · TS-2 @ts-check coverage', () => {
  const TS_CHECK_FILES = [
    'server/services/slugify.js',
    'server/services/units.js',
    'server/services/seed.service.js',
    'server/services/recipe-similarity.service.js',
    'server/http/errors.js',
    'server/http/validate.js',
    'server/http/metrics.js',
    'server/http/cache.js',
    'server/logger.js',
    'server/state-snapshot.js',
  ];

  for (const file of TS_CHECK_FILES) {
    test(`${file} har // @ts-check i topp`, () => {
      const content = readFile(file);
      // @ts-check må være i første 3 linjer (shebang eller kommentarer)
      const firstLines = content.split('\n').slice(0, 5).join('\n');
      assert.ok(firstLines.includes('// @ts-check'), `${file} mangler "// @ts-check" i topp`);
    });
  }

  test('Minst 10 server/*.js filer er opt-in type-sjekket', () => {
    function walk(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      let files = [];
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) files = files.concat(walk(full));
        else if (e.isFile() && e.name.endsWith('.js')) files.push(full);
      }
      return files;
    }
    const allJs = walk(path.join(ROOT, 'server'));
    const withTsCheck = allJs.filter((f) => {
      const content = fs.readFileSync(f, 'utf8');
      return content.split('\n').slice(0, 5).join('\n').includes('// @ts-check');
    });
    assert.ok(
      withTsCheck.length >= 10,
      `forventet >=10 type-sjekket filer, fant ${withTsCheck.length}`
    );
  });
});

// ============================================================
// TS-3: openapi.d.ts
// ============================================================
describe('Uke8 · TS-3 openapi.d.ts generert', () => {
  test('types/openapi.d.ts finnes', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'types', 'openapi.d.ts')), 'openapi.d.ts mangler');
  });

  test('openapi.d.ts har relevante definisjoner', () => {
    const dts = readFile('types/openapi.d.ts');
    assert.ok(/export\s+interface\s+paths/.test(dts), 'paths-interface mangler');
    assert.ok(/\/api\/audit/.test(dts), 'audit-endpoint ikke typet');
    assert.ok(/\/api\/today/.test(dts), 'today-endpoint ikke typet');
  });

  test('package.json har openapi:types script', () => {
    const pkg = JSON.parse(readFile('package.json'));
    assert.ok(pkg.scripts?.['openapi:types'], 'npm run openapi:types mangler');
  });
});

// ============================================================
// TS-4: typecheck script + faktisk tsc
// ============================================================
describe('Uke8 · TS-4 typecheck npm script', () => {
  test('package.json har typecheck script', () => {
    const pkg = JSON.parse(readFile('package.json'));
    assert.equal(pkg.scripts.typecheck, 'tsc --noEmit', 'typecheck script feil');
  });

  test('tsc --noEmit på hele server/ passerer 0 errors', () => {
    const res = runTsc();
    if (res.status !== 0) {
      console.error('tsc stdout:', res.stdout?.slice(0, 2000));
      console.error('tsc stderr:', res.stderr?.slice(0, 2000));
      console.error('tsc error:', res.error);
    }
    assert.equal(res.status, 0, `tsc --noEmit feilet med exit ${res.status}`);
  });
});

// ============================================================
// TS-5: Refactor-verifisering proof-test
// ============================================================
// Vi oppretter en midlertidig fil under server/ med @ts-check og en
// åpenbar type-feil, kjører tsc, og sjekker at den faktisk feiler.
// Etterpå ryddes filen opp. Dette beviser at type-gaten fanger reelle
// type-feil — ikke bare at tsc kjører til 0 på eksisterende kode.
describe('Uke8 · TS-5 Refactor-verifisering (proof of effectiveness)', () => {
  const tmpFile = path.join(ROOT, 'server', '__typecheck_proof__.js');

  after(() => {
    if (fs.existsSync(tmpFile)) {
      try {
        fs.unlinkSync(tmpFile);
      } catch {}
    }
  });

  test('tsc fanger syntetisk type-feil i @ts-check-fil', () => {
    const brokenJs = `// @ts-check
/**
 * Proof: dette filen har en eksplisitt type-feil som tsc må fange.
 * @param {string} name
 * @returns {number}
 */
function broken(name) {
  // Bug: vi returnerer string i stedet for number
  return name.toUpperCase();
}
module.exports = { broken };
`;
    fs.writeFileSync(tmpFile, brokenJs);

    const res = runTsc();

    // Vi forventer at tsc feiler
    assert.notEqual(res.status, 0, 'tsc må fange type-feil i broken fil');
    // Og at feilmeldingen peker til vår bevisfil
    const combined = (res.stdout || '') + (res.stderr || '');
    assert.ok(
      combined.includes('__typecheck_proof__.js'),
      `tsc output må nevne __typecheck_proof__.js, fikk: ${combined.slice(0, 500)}`
    );
    // Feilen skal være en TS2322 (type mismatch) eller lignende
    assert.ok(
      /TS\d{4}/.test(combined),
      `tsc output må inneholde TS-error kode, fikk: ${combined.slice(0, 500)}`
    );
  });
});

// ============================================================
// TS-6: docs/TYPE_COVERAGE.md
// ============================================================
describe('Uke8 · TS-6 TYPE_COVERAGE.md', () => {
  test('docs/TYPE_COVERAGE.md finnes', () => {
    assert.ok(
      fs.existsSync(path.join(ROOT, 'docs', 'TYPE_COVERAGE.md')),
      'docs/TYPE_COVERAGE.md mangler'
    );
  });

  test('TYPE_COVERAGE.md dokumenterer opt-in strategi', () => {
    const md = readFile('docs/TYPE_COVERAGE.md');
    assert.ok(/opt-in/i.test(md), 'opt-in ikke dokumentert');
    assert.ok(/@ts-check/.test(md), '@ts-check-direktivet ikke dokumentert');
    assert.ok(/tsconfig/.test(md), 'tsconfig.json ikke nevnt');
  });

  test('TYPE_COVERAGE.md lister dagens type-sjekkede filer', () => {
    const md = readFile('docs/TYPE_COVERAGE.md');
    assert.ok(/slugify/.test(md), 'slugify.js ikke nevnt');
    assert.ok(/units/.test(md), 'units.js ikke nevnt');
    assert.ok(/errors/.test(md), 'errors.js ikke nevnt');
  });
});
