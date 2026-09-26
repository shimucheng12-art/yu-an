import path from 'node:path'
import { PrismaClient } from '@prisma/client'

// 数据库位置是项目相对不变量：<项目根>/db/custom.db
// 显式传入 datasourceUrl，避免依赖环境变量
const databaseUrl = `file:${path.join(process.cwd(), 'db', 'custom.db')}`

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: databaseUrl,
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
