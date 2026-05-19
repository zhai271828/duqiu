# Bug 修复报告

**日期：** 2026-05-15
**修复人：** Claude Code

---

## 问题描述

用户报告了两个问题：
1. 比赛时间显示不正确
2. 点击赛事详情页后白屏

---

## Bug 1：比赛时间显示不正确

### 根因

有两层问题叠加：

**问题 1a：ISO 字符串缺少时区标识（主要原因）**

SQLite 返回的 datetime 是 naive 的（无时区信息）。`isoformat()` 生成的字符串如 `'2026-05-16T19:00:00'` 没有 `+00:00` 后缀。JavaScript 的 `new Date('2026-05-16T19:00:00')` 会将其解释为**本地时间**（浏览器 UTC+8），而不是 UTC。导致所有时间多了 8 小时。

```
存储: UTC 19:00
API 返回: '2026-05-16T19:00:00' (无 +00:00)
JS 解析: 本地时间 19:00 = UTC 11:00  ← 错了！差 8 小时
显示: 北京时间 19:00  ← 应该是 03:00(+1天)
```

**问题 1b：日期筛选时区不一致**

后端用 UTC 零点算"今天"边界，前端显示北京时间。在 UTC 16:00-24:00 期间（北京次日 00:00-08:00），后端已进入新的一天但北京还是"今天"。

### 修复方案

**文件：** `backend/app/models/match.py`、`backend/app/models/bet.py`、`backend/app/models/user.py`

所有 `to_dict()` 方法中的时间字段统一追加 `+00:00`：

```python
# 修复前
'start_time': self.start_time.isoformat(),        # → '2026-05-16T19:00:00'
'updated_at': self.updated_at.isoformat(),         # → '2026-05-16T19:00:00'
'created_at': self.created_at.isoformat(),         # → '2026-05-16T19:00:00'

# 修复后
'start_time': self._to_utc_iso(self.start_time),   # → '2026-05-16T19:00:00+00:00'
'updated_at': updated_str,                          # → '2026-05-16T19:00:00+00:00'
'created_at': created_str,                          # → '2026-05-16T19:00:00+00:00'
```

`_to_utc_iso` 辅助方法：去掉可能存在的 tzinfo 后追加 `+00:00`，确保 naive 和 aware datetime 都能正确处理。

**文件：** `backend/app/routes/matches.py`

日期筛选从 UTC 改为北京时间：

```python
# 修复前
now = datetime.utcnow()
today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

# 修复后
beijing_offset = timedelta(hours=8)
now_utc = datetime.utcnow()
today_start_utc = (now_utc + beijing_offset).replace(
    hour=0, minute=0, second=0, microsecond=0
) - beijing_offset
```

核心思路：先将 UTC 时间转为北京时间，取北京时间的 00:00，再转回 UTC 做数据库查询。

---

## Bug 2：赛事详情页白屏

### 根因

`MatchDetail.vue` 中存在多处 null 安全问题，当比赛没有赔率数据时触发 JavaScript 错误导致页面崩溃。

**触发条件：**
- 用户通过"同步赛程"按钮从 football-data.org 同步了比赛（无赔率）
- 或 The Odds API 未配置/配额用尽，只同步了赛程没有赔率
- 此时 `match.avg_odds` 为 `null`

**崩溃点分析：**

1. **`potentialWin` 计算属性**（主要原因）
   ```javascript
   // 修复前 - odds 可能是 NaN 或 null
   return betAmount.value * odds

   // 修复后
   if (!odds || isNaN(odds)) return 0
   return betAmount.value * Number(odds)
   ```

2. **`fetchMatch` 数据处理**
   - API 返回的赔率值可能是字符串而非数字（数据库 `Numeric` 类型）
   - `avg_odds` 手动计算时未做类型转换
   - 修复：添加 `Number()` 转换和 `NaN` 检查

3. **`isHighest` 函数**
   ```javascript
   // 修复前 - 空数组时 Math.max() 返回 -Infinity
   return row[`${type}_odds`] === Math.max(...values)

   // 修复后 - 添加空数组保护
   if (values.length === 0) return false
   return Number(row[`${type}_odds`]) === Math.max(...values)
   ```

4. **`getSelectedOdds` 函数**
   - 修复：添加 null/NaN 检查，返回数字类型

5. **`placeBet` 下注函数**
   - 修复：添加赔率有效性检查，无效时弹出提示而非提交

6. **模板"暂无赔率"状态**
   - 修复：为"未开始但无赔率"增加专门的 `v-else-if` 分支，显示提示和返回按钮

### 修复方案

**文件：** `frontend/src/views/MatchDetail.vue`

修改了以下内容：
- `fetchMatch`：添加响应数据验证、赔率值 `Number()` 转换、`avg_odds` 计算时的 NaN 过滤
- `potentialWin`：添加 `isNaN` 检查
- `getSelectedOdds`：添加 null/NaN 保护，确保返回数字
- `isHighest`：添加空数组保护，比较前做 `Number()` 转换
- `placeBet`：添加赔率有效性检查
- 模板：为无赔率的比赛增加专门的空状态展示

---

## 关联问题：赔率数据来源

在排查过程中发现，football-data.org 和 The Odds API 使用不同的比赛 ID 体系：
- football-data.org: `external_id = "fd_12345"`
- The Odds API: `external_id = "odds_api_abc123"`

这意味着两个数据源的比赛不会自动关联。通过"同步赛程"获取的比赛不会有赔率，需要通过"同步赔率"单独获取 The Odds API 的比赛和赔率，或使用"一键同步"同时获取。

---

## 修改的文件

| 文件 | 修改内容 |
|------|----------|
| `backend/app/models/match.py` | `to_dict()` 时间字段追加 `+00:00` 时区标识 |
| `backend/app/models/bet.py` | `to_dict()` 时间字段追加 `+00:00` 时区标识 |
| `backend/app/models/user.py` | `to_dict()` 时间字段追加 `+00:00` 时区标识 |
| `backend/app/routes/matches.py` | 日期筛选从 UTC 改为北京时间 |
| `frontend/src/views/MatchDetail.vue` | 添加 null 安全检查、类型转换、空状态处理 |

---

## 验证方法

1. 启动后端和前端
2. 登录后点击"一键同步"或分别同步赛程和赔率
3. 检查比赛时间是否显示为正确的北京时间
4. 检查"今天"/"明天"筛选是否与北京时间一致
5. 点击一场有赔率的比赛，确认详情页正常显示
6. 点击一场无赔率的比赛，确认显示"暂无赔率数据"提示而非白屏
