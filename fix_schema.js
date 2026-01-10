import pg from 'pg';
import dotenv from 'dotenv';

import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, '.env') });

console.log("Checking Env...");
let connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    console.log("Constructing connection string from POSTGRES_* variables...");
    const host = process.env.POSTGRES_HOST || 'localhost';
    const port = process.env.POSTGRES_PORT || '5432';
    const user = process.env.POSTGRES_USER;
    const pass = process.env.POSTGRES_PASSWORD;
    const db = process.env.POSTGRES_DATABASE;

    if (user && pass && db) {
        connectionString = `postgresql://${user}:${pass}@${host}:${port}/${db}`;
        console.log(`constructed: postgresql://${user}:***@${host}:${port}/${db}`);
    } else {
        console.error("❌ Missing POSTGRES_* variables in .env");
        console.log("Keys found:", Object.keys(process.env).filter(k => k.startsWith('POSTGRES')));
    }
} else {
    console.log("✅ DATABASE_URL found.");
}

const pool = new pg.Pool({
  connectionString: connectionString
});

async function run() {
    const client = await pool.connect();
    try {
        console.log('🏥 Starting Comprehensive Database Heal...');

        // 1. semantic_context
        console.log('🔧 Checking table: semantic_context');
        await client.query(`CREATE TABLE IF NOT EXISTS semantic_context (id UUID PRIMARY KEY DEFAULT gen_random_uuid());`);
        const semanticCols = [
            {name: 'market_state', type: 'TEXT'},
            {name: 'recorded_at', type: 'TIMESTAMPTZ DEFAULT NOW()'},
            {name: 'fear_gauge', type: 'REAL'},
            {name: 'symbol', type: 'TEXT'},
            {name: 'tags', type: 'TEXT[]'}
        ];
        for (const col of semanticCols) {
            try {
                await client.query(`ALTER TABLE semantic_context ADD COLUMN IF NOT EXISTS ${col.name} ${col.type};`);
                console.log(`   - Verified ${col.name}`);
            } catch(e) { console.log(`   - Error adding ${col.name}: ${e.message}`); }
        }

        // 2. fusion_events
        console.log('🔧 Checking table: fusion_events');
        await client.query(`CREATE TABLE IF NOT EXISTS fusion_events (id UUID PRIMARY KEY DEFAULT gen_random_uuid());`);
        const fusionCols = [
            {name: 'event_time', type: 'TIMESTAMPTZ DEFAULT NOW()'},
            {name: 'symbol', type: 'TEXT'},
            {name: 'event_type', type: 'TEXT'}, // guessing other fields usually needed
            {name: 'price', type: 'NUMERIC'}
        ];
        for (const col of fusionCols) {
             try {
                await client.query(`ALTER TABLE fusion_events ADD COLUMN IF NOT EXISTS ${col.name} ${col.type};`);
                console.log(`   - Verified ${col.name}`);
            } catch(e) { console.log(`   - Error adding ${col.name}: ${e.message}`); }
        }

        // 3. market_levels
        console.log('🔧 Checking table: market_levels');
        await client.query(`CREATE TABLE IF NOT EXISTS market_levels (id UUID PRIMARY KEY DEFAULT gen_random_uuid());`);
        const levelCols = [
            {name: 'level_price', type: 'NUMERIC'},
            {name: 'symbol', type: 'TEXT'},
            {name: 'is_active', type: 'BOOLEAN DEFAULT true'},
            {name: 'confirmations', type: 'INTEGER DEFAULT 0'}
        ];
        for (const col of levelCols) {
             try {
                await client.query(`ALTER TABLE market_levels ADD COLUMN IF NOT EXISTS ${col.name} ${col.type};`);
                console.log(`   - Verified ${col.name}`);
            } catch(e) { console.log(`   - Error adding ${col.name}: ${e.message}`); }
        }

        // 4. market_snapshots
        console.log('🔧 Checking table: market_snapshots');
        await client.query(`CREATE TABLE IF NOT EXISTS market_snapshots (id UUID PRIMARY KEY DEFAULT gen_random_uuid());`);
        const snapshotCols = [
            {name: 'last_price', type: 'NUMERIC'},
            {name: 'symbol', type: 'TEXT'},
            {name: 'snapshot_time', type: 'TIMESTAMPTZ DEFAULT NOW()'}
        ];
        for (const col of snapshotCols) {
             try {
                await client.query(`ALTER TABLE market_snapshots ADD COLUMN IF NOT EXISTS ${col.name} ${col.type};`);
                console.log(`   - Verified ${col.name}`);
            } catch(e) { console.log(`   - Error adding ${col.name}: ${e.message}`); }
        }

        // 5. market_news (Legacy/VIX source)
        console.log('🔧 Checking table: market_news');
        await client.query(`CREATE TABLE IF NOT EXISTS market_news (id UUID PRIMARY KEY DEFAULT gen_random_uuid());`);
        const newsCols = [
            {name: 'title', type: 'TEXT'},
            {name: 'content', type: 'TEXT'},
            {name: 'source', type: 'TEXT'},
            {name: 'url', type: 'TEXT'},
            {name: 'published_at', type: 'TIMESTAMPTZ DEFAULT NOW()'}
        ];
        for (const col of newsCols) {
             try {
                await client.query(`ALTER TABLE market_news ADD COLUMN IF NOT EXISTS ${col.name} ${col.type};`);
                console.log(`   - Verified ${col.name}`);
            } catch(e) { console.log(`   - Error adding ${col.name}: ${e.message}`); }
        }

        console.log('✅ HEALING COMPLETE. Relauching Service SHOULD work now.');

    } catch (e) {
        console.error('❌ Critical Error:', e);
    } finally {
        client.release();
        pool.end();
        process.exit(0);
    }
}

run();
