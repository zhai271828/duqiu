<template>
  <div class="matches">
    <div class="matches-header">
      <h1>赛事列表</h1>
      <div class="filters">
        <el-radio-group v-model="selectedDate" @change="fetchMatches">
          <el-radio-button label="today">今天</el-radio-button>
          <el-radio-button label="tomorrow">明天</el-radio-button>
          <el-radio-button label="all">全部</el-radio-button>
        </el-radio-group>

        <el-select v-model="selectedLeague" placeholder="选择联赛" clearable @change="fetchMatches">
          <el-option
            v-for="league in leagues"
            :key="league"
            :label="league"
            :value="league"
          />
        </el-select>

        <el-checkbox v-model="showFinished" @change="fetchMatches">显示已结束</el-checkbox>

        <el-button v-if="canSyncMatches" type="primary" @click="syncAll" :loading="syncingAll">
          <el-icon><Refresh /></el-icon>
          一键同步
        </el-button>

        <el-button v-if="canSyncMatches" @click="syncSchedule" :loading="syncingSchedule">
          <el-icon><Download /></el-icon>
          同步赛程
        </el-button>

        <el-button v-if="canSyncMatches" @click="syncOdds" :loading="syncingOdds">
          <el-icon><Download /></el-icon>
          同步赔率
        </el-button>
      </div>
    </div>

    <div class="api-info" v-if="canSyncMatches && apiRemaining !== null">
      <el-tag type="info">API 剩余请求次数: {{ apiRemaining }}</el-tag>
    </div>

    <div class="matches-grid" v-if="matches.length > 0">
      <div
        v-for="match in filteredMatches"
        :key="match.id"
        class="match-card"
        :class="{
          finished: getDisplayStatus(match) === 'finished',
          live: getDisplayStatus(match) === 'live',
          locked: getDisplayStatus(match) === 'locked'
        }"
        @click="goToMatch(match.id)"
      >
        <div class="match-header">
          <div class="match-league">{{ match.league }}</div>
          <div class="match-time">
            <el-tag v-if="getDisplayStatus(match) === 'live'" type="danger" size="small">进行中</el-tag>
            <el-tag v-else-if="getDisplayStatus(match) === 'finished'" type="info" size="small">已结束</el-tag>
            <el-tag v-else-if="getDisplayStatus(match) === 'locked'" type="warning" size="small">已开赛</el-tag>
            {{ formatTime(match.start_time) }}
          </div>
        </div>

        <div class="match-teams">
          <div class="team home">
            <span class="team-name">{{ match.home_team }}</span>
          </div>
          <div class="score" v-if="getDisplayStatus(match) === 'finished' || getDisplayStatus(match) === 'live'">
            <span class="score-value">{{ match.home_score ?? 0 }}</span>
            <span class="score-divider">:</span>
            <span class="score-value">{{ match.away_score ?? 0 }}</span>
          </div>
          <div class="vs" v-else>VS</div>
          <div class="team away">
            <span class="team-name">{{ match.away_team }}</span>
          </div>
        </div>

        <div class="match-odds" v-if="match.avg_odds && getDisplayStatus(match) === 'upcoming'">
          <div class="odds-row">
            <div class="odd-item" v-if="match.avg_odds.home">
              <span class="odd-label">{{ getSelectionLabel(match, 'home') }}</span>
              <span class="odd-value">{{ match.avg_odds.home }}</span>
            </div>
            <div class="odd-item" v-if="match.avg_odds.draw">
              <span class="odd-label">{{ getSelectionLabel(match, 'draw') }}</span>
              <span class="odd-value">{{ match.avg_odds.draw }}</span>
            </div>
            <div class="odd-item" v-if="match.avg_odds.away">
              <span class="odd-label">{{ getSelectionLabel(match, 'away') }}</span>
              <span class="odd-value">{{ match.avg_odds.away }}</span>
            </div>
          </div>
          <div class="bookmakers-count">
            {{ match.odds_count }} 家博彩公司平均赔率
          </div>
        </div>

        <div class="match-odds" v-else-if="getDisplayStatus(match) === 'upcoming'">
          <div class="no-odds">暂无赔率数据</div>
        </div>
        <div class="match-odds" v-else-if="getDisplayStatus(match) === 'locked'">
          <div class="no-odds">比赛已经开始，停止下注</div>
        </div>
      </div>
    </div>

    <div v-else-if="loading" class="loading-container">
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>加载中...</span>
    </div>

    <div v-else class="empty-container">
      <el-empty :description="`暂无${selectedDate === 'today' ? '今天' : selectedDate === 'tomorrow' ? '明天' : ''}的赛事数据`" />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { Loading, Refresh, Download } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import api from '../api/axios'
import { useAuthStore } from '../stores/auth'
import { getMatchSelectionTexts } from '../utils/format'

const router = useRouter()
const authStore = useAuthStore()
const matches = ref([])
const leagues = ref([])
const selectedLeague = ref('')
const selectedDate = ref('today')
const showFinished = ref(true)
const loading = ref(false)
const syncingAll = ref(false)
const syncingSchedule = ref(false)
const syncingOdds = ref(false)
const apiRemaining = ref(null)
const nowMs = ref(Date.now())
let clockTimer = null

const filteredMatches = computed(() => {
  if (!selectedLeague.value) return matches.value
  return matches.value.filter(m => m.league === selectedLeague.value)
})

const canSyncMatches = computed(() => authStore.isAuthenticated && authStore.isAdmin)
const getSelectionLabel = (match, selection) => getMatchSelectionTexts(match)?.[selection] || ''

const getMatchStartMs = (match) => {
  const startMs = new Date(match?.start_time || '').getTime()
  return Number.isFinite(startMs) ? startMs : null
}

const getDisplayStatus = (match) => {
  if (match?.status === 'upcoming') {
    const startMs = getMatchStartMs(match)
    if (startMs === null || nowMs.value >= startMs) {
      return 'locked'
    }
  }
  return match?.status
}

const getBeijingDateParts = (date) => {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })

  const parts = {}
  formatter.formatToParts(date).forEach((part) => {
    if (part.type !== 'literal') {
      parts[part.type] = part.value
    }
  })

  return parts
}

const formatTime = (timeString) => {
  if (!timeString) return ''
  const date = new Date(timeString)
  const now = new Date()
  const matchParts = getBeijingDateParts(date)
  const todayParts = getBeijingDateParts(now)
  const timePart = `${matchParts.hour}:${matchParts.minute}`

  if (
    matchParts.year === todayParts.year &&
    matchParts.month === todayParts.month &&
    matchParts.day === todayParts.day
  ) {
    return `今天 ${timePart}`
  }

  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const tomorrowParts = getBeijingDateParts(tomorrow)

  if (
    matchParts.year === tomorrowParts.year &&
    matchParts.month === tomorrowParts.month &&
    matchParts.day === tomorrowParts.day
  ) {
    return `明天 ${timePart}`
  }

  return `${matchParts.month}月${matchParts.day}日 ${timePart}`
}

const fetchMatches = async () => {
  loading.value = true
  try {
    const response = await api.get('/matches/', {
      params: {
        date: selectedDate.value,
        show_finished: showFinished.value
      }
    })
    matches.value = response.data.matches

    // 提取联赛列表
    const uniqueLeagues = [...new Set(matches.value.map(m => m.league))]
    leagues.value = uniqueLeagues
  } catch (error) {
    console.error('Failed to fetch matches:', error)
  } finally {
    loading.value = false
  }
}

const checkAdminAccess = () => {
  if (!authStore.isAuthenticated) {
    ElMessage.warning('请先登录再同步数据')
    router.push('/login')
    return false
  }
  if (!authStore.isAdmin) {
    ElMessage.warning('只有管理员可以同步赛事数据')
    return false
  }
  return true
}

const syncAll = async () => {
  if (!checkAdminAccess()) return
  syncingAll.value = true
  try {
    const response = await api.post('/matches/sync-all')
    if (response.data.results?.odds?.api_remaining) {
      apiRemaining.value = response.data.results.odds.api_remaining
    }
    ElMessage.success(response.data.message)
    await fetchMatches()
  } catch (error) {
    ElMessage.error('同步失败：' + (error.response?.data?.error || error.message))
  } finally {
    syncingAll.value = false
  }
}

const syncSchedule = async () => {
  if (!checkAdminAccess()) return
  syncingSchedule.value = true
  try {
    const response = await api.post('/matches/sync-schedule')
    ElMessage.success(response.data.message)
    await fetchMatches()
  } catch (error) {
    ElMessage.error('同步失败：' + (error.response?.data?.error || error.message))
  } finally {
    syncingSchedule.value = false
  }
}

const syncOdds = async () => {
  if (!checkAdminAccess()) return
  syncingOdds.value = true
  try {
    const response = await api.post('/matches/sync?force=true')
    apiRemaining.value = response.data.api_remaining
    ElMessage.success(response.data.message)
    await fetchMatches()
  } catch (error) {
    ElMessage.error('同步失败：' + (error.response?.data?.error || error.message))
  } finally {
    syncingOdds.value = false
  }
}

const goToMatch = (id) => {
  router.push(`/matches/${id}`)
}

onMounted(() => {
  fetchMatches()
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
.matches {
  max-width: 1200px;
  margin: 0 auto;
}

.matches-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 16px;
}

.matches-header h1 {
  font-size: 28px;
  color: #333;
  margin: 0;
}

.filters {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.api-info {
  margin-bottom: 20px;
}

.matches-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: 20px;
}

.match-card {
  background: white;
  border-radius: 12px;
  padding: 20px;
  cursor: pointer;
  transition: all 0.3s;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.match-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
}

.match-card.finished {
  opacity: 0.7;
  background: #f5f5f5;
}

.match-card.live {
  border-left: 4px solid #f56c6c;
}

.match-card.locked {
  opacity: 0.82;
  border-left: 4px solid #e6a23c;
}

.match-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.match-league {
  font-size: 12px;
  color: #fff;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 4px 12px;
  border-radius: 12px;
}

.match-time {
  font-size: 14px;
  color: #666;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
}

.match-teams {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.team {
  flex: 1;
  text-align: center;
}

.team-name {
  font-size: 18px;
  font-weight: 600;
  color: #333;
}

.vs {
  font-size: 16px;
  color: #999;
  padding: 0 16px;
  font-weight: bold;
}

.score {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
}

.score-value {
  font-size: 28px;
  font-weight: bold;
  color: #333;
}

.score-divider {
  font-size: 24px;
  color: #999;
}

.match-odds {
  border-top: 1px solid #eee;
  padding-top: 12px;
}

.odds-row {
  display: flex;
  justify-content: space-around;
  margin-bottom: 8px;
}

.odd-item {
  text-align: center;
  padding: 8px 16px;
  background: #f8f9fa;
  border-radius: 8px;
  min-width: 80px;
}

.odd-label {
  display: block;
  font-size: 12px;
  color: #666;
  margin-bottom: 4px;
}

.odd-value {
  font-size: 20px;
  font-weight: bold;
  color: #667eea;
}

.bookmakers-count {
  text-align: center;
  font-size: 12px;
  color: #999;
}

.no-odds {
  text-align: center;
  color: #999;
  padding: 12px;
}

.loading-container,
.empty-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px;
  color: #666;
}

.loading-container .el-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

@media (max-width: 768px) {
  .matches-header {
    align-items: stretch;
  }

  .matches-header h1 {
    font-size: 24px;
  }

  .filters,
  .filters :deep(.el-select),
  .filters :deep(.el-button) {
    width: 100%;
  }

  .filters :deep(.el-radio-group) {
    display: flex;
    width: 100%;
  }

  .filters :deep(.el-radio-button) {
    flex: 1;
  }

  .filters :deep(.el-radio-button__inner) {
    width: 100%;
  }

  .matches-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }

  .match-card {
    padding: 16px;
  }

  .match-header {
    align-items: flex-start;
    gap: 10px;
  }

  .match-time {
    flex-wrap: wrap;
    justify-content: flex-end;
    text-align: right;
  }

  .team-name {
    font-size: 16px;
    word-break: break-word;
  }

  .vs,
  .score {
    padding: 0 8px;
  }

  .odds-row {
    gap: 8px;
  }

  .odd-item {
    min-width: 0;
    flex: 1;
    padding: 8px;
  }

  .loading-container,
  .empty-container {
    padding: 36px 12px;
  }
}
</style>
