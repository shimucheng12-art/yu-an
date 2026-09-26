import { getUserFromRequest, unauthorized } from '@/lib/auth'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()
  return Response.json({ user })
}
