import { PrismaClient } from '@prisma/client'

// 云端数据库连接：优先读环境变量，未配置时使用内置地址（Neon 免费版）。
// 之前版本这里硬编码了本地 SQLite 路径，导致云端所有数据库操作失败——已移除。
const FALLBACK_DATABASE_URL =
  'postgresql://neondb_owner:npg_xIVBPE91qNtf@ep-calm-sea-b4cpjqyr-pooler.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require'

const databaseUrl = process.env.DATABASE_URL ?? FALLBACK_DATABASE_URL

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: databaseUrl,
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
