import { randomUUID } from 'node:crypto'
import { query, withTransaction } from '@/lib/db'
import { getUserFromRequest, unauthorized } from '@/lib/auth'

export const runtime = 'nodejs'

interface UserRow {
  id: string
  username: string
  avatarColor: string
  avatarImageId: string | null
  createdAt: Date
  bio: string | null
  lastSeen: Date | null
}

interface RequestRowBase {
  id: string
  senderId: string
  receiverId: string
  status: string
  createdAt: Date
  updatedAt: Date
}

const USER_COLUMNS = `"id", "username", "avatarColor", "avatarImageId", "createdAt", "bio", "lastSeen"`

export async function GET(req: Request) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') ?? '').trim()

  if (q) {
    if (q.length < 2) return Response.json({ users: [] })
    // 转义 LIKE 通配符，避免用户名中 % _ \ 影响结果
    const escaped = q.replace(/[\\%_]/g, (m) => '\\' + m)
    const users = await query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM "User"
       WHERE "username" ILIKE $1 AND "id" <> $2
       ORDER BY "username" ASC
       LIMIT 20`,
      [`%${escaped}%`, user.id]
    )
    return Response.json({ users })
  }

  const [friends, incoming, outgoing] = await Promise.all([
    query<UserRow>(
      `SELECT u."id", u."username", u."avatarColor", u."avatarImageId", u."createdAt", u."bio", u."lastSeen"
       FROM "Friendship" f JOIN "User" u ON u."id" = f."friendId"
       WHERE f."userId" = $1
       ORDER BY f."createdAt" DESC`,
      [user.id]
    ),
    query<RequestRowBase & { sender: UserRow }>(
      `SELECT r.*, jsonb_build_object('id', s."id", 'username', s."username", 'avatarColor', s."avatarColor", 'createdAt', s."createdAt") AS sender
       FROM "FriendRequest" r JOIN "User" s ON s."id" = r."senderId"
       WHERE r."receiverId" = $1 AND r."status" = 'pending'
       ORDER BY r."createdAt" DESC`,
      [user.id]
    ),
    query<RequestRowBase & { receiver: UserRow }>(
      `SELECT r.*, jsonb_build_object('id', rc."id", 'username', rc."username", 'avatarColor', rc."avatarColor", 'createdAt', rc."createdAt") AS receiver
       FROM "FriendRequest" r JOIN "User" rc ON rc."id" = r."receiverId"
       WHERE r."senderId" = $1 AND r."status" = 'pending'
       ORDER BY r."createdAt" DESC`,
      [user.id]
    ),
  ])

  return Response.json({
    friends,
    incomingRequests: incoming.map((r) => ({
      id: r.id,
      senderId: r.senderId,
      receiverId: r.receiverId,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      sender: r.sender,
    })),
    outgoingRequests: outgoing.map((r) => ({
      id: r.id,
      senderId: r.senderId,
      receiverId: r.receiverId,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      receiver: r.receiver,
    })),
  })
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req)
  if (!user) return unauthorized()

  let body: any
  try { body = await req.json() } catch {
    return Response.json({ error: '请求格式错误' }, { status: 400 })
  }

  const action = typeof body.action === 'string' ? body.action : ''

  if (action === 'request') {
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    if (!username) return Response.json({ error: '请输入用户名' }, { status: 400 })

    const targets = await query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM "User" WHERE "username" = $1`,
      [username]
    )
    const target = targets[0]
    if (!target) return Response.json({ error: '没有找到这个用户' }, { status: 404 })
    if (target.id === user.id) return Response.json({ error: '不能添加自己' }, { status: 400 })

    const existingFriend = await query(
      'SELECT 1 FROM "Friendship" WHERE "userId" = $1 AND "friendId" = $2',
      [user.id, target.id]
    )
    if (existingFriend.length > 0) {
      return Response.json({ error: '你们已经是好友了' }, { status: 409 })
    }

    // 对方已向我发过请求 → 直接互相成为好友
    const reverse = await query<RequestRowBase>(
      `SELECT "id" FROM "FriendRequest"
       WHERE "senderId" = $1 AND "receiverId" = $2 AND "status" = 'pending'`,
      [target.id, user.id]
    )
    if (reverse.length > 0) {
      await acceptRequest(reverse[0].id, user.id, target.id)
      return Response.json({ accepted: true, friend: target })
    }

    const rows = await query<RequestRowBase>(
      `INSERT INTO "FriendRequest" ("id", "senderId", "receiverId", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'pending', now(), now())
       ON CONFLICT ("senderId", "receiverId")
       DO UPDATE SET "status" = 'pending', "updatedAt" = now()
       RETURNING "id", "senderId", "receiverId", "status", "createdAt", "updatedAt"`,
      [randomUUID(), user.id, target.id]
    )
    return Response.json({ request: rows[0] })
  }

  if (action === 'accept' || action === 'reject') {
    const requestId = typeof body.requestId === 'string' ? body.requestId : ''
    const requests = await query<RequestRowBase>(
      'SELECT "id", "senderId", "receiverId", "status", "createdAt", "updatedAt" FROM "FriendRequest" WHERE "id" = $1',
      [requestId]
    )
    const request = requests[0]
    if (!request || request.receiverId !== user.id || request.status !== 'pending') {
      return Response.json({ error: '好友请求不存在或已处理' }, { status: 404 })
    }

    if (action === 'reject') {
      await query(
        `UPDATE "FriendRequest" SET "status" = 'rejected', "updatedAt" = now() WHERE "id" = $1`,
        [request.id]
      )
      return Response.json({ ok: true })
    }

    const friend = await acceptRequest(request.id, user.id, request.senderId)
    return Response.json({ ok: true, friend })
  }

  if (action === 'remove') {
    const friendId = typeof body.friendId === 'string' ? body.friendId : ''
    if (!friendId) return Response.json({ error: '缺少好友 ID' }, { status: 400 })
    await withTransaction(async (tx) => {
      await tx.query(
        `DELETE FROM "Friendship" WHERE ("userId" = $1 AND "friendId" = $2) OR ("userId" = $2 AND "friendId" = $1)`,
        [user.id, friendId]
      )
      await tx.query(
        `DELETE FROM "FriendRequest" WHERE ("senderId" = $1 AND "receiverId" = $2) OR ("senderId" = $2 AND "receiverId" = $1)`,
        [user.id, friendId]
      )
    })
    return Response.json({ ok: true })
  }

  return Response.json({ error: '不支持的操作' }, { status: 400 })
}

async function acceptRequest(requestId: string, receiverId: string, senderId: string) {
  const friends = await query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM "User" WHERE "id" = $1`,
    [senderId]
  )
  const friend = friends[0]
  if (!friend) throw new Error('用户不存在')

  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE "FriendRequest" SET "status" = 'accepted', "updatedAt" = now() WHERE "id" = $1`,
      [requestId]
    )
    await tx.query(
      `INSERT INTO "Friendship" ("id", "userId", "friendId", "createdAt")
       VALUES ($1, $2, $3, now())
       ON CONFLICT ("userId", "friendId") DO NOTHING`,
      [randomUUID(), receiverId, senderId]
    )
    await tx.query(
      `INSERT INTO "Friendship" ("id", "userId", "friendId", "createdAt")
       VALUES ($1, $2, $3, now())
       ON CONFLICT ("userId", "friendId") DO NOTHING`,
      [randomUUID(), senderId, receiverId]
    )
  })
  return friend
}
