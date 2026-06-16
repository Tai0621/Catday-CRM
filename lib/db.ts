import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined
}

function createPrisma() {
  const url = process.env.DATABASE_URL
  const authToken = process.env.DATABASE_AUTH_TOKEN

  if (!url) throw new Error('DATABASE_URL is not set')

  const adapter = new PrismaLibSql({ url, authToken })
  return new PrismaClient({ adapter } as any)
}

export const db: PrismaClient =
  global.__prisma ?? (global.__prisma = createPrisma())
