# 余安 · 浮云深处，岁岁余安

一个轻盈的沟通小站：**消息 · 广场**，与「碎碎念」APP 账号云端互通。

**[🌐 在线体验](https://shimucheng12-art.github.io/yu-an/)**

| 登录 | 消息 |
| :---: | :---: |
| ![登录页](assets/screenshot-login.png) | ![消息页](assets/screenshot-chat.png) |

| 广场 | 我的 |
| :---: | :---: |
| ![广场页](assets/screenshot-square.png) | ![我的页](assets/screenshot-me.png) |

## ✨ 功能

### 💬 消息
- 文字 + 图片消息，图片自动压缩、点击查看大图
- 同一浏览器**多开标签页即可实时互聊**（BroadcastChannel）
- 在线人数、正在输入提示、历史消息搜索、日期分组

### 🏞️ 广场
- 发布图文动态，点赞互动
- **与碎碎念 APP 联动**：云端登录后可一键把日记分享到广场（只读拉取，不改动碎碎念的数据）
- 动态搜索

### ☁️ 账号互通（碎碎念）
- 使用「碎碎念」APP 的**手机号 + 短信验证码**登录，无需另行注册
- 与 [碎碎念网页版](https://shimucheng12-art.github.io/life/) 共享登录会话：在那边登录过，这边自动识别
- 登录后可拉取云端日记分享到广场
- 不登录也可以游客身份直接体验

## 🎨 设计

- 背景：雾蓝粉调云层摄影 + 莫兰迪配色 + 毛玻璃（backdrop-filter）卡片
- 移动端 APP 式交互：顶部搜索栏、左侧抽屉菜单（应用信息 + 功能导航 + 扫一扫/设置/我的）、底部标签栏
- 桌面端居中「手机框」展示，自适应深浅环境
- 单文件实现（`index.html`），零依赖、零构建，可直接双击打开

## 📁 项目结构

```
├── index.html        # 应用本体（自包含单文件）
├── assets/           # 云层背景图与 README 截图
├── 团队公约.md        # 示例素材
├── 晨光山谷.png       # 示例素材（广场示例动态）
├── .github/          # GitHub Pages 自动部署工作流
├── src/              # 完整版源码（Next.js + Socket.io + SQLite）
└── mini-services/    # Socket.io 实时服务
```

## ☁️ 账号互通原理

余安调用碎碎念的阿里云函数计算后端（`cloud-fc`，见 [life 仓库](https://github.com/shimucheng12-art/life)）：

- 登录：`POST /api/auth/sms/send` + `POST /api/auth/sms/login`（手机号验证码 → JWT）
- 拉日记：`GET /api/data`（只读，解析 `diaries` 数组后分享到广场；**不回写**，避免干扰碎碎念的云同步）

两个站点同属 `shimucheng12-art.github.io` 域，云端 API 的 CORS 白名单直接放行，登录态（JWT）在 localStorage 中互通。

## 🔧 完整版（仓库源码）

`src/` 目录保留了上一代的完整全栈实现（Next.js 16 + Prisma/SQLite + Socket.io + JWT 账号系统），本地运行与部署方法见提交历史中的旧版 README。

## ⚠️ 说明

当前线上为纯前端版本：消息与广场数据保存在浏览器本地（localStorage），清空浏览器数据会丢失；「完整版」需要自建后端。

## 许可

供学习与个人使用，欢迎参考改造。
