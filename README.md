# 模拟赌球网站

一个仅供娱乐的模拟赌球平台。用户注册即获 10,000 虚拟金币，可在足球赛事上进行虚拟下注。**不涉及任何真实金钱交易。**

**主要数据源：**
- 赛程数据：[football-data.org](https://www.football-data.org/)（当前实现需要 `FOOTBALL_DATA_API_KEY`）
- 赔率数据：[The Odds API](https://the-odds-api.com/)（免费 500 次/月，聚合多家博彩公司真实赔率）

## 项目架构

```
赌球/
├── start.bat / start.sh          # 一键启动脚本
├── init_data.py                  # 初始化数据库 + 同步真实数据
├── clean_data.py                 # 清理无赔率的比赛
├── update_names.py               # 批量翻译球队/联赛名为中文
│
├── backend/                      # Flask 后端 (端口 5000)
│   ├── run.py                    # 应用入口
│   ├── config.py                 # 配置项
│   ├── .env.example              # 环境变量模板
│   ├── requirements.txt
│   ├── instance/
│   │   └── betting.db            # SQLite 数据库
│   └── app/
│       ├── __init__.py           # Flask app factory
│       ├── models/
│       │   ├── user.py           # 用户模型
│       │   ├── match.py          # 比赛 + 赔率模型
│       │   └── bet.py            # 下注模型
│       ├── routes/
│       │   ├── auth.py           # 注册 / 登录 / 兑换码 / 邮箱验证
│       │   ├── matches.py        # 比赛列表 / 详情 / 数据同步 / 赔率对比
│       │   ├── bets.py           # 下注 / 注单列表 / 注单详情
│       │   └── stats.py          # 个人统计 / 排行榜 / 首页数据
│       ├── services/
│       │   ├── odds_service.py   # The Odds API 客户端 + 中英翻译映射表
│       │   └── football_api.py   # football-data.org / OpenLigaDB 客户端
│       └── utils/
│
├── backend-worker/               # Cloudflare Workers + D1 后端 (端口 8787)
│   ├── wrangler.jsonc            # Workers / D1 配置
│   ├── migrations/               # D1 schema migrations
│   ├── src/                      # Worker API 入口与业务逻辑
│   └── README.md                 # Cloudflare 部署说明
│
└── frontend/                     # Vue 3 前端 (端口 3000)
    ├── vite.config.js            # Vite 配置，默认代理 /api → localhost:8787
    ├── package.json
    └── src/
        ├── main.js
        ├── App.vue               # 顶部导航 + 布局
        ├── router/index.js       # 路由表
        ├── stores/auth.js        # Pinia 认证状态
        ├── api/axios.js          # Axios 实例 + JWT 拦截器
        ├── utils/format.js       # 时间/金额/百分比格式化
        └── views/
            ├── Home.vue          # 首页：平台统计概览
            ├── Login.vue         # 登录
            ├── Register.vue      # 三步注册（填写信息 → 邮箱验证 → 完成）
            ├── Matches.vue       # 比赛列表：筛选 + 同步按钮
            ├── MatchDetail.vue   # 比赛详情：多博彩公司赔率 + 下注表单
            ├── MyBets.vue        # 我的注单：历史记录 + 盈亏统计
            ├── Profile.vue       # 个人中心：余额 / 兑换码 / 统计
            ├── Leaderboard.vue   # 排行榜：综合评分排名
            └── OddsValidation.vue # 赔率对比：不同博彩公司真实赔率差异
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | Vue 3 (Composition API) + Vite 5 |
| UI 组件库 | Element Plus 2.4 |
| 状态管理 | Pinia 2.1 |
| HTTP 客户端 | Axios 1.6（JWT 自动注入） |
| 后端框架 | Flask 3.0 |
| ORM | Flask-SQLAlchemy 3.1（SQLite / PostgreSQL） |
| 认证 | Flask-JWT-Extended 4.6（JWT，24h 过期） |
| 密码加密 | bcrypt 4.1 |
| 赛程数据 | football-data.org（当前实现需要 API Key） |
| 赔率数据 | The Odds API（免费 500 次/月） |

## 数据库设计

```
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│    users     │       │   matches    │       │     odds     │
├──────────────┤       ├──────────────┤       ├──────────────┤
│ id           │       │ id           │◄──┐   │ id           │
│ username     │       │ external_id  │   │   │ match_id (FK)│──┐
│ email        │       │ sport        │   │   │ bookmaker    │  │
│ password_hash│       │ league       │   ├───│ market       │  │
│ balance      │       │ home_team    │   │   │ home_odds    │  │
│ email_verified│      │ away_team    │   │   │ away_odds    │  │
│ verify_code  │       │ start_time   │   │   │ draw_odds    │  │
│ created_at   │       │ status       │   │   │ updated_at   │  │
└──────┬───────┘       │ home_score   │   │   └──────────────┘  │
       │               │ away_score   │   │                     │
       │               │ created_at   │   │   ┌──────────────┐  │
       │               └──────────────┘   │   │     bets     │  │
       │                                  │   ├──────────────┤  │
       │               ┌──────────────────┘   │ id           │  │
       └───────────────│──────────────────────│ user_id (FK) │  │
                       │                      │ match_id(FK) │──┘
                       │                      │ bet_type     │
                       │                      │ selection    │
                       │                      │ odds         │
                       │                      │ amount       │
                       │                      │ potential_win│
                       │                      │ status       │
                       │                      │ profit       │
                       │                      │ created_at   │
                       │                      └──────────────┘
```

**比赛状态：** upcoming → live → finished / postponed / cancelled

**注单状态：** pending → won / lost / cancelled（结算功能未实现）

## 数据来源

| 数据源 | 提供内容 | 说明 |
|--------|----------|------|
| [football-data.org](https://www.football-data.org/) | 赛程 | 免费，覆盖英超/西甲/德甲/意甲/法甲/欧冠/英冠/荷甲/葡超/巴甲 |
| [The Odds API](https://the-odds-api.com/) | 赔率 | 免费 500 次/月，返回多家博彩公司（Bet365、William Hill 等）的真实赔率 |
| [OpenLigaDB](https://www.openligadb.de/) | 德甲赛程 | 完全免费，作为 football-data.org 的补充 |

## API 端点

所有端点前缀 `/api`：

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/auth/register` | 注册（含邮箱验证码） | - |
| POST | `/auth/login` | 登录，返回 JWT | - |
| GET | `/auth/profile` | 获取当前用户信息 | JWT |
| POST | `/auth/redeem` | 兑换虚拟金币 | JWT |
| POST | `/auth/send-verify-code` | 发送邮箱验证码 | - |
| POST | `/auth/verify-email` | 验证邮箱 | - |
| GET | `/matches/` | 比赛列表（支持筛选） | - |
| GET | `/matches/<id>` | 比赛详情 + 所有赔率 | - |
| GET | `/matches/leagues` | 联赛列表 | - |
| POST | `/matches/sync` | 从 The Odds API 同步赔率 | JWT |
| POST | `/matches/sync-schedule` | 从 football-data.org 同步赛程 | JWT |
| POST | `/matches/sync-all` | 一键同步（赛程 + 赔率） | JWT |
| GET | `/matches/validate-odds` | 赔率对比（多博彩公司差异） | - |
| POST | `/bets/` | 下注 | JWT |
| GET | `/bets/` | 我的注单列表 | JWT |
| GET | `/bets/<id>` | 注单详情 | JWT |
| GET | `/stats/me` | 个人投注统计 | JWT |
| GET | `/stats/leaderboard` | 排行榜 | - |
| GET | `/stats/homepage` | 首页聚合数据 | - |

## 快速开始

### 1. 获取 API Key

访问 [The Odds API](https://the-odds-api.com) 注册获取免费 API Key（500 次/月）。

可选地再申请一个 `FOOTBALL_DATA_API_KEY` 用于赛程同步。

**最低可运行配置：**
- 只配置 `ODDS_API_KEY`：可以跑通项目，并通过赔率接口同步比赛 + 赔率
- 同时配置 `ODDS_API_KEY` 和 `FOOTBALL_DATA_API_KEY`：可以使用完整的赛程同步功能

### 2. 后端

目前仓库里有两套后端。本地默认启动脚本和前端代理都使用 Worker 版后端：

- `backend-worker/`：Cloudflare Workers + D1 版本，当前主线，适合本地开发和 Cloudflare 部署
- `backend/`：Flask 旧版/备选版本，适合传统服务器实验

#### 2a. 推荐：Cloudflare Workers 后端

```bash
cd backend-worker
npm install
cp .dev.vars.example .dev.vars  # 编辑 .dev.vars，填写 Firebase/API Key
npm run typegen
npm run migrate:local
npm run dev                     # 启动在 localhost:8787
```

前端默认会把 `/api` 代理到 `localhost:8787`。根目录的 `start.bat` / `start.sh` 也会启动 Worker 后端和前端。

#### 2b. 备选：Flask 后端

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # 编辑 .env，至少填入 ODDS_API_KEY
python run.py                   # 启动在 localhost:5000
```

如需让前端连接 Flask 后端，可设置 `frontend/.env.local`：`VITE_API_PROXY_TARGET=http://localhost:5000`。

### 3. 前端

```bash
cd frontend
npm install
npm run dev                     # 启动在 localhost:3000
```

### 4. 初始化数据

```bash
python init_data.py             # 创建表 + 直接初始化数据（不要求后端先启动）
```

或由管理员在前端赛事页面点击"一键同步"按钮。

说明：
- 若未配置 `FOOTBALL_DATA_API_KEY`，`sync-schedule` 会明确报错
- `sync-all` 会继续执行赔率同步，并返回“赛程未同步 + 赔率同步结果”的组合提示

### 5. 测试用兑换码

| 兑换码 | 金币 |
|--------|------|
| `can666` | 10,000 |
| `test888` | 5,000 |
| `vip2024` | 20,000 |

## 已知问题

- **投注未结算：** 没有自动结算逻辑，所有注单永久处于"待结算"状态
- **邮箱验证为测试模式：** 验证码直接在 API 响应中返回，未实际发送邮件
- **Celery/Redis 未使用：** `requirements.txt` 中引入但未实际部署后台任务
- **球队名翻译不完整：** 翻译映射表约覆盖 150 支球队 + 30 个联赛，冷门球队会显示英文名
- **football-data 赛程同步依赖额外 key：** 当前 `football-data.org` 接口需要 `FOOTBALL_DATA_API_KEY`

## Cloudflare 部署

现在仓库已经包含 `backend-worker/`，可以作为 Cloudflare 部署版本继续使用。

- **前端**：部署到 Cloudflare Pages
- **后端**：部署 `backend-worker/` 到 Cloudflare Workers
- **数据库**：使用 Cloudflare D1

部署前还需要做的事：

1. 执行 `wrangler d1 create betting-simulator-db`
2. 把返回的 `database_id` / `preview_database_id` 填到 `backend-worker/wrangler.jsonc`
3. 用 `wrangler secret put` 配置 `FIREBASE_API_KEY`、`FIREBASE_PROJECT_ID`、`ODDS_API_KEY`、`FOOTBALL_DATA_API_KEY`
4. 执行 `wrangler d1 migrations apply betting-simulator-db --remote`
5. 执行 `wrangler deploy`

## 免责声明

本网站仅供娱乐和学习用途，不涉及真实金钱交易。所有投注均为虚拟行为，投注结果不影响任何真实利益。请理性娱乐，切勿沉迷。

## License

MIT
