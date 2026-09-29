import pg from 'pg'

// 云端数据库连接：优先读环境变量（须非空，防止误配空值穿透 ??），
// 未配置时使用内置地址（Neon 免费版）。
const FALLBACK_DATABASE_URL =
  'postgresql://neondb_owner:npg_xIVBPE91qNtf@ep-calm-sea-b4cpjqyr-pooler.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require'

const envDatabaseUrl = process.env.DATABASE_URL?.trim()
const connectionString = envDatabaseUrl ? envDatabaseUrl : FALLBACK_DATABASE_URL

// serverless 环境下进程随时回收，连接池保持小而短命
const globalForPg = globalThis as unknown as { pool: pg.Pool | undefined }

export const pool =
  globalForPg.pool ??
  new pg.Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // Neon 等云端库要求 TLS；本地连接串（localhost）则不启用
    ssl: /localhost|127\.0\.0\.1/.test(connectionString)
      ? undefined
      : { rejectUnauthorized: false },
  })

if (process.env.NODE_ENV !== 'production') globalForPg.pool = pool

/** 执行查询，返回行数组 */
export async function query<R extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<R[]> {
  const res = await pool.query<R>(text, params)
  return res.rows
}

/** 在事务中执行（出错自动回滚） */
export async function withTransaction(
  fn: (client: pg.PoolClient) => Promise<void>
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await fn(client)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
