<template>
  <div class="my-bets">
    <h1>我的下注</h1>

    <el-card class="stats-card">
      <div class="stats-grid">
        <div class="stat-item">
          <span class="stat-value">{{ stats.total_bets }}</span>
          <span class="stat-label">总下注次数</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{{ stats.won_bets }}</span>
          <span class="stat-label">获胜次数</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{{ stats.win_rate }}%</span>
          <span class="stat-label">胜率</span>
        </div>
        <div class="stat-item">
          <span class="stat-value" :class="{ profit: stats.total_profit > 0, loss: stats.total_profit < 0 }">
            {{ stats.total_profit > 0 ? '+' : '' }}{{ stats.total_profit.toFixed(2) }}
          </span>
          <span class="stat-label">总盈亏</span>
        </div>
      </div>
    </el-card>

    <el-tabs v-model="activeTab" @tab-change="handleTabChange">
      <el-tab-pane label="全部" name="all" />
      <el-tab-pane label="待结算" name="pending" />
      <el-tab-pane label="已获胜" name="won" />
      <el-tab-pane label="已失败" name="lost" />
    </el-tabs>

    <div class="bets-list" v-if="bets.length > 0">
      <div v-for="bet in bets" :key="bet.id" class="bet-card">
        <div class="bet-header">
          <div class="bet-status" :class="bet.status">
            {{ getStatusText(bet.status) }}
          </div>
          <div class="bet-time">{{ formatTime(bet.created_at) }}</div>
        </div>

        <div class="bet-match">
          <span>{{ bet.match?.home_team }}</span>
          <span class="vs">VS</span>
          <span>{{ bet.match?.away_team }}</span>
        </div>

        <div class="bet-details">
          <div class="detail-item">
            <span class="label">投注选项</span>
            <span class="value">{{ getSelectionText(bet) }}</span>
          </div>
          <div class="detail-item">
            <span class="label">赔率</span>
            <span class="value">{{ bet.odds }}</span>
          </div>
          <div class="detail-item">
            <span class="label">投注金额</span>
            <span class="value">{{ bet.amount }}</span>
          </div>
          <div class="detail-item">
            <span class="label">预计收益</span>
            <span class="value potential">{{ bet.potential_win }}</span>
          </div>
        </div>
      </div>
    </div>

    <el-empty v-else description="暂无下注记录" />

    <el-pagination
      v-if="total > pageSize"
      v-model:current-page="page"
      v-model:page-size="pageSize"
      class="pagination"
      background
      layout="total, sizes, prev, pager, next"
      :page-sizes="[10, 20, 50]"
      :total="total"
      @current-change="fetchBets"
      @size-change="handleSizeChange"
    />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../api/axios'
import { formatTime, getMatchSelectionTexts } from '../utils/format'

const activeTab = ref('all')
const bets = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const stats = ref({
  total_bets: 0,
  won_bets: 0,
  win_rate: 0,
  total_profit: 0
})

const getStatusText = (status) => {
  const map = {
    pending: '待结算',
    won: '已获胜',
    lost: '已失败',
    cancelled: '已取消'
  }
  return map[status] || status
}

const getSelectionText = (bet) => {
  return getMatchSelectionTexts(bet?.match)?.[bet?.selection] || bet?.selection
}

const fetchBets = async () => {
  try {
    const params = {
      page: page.value,
      page_size: pageSize.value,
      ...(activeTab.value === 'all' ? {} : { status: activeTab.value })
    }
    const response = await api.get('/bets/', { params })
    bets.value = response.data.bets
    total.value = response.data.total || 0
  } catch (error) {
    console.error('Failed to fetch bets:', error)
  }
}

const handleTabChange = () => {
  page.value = 1
  fetchBets()
}

const handleSizeChange = () => {
  page.value = 1
  fetchBets()
}

const fetchStats = async () => {
  try {
    const response = await api.get('/stats/me')
    stats.value = response.data
  } catch (error) {
    console.error('Failed to fetch stats:', error)
  }
}

onMounted(() => {
  fetchBets()
  fetchStats()
})
</script>

<style scoped>
.my-bets {
  max-width: 900px;
  margin: 0 auto;
}

.my-bets h1 {
  margin-bottom: 24px;
  color: #333;
}

.stats-card {
  margin-bottom: 24px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
  text-align: center;
}

.stat-item {
  display: flex;
  flex-direction: column;
}

.stat-value {
  font-size: 28px;
  font-weight: bold;
  color: #333;
}

.stat-value.profit {
  color: #67c23a;
}

.stat-value.loss {
  color: #f56c6c;
}

.stat-label {
  font-size: 14px;
  color: #666;
  margin-top: 4px;
}

.bets-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.bet-card {
  background: white;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.bet-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12px;
}

.bet-status {
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 500;
}

.bet-status.pending {
  background: #e6a23c;
  color: white;
}

.bet-status.won {
  background: #67c23a;
  color: white;
}

.bet-status.lost {
  background: #f56c6c;
  color: white;
}

.bet-time {
  color: #666;
  font-size: 14px;
}

.bet-match {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 16px;
  text-align: center;
}

.vs {
  margin: 0 12px;
  color: #999;
}

.bet-details {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  padding-top: 16px;
  border-top: 1px solid #eee;
}

.detail-item {
  text-align: center;
}

.detail-item .label {
  display: block;
  font-size: 12px;
  color: #666;
  margin-bottom: 4px;
}

.detail-item .value {
  font-size: 18px;
  font-weight: 600;
  color: #333;
}

.detail-item .value.potential {
  color: #667eea;
}

.pagination {
  justify-content: center;
  margin-top: 20px;
}

@media (max-width: 768px) {
  .my-bets h1 {
    font-size: 24px;
    margin-bottom: 16px;
  }

  .stats-grid,
  .bet-details {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .stat-value {
    font-size: 24px;
  }

  .bet-card {
    padding: 16px;
  }

  .bet-header {
    flex-direction: column;
    gap: 8px;
  }

  .bet-match {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 16px;
  }

  .vs {
    margin: 0;
  }

  .pagination {
    overflow-x: auto;
    justify-content: flex-start;
  }
}
</style>
