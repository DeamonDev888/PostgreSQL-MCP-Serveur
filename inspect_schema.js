import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

let connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    const host = process.env.POSTGRES_HOST || 'localhost';
    const port = process.env.POSTGRES_PORT || '5432';
    const user = process.env.POSTGRES_user || process.env.POSTGRES_USER;
    const pass = process.env.POSTGRES_PASSWORD;
    const db = process.env.POSTGRES_DATABASE;
    if (user && pass && db) {
        connectionString = `postgresql://${user}:${pass}@${host}:${port}/${db}`;
    }
}

const pool = new pg.Pool({ connectionString });

async function run() {
    const client = await pool.connect();
    try {
        console.log("--- Schema of semantic_context ---");
        const res = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'semantic_context'
        `);
        console.table(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        client.release();
        pool.end();
    }
}
run();
