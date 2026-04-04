import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT TOP 50
      r.session_id,
      r.status,
      r.blocking_session_id,
      r.wait_type,
      r.wait_time,
      r.command,
      DB_NAME(r.database_id) AS database_name,
      SUBSTRING(t.text, (r.statement_start_offset/2) + 1,
        ((CASE r.statement_end_offset WHEN -1 THEN DATALENGTH(t.text)
          ELSE r.statement_end_offset END - r.statement_start_offset)/2) + 1) AS statement_text
    FROM sys.dm_exec_requests r
    CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
    WHERE r.session_id <> @@SPID
    ORDER BY r.start_time ASC
  `);
  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
