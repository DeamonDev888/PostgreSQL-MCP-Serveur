#!/usr/bin/env node

/**
 * Script d'analyse pour la base de données financial_analyst
 *
 * Problèmes identifiés :
 * - pg_stat_statements non activé
 * - Cache PostgreSQL sous-optimal
 *
 * Usage:
 *   node scripts/analyze_financial_analyst.js
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: 'financial_analyst',
});

async function analyzeDatabase() {
  console.log('📊 Analyse de la base financial_analyst...\n');

  try {
    // 1. Vérifier pg_stat_statements
    console.log('1️⃣ Vérification pg_stat_statements...');
    const pgStatResult = await pool.query(`
      SELECT EXISTS(
        SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'
      ) as installed
    `);

    if (!pgStatResult.rows[0].installed) {
      console.log('   ❌ pg_stat_statements NON installé\n');
      console.log('   📦 Installation requise:');
      console.log('   1. Ajouter à postgresql.conf: shared_preload_libraries = \'pg_stat_statements\'');
      console.log('   2. Redémarrer PostgreSQL');
      console.log('   3. CREATE EXTENSION pg_stat_statements;\n');
    } else {
      console.log('   ✅ pg_stat_statements installé\n');
    }

    // 2. Analyser le cache
    console.log('2️⃣ Analyse du cache PostgreSQL...');
    const cacheResult = await pool.query(`
      SELECT
        sum(heap_blks_read) as heap_read,
        sum(heap_blks_hit) as heap_hit,
        sum(heap_blks_hit) / NULLIF(sum(heap_blks_hit) + sum(heap_blks_read), 0) as heap_ratio,
        sum(idx_blks_read) as idx_read,
        sum(idx_blks_hit) as idx_hit,
        sum(idx_blks_hit) / NULLIF(sum(idx_blks_hit) + sum(idx_blks_read), 0) as idx_ratio
      FROM pg_statio_user_tables
    `);

    const cache = cacheResult.rows[0];
    const heapRatio = (cache.heap_ratio || 0) * 100;
    const idxRatio = (cache.idx_ratio || 0) * 100;

    console.log(`   Cache tables: ${heapRatio.toFixed(2)}%`);
    console.log(`   Cache index:  ${idxRatio.toFixed(2)}%`);

    if (heapRatio < 95 || idxRatio < 95) {
      console.log('   ⚠️ Cache sous-optimal détecté !\n');
      console.log('   💡 Recommandations:');
      console.log('   - Augmenter shared_buffers dans postgresql.conf');
      console.log('   - Augmenter effective_cache_size');
      console.log('   - Vérifier la mémoire RAM disponible\n');
    } else {
      console.log('   ✅ Cache correct\n');
    }

    // 3. Lister les tables
    console.log('3️⃣ Tables détectées...');
    const tablesResult = await pool.query(`
      SELECT
        schemaname,
        tablename,
        n_live_tup,
        n_dead_tup,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
    `);

    console.log(`   📋 ${tablesResult.rows.length} tables trouvées:\n`);
    tablesResult.rows.forEach((table, i) => {
      const deadTupPercent = table.n_live_tup > 0
        ? ((table.n_dead_tup / (table.n_live_tup + table.n_dead_tup)) * 100).toFixed(1)
        : 0;
      console.log(`   ${i + 1}. ${table.tablename} (${table.size})`);
      if (parseFloat(deadTupPercent) > 10) {
        console.log(`      ⚠️ ${deadTupPercent}% tuples morts - VACUUM recommandé`);
      }
    });

    // 4. Index non utilisés
    console.log('\n4️⃣ Analyse des index...');
    const indexResult = await pool.query(`
      SELECT
        i.tablename,
        i.indexname,
        pg_size_pretty(pg_relation_size(s.indexrelid)) as size,
        s.idx_scan as usage
      FROM pg_indexes i
      JOIN pg_stat_user_indexes s
        ON i.tablename = s.relname
        AND i.indexname = s.indexrelname
        AND i.schemaname = s.schemaname
      WHERE i.schemaname = 'public'
      ORDER BY s.idx_scan ASC
    `);

    const unusedIndexes = indexResult.rows.filter(idx => parseInt(idx.usage) === 0);
    if (unusedIndexes.length > 0) {
      console.log(`   🗑️ ${unusedIndexes.length} index non utilisés:`);
      unusedIndexes.forEach(idx => {
        console.log(`      - ${idx.indexname} sur ${idx.tablename} (${idx.size})`);
      });
    } else {
      console.log('   ✅ Tous les index sont utilisés');
    }

    console.log('\n✅ Analyse terminée\n');

  } catch (error) {
    console.error('❌ Erreur:', error.message);
  } finally {
    await pool.end();
  }
}

analyzeDatabase();
