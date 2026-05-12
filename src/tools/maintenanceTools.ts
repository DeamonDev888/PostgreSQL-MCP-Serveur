import { FastMCP } from "fastmcp";
import { z } from "zod";
import { Pool } from "pg";
import { SchemaManagerService } from "../services/schemaManagerService.js";
import Logger from "../utils/logger.js";

export class MaintenanceTools {
  private schemaManager: SchemaManagerService;

  constructor(private pool: Pool, private server: FastMCP) {
    this.schemaManager = new SchemaManagerService(pool);
  }

  registerTools() {
    /**
     * Tool: MCP_DB_MAINTENANCE
     * Exécute les tâches de maintenance et d'harmonisation du schéma.
     */
    this.server.addTool({
      name: "mcp_db_maintenance",
      description: "🔧 Exécute les tâches de maintenance (harmonisation TIMESTAMPTZ, vérification intégrité)",
      parameters: z.object({
        action: z
          .enum(["harmonize", "check", "full"])
          .describe("Action à effectuer"),
      }),
      execute: async (args: { action: string }) => {
        try {
          const action = args.action as "harmonize" | "check" | "full";
          Logger.info(`🔧 [MAINTENANCE] Execution action: ${action}`);

          const report: any = {
            timestamp: new Date().toISOString(),
            action,
            results: {}
          };

          if (action === "check" || action === "full") {
            report.results.integrity = await this.schemaManager.checkSchemaIntegrity();
          }

          if (action === "harmonize" || action === "full") {
            report.results.harmonization = await this.schemaManager.harmonizeTimestamps();
          }

          return JSON.stringify(report, null, 2);
        } catch (error: any) {
          Logger.error("❌ [MAINTENANCE] Error:", error.message);
          return `Erreur maintenance: ${error.message}`;
        }
      }
    });
  }
}
