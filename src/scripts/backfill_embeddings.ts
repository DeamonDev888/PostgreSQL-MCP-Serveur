
import { Pool } from 'pg';
import { embeddingService } from '../services/embeddingService.js';
import config, { dbConfig } from '../config.js';
import Logger from '../utils/logger.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Setup Env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function backfillEmbeddings() {
    Logger.info("🚀 Starting Embedding Backfill Process...");

    // 1. Setup DB Connection
    const pool = new Pool(config.database);
    
    try {
        // 2. Count Targets (Recent News - last 7 days)
        // Optimized to prioritize recent news first
        const daysToLookBack = 7; 
        const countQuery = `
            SELECT COUNT(*) 
            FROM enhanced_news 
            WHERE embedding IS NULL 
            AND timestamp_unix_ms > (EXTRACT(EPOCH FROM NOW()) * 1000 - ${daysToLookBack * 24 * 60 * 60 * 1000})
        `;
        const resCount = await pool.query(countQuery);
        const totalToProcess = parseInt(resCount.rows[0].count);

        Logger.info(`🎯 Found ${totalToProcess} recent articles (last ${daysToLookBack} days) needing embeddings.`);

        if (totalToProcess === 0) {
            Logger.info("✅ No articles to process.");
            return;
        }

        // 3. AUTO-DETECT & MIGRATE DIMENSIONS
        // Generate one probe vector to check dimensions
        Logger.info("🕵️ Probing API for vector dimensions...");
        const probeVector = await embeddingService.generateEmbedding("Probe", { model: 'qwen/qwen3-embedding-8b' });
        const apiDims = probeVector.length;
        Logger.info(`📏 API Model 'qwen/qwen3-embedding-8b' returns ${apiDims} dimensions.`);

        // Check DB Column Type
        const schemaRes = await pool.query(`
            SELECT atttypmod 
            FROM pg_attribute 
            WHERE attrelid = 'enhanced_news'::regclass 
            AND attname = 'embedding'
        `);
        const dbDims = schemaRes.rows[0]?.atttypmod; // vector typmod is usually dims
        
        // Note: pg_vector typmod needs parsing or just try/catch the insert. 
        // Simpler: Just try to ALTER if catch error implies mismatch? 
        // Better: Always ensure correct type.
        
        // Let's blindly run ALTER if we can, or just log.
        // If apiDims (e.g. 4096) != 1536 (default), execution will fail.
        
        if (apiDims !== 1536) { // Assuming 1536 is the old default
             Logger.warn(`⚠️ Dimension Mismatch! API: ${apiDims} vs DB Default (1536). Initiating Migration...`);
             try {
                 await pool.query(`ALTER TABLE enhanced_news ALTER COLUMN embedding TYPE vector(${apiDims})`);
                 Logger.info(`✅ Schema Updated: embedding column is now vector(${apiDims})`);
             } catch (e: any) {
                 Logger.error(`❌ Migration Failed: ${e.message}. Attempting to proceed anyway...`);
             }
        }

        // 4. Process in Batches
        const BATCH_SIZE = 10;
        let processed = 0;
        let errors = 0;

        // Cursor logic or simple offset
        // Using cursor-like approach by selecting NULLs each time is robust but order matters
        const selectQuery = `
            SELECT id, title, content 
            FROM enhanced_news 
            WHERE embedding IS NULL 
            AND timestamp_unix_ms > (EXTRACT(EPOCH FROM NOW()) * 1000 - ${daysToLookBack * 24 * 60 * 60 * 1000})
            ORDER BY timestamp_unix_ms DESC
            LIMIT ${BATCH_SIZE}
        `;

        while (processed < totalToProcess) {
            const rows = (await pool.query(selectQuery)).rows;
            if (rows.length === 0) break;

            Logger.info(`📦 Processing batch of ${rows.length} articles...`);

            // Parallel Processing within Batch
            await Promise.all(rows.map(async (row) => {
                try {
                    const textToEmbed = `${row.title}\n\n${row.content || ''}`.substring(0, 8000); // Truncate safety
                    
                    // Generate Vector (Qwen via OpenRouter)
                    const vector = await embeddingService.generateEmbedding(textToEmbed, {
                        model: 'qwen/qwen3-embedding-8b',
                        dimensions: 1536 // Or let API decide, but usually standard fixed
                    });

                    // Update DB - Using explicit casting for pgvector
                    // Note: pgvector expects '[...]' string format
                    const vectorStr = `[${vector.join(',')}]`;
                    
                    await pool.query(
                        `UPDATE enhanced_news SET embedding = $1::vector WHERE id = $2`,
                        [vectorStr, row.id]
                    );
                    
                    process.stdout.write('.'); // Progress dot
                } catch (err: any) {
                    process.stdout.write('x');
                    errors++;
                    Logger.error(`Failed ID ${row.id}: ${err.message}`);
                }
            }));
            
            processed += rows.length;
            console.log(`\n📊 Progress: ${processed}/${totalToProcess} (Errors: ${errors})`);
            
            // Rate Limit Safety (optional but good practice)
            await new Promise(r => setTimeout(r, 1000));
        }

        Logger.info("✅ Backfill Complete!");

    } catch (err) {
        Logger.error("❌ Fatal Script Error", err);
    } finally {
        await pool.end();
    }
}

backfillEmbeddings();
