require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: "postgres://azureadmin:Markinauna%401981@apppkg-dev-pg.postgres.database.azure.com:5432/packaging_db?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

async function checkDb() {
  try {
    const res = await pool.query('SELECT * FROM requests ORDER BY id DESC LIMIT 5');
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error("error", err);
  } finally {
    pool.end();
  }
}

checkDb();
