
import pkg from 'pg';
const { Client } = pkg;

async function diagnostic() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'financial_analyst',
    user: 'postgres',
    password: '9022',
  });

  try {
    await client.connect();
    console.log('Connected to database.');

    // 1. List main tables
    console.log('\n--- Main Tables ---');
    const tablesRes = await client.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public';");
    tablesRes.rows.forEach(row => console.log(`- ${row.tablename}`));

    // 2. Check number of news without embedding in 'enhanced_news'
    console.log('\n--- News without Embedding ---');
    try {
      const newsRes = await client.query("SELECT count(*) FROM enhanced_news WHERE vector_8d IS NULL;");
      console.log(`Count: ${newsRes.rows[0].count}`);
    } catch (err) {
      console.log(`Error checking enhanced_news: ${err.message}`);
    }

    // 3. Check status of the pgvector extension
    console.log('\n--- pgvector Extension Status ---');
    const extRes = await client.query("SELECT * FROM pg_extension WHERE extname = 'vector';");
    if (extRes.rows.length > 0) {
      console.log(`Extension 'vector' is installed. Version: ${extRes.rows[0].extversion}`);
    } else {
      console.log("Extension 'vector' is NOT installed.");
    }

  } catch (err) {
    console.error('Connection error:', err.stack);
  } finally {
    await client.end();
  }
}

diagnostic();
