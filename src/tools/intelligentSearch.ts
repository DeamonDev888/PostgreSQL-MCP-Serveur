#!/usr/bin/env node

import { FastMCP } from "fastmcp";
import { z } from "zod";
import { Pool } from "pg";
import { toolLogger } from "../utils/logger.js";
import { IntelligentSearchService } from "../services/intelligentSearchService.js";

/**
 * Outil MCP de recherche intelligente
 * Route automatiquement les requêtes vers le meilleur mode
 */
export class IntelligentSearchTools {
  private pool: Pool;
  private server: FastMCP;
  private searchService: IntelligentSearchService;

  constructor(pool: Pool, server: FastMCP) {
    this.pool = pool;
    this.server = server;
    this.searchService = new IntelligentSearchService(pool);
  }

  registerTools(): void {
    this.intelligentSearch();
    this.searchWithMode();
    this.analyzeQuery();
    this.benchmarkSearch();
    this.getSuggestions();

    toolLogger.info("✅ Outils de recherche intelligente enregistrés (5 outils)");
  }

  /**
   * Recherche intelligente avec détection automatique du mode
   */
  private intelligentSearch(): void {
    this.server.addTool({
      name: "intelligent_search",
      description:
        "Recherche intelligente avec détection automatique du mode optimal",
      parameters: z.object({
        query: z.string().describe("Requête de recherche"),
        tableName: z.string().describe("Nom de la table"),
        mode: z
          .enum(["auto", "hybrid", "vector", "text"])
          .optional()
          .default("auto")
          .describe("Mode de recherche (auto = automatique)"),
        topK: z.number().optional().default(10).describe("Nombre de résultats"),
        enableCache: z
          .boolean()
          .optional()
          .default(true)
          .describe("Utiliser le cache d'embeddings"),
      }),
      execute: async (args) => {
        try {
          const result = await this.searchService.search(args.query, {
            tableName: args.tableName,
            mode: args.mode,
            topK: args.topK,
            enableCache: args.enableCache,
          });

          // Formatter la sortie
          let output = `🔍 **Recherche Intelligente**\n\n`;
          output += `📝 Requête: "${args.query}"\n`;
          output += `🎯 Mode: ${result.metadata.actualMode}\n`;
          output += `⏱️ Temps: ${result.metadata.executionTime}ms\n`;
          output += `📊 Résultats: ${result.results.length}\n`;

          if (result.metadata.embeddingGenerated) {
            output += `🧠 Embedding: ${result.metadata.embeddingGenerated ? "Oui" : "Non"}\n`;
            if (result.metadata.cacheHit) {
              output += `📦 Cache: Hit ✅\n`;
            }
          }

          output += `\n---\n\n`;

          if (result.results.length > 0) {
            result.results.forEach((row: any, index: number) => {
              const similarity = row.similarity
                ? (row.similarity * 100).toFixed(1)
                : "N/A";
              const rank = row.rank || index + 1;
              const score = row.final_score
                ? (row.final_score * 100).toFixed(1)
                : similarity;

              output += `**${rank}.** Score: ${score}%`;
              if (row.similarity && row.final_score) {
                output += ` (Vecteur: ${similarity}%, Hybride: ${score}%)`;
              }
              output += `\n`;

              // Afficher le contenu (tronqué)
              const content =
                row.content || row.title || JSON.stringify(row, null, 2);
              if (content && typeof content === "string") {
                const displayContent =
                  content.length > 200
                    ? content.substring(0, 200) + "..."
                    : content;
                output += `   ${displayContent}\n\n`;
              }
            });
          } else {
            output += `❌ Aucun résultat trouvé\n\n`;
            output += `💡 **Suggestions:**\n`;
            output += `• Vérifiez l'orthographe\n`;
            output += `• Utilisez des mots-clés plus généraux\n`;
            output += `• Essayez un mode différent (text, vector, hybrid)\n`;
          }

          // Conseils d'optimisation
          output += `\n---\n`;
          output += `💡 **Mode ${result.metadata.actualMode}:**\n`;
          switch (result.metadata.actualMode) {
            case "random":
              output += `Mode test activé - résultats aléatoires pour débogage\n`;
              break;
            case "text":
              output += `Recherche full-text - rapide mais moins précise\n`;
              break;
            case "vector":
              output += `Recherche sémantique - précise mais plus lente\n`;
              break;
            case "hybrid":
              output += `Recherche hybride - meilleur des 2 mondes !\n`;
              break;
          }

          return output;
        } catch (error: any) {
          toolLogger.error({ err: error, tool: "intelligent_search", query: args.query }, "Error in intelligent_search tool execution");
          return `❌ Erreur: ${error.message}`;
        }
      },
    });
  }

  /**
   * Recherche avec mode explicite
   */
  private searchWithMode(): void {
    this.server.addTool({
      name: "search_with_mode",
      description: "Force un mode de recherche spécifique",
      parameters: z.object({
        query: z.string().describe("Requête de recherche"),
        tableName: z.string().describe("Nom de la table"),
        mode: z.enum(["text", "vector", "hybrid"]).describe("Mode forcé"),
        topK: z.number().optional().default(10).describe("Nombre de résultats"),
      }),
      execute: async (args) => {
        try {
          const result = await this.searchService.search(args.query, {
            tableName: args.tableName,
            mode: args.mode,
            topK: args.topK,
          });

          let output = `🔍 **Recherche ${args.mode.toUpperCase()}**\n\n`;
          output += `📝 Requête: "${args.query}"\n`;
          output += `⚡ Mode forcé: ${args.mode}\n`;
          output += `⏱️ Temps: ${result.metadata.executionTime}ms\n`;
          output += `📊 Résultats: ${result.results.length}\n\n`;

          result.results.forEach((row: any, index: number) => {
            const similarity = row.similarity
              ? (row.similarity * 100).toFixed(1)
              : "N/A";
            output += `**${index + 1}.** Similarité: ${similarity}%\n`;
            if (row.content) {
              const content =
                row.content.substring(0, 150) +
                (row.content.length > 150 ? "..." : "");
              output += `   ${content}\n\n`;
            }
          });

          return output;
        } catch (error: any) {
          toolLogger.error({ err: error, tool: "search_with_mode", mode: args.mode }, "Error in search_with_mode tool execution");
          return `❌ Erreur: ${error.message}`;
        }
      },
    });
  }

  /**
   * Analyse une requête et suggère le mode optimal
   */
  private analyzeQuery(): void {
    this.server.addTool({
      name: "analyze_query",
      description: "Analyse une requête et recommande le mode optimal",
      parameters: z.object({
        query: z.string().describe("Requête à analyser"),
      }),
      execute: async (args) => {
        try {
          const analysis = await this.searchService.analyzeQuery(args.query);

          let output = `🔬 **Analyse de Requête**\n\n`;
          output += `📝 Requête: "${args.query}"\n`;
          output += `🎯 Mode recommandé: **${analysis.mode}**\n`;
          output += `🎚️ Confiance: ${(analysis.confidence * 100).toFixed(0)}%\n\n`;

          if (analysis.reasoning.length > 0) {
            output += `🧠 **Analyse:**\n`;
            analysis.reasoning.forEach((reason, index) => {
              output += `${index + 1}. ${reason}\n`;
            });
            output += `\n`;
          }

          if (analysis.suggestions.length > 0) {
            output += `💡 **Suggestions:**\n`;
            analysis.suggestions.forEach((suggestion, index) => {
              output += `${index + 1}. ${suggestion}\n`;
            });
          }

          output += `\n---\n`;
          output += `📊 **Modes disponibles:**\n`;
          output += `• **random** - Tests et débogage\n`;
          output += `• **text** - Full-text PostgreSQL (rapide)\n`;
          output += `• **vector** - Recherche sémantique (précise)\n`;
          output += `• **hybrid** - Combinaison text+vecteur (optimal)\n`;

          return output;
        } catch (error: any) {
          toolLogger.error({ err: error, tool: "analyze_query" }, "Error in analyze_query tool execution");
          return `❌ Erreur: ${error.message}`;
        }
      },
    });
  }

  /**
   * Benchmark des modes de recherche
   */
  private benchmarkSearch(): void {
    this.server.addTool({
      name: "benchmark_search",
      description:
        "Benchmark des performances des différents modes de recherche",
      parameters: z.object({
        tableName: z.string().describe("Nom de la table à tester"),
        testQueries: z.array(z.string()).describe("Liste de requêtes de test"),
        iterations: z
          .number()
          .optional()
          .default(3)
          .describe("Nombre d'itérations"),
      }),
      execute: async (args) => {
        try {
          const results = await this.searchService.benchmark(
            args.testQueries,
            args.tableName,
            args.iterations,
          );

          let output = `🧪 **Benchmark des Modes de Recherche**\n\n`;
          output += `📊 Table: ${args.tableName}\n`;
          output += `🔄 Itérations: ${args.iterations}\n`;
          output += `📝 Requêtes testées: ${args.testQueries.length}\n\n`;

          output += `| Mode | Temps Moyen | Taux de Succès |\n`;
          output += `|------|-------------|----------------|\n`;
          output += `| Text | ${results.text.avgTime.toFixed(2)}ms | ${results.text.successRate.toFixed(1)}% |\n`;
          output += `| Vector | ${results.vector.avgTime.toFixed(2)}ms | ${results.vector.successRate.toFixed(1)}% |\n`;
          output += `| Hybrid | ${results.hybrid.avgTime.toFixed(2)}ms | ${results.hybrid.successRate.toFixed(1)}% |\n\n`;

          // Recommandation
          const fastest = Object.entries(results).reduce((a, b) =>
            results[a[0] as keyof typeof results].avgTime <
            results[b[0] as keyof typeof results].avgTime
              ? a
              : b,
          )[0];

          output += `🏆 **Le plus rapide:** ${fastest}\n`;
          output += `💡 **Recommandation:** Utilisez le mode \`${fastest}\` pour cette table\n\n`;

          // Conseils
          output += `💡 **Conseils:**\n`;
          if (results.text.avgTime < results.vector.avgTime) {
            output += `• Le full-text est plus rapide - utilisez-le pour les requêtes simples\n`;
          }
          if (results.hybrid.avgTime < results.vector.avgTime) {
            output += `• L'hybride est plus rapide que le vecteur seul - privilégiez-le\n`;
          }
          if (results.vector.successRate > results.text.successRate) {
            output += `• Le vecteur est plus précis - utilisez-le pour les requêtes complexes\n`;
          }

          return output;
        } catch (error: any) {
          toolLogger.error({ err: error, tool: "benchmark_search" }, "Error in benchmark_search tool execution");
          return `❌ Erreur: ${error.message}`;
        }
      },
    });
  }

  /**
   * Suggestions de requêtes
   */
  private getSuggestions(): void {
    this.server.addTool({
      name: "get_search_suggestions",
      description: "Obtenir des suggestions de requêtes",
      parameters: z.object({
        partialQuery: z.string().describe("Requête partielle"),
        tableName: z.string().describe("Nom de la table"),
        limit: z
          .number()
          .optional()
          .default(5)
          .describe("Nombre de suggestions"),
      }),
      execute: async (args) => {
        try {
          const suggestions = await this.searchService.getSuggestions(
            args.partialQuery,
            args.tableName,
            "content",
            args.limit,
          );

          let output = `💡 **Suggestions de Requêtes**\n\n`;
          output += `🔍 Requête partielle: "${args.partialQuery}"\n`;
          output += `📊 Trouvé: ${suggestions.length} suggestions\n\n`;

          if (suggestions.length > 0) {
            output += `**Suggestions:**\n`;
            suggestions.forEach((suggestion: string, index: number) => {
              output += `${index + 1}. ${suggestion}\n`;
            });
          } else {
            output += `❌ Aucune suggestion trouvée\n`;
          }

          return output;
        } catch (error: any) {
          toolLogger.error({ err: error, tool: "get_search_suggestions" }, "Error in get_search_suggestions tool execution");
          return `❌ Erreur: ${error.message}`;
        }
      },
    });
  }
}
