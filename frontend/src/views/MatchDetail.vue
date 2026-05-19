<template>
  <div class="match-detail" v-if="match">
    <el-card class="match-card">
      <div class="match-header">
        <div class="league">{{ match.league }}</div>
        <div class="time">
          <el-tag v-if="displayStatus === 'live'" type="danger">进行中</el-tag>
          <el-tag v-else-if="displayStatus === 'finished'" type="info">已结束</el-tag>
          <el-tag v-else-if="displayStatus === 'locked'" type="warning">已开赛</el-tag>
          {{ formatTime(match.start_time) }}
        </div>
      </div>

      <div class="teams-section">
        <div class="team home">
          <h2>{{ match.home_team }}</h2>
          <span class="label">主队</span>
        </div>
        <div class="score-section" v-if="displayStatus === 'finished' || displayStatus === 'live'">
          <div class="score">
            <span class="score-value">{{ match.home_score ?? 0 }}</span>
            <span class="score-divider">:</span>
            <span class="score-value">{{ match.away_score ?? 0 }}</span>
          </div>
        </div>
        <div class="vs" v-else>VS</div>
        <div class="team away">
          <h2>{{ match.away_team }}</h2>
          <span class="label">客队</span>
        </div>
      </div>
    </el-card>

    <!-- 下注区域（仅未开始比赛显示） -->
    <el-card class="betting-card" v-if="canBet && match.avg_odds">
      <template #header>
        <div class="card-header">
          <h3>下注区域</h3>
          <el-button type="text" @click="showOddsSources = true">
            <el-icon><View /></el-icon>
            查看数据来源
          </el-button>
        </div>
      </template>

      <el-alert
        v-if="authStore.isAuthenticated && !authStore.isEmailVerified"
        title="邮箱尚未验证，当前无法下注。请先到个人中心完成邮箱验证。"
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom: 16px"
      />

      <div class="avg-odds-section">
        <p class="avg-label">平均赔率（{{ match.odds_count }} 家博彩公司）</p>
        <div class="odds-options">
          <div
            class="odd-option"
            :class="{ selected: betSelection === 'home' }"
            @click="selectOdds('home')"
            v-if="match.avg_odds.home"
          >
            <div class="odd-label">主胜</div>
            <div class="odd-value">{{ match.avg_odds.home }}</div>
          </div>
          <div
            class="odd-option"
            :class="{ selected: betSelection === 'draw' }"
            @click="selectOdds('draw')"
            v-if="match.allow_draw && match.avg_odds.draw"
          >
            <div class="odd-label">平局</div>
            <div class="odd-value">{{ match.avg_odds.draw }}</div>
          </div>
          <div
            class="odd-option"
            :class="{ selected: betSelection === 'away' }"
            @click="selectOdds('away')"
            v-if="match.avg_odds.away"
          >
            <div class="odd-label">客胜</div>
            <div class="odd-value">{{ match.avg_odds.away }}</div>
          </div>
        </div>
      </div>

      <div class="bet-form" v-show="betSelection">
        <el-divider />
        <h4>下注信息</h4>
        <el-form label-width="100px">
          <el-form-item label="选择结果">
            <el-tag size="large">{{ getSelectionText(betSelection) }}</el-tag>
            <span class="odds-display">赔率: {{ getSelectedOdds() }}</span>
          </el-form-item>

          <el-form-item label="下注金额">
            <div class="amount-input">
              <el-input-number
                v-model="betAmount"
                :min="10"
                :max="authStore.balance"
                :step="100"
                size="large"
              />
              <div class="quick-amounts">
                <el-button @click="betAmount = 100">100</el-button>
                <el-button @click="betAmount = 500">500</el-button>
                <el-button @click="betAmount = 1000">1000</el-button>
                <el-button @click="betAmount = 5000">5000</el-button>
                <el-button @click="betAmount = authStore.balance">全部</el-button>
              </div>
            </div>
            <span class="balance-hint">可用余额: {{ authStore.balance?.toFixed(2) }}</span>
          </el-form-item>

          <el-form-item label="预计收益">
            <span class="potential-win">{{ potentialWin.toFixed(2) }}</span>
            <span class="profit-hint">（盈利 {{ (potentialWin - betAmount).toFixed(2) }}）</span>
          </el-form-item>

          <el-form-item>
            <el-button
              type="primary"
              @click="placeBet"
              :loading="betting"
              :disabled="authStore.isAuthenticated && !authStore.isEmailVerified"
              size="large"
              class="bet-button"
            >
              确认下注 {{ betAmount }} 元
            </el-button>
          </el-form-item>
        </el-form>
      </div>
    </el-card>

    <!-- 已结束比赛 -->
    <el-card v-else-if="displayStatus === 'finished'">
      <el-result
        icon="success"
        title="比赛已结束"
        :sub-title="`${match.home_score} - ${match.away_score}`"
      />
    </el-card>

    <!-- 进行中比赛 -->
    <el-card v-else-if="displayStatus === 'live'">
      <el-result
        icon="info"
        title="比赛进行中"
        :sub-title="`当前比分: ${match.home_score ?? 0} - ${match.away_score ?? 0}`"
      />
    </el-card>

    <!-- 暂无赔率（未开始但无赔率数据） -->
    <el-card v-else-if="displayStatus === 'locked'">
      <el-result
        icon="warning"
        title="比赛已经开始"
        sub-title="已停止下注，等待赛果同步"
      />
    </el-card>

    <!-- 暂无赔率（未开始但无赔率数据） -->
    <el-card v-else-if="canBet">
      <el-empty description="暂无赔率数据，请先同步赔率">
        <el-button type="primary" @click="router.push('/matches')">返回赛事列表</el-button>
      </el-empty>
    </el-card>

    <!-- 其他状态 -->
    <el-card v-else>
      <el-empty :description="`比赛状态: ${displayStatus}`" />
    </el-card>

    <!-- 数据来源弹窗 -->
    <el-dialog v-model="showOddsSources" title="赔率数据来源" width="800px">
      <el-table :data="match.odds" border stripe>
        <el-table-column prop="bookmaker" label="博彩公司" width="150" />
        <el-table-column label="主胜" width="100">
          <template #default="{ row }">
            <span :class="{ highlight: isHighest(row, 'home') }">{{ row.home_odds }}</span>
          </template>
        </el-table-column>
        <el-table-column label="平局" width="100">
          <template #default="{ row }">
            <span :class="{ highlight: isHighest(row, 'draw') }">{{ row.draw_odds }}</span>
          </template>
        </el-table-column>
        <el-table-column label="客胜" width="100">
          <template #default="{ row }">
            <span :class="{ highlight: isHighest(row, 'away') }">{{ row.away_odds }}</span>
          </template>
        </el-table-column>
        <el-table-column label="更新时间">
          <template #default="{ row }">
            {{ formatUpdateTime(row.updated_at) }}
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>

  <div v-else class="loading">
    <el-icon class="is-loading"><Loading /></el-icon>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Loading, View } from '@element-plus/icons-vue'
import { useAuthStore } from '../stores/auth'
import api from '../api/axios'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const match = ref(null)
const betSelection = ref('')
const betAmount = ref(100)
const betting = ref(false)
const showOddsSources = ref(false)
const nowMs = ref(Date.now())
let clockTimer = null

const matchStartMs = computed(() => {
  const startMs = new Date(match.value?.start_time || '').getTime()
  return Number.isFinite(startMs) ? startMs : null
})

const displayStatus = computed(() => {
  if (match.value?.status === 'upcoming') {
    if (matchStartMs.value === null || nowMs.value >= matchStartMs.value) {
      return 'locked'
    }
  }
  return match.value?.status
})

const canBet = computed(() => displayStatus.value === 'upcoming')

const potentialWin = computed(() => {
  if (!match.value?.avg_odds || !betSelection.value) return 0

  let odds = 0
  if (betSelection.value === 'home') odds = match.value.avg_odds.home
  else if (betSelection.value === 'draw') odds = match.value.avg_odds.draw
  else if (betSelection.value === 'away') odds = match.value.avg_odds.away

  if (!odds || isNaN(odds)) return 0
  return betAmount.value * Number(odds)
})

const getSelectionText = (selection) => {
  const map = {
    home: '主胜',
    draw: '平局',
    away: '客胜'
  }
  return map[selection] || ''
}

const getSelectedOdds = () => {
  if (!match.value?.avg_odds || !betSelection.value) return 0
  let odds = 0
  if (betSelection.value === 'home') odds = match.value.avg_odds.home
  if (betSelection.value === 'draw') odds = match.value.avg_odds.draw
  if (betSelection.value === 'away') odds = match.value.avg_odds.away
  return odds && !isNaN(odds) ? Number(odds) : 0
}

const selectOdds = (type) => {
  betSelection.value = type
}

const formatTime = (timeString) => {
  if (!timeString) return ''
  const date = new Date(timeString)
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

const formatUpdateTime = (timeString) => {
  if (!timeString) return ''
  const date = new Date(timeString)
  return date.toLocaleString('zh-CN')
}

const isHighest = (row, type) => {
  if (!match.value?.odds || match.value.odds.length === 0) return false
  const values = match.value.odds
    .map(o => o[`${type}_odds`])
    .filter(v => v != null && !isNaN(v))
  if (values.length === 0) return false
  return Number(row[`${type}_odds`]) === Math.max(...values)
}

const fetchMatch = async () => {
  try {
    const response = await api.get(`/matches/${route.params.id}`)
    const data = response.data?.match

    if (!data || !data.id) {
      ElMessage.error('比赛数据无效')
      router.push('/matches')
      return
    }

    // 确保 odds 是数组且数值为数字类型
    if (Array.isArray(data.odds)) {
      data.odds = data.odds.map(o => ({
        ...o,
        home_odds: o.home_odds != null ? Number(o.home_odds) : null,
        draw_odds: o.draw_odds != null ? Number(o.draw_odds) : null,
        away_odds: o.away_odds != null ? Number(o.away_odds) : null,
      }))
    }

    // 确保 avg_odds 存在
    if (!data.avg_odds && Array.isArray(data.odds) && data.odds.length > 0) {
      const homeOdds = data.odds.map(o => o.home_odds).filter(v => v != null && !isNaN(v))
      const drawOdds = data.odds.map(o => o.draw_odds).filter(v => v != null && !isNaN(v))
      const awayOdds = data.odds.map(o => o.away_odds).filter(v => v != null && !isNaN(v))

      data.avg_odds = {
        home: homeOdds.length ? Number((homeOdds.reduce((a, b) => a + b, 0) / homeOdds.length).toFixed(2)) : null,
        draw: drawOdds.length ? Number((drawOdds.reduce((a, b) => a + b, 0) / drawOdds.length).toFixed(2)) : null,
        away: awayOdds.length ? Number((awayOdds.reduce((a, b) => a + b, 0) / awayOdds.length).toFixed(2)) : null
      }
    }

    match.value = data
  } catch (error) {
    console.error('Failed to fetch match:', error)
    ElMessage.error('获取比赛信息失败')
    router.push('/matches')
  }
}

const placeBet = async () => {
  if (!authStore.isAuthenticated) {
    ElMessage.warning('请先登录')
    router.push('/login')
    return
  }

  if (!authStore.isEmailVerified) {
    ElMessage.warning('请先完成邮箱验证，再进行下注')
    router.push('/profile')
    return
  }

  if (!betSelection.value) {
    ElMessage.warning('请选择投注结果')
    return
  }

  if (betAmount.value <= 0) {
    ElMessage.warning('请输入有效的投注金额')
    return
  }

  const currentMatchStartMs = new Date(match.value?.start_time || '').getTime()
  if (!Number.isFinite(currentMatchStartMs)) {
    ElMessage.error('比赛时间异常，无法下注')
    return
  }

  if (Date.now() >= currentMatchStartMs) {
    ElMessage.warning('比赛已经开始，无法下注')
    return
  }

  // 获取对应赔率
  let odds = 0
  if (betSelection.value === 'home') odds = match.value.avg_odds?.home
  else if (betSelection.value === 'draw') odds = match.value.avg_odds?.draw
  else if (betSelection.value === 'away') odds = match.value.avg_odds?.away

  if (!odds || isNaN(odds)) {
    ElMessage.warning('赔率数据无效')
    return
  }

  betting.value = true
  try {
    const response = await api.post('/bets/', {
      match_id: match.value.id,
      bet_type: 'h2h',
      selection: betSelection.value,
      odds: odds,
      amount: betAmount.value
    })

    ElMessage.success('下注成功！')
    authStore.fetchProfile()
    router.push('/my-bets')
  } catch (error) {
    ElMessage.error(error.response?.data?.error || '下注失败')
  } finally {
    betting.value = false
  }
}

onMounted(() => {
  fetchMatch()
  clockTimer = window.setInterval(() => {
    nowMs.value = Date.now()
  }, 30000)
})

onUnmounted(() => {
  if (clockTimer) {
    window.clearInterval(clockTimer)
  }
})
</script>

<style scoped>
.match-detail {
  max-width: 900px;
  margin: 0 auto;
}

.match-card {
  margin-bottom: 20px;
}

.match-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 20px;
}

.league {
  background: #667eea;
  color: white;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 14px;
}

.time {
  color: #666;
  display: flex;
  align-items: center;
  gap: 8px;
}

.teams-section {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 40px;
  padding: 20px 0;
}

.team {
  text-align: center;
}

.team h2 {
  font-size: 28px;
  margin-bottom: 8px;
}

.team .label {
  color: #666;
  font-size: 14px;
}

.vs {
  font-size: 24px;
  color: #999;
}

.score-section {
  padding: 0 20px;
}

.score {
  display: flex;
  align-items: center;
  gap: 12px;
}

.score-value {
  font-size: 48px;
  font-weight: bold;
  color: #333;
}

.score-divider {
  font-size: 36px;
  color: #999;
}

.betting-card {
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-header h3 {
  margin: 0;
}

.avg-odds-section {
  text-align: center;
}

.avg-label {
  color: #666;
  margin-bottom: 16px;
}

.odds-options {
  display: flex;
  justify-content: center;
  gap: 20px;
}

.odd-option {
  text-align: center;
  padding: 20px 40px;
  background: #f8f9fa;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.3s;
  border: 2px solid transparent;
}

.odd-option:hover {
  border-color: #667eea;
}

.odd-option.selected {
  border-color: #667eea;
  background: #e8ecff;
}

.odd-label {
  font-size: 16px;
  color: #666;
  margin-bottom: 8px;
}

.odd-value {
  font-size: 32px;
  font-weight: bold;
  color: #667eea;
}

.bet-form {
  margin-top: 20px;
}

.balance-hint {
  margin-left: 12px;
  color: #666;
}

.potential-win {
  font-size: 28px;
  font-weight: bold;
  color: #67c23a;
}

.profit-hint {
  color: #67c23a;
  margin-left: 12px;
}

.odds-display {
  margin-left: 16px;
  color: #667eea;
  font-weight: bold;
}

.amount-input {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.quick-amounts {
  display: flex;
  gap: 8px;
}

.bet-button {
  width: 100%;
  height: 50px;
  font-size: 18px;
}

.loading {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 400px;
}

.loading .el-icon {
  font-size: 48px;
  color: #667eea;
}

.highlight {
  color: #67c23a;
  font-weight: bold;
}

@media (max-width: 768px) {
  .match-detail {
    max-width: none;
  }

  .match-header,
  .card-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .teams-section {
    gap: 14px;
  }

  .team h2 {
    font-size: 18px;
    word-break: break-word;
  }

  .vs {
    padding: 0 8px;
  }

  .score-value {
    font-size: 26px;
  }

  .odds-options {
    flex-direction: column;
    gap: 10px;
  }

  .odd-option {
    width: 100%;
    min-width: 0;
    padding: 14px;
  }

  .amount-input,
  .quick-amounts {
    width: 100%;
  }

  .quick-amounts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .quick-amounts .el-button {
    width: 100%;
    margin-left: 0;
  }

  .amount-input :deep(.el-input-number),
  .bet-button {
    width: 100%;
  }

  :deep(.el-form-item__label) {
    width: auto !important;
  }

  :deep(.el-dialog) {
    width: 94vw !important;
  }
}
</style>
