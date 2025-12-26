import { Pool } from 'pg';

// Types pour les analyses d'optimisation
export interface SlowQuery {
  query: string;
  duration: number;
  calls: number;
  mean_time: number;
  total_time: number;
}

export interface IndexInfo {
  tablename: string;
  indexname: string;
  indexdef: string;
  size: string;
  usage: number;
}

export interface TableStats {
  tablename: string;
  seq_scan: number;
  seq_tup_read: number;
  idx_scan: number;
  idx_tup_fetch: number;
  n_tup_ins: number;
  n_tup_upd: number;
  n_tup_del: number;
  n_live_tup: number;
  n_dead_tup: number;
  last_vacuum?: string;
  last_autovacuum?: string;
  last_analyze?: string;
  last_autoanalyze?: string;
}

export interface MissingIndex {
  table: string;
  columns: string;
  suggested_index: string;
  potential_impact: 'HIGH' | 'MEDIUM' | 'LOW';
  estimated_gain: string;
}

// Classe pour l'optimisation de base de donnÃ©es
export class DBOptimizer {
  constructor(private pool: Pool) {}

  // Obtenir les requÃªtes lentes depuis pg_stat_statements
  async getSlowQueries(limit: number = 10): Promise<SlowQuery[]> {
    const query = `
      SELECT
        query,
        calls,
        total_exec_time as total_time,
        mean_exec_time as mean_time,
        total_exec_time / calls as avg_time
      FROM pg_stat_statements
      ORDER BY mean_exec_time DESC
      LIMIT $1
    `;

    try {
      const result = await this.pool.query(query, [limit]);
      return result.rows.map(row => ({
        query: row.query,
        duration: parseFloat(row.mean_time),
        calls: parseInt(row.calls),
        mean_time: parseFloat(row.mean_time),
        total_time: parseFloat(row.total_time)
      }));
    } catch (error: any) {
      throw new Error(`Erreur lors de la rÃ©cupÃ©ration des requÃªtes lentes: ${error.message}`);
    }
  }

  // Analyser l'utilisation des index
  async analyzeIndexUsage(): Promise<IndexInfo[]> {
    const query = `
      SELECT
        i.schemaname,
        i.tablename,
        i.indexname,
        i.indexdef,
        pg_size_pretty(pg_relation_size(s.indexrelid)) as size,
        s.idx_scan as usage
      FROM pg_indexes i
      JOIN pg_stat_user_indexes s ON i.tablename = s.relname AND i.indexname = s.indexrelname AND i.schemaname = s.schemaname
      WHERE i.schemaname = 'public'
      ORDER BY s.idx_scan ASC, pg_relation_size(s.indexrelid) DESC
    `;

    try {
      const result = await this.pool.query(query);
      return result.rows.map(row => ({
        tablename: row.tablename,
        indexname: row.indexname,
        indexdef: row.indexdef,
        size: row.size,
        usage: parseInt(row.usage || 0)
      }));
    } catch (error: any) {
      throw new Error(`Erreur lors de l'analyse des index: ${error.message}`);
    }
  }

  // Obtenir les statistiques des tables
  async getTableStatistics(): Promise<TableStats[]> {
    const query = `
      SELECT
        schemaname,
        relname as tablename,
        seq_scan,
        seq_tup_read,
        idx_scan,
        idx_tup_fetch,
        n_tup_ins,
        n_tup_upd,
        n_tup_del,
        n_live_tup,
        n_dead_tup,
        last_vacuum,
        last_autovacuum,
        last_analyze,
        last_autoanalyze,
        vacuum_count,
        autovacuum_count,
        analyze_count,
        autoanalyze_count
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      ORDER BY (n_dead_tup::float / GREATEST(n_live_tup + n_dead_tup, 1)) DESC
    `;

    try {
      const result = await this.pool.query(query);
      return result.rows.map(row => ({
        tablename: row.tablename,
        seq_scan: parseInt(row.seq_scan || 0),
        seq_tup_read: parseInt(row.seq_tup_read || 0),
        idx_scan: parseInt(row.idx_scan || 0),
        idx_tup_fetch: parseInt(row.idx_tup_fetch || 0),
        n_tup_ins: parseInt(row.n_tup_ins || 0),
        n_tup_upd: parseInt(row.n_tup_upd || 0),
        n_tup_del: parseInt(row.n_tup_del || 0),
        n_live_tup: parseInt(row.n_live_tup || 0),
        n_dead_tup: parseInt(row.n_dead_tup || 0),
        last_vacuum: row.last_vacuum,
        last_autovacuum: row.last_autovacuum,
        last_analyze: row.last_analyze,
        last_autoanalyze: row.last_autoanalyze
      }));
    } catch (error: any) {
      throw new Error(`Erreur lors de la rÃ©cupÃ©ration des statistiques: ${error.message}`);
    }
  }

  // SuggÃ©rer des index manquants basÃ©s sur les requÃªtes lentes
  async suggestMissingIndexes(): Promise<MissingIndex[]> {
    const suggestions: MissingIndex[] = [];

    // Analyser les requÃªtes avec beaucoup de seq_scan
    const tablesWithHighSeqScan = await this.pool.query(`
      SELECT
        relname as tablename,
        seq_scan,
        seq_tup_read
      FROM pg_stat_user_tables
      WHERE seq_scan > 1000
        AND seq_tup_read > 10000
      ORDER BY seq_scan DESC
    `);

    for (const table of tablesWithHighSeqScan.rows) {
      // SuggÃ©rer des index basÃ©s sur les colonnes frÃ©quemment utilisÃ©es dans WHERE
      const commonWhereColumns = await this.pool.query(`
        SELECT
          attname as column_name
        FROM pg_attribute a
        JOIN pg_class c ON a.attrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE c.relname = $1
          AND n.nspname = 'public'
          AND a.attnum > 0
          AND NOT a.attisdropped
          AND a.attnotnull = true
        ORDER BY a.attnum
      `, [table.tablename]);

      if (commonWhereColumns.rows.length > 0) {
        const columns = commonWhereColumns.rows
          .slice(0, 3) // Prendre les 3 premiÃ¨res colonnes
          .map(col => col.column_name)
          .join(', ');

        suggestions.push({
          table: table.tablename,
          columns,
          suggested_index: `CREATE INDEX idx_${table.tablename}_${commonWhereColumns.rows[0].column_name} ON ${table.tablename} (${columns});`,
          potential_impact: table.seq_scan > 10000 ? 'HIGH' : 'MEDIUM',
          estimated_gain: `RÃ©duction potentielle de ${Math.round((table.seq_scan / (table.seq_scan + 100)) * 100)}% des sequential scans`
        });
      }
    }

    return suggestions;
  }

  // Analyser les tables qui nÃ©cessitent un VACUUM
  async getTablesNeedingVacuum(): Promise<any[]> {
    const query = `
      SELECT
        schemaname,
        relname as tablename,
        n_live_tup,
        n_dead_tup,
        (n_dead_tup::float / GREATEST(n_live_tup + n_dead_tup, 1)) * 100 as dead_tuple_percent,
        last_vacuum,
        last_autovacuum,
        last_analyze,
        last_autoanalyze,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||relname)) as table_size
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
        AND n_dead_tup > 1000
        AND (n_dead_tup::float / GREATEST(n_live_tup + n_dead_tup, 1)) > 0.1
      ORDER BY dead_tuple_percent DESC
    `;

    try {
      const result = await this.pool.query(query);
      // Formatter dead_tuple_percent en JavaScript (plus compatible)
      return result.rows.map(row => ({
        ...row,
        dead_tuple_percent: parseFloat(row.dead_tuple_percent || 0).toFixed(2)
      }));
    } catch (error: any) {
      throw new Error(`Erreur lors de l'analyse VACUUM: ${error.message}`);
    }
  }

  // Obtenir les informations de cache
  async getCacheHitRatios(): Promise<any> {
    const query = `
      SELECT
        sum(heap_blks_read) as heap_read,
        sum(heap_blks_hit) as heap_hit,
        sum(heap_blks_hit) / nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0) as heap_ratio,
        sum(idx_blks_read) as idx_read,
        sum(idx_blks_hit) as idx_hit,
        sum(idx_blks_hit) / nullif(sum(idx_blks_hit) + sum(idx_blks_read), 0) as idx_ratio
      FROM pg_statio_user_tables;
    `;

    try {
      const result = await this.pool.query(query);
      return result.rows[0];
    } catch (error: any) {
      throw new Error(`Erreur lors de l'analyse du cache: ${error.message}`);
    }
  }

  // Analyser les locks actifs
  async getActiveLocks(): Promise<any[]> {
    const query = `
      SELECT
        t.relname as table_name,
        l.mode,
        l.granted,
        a.usename as username,
        a.query,
        a.query_start,
        now() - a.query_start as duration
      FROM pg_locks l
      JOIN pg_class t ON l.relation = t.oid
      JOIN pg_stat_activity a ON l.pid = a.pid
      WHERE t.relname IS NOT NULL
        AND l.mode NOT IN ('AccessShareLock')
      ORDER BY a.query_start;
    `;

    try {
      const result = await this.pool.query(query);
      return result.rows;
    } catch (error: any) {
      throw new Error(`Erreur lors de l'analyse des locks: ${error.message}`);
    }
  }

  // Analyser les requÃªtes en cours d'exÃ©cution
  async getRunningQueries(): Promise<any[]> {
    const query = `
      SELECT
        pid,
        usename as username,
        application_name,
        client_addr,
        state,
        query,
        query_start,
        now() - query_start as duration,
        wait_event_type,
        wait_event
      FROM pg_stat_activity
      WHERE state != 'idle'
        AND query NOT LIKE '%pg_stat_activity%'
      ORDER BY query_start;
    `;

    try {
      const result = await this.pool.query(query);
      return result.rows;
    } catch (error: any) {
      throw new Error(`Erreur lors de l'analyse des requÃªtes: ${error.message}`);
    }
  }

  // GÃ©nÃ©rer un rapport d'optimisation complet
  async generateOptimizationReport(): Promise<string> {
    try {
      const report = [];

      report.push('# ðŸ“Š Rapport d\'Optimisation PostgreSQL\n');
      report.push(`*GÃ©nÃ©rÃ© le ${new Date().toLocaleString('fr-FR')}*\n`);

      // 1. Cache Hit Ratios
      const cacheStats = await this.getCacheHitRatios();
      report.push('## ðŸŽ¯ Performance du Cache');
      report.push(`- **Cache tables**: ${((cacheStats.heap_ratio || 0) * 100).toFixed(2)}%`);
      report.push(`- **Cache index**: ${((cacheStats.idx_ratio || 0) * 100).toFixed(2)}%`);

      if ((cacheStats.heap_ratio || 0) < 0.95) {
        report.push('âš ï¸  **Recommandation**: Augmenter shared_buffers pour amÃ©liorer le cache hit ratio');
      }
      report.push('');

      // 2. Tables nÃ©cessitant un VACUUM
      const vacuumTables = await this.getTablesNeedingVacuum();
      if (vacuumTables.length > 0) {
        report.push('## ðŸ§¹ Tables nÃ©cessitant un VACUUM');
        vacuumTables.slice(0, 5).forEach(table => {
          report.push(`- **${table.tablename}**: ${table.dead_tuple_percent}% de tuples morts (${table.table_size})`);
        });
        report.push('');
      }

      // 3. Index non utilisÃ©s
      const unusedIndexes = await this.analyzeIndexUsage();
      const unused = unusedIndexes.filter(idx => idx.usage === 0);
      if (unused.length > 0) {
        report.push('## ðŸ—‘ï¸  Index non utilisÃ©s');
        unused.slice(0, 3).forEach(idx => {
          report.push(`- **${idx.indexname}** sur ${idx.tablename} (${idx.size})`);
        });
        report.push('ðŸ’¡ **Action**: ConsidÃ©rez supprimer ces index pour amÃ©liorer les performances d\'Ã©criture');
        report.push('');
      }

      // 4. RequÃªtes lentes (si pg_stat_statements est activÃ©)
      try {
        const slowQueries = await this.getSlowQueries(3);
        if (slowQueries.length > 0) {
          report.push('## ðŸ Œ RequÃªtes lentes');
          slowQueries.forEach((query, index) => {
            report.push(`${index + 1}. **Temps moyen**: ${query.duration.toFixed(2)}ms (${query.calls} appels)`);
            report.push(`   \`\`\`sql\n${query.query.substring(0, 100)}...\n   \`\`\``);
          });
          report.push('');
        }
      } catch (e) {
        // pg_stat_statements n'est peut-Ãªtre pas activÃ©
        report.push('## ðŸ“ˆ Note');
        report.push('Activer `pg_stat_statements` pour analyser les requÃªtes lentes');
        report.push('');
      }

      // 5. Suggestions d'index
      const missingIndexes = await this.suggestMissingIndexes();
      if (missingIndexes.length > 0) {
        report.push('## ðŸ’¡ Suggestions d\'index');
        missingIndexes.slice(0, 3).forEach(idx => {
          report.push(`- **${idx.table}** (${idx.potential_impact} impact)`);
          report.push(`  ${idx.suggested_index}`);
        });
        report.push('');
      }

      // 6. RequÃªtes actives et locks
      const activeQueries = await this.getRunningQueries();
      const activeLocks = await this.getActiveLocks();

      if (activeQueries.length > 0 || activeLocks.length > 0) {
        report.push('## âš¡ ActivitÃ© actuelle');
        if (activeQueries.length > 0) {
          report.push(`- **${activeQueries.length} requÃªte(s) en cours d'exÃ©cution**`);
        }
        if (activeLocks.length > 0) {
          report.push(`- **${activeLocks.length} lock(s) actif(s)**`);
        }
        report.push('');
      }

      return report.join('\n');
    } catch (error: any) {
      return `â Œ Erreur lors de la gÃ©nÃ©ration du rapport: ${error.message}`;
    }
  }
}
