# 轻聊 QingLiao · 聊天 APP

一个轻量级多人聊天室：**文字聊天 · 文件分享 · 用户数据云端储存**。

**[🌐 在线体验（GitHub Pages 演示版）](https://shimucheng12-art.github.io/yu-an/)**

| 登录 | 聊天室 |
| :---: | :---: |
| ![登录页](assets/screenshot-login.png) | ![聊天页](assets/screenshot-chat.png) |

> **关于演示版**：GitHub Pages 只能托管静态网页，无法运行数据库与实时后端。因此在线演示版是纯前端实现——
> 聊天记录与文件保存在**当前浏览器**中，**同一浏览器多开几个标签页**（用不同昵称进入）即可实时互聊，图片与文件分享均可体验。
> 完整版（账号系统、云端同步、跨设备、Socket.io 实时通信）源码即本仓库，运行方式见下文。

## 功能一览

| 功能 | 在线演示版 | 完整版（本仓库源码） |
| --- | :-: | :-: |
| 文字聊天、实时收发 | ✅（同浏览器多标签页） | ✅（Socket.io，跨设备） |
| 文件 / 图片分享 | ✅（≤2MB，本地存储） | ✅（≤20MB，服务器存储） |
| 图片点击预览、原图下载 | ✅ | ✅ |
| 用户注册 / 登录 | —（免登录，输入昵称即用） | ✅（JWT + scrypt 密码哈希） |
| 聊天记录云端储存 | —（仅浏览器本地） | ✅（SQLite，换设备登录可见） |
| 在线成员、正在输入提示 | ✅ | ✅ |
| 历史消息分页、日期分组 | ✅ | ✅ |
| 深浅色主题、移动端自适应 | ✅ | ✅ |

## 技术栈

**完整版**：Next.js 16（App Router）· TypeScript · Tailwind CSS 4 · shadcn/ui · Prisma + SQLite · Socket.io · jose（JWT）· Framer Motion

**演示版**：单文件原生 HTML/CSS/JS · BroadcastChannel（多标签页实时） · localStorage（本地持久化）

## 项目结构

```
├── index.html                  # GitHub Pages 演示版（自包含单文件，可直接双击打开）
├── assets/                     # README 截图
├── 团队公约.md                  # 团队使用约定
├── 晨光山谷.png                 # 示例素材（演示版内置分享示例）
├── prisma/schema.prisma         # 数据模型：User / Message
├── src/
│   ├── app/
│   │   ├── page.tsx             # 前端入口（登录恢复 + 聊天室）
│   │   ├── layout.tsx           # 根布局（主题、Toast）
│   │   └── api/                 # 后端接口
│   │       ├── auth/            #   注册 / 登录（JWT 签发）
│   │       ├── me/              #   当前用户（Bearer 鉴权）
│   │       ├── messages/        #   发送消息 / 历史消息分页
│   │       ├── upload/          #   文件上传（落盘 + 生成文件消息）
│   │       └── files/[id]/      #   文件下载 / 图片预览（需认证）
│   ├── components/chat/         # 聊天 UI 组件（登录页、消息气泡、文件卡片等）
│   ├── lib/                     # db 客户端、JWT 工具、请求封装、socket 封装
│   └── types/                   # 共享类型
└── mini-services/chat-service/  # Socket.io 实时服务（端口 3003）
```

## 本地运行完整版

环境要求：[Bun](https://bun.sh) v1+（或 Node 18+ 配合 npm/pnpm 替换命令）

```bash
# 1. 安装依赖
bun install

# 2. 配置环境变量
cp .env.example .env
#    编辑 .env，将 JWT_SECRET、INTERNAL_SECRET 替换为随机长字符串：
#    openssl rand -hex 32

# 3. 初始化数据库（SQLite，自动建于 db/custom.db）
bun run db:push

# 4. 启动网页服务（http://localhost:3000）
bun run dev

# 5. 另开一个终端，启动实时聊天服务（端口 3003）
cd mini-services/chat-service
bun install
bun run dev
```

打开 `http://localhost:3000`，注册两个账号、开两个浏览器窗口即可对聊。

## 部署完整版

完整版依赖 Node/Bun 运行时、SQLite 数据库与 Socket.io 长连接，**不能**部署在 GitHub Pages / Vercel 静态托管等纯静态平台。推荐：

- **VPS / 云服务器**：`bun run build && bun run start`，配合 Nginx/Caddy 反代（WebSocket 需透传）
- **容器平台**：Render / Fly.io / Railway 等，挂载持久卷保存 `db/` 目录

## 安全说明

- 密码使用 scrypt 加盐哈希存储，明文不落库
- 认证采用 JWT Bearer Token（7 天有效期），所有受保护接口均校验
- 上传文件以消息 ID 命名落盘，杜绝路径穿越；下载必须携带认证
- `.env` 已被 .gitignore 忽略，请勿提交密钥

## 许可

供学习与个人使用，欢迎参考改造。
