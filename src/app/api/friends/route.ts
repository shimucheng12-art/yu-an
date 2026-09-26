import { db } from '@/lib/db'
import { getUserFromRequest, unauthorized } from '@/lib/auth'
import { Prisma } from '@prisma/client'

export const runtime = 'nodejs'

const USER = {
  id: true,
  username: true,
  avatarColor: true,
  createdAt: true,
} as const

async function currentUser(req: Request) {
  return getUserFromRequest(req)
}

export async function GET(req: Request) {
  const user = await currentUser(req)
  if (!user) return unauthorized()

  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') ?? '').trim()

  if (q) {
    if (q.length < 2) return Response.json({ users: [] })
    const users = await db.user.findMany({
      where: {
        username: { contains: q, mode: 'insensitive' },
        NOT: { id: user.id },
      },
      select: USER,
      orderBy: { username: 'asc' },
      take: 20,
    })
    return Response.json({ users })
  }

  const [rows, incoming, outgoing] = await Promise.all([
    db.friendship.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      include: { friend: { select: USER } },
    }),
    db.friendRequest.findMany({
      where: { receiverId: user.id, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      include: { sender: { select: USER } },
    }),
    db.friendRequest.findMany({
      where: { senderId: user.id, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      include: { receiver: { select: USER } },
    }),
  ])

  return Response.json({
    friends: rows.map((r) => r.friend),
    incomingRequests: incoming.map((r) => ({ ...r, sender: r.sender })),
    outgoingRequests: outgoing.map((r) => ({ ...r, receiver: r.receiver })),
  })
}

export async function POST(req: Request) {
  const user = await currentUser(req)
  if (!user) return unauthorized()

  let body: any
  try { body = await req.json() } catch {
    return Response.json({ error: '请求格式错误' }, { status: 400 })
  }

  const action = typeof body.action === 'string' ? body.action : ''

  if (action === 'request') {
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    if (!username) return Response.json({ error: '请输入用户名' }, { status: 400 })

    const target = await db.user.findUnique({ where: { username }, select: USER })
    if (!target) return Response.json({ error: '没有找到这个用户' }, { status: 404 })
    if (target.id === user.id) return Response.json({ error: '不能添加自己' }, { status: 400 })

    const existingFriend = await db.friendship.findUnique({
      where: { userId_friendId: { userId: user.id, friendId: target.id } },
    })
    if (existingFriend) return Response.json({ error: '你们已经是好友了' }, { status: 409 })

    const reverse = await db.friendRequest.findUnique({
      where: { senderId_receiverId: { senderId: target.id, receiverId: user.id } },
    })
    if (reverse?.status === 'pending') {
      const accepted = await acceptRequest(reverse.id, user.id, target.id)
      return Response.json({ accepted: true, friend: target })
    }

    try {
      const request = await db.friendRequest.upsert({
        where: { senderId_receiverId: { senderId: user.id, receiverId: target.id } },
        create: { senderId: user.id, receiverId: target.id },
        update: { status: 'pending' },
      })
      return Response.json({ request })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        return Response.json({ error: '好友请求已存在' }, { status: 409 })
      }
      throw e
    }
  }

  if (action === 'accept' || action === 'reject') {
    const requestId = typeof body.requestId === 'string' ? body.requestId : ''
    const request = await db.friendRequest.findUnique({ where: { id: requestId } })
    if (!request || request.receiverId !== user.id || request.status !== 'pending') {
      return Response.json({ error: '好友请求不存在或已处理' }, { status: 404 })
    }

    if (action === 'reject') {
      await db.friendRequest.update({ where: { id: request.id }, data: { status: 'rejected' } })
      return Response.json({ ok: true })
    }

    const friend = await acceptRequest(request.id, user.id, request.senderId)
    return Response.json({ ok: true, friend })
  }

  if (action === 'remove') {
    const friendId = typeof body.friendId === 'string' ? body.friendId : ''
    if (!friendId) return Response.json({ error: '缺少好友 ID' }, { status: 400 })
    await db.$transaction([
      db.friendship.deleteMany({ where: { OR: [{ userId: user.id, friendId }, { userId: friendId, friendId: user.id }] } }),
      db.friendRequest.deleteMany({ where: { OR: [{ senderId: user.id, receiverId: friendId }, { senderId: friendId, receiverId: user.id }] } }),
    ])
    return Response.json({ ok: true })
  }

  return Response.json({ error: '不支持的操作' }, { status: 400 })
}

async function acceptRequest(requestId: string, receiverId: string, senderId: string) {
  const friend = await db.user.findUnique({ where: { id: senderId }, select: USER })
  if (!friend) throw new Error('用户不存在')

  await db.$transaction(async (tx) => {
    await tx.friendRequest.update({
      where: { id: requestId },
      data: { status: 'accepted' },
    })
    await tx.friendship.upsert({
      where: { userId_friendId: { userId: receiverId, friendId: senderId } },
      create: { userId: receiverId, friendId: senderId },
      update: {},
    })
    await tx.friendship.upsert({
      where: { userId_friendId: { userId: senderId, friendId: receiverId } },
      create: { userId: senderId, friendId: receiverId },
      update: {},
    })
  })
  return friend
}
