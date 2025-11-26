// lib/db.ts
import sql, { config as SQLConfig, ConnectionPool } from 'mssql';

const sqlConfig: SQLConfig = {
  user: process.env.AZURE_SQL_USER,
  password: process.env.AZURE_SQL_PASSWORD,
  server: process.env.AZURE_SQL_SERVER as string,
  database: process.env.AZURE_SQL_DATABASE,
  options: {
    encrypt: process.env.AZURE_SQL_ENCRYPT === 'true',
    trustServerCertificate: process.env.AZURE_SQL_TRUST_SERVER_CERTIFICATE === 'true',
  },
};

let pool: ConnectionPool | null = null;

export async function getDb() {
  if (pool && pool.connected) return pool;

  if (!pool) {
    pool = new sql.ConnectionPool(sqlConfig);
  }

  if (!pool.connected) {
    await pool.connect();
  }

  return pool;
}
