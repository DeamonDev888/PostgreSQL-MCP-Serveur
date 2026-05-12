import { Pool } from "pg";
import Logger from "../utils/logger.js";

export interface SchemaFix {
  table: string;
  column: string;
  targetType: string;
  status: "PENDING" | "FIXED" | "ERROR" | "SKIPPED";
  error?: string;
}

/**
 * Service pour la gestion et l'harmonisation du schéma DB.
 * Gère notamment la migration vers TIMESTAMPTZ et les dépendances de vues.
 */
export class SchemaManagerService {
  constructor(private pool: Pool) {}

  /**
   * Vérifie et harmonise les colonnes temporelles
   */
  async harmonizeTimestamps(): Promise<SchemaFix[]> {
    const targets = [
      { table: "system_combats", column: "timestamp" },
      { table: "news", column: "timestamp" },
      { table: "verdict_execution_log", column: "timestamp" },
      { table: "semantic_context", column: "timestamp" },
      { table: "semantic_context", column: "recorded_at" }
    ];

    const results: SchemaFix[] = [];

    for (const target of targets) {
      const fix: SchemaFix = {
        ...target,
        targetType: "TIMESTAMPTZ",
        status: "PENDING"
      };

      try {
        // 1. Vérifier si la table existe
        const tableCheck = await this.pool.query(
          "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)",
          [target.table]
        );

        if (!tableCheck.rows[0].exists) {
          fix.status = "SKIPPED";
          fix.error = "Table non trouvée";
          results.push(fix);
          continue;
        }

        // 2. Vérifier le type actuel
        const typeCheck = await this.pool.query(
          "SELECT data_type FROM information_schema.columns WHERE table_name = $1 AND column_name = $2",
          [target.table, target.column]
        );

        if (typeCheck.rows.length === 0) {
          fix.status = "SKIPPED";
          fix.error = "Colonne non trouvée";
          results.push(fix);
          continue;
        }

        const currentType = typeCheck.rows[0].data_type.toUpperCase();
        if (currentType === "TIMESTAMP WITH TIME ZONE" || currentType === "TIMESTAMPTZ") {
          fix.status = "FIXED"; // Déjà correct
          results.push(fix);
          continue;
        }

        // 3. Appliquer le fix avec gestion des dépendances
        await this.applyTypeFix(target.table, target.column, "TIMESTAMPTZ");
        fix.status = "FIXED";
      } catch (err: any) {
        Logger.error(`❌ Erreur fix ${target.table}.${target.column}:`, err.message);
        fix.status = "ERROR";
        fix.error = err.message;
      }
      results.push(fix);
    }

    return results;
  }

  /**
   * Applique un changement de type en gérant les dépendances (vues)
   */
  private async applyTypeFix(table: string, column: string, newType: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Trouver les vues dépendantes
      const dependentViews = await client.query(`
        SELECT DISTINCT dependent_view.relname as view_name, 
               pg_get_viewdef(dependent_view.oid) as view_def
        FROM pg_rewrite rw
        JOIN pg_class dependent_view ON rw.ev_class = dependent_view.oid
        JOIN pg_depend d ON rw.oid = d.objid
        JOIN pg_class source_table ON d.refobjid = source_table.oid
        WHERE source_table.relname = $1
          AND dependent_view.relkind = 'v'
      `, [table]);

      // 2. Dropper les vues temporairement
      for (const view of dependentViews.rows) {
        Logger.info(`🗑️ Dropping dependent view: ${view.view_name}`);
        await client.query(`DROP VIEW IF EXISTS ${view.view_name} CASCADE`);
      }

      // 3. Altérer la colonne
      Logger.info(`🔧 Altering ${table}.${column} to ${newType}`);
      await client.query(`
        ALTER TABLE ${table} 
        ALTER COLUMN ${column} TYPE ${newType} 
        USING ${column} AT TIME ZONE 'UTC'
      `);

      // 4. Recréer les vues
      for (const view of dependentViews.rows) {
        Logger.info(`🔨 Recreating view: ${view.view_name}`);
        await client.query(`CREATE VIEW ${view.view_name} AS ${view.view_def}`);
      }

      await client.query("COMMIT");
      Logger.info(`✅ Successfully migrated ${table}.${column} to ${newType}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Vérifie l'intégrité globale du schéma pour les outils MCP
   */
  async checkSchemaIntegrity(): Promise<{ 
    valid: boolean; 
    issues: string[];
    details: any;
  }> {
    const issues: string[] = [];
    const details: any = {};

    // Vérifier tables essentielles pour Intelligent Search
    const essentialTables = ["documents", "semantic_context", "news"];
    for (const table of essentialTables) {
      const res = await this.pool.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)",
        [table]
      );
      details[table] = { exists: res.rows[0].exists };
      if (!res.rows[0].exists) {
        issues.push(`Table manquante: ${table}`);
      }
    }

    // Vérifier extension pgvector
    const vectorCheck = await this.pool.query(
      "SELECT 1 FROM pg_extension WHERE extname = 'vector'"
    );
    details.pgvector = { installed: vectorCheck.rows.length > 0 };
    if (vectorCheck.rows.length === 0) {
      issues.push("Extension pgvector non installée");
    }

    return {
      valid: issues.length === 0,
      issues,
      details
    };
  }
}
