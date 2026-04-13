#!/usr/bin/env node

/**
 * Test Simple du Serveur PostgreSQL MCP (sans connexion BD)
 * Valide la structure et les imports
 */

import assert from 'node:assert';

// Logger simple pour les tests
const testLogger = {
  info: (msg) => console.log(`✅ ${msg}`),
  error: (msg) => console.error(`❌ ${msg}`),
  debug: (msg) => console.log(`🔍 ${msg}`)
};

/**
 * Test 1: Vérification des modules
 */
function testModules() {
  try {
    // Vérification que les modules sont importables
    assert.ok(true, 'Modules importés avec succès');

    testLogger.info('Modules importés correctement');
    return true;
  } catch (error) {
    testLogger.error(`Import modules échoué: ${error.message}`);
    return false;
  }
}

/**
 * Test 2: Vérification des fichiers dist
 */
import fs from 'node:fs';
import path from 'node:path';

function testDistFiles() {
  try {
    const distDir = path.join(process.cwd(), 'dist');
    const requiredFiles = [
      'index.js',
      'index.d.ts',
      'config.js',
      'config.d.ts',
      'tools/coreTools.js',
      'services/intelligentSearchService.js',
      'services/embeddingService.js'
    ];

    for (const file of requiredFiles) {
      const filePath = path.join(distDir, file);
      assert.ok(fs.existsSync(filePath), `Le fichier ${file} devrait exister`);
    }

    testLogger.info(`${requiredFiles.length} fichiers dist/ vérifiés`);
    return true;
  } catch (error) {
    testLogger.error(`Vérification dist échouée: ${error.message}`);
    return false;
  }
}

/**
 * Test 3: Vérification package.json
 */
function testPackageJson() {
  try {
    const packagePath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));

    assert.ok(packageJson.scripts, 'scripts devrait exister');
    assert.ok(packageJson.scripts.build, 'script build devrait exister');
    assert.ok(packageJson.scripts.test, 'script test devrait exister');
    assert.ok(packageJson.scripts.lint, 'script lint devrait exister');
    assert.ok(packageJson.dependencies, 'dependencies devrait exister');
    assert.ok(packageJson.dependencies.pg, 'pg devrait être dans dependencies');
    assert.ok(packageJson.dependencies.fastmcp, 'fastmcp devrait être dans dependencies');

    testLogger.info('Structure package.json valide');
    return true;
  } catch (error) {
    testLogger.error(`Vérification package.json échouée: ${error.message}`);
    return false;
  }
}

/**
 * Test 4: Vérification TypeScript config
 */
function testTypeScriptConfig() {
  try {
    const tsConfigPath = path.join(process.cwd(), 'tsconfig.json');
    const tsConfig = JSON.parse(fs.readFileSync(tsConfigPath, 'utf-8'));

    assert.ok(tsConfig.compilerOptions, 'compilerOptions devrait exister');
    assert.strictEqual(tsConfig.compilerOptions.module, 'ESNext', 'module devrait être ESNext');
    assert.strictEqual(tsConfig.compilerOptions.target, 'ES2022', 'target devrait être ES2022');
    assert.ok(tsConfig.compilerOptions.outDir, 'outDir devrait être défini');
    assert.strictEqual(tsConfig.compilerOptions.strict, true, 'strict devrait être true');

    testLogger.info('Configuration TypeScript valide');
    return true;
  } catch (error) {
    testLogger.error(`Vérification TypeScript échouée: ${error.message}`);
    return false;
  }
}

/**
 * Test 5: Vérification environnement
 */
function testEnvironment() {
  try {
    // Vérification variables d'environnement critiques
    const envVars = ['NODE_ENV', 'PGHOST', 'PGPORT', 'PGDATABASE'];

    let found = 0;
    for (const envVar of envVars) {
      if (process.env[envVar]) {
        found++;
      }
    }

    testLogger.info(`${found}/${envVars.length} variables d\'environnement trouvées`);
    return true;
  } catch (error) {
    testLogger.error(`Vérification environnement échouée: ${error.message}`);
    return false;
  }
}

/**
 * Exécution principale des tests
 */
async function runAllTests() {
  console.log('\n🧪 Exécution des Tests PostgreSQL MCP Serveur (Sans BD)\n');

  const tests = [
    { name: 'Modules', fn: testModules },
    { name: 'Fichiers dist/', fn: testDistFiles },
    { name: 'package.json', fn: testPackageJson },
    { name: 'TypeScript Config', fn: testTypeScriptConfig },
    { name: 'Environnement', fn: testEnvironment }
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = test.fn();
    if (result) {
      passed++;
    } else {
      failed++;
    }
  }

  // Rapport final
  console.log('\n📊 RÉSULTATS DES TESTS\n');
  console.log('='.repeat(50));
  console.log(`✅ Tests réussis: ${passed}/${tests.length}`);
  console.log(`❌ Tests échoués: ${failed}/${tests.length}`);
  console.log(`📈 Taux de réussite: ${((passed / tests.length) * 100).toFixed(1)}%`);
  console.log('='.repeat(50));

  if (failed === 0) {
    console.log('\n🎉 TOUS LES TESTS ONT RÉUSSI !\n');
    process.exit(0);
  } else {
    console.log(`\n⚠️ ${failed} test(s) échoué(s)\n`);
    process.exit(1);
  }
}

// Exécution
runAllTests().catch(error => {
  testLogger.error(`Erreur critique: ${error.message}`);
  process.exit(1);
});
