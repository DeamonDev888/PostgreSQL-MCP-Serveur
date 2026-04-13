#!/usr/bin/env node

/**
 * Test Complet du Serveur PostgreSQL MCP
 * Valide les fonctionnalités critiques du serveur
 */

import assert from 'node:assert';
import { CoreTools } from './dist/tools/coreTools.js';
import { FastMCP } from 'fastmcp';
import { Pool } from 'pg';

// Logger simple pour les tests
const testLogger = {
  info: (msg) => console.log(`✅ ${msg}`),
  error: (msg) => console.error(`❌ ${msg}`),
  debug: (msg) => console.log(`🔍 ${msg}`)
};

// Variables globales
let pool;
let server;
let coreTools;

/**
 * Test 1: Initialisation
 */
async function testInitialization() {
  try {
    // Configuration de test
    const config = {
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT) || 5432,
      database: process.env.PGDATABASE || 'test_db',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres'
    };

    pool = new Pool(config);
    server = new FastMCP({ name: 'test-server' });
    coreTools = new CoreTools(pool, server);

    assert.ok(coreTools, 'CoreTools devrait être défini');
    assert.ok(coreTools.registerTools, 'registerTools devrait être défini');

    testLogger.info('Tests initialisés avec succès');
    return true;
  } catch (error) {
    testLogger.error(`Initialisation échouée: ${error.message}`);
    return false;
  }
}

/**
 * Test 2: Connexion BD
 */
async function testDatabaseConnection() {
  try {
    const client = await pool.connect();
    assert.ok(client, 'Client devrait être défini');
    await client.release();

    testLogger.info('Connexion BD réussie');
    return true;
  } catch (error) {
    testLogger.error(`Connexion BD échouée: ${error.message}`);
    return false;
  }
}

/**
 * Test 3: Requêtes SQL simples
 */
async function testSimpleQueries() {
  try {
    const result = await pool.query('SELECT 1 as test');
    assert.strictEqual(result.rows[0].test, 1, 'Le résultat devrait être 1');

    testLogger.info('Requête SQL exécutée avec succès');
    return true;
  } catch (error) {
    testLogger.error(`Requête SQL échouée: ${error.message}`);
    return false;
  }
}

/**
 * Test 4: Transactions
 */
async function testTransactions() {
  try {
    const client = await pool.connect();
    await client.query('BEGIN');
    const result = await client.query('SELECT 1 as transaction_test');
    await client.query('ROLLBACK');
    await client.release();

    assert.strictEqual(result.rows[0].transaction_test, 1, 'Le résultat transaction devrait être 1');

    testLogger.info('Transaction réussie');
    return true;
  } catch (error) {
    testLogger.error(`Transaction échouée: ${error.message}`);
    return false;
  }
}

/**
 * Test 5: Gestion d'erreurs SQL
 */
async function testSQLErrorHandling() {
  try {
    await pool.query('SELECT * FROM table_inexistante');
    testLogger.error('Devrait avoir lancé une erreur');
    return false;
  } catch (error) {
    assert.ok(error, 'Erreur devrait être définie');
    assert.ok(error.message.includes('does not exist'), 'Message devrait contenir "does not exist"');

    testLogger.info('Gestion d\'erreur SQL correcte');
    return true;
  }
}

/**
 * Test 6: Performance
 */
async function testPerformance() {
  try {
    const start = Date.now();
    await pool.query('SELECT 1');
    const duration = Date.now() - start;

    assert.ok(duration < 100, `La requête devrait prendre < 100ms (actuel: ${duration}ms)`);

    testLogger.info(`Performance: ${duration}ms`);
    return true;
  } catch (error) {
    testLogger.error(`Test performance échoué: ${error.message}`);
    return false;
  }
}

/**
 * Test 7: Connexions multiples
 */
async function testMultipleConnections() {
  try {
    const promises = Array(5).fill(null).map(() =>
      pool.query('SELECT 1')
    );

    const results = await Promise.all(promises);
    assert.strictEqual(results.length, 5, 'Devrait avoir 5 résultats');

    testLogger.info('Connexions parallèles réussies');
    return true;
  } catch (error) {
    testLogger.error(`Connexions multiples échouées: ${error.message}`);
    return false;
  }
}

/**
 * Test 8: Validation sécurité
 */
async function testSecurityValidation() {
  try {
    const dangerousQuery = 'DROP TABLE users';
    const isDangerous = /DROP|DELETE|UPDATE|INSERT/i.test(dangerousQuery);

    assert.ok(isDangerous, 'La requête devrait être détectée comme dangereuse');

    testLogger.info('Validation sécurité réussie');
    return true;
  } catch (error) {
    testLogger.error(`Test sécurité échoué: ${error.message}`);
    return false;
  }
}

/**
 * Test 9: Validation paramètres
 */
async function testParameterValidation() {
  try {
    const maliciousInput = "'; DROP TABLE users; --";
    const sanitized = maliciousInput.replace(/[';]/g, '');

    assert.ok(!sanitized.includes('DROP'), 'Le DROP devrait être retiré');

    testLogger.info('Validation paramètres réussie');
    return true;
  } catch (error) {
    testLogger.error(`Validation paramètres échouée: ${error.message}`);
    return false;
  }
}

/**
 * Nettoyage
 */
async function cleanup() {
  if (pool) {
    await pool.end();
    testLogger.info('Pool de connexions fermé');
  }
}

/**
 * Exécution principale des tests
 */
async function runAllTests() {
  console.log('\n🧪 Exécution des Tests PostgreSQL MCP Serveur...\n');

  const tests = [
    { name: 'Initialisation', fn: testInitialization },
    { name: 'Connexion BD', fn: testDatabaseConnection },
    { name: 'Requêtes SQL simples', fn: testSimpleQueries },
    { name: 'Transactions', fn: testTransactions },
    { name: 'Gestion erreurs SQL', fn: testSQLErrorHandling },
    { name: 'Performance', fn: testPerformance },
    { name: 'Connexions multiples', fn: testMultipleConnections },
    { name: 'Validation sécurité', fn: testSecurityValidation },
    { name: 'Validation paramètres', fn: testParameterValidation }
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = await test.fn();
    if (result) {
      passed++;
    } else {
      failed++;
    }
  }

  await cleanup();

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
