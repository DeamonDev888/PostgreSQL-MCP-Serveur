import { z } from 'zod';

// Types pour la validation SQL
export interface SQLValidationResult {
  valid: boolean;
  error?: string;
  analysis?: string;
  suggestion?: string;
}

// Mots-clés dangereux qui nécessitent une attention particulière
const DANGEROUS_KEYWORDS = [
  'DROP', 'DELETE', 'TRUNCATE', 'UPDATE', 'INSERT', 'CREATE', 'ALTER',
  'GRANT', 'REVOKE', 'EXECUTE', 'UNION', 'EXEC', 'sp_executesql'
];

// Validation basique de syntaxe SQL
export function validateSQL(query: string): SQLValidationResult {
  if (!query || query.trim().length === 0) {
    return {
      valid: false,
      error: 'La requête SQL est vide',
      suggestion: 'Veuillez fournir une requête SQL valide'
    };
  }

  const trimmedQuery = query.trim().toUpperCase();

  // Vérifier les parenthèses
  const openParens = (query.match(/\(/g) || []).length;
  const closeParens = (query.match(/\)/g) || []).length;

  if (openParens !== closeParens) {
    return {
      valid: false,
      error: 'Parenthèses non équilibrées',
      suggestion: 'Vérifiez que toutes les parenthèses ouvertes sont fermées'
    };
  }

  // Vérifier les guillemets
  const singleQuotes = (query.match(/'/g) || []).length;
  if (singleQuotes % 2 !== 0) {
    return {
      valid: false,
      error: 'Guillemets simples non équilibrés',
      suggestion: 'Vérifiez que toutes les chaînes de caractères sont correctement quotées'
    };
  }

  // Analyser le type de requête
  let analysis = '';
  let warnings: string[] = [];

  if (trimmedQuery.startsWith('SELECT')) {
    analysis = 'Requête de sélection de données';

    // Vérifier les potentiels problèmes de performance
    if (trimmedQuery.includes('SELECT *')) {
      warnings.push('SELECT * peut retourner plus de colonnes que nécessaire');
    }

    if (!trimmedQuery.includes('WHERE') && !trimmedQuery.includes('LIMIT')) {
      warnings.push('Considérez ajouter une clause WHERE ou LIMIT pour limiter les résultats');
    }

    if (trimmedQuery.includes('ORDER BY') && !trimmedQuery.includes('LIMIT')) {
      warnings.push('ORDER BY sans LIMIT peut être coûteux sur de grands jeux de données');
    }
  } else if (trimmedQuery.startsWith('INSERT')) {
    analysis = 'Requête d\'insertion de données';
    warnings.push('Les requêtes d\'écriture modifient la base de données');
  } else if (trimmedQuery.startsWith('UPDATE')) {
    analysis = 'Requête de mise à jour de données';
    if (!trimmedQuery.includes('WHERE')) {
      warnings.push('UPDATE sans WHERE va modifier toutes les lignes !');
    }
  } else if (trimmedQuery.startsWith('DELETE')) {
    analysis = 'Requête de suppression de données';
    if (!trimmedQuery.includes('WHERE')) {
      warnings.push('DELETE sans WHERE va supprimer toutes les lignes !');
    }
  } else if (trimmedQuery.startsWith('DROP')) {
    analysis = 'Requête de suppression d\'objet (table, vue, etc.)';
    warnings.push('DROP est une opération irréversible !');
  } else if (trimmedQuery.startsWith('CREATE')) {
    analysis = 'Requête de création d\'objet';
  } else if (trimmedQuery.startsWith('ALTER')) {
    analysis = 'Requête de modification de structure';
    warnings.push('ALTER modifie la structure de la base de données');
  } else if (trimmedQuery.startsWith('EXPLAIN')) {
    analysis = 'Requête d\'analyse de plan d\'exécution';
  } else {
    analysis = 'Type de requête non identifié';
  }

  // Vérifier les mots-clés potentiellement dangereux
  const foundDangerous = DANGEROUS_KEYWORDS.filter(keyword =>
    trimmedQuery.includes(keyword) && !trimmedQuery.startsWith('SELECT') || keyword === 'UNION'
  );

  if (foundDangerous.length > 0) {
    warnings.push(`Mots-clés sensibles détectés: ${foundDangerous.join(', ')}`);
  }

  // Construire la suggestion si il y a des avertissements
  let suggestion = '';
  if (warnings.length > 0) {
    suggestion = warnings.join('\n');
  } else {
    suggestion = 'La requête semble syntaxiquement correcte';
  }

  return {
    valid: true,
    analysis: `${analysis}${warnings.length > 0 ? '\n\n⚠️ Avertissements:' : ''}`,
    suggestion
  };
}

// Formater une requête SQL (basique)
export function formatSQL(query: string): string {
  if (!query) return '';

  // Mettre en majuscules les mots-clés SQL principaux
  const keywords = [
    'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN',
    'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'DROP',
    'ALTER', 'TABLE', 'INDEX', 'VIEW', 'AS', 'JOIN', 'INNER', 'LEFT', 'RIGHT',
    'OUTER', 'ON', 'GROUP', 'BY', 'HAVING', 'ORDER', 'ASC', 'DESC', 'LIMIT',
    'OFFSET', 'UNION', 'ALL', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
    'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'IF', 'NULL', 'IS',
    'TRUE', 'FALSE', 'AND', 'OR', 'XOR'
  ];

  let formatted = query;

  // Mettre en majuscules les mots-clés (en évitant les valeurs littérales)
  keywords.forEach(keyword => {
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    formatted = formatted.replace(regex, keyword);
  });

  // Ajouter des sauts de ligne après les mots-clés principaux
  const lineBreakKeywords = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY'];
  lineBreakKeywords.forEach(keyword => {
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    formatted = formatted.replace(regex, `\n${keyword}`);
  });

  // Nettoyer les espaces multiples
  formatted = formatted.replace(/\s+/g, ' ').trim();

  return formatted;
}

// Analyser une requête pour extraire des informations
export function analyzeQuery(query: string): {
  tables: string[];
  columns: string[];
  operations: string[];
  estimatedComplexity: 'LOW' | 'MEDIUM' | 'HIGH';
} {
  const tables: string[] = [];
  const columns: string[] = [];
  const operations: string[] = [];
  let estimatedComplexity: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';

  const upperQuery = query.toUpperCase();

  // Extraire les opérations
  if (upperQuery.includes('SELECT')) operations.push('SELECT');
  if (upperQuery.includes('INSERT')) operations.push('INSERT');
  if (upperQuery.includes('UPDATE')) operations.push('UPDATE');
  if (upperQuery.includes('DELETE')) operations.push('DELETE');
  if (upperQuery.includes('JOIN')) operations.push('JOIN');
  if (upperQuery.includes('UNION')) operations.push('UNION');
  if (upperQuery.includes('SUBQUERY') || upperQuery.match(/\(.*SELECT.*\)/)) {
    operations.push('SUBQUERY');
  }

  // Extraire les tables (simplifié)
  const fromMatch = query.match(/FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
  if (fromMatch) tables.push(fromMatch[1]);

  const joinMatches = query.match(/JOIN\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi);
  if (joinMatches) {
    joinMatches.forEach(match => {
      const tableName = match.replace(/JOIN\s+/i, '').trim();
      tables.push(tableName);
    });
  }

  // Extraire les colonnes (simplifié)
  const selectMatch = query.match(/SELECT\s+(.*?)\s+FROM/i);
  if (selectMatch) {
    const selectPart = selectMatch[1];
    if (selectPart !== '*') {
      const cols = selectPart.split(',').map(col => col.trim().split(/\s+/)[0]);
      columns.push(...cols);
    }
  }

  // Estimer la complexité
  let complexityScore = 0;

  // Opérations de jointure
  complexityScore += (upperQuery.match(/JOIN/g) || []).length * 2;

  // Sous-requêtes
  complexityScore += (upperQuery.match(/\(.*SELECT.*\)/gi) || []).length * 3;

  // Fonctions d'agrégation
  complexityScore += (upperQuery.match(/\b(COUNT|SUM|AVG|MIN|MAX|GROUP_CONCAT)\b/g) || []).length;

  // UNION
  complexityScore += (upperQuery.match(/\bUNION\b/g) || []).length * 2;

  // Window functions
  if (upperQuery.match(/\bOVER\s*\(/)) complexityScore += 3;

  // CTE (Common Table Expressions)
  complexityScore += (upperQuery.match(/\bWITH\s+/g) || []).length * 2;

  if (complexityScore >= 6) {
    estimatedComplexity = 'HIGH';
  } else if (complexityScore >= 3) {
    estimatedComplexity = 'MEDIUM';
  }

  return {
    tables: [...new Set(tables)],
    columns: [...new Set(columns)],
    operations: [...new Set(operations)],
    estimatedComplexity
  };
}

// Obtenir le plan d'exécution simplifié (analyse statique)
export function explainQuery(query: string): {
  steps: string[];
  estimatedCost: number;
  optimizations: string[];
} {
  const steps: string[] = [];
  const optimizations: string[] = [];
  let estimatedCost = 1;

  const upperQuery = query.toUpperCase();

  // Analyser les étapes
  if (upperQuery.includes('FROM')) {
    steps.push('Scan des tables sources');
  }

  if (upperQuery.includes('WHERE')) {
    steps.push('Filtrage des lignes (WHERE)');
    estimatedCost += 0.5;
  }

  if (upperQuery.includes('JOIN')) {
    const joinCount = (upperQuery.match(/JOIN/g) || []).length;
    steps.push(`${joinCount} jointure(s)`);
    estimatedCost += joinCount * 2;
  }

  if (upperQuery.includes('GROUP BY')) {
    steps.push('Groupement et agrégation');
    estimatedCost += 1.5;
  }

  if (upperQuery.includes('ORDER BY')) {
    steps.push('Tri des résultats');
    estimatedCost += 1;
  }

  if (upperQuery.includes('DISTINCT')) {
    steps.push('Suppression des doublons');
    estimatedCost += 0.5;
  }

  if (upperQuery.includes('LIMIT')) {
    steps.push('Limitation des résultats');
    estimatedCost -= 0.3; // LIMIT réduit le coût
  }

  // Suggestions d'optimisation
  if (upperQuery.includes('SELECT *')) {
    optimizations.push('Évitez SELECT *, spécifiez uniquement les colonnes nécessaires');
  }

  if (upperQuery.includes('WHERE') && !upperQuery.match(/WHERE.*\s+(AND|OR)\s+.*=/)) {
    optimizations.push('Ajoutez des index sur les colonnes utilisées dans WHERE');
  }

  if (upperQuery.includes('ORDER BY') && !upperQuery.includes('LIMIT')) {
    optimizations.push('Ajoutez LIMIT après ORDER BY si vous n\'avez pas besoin de tous les résultats');
  }

  if (upperQuery.includes('JOIN') && !upperQuery.includes('ON')) {
    optimizations.push('Vérifiez que les jointures utilisent des index appropriés');
  }

  if (upperQuery.includes('SUBQUERY') || (query.match(/\(.*SELECT.*\)/))) {
    optimizations.push('Considérez convertir les sous-requêtes en JOIN si possible');
  }

  return {
    steps,
    estimatedCost: Math.max(estimatedCost, 0.1),
    optimizations
  };
}