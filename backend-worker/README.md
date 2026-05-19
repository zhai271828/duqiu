# Cloudflare Worker Backend

这个目录现在使用：

- `Cloudflare Workers + D1` 处理业务接口
- `Firebase Authentication` 处理邮箱注册、登录、邮箱验证、重置密码

## 认证流程

- `POST /api/auth/register`
  - 注册 Firebase 账号
  - 在 D1 创建本地用户资料
  - 自动发送验证邮件
- `POST /api/auth/login`
  - 支持邮箱或用户名登录
- `POST /api/auth/forgot-password`
  - 支持邮箱或用户名触发重置密码邮件
- `POST /api/auth/resend-verification`
  - 为当前登录用户重新发送验证邮件
- `POST /api/auth/refresh`
  - 使用 refresh token 刷新 Firebase id token
- `GET /api/auth/profile`
  - 返回本地用户资料，并同步邮箱验证状态

未验证邮箱的用户：

- 可以登录
- 可以查看个人中心
- 不能下注
- 不能兑换

## 本地开发

1. 安装依赖

```bash
cd backend-worker
npm install
```

2. 复制本地变量模板

```bash
cp .dev.vars.example .dev.vars
```

至少需要填写：

- `FIREBASE_API_KEY`
- `FIREBASE_PROJECT_ID`

可选：

- `ADMIN_EMAILS`
- `ODDS_API_KEY`
- `FOOTBALL_DATA_API_KEY`

3. 生成 Worker 类型

```bash
npm run typegen
```

4. 应用本地 D1 migration

```bash
npm run migrate:local
```

5. 启动 Worker

```bash
npm run dev
```

默认监听 `http://localhost:8787`。

## Firebase 控制台需要配置的内容

1. 创建 Firebase 项目
2. 打开 `Authentication`
3. 启用 `Email/Password`
4. 在 `Authorized domains` 中加入：
   - 生产的 `pages.dev` 域名
   - `localhost`
5. 如需管理员账号：
   - 在 Firebase 控制台手动创建管理员邮箱
   - 把该邮箱加入 `ADMIN_EMAILS`

## 验证

类型检查：

```bash
npm run check
```

端到端 smoke test：

```bash
npm run smoke
```

## 部署前需要配置的变量

在 Cloudflare 中配置：

```bash
wrangler secret put FIREBASE_API_KEY
wrangler secret put FIREBASE_PROJECT_ID
wrangler secret put ODDS_API_KEY
wrangler secret put FOOTBALL_DATA_API_KEY
```

如果要启用管理员白名单，再设置：

```bash
wrangler secret put ADMIN_EMAILS
```
