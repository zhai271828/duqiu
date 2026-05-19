<template>
  <div class="leaderboard">
    <h1>排行榜</h1>
    <p class="subtitle">
      至少下注 1 次才参与排名。综合评分 = 盈利率 × 40% + 胜率 × 30% + 下注活跃度 × 30%，下注活跃度 = min(log2(总下注 + 1) × 10, 100)。
    </p>

    <el-card>
      <el-table
        :data="leaderboard"
        style="width: 100%"
        stripe
        v-loading="loading"
        @sort-change="handleSort"
      >
        <el-table-column label="排名" width="80" sortable="custom" prop="rank">
          <template #default="{ row }">
            <div class="rank" :class="{ top3: row.rank <= 3 }">
              <span v-if="row.rank === 1" class="medal gold">🥇</span>
              <span v-else-if="row.rank === 2" class="medal silver">🥈</span>
              <span v-else-if="row.rank === 3" class="medal bronze">🥉</span>
              <span v-else>{{ row.rank }}</span>
            </div>
          </template>
        </el-table-column>

        <el-table-column prop="username" label="用户名" width="120" />

        <el-table-column label="余额" sortable="custom" prop="balance" width="120">
          <template #default="{ row }">
            <span class="balance">{{ formatMoney(row.balance) }}</span>
          </template>
        </el-table-column>

        <el-table-column label="总盈利" sortable="custom" prop="total_profit" width="120">
          <template #default="{ row }">
            <span :class="row.total_profit >= 0 ? 'profit' : 'loss'">
              {{ row.total_profit >= 0 ? '+' : '' }}{{ formatMoney(row.total_profit) }}
            </span>
          </template>
        </el-table-column>

        <el-table-column label="盈利率" sortable="custom" prop="profit_rate" width="100">
          <template #default="{ row }">
            <span :class="row.profit_rate >= 0 ? 'profit' : 'loss'">
              {{ row.profit_rate >= 0 ? '+' : '' }}{{ row.profit_rate }}%
            </span>
          </template>
        </el-table-column>

        <el-table-column prop="total_bets" label="总下注" width="80" />

        <el-table-column label="胜/负" width="100">
          <template #default="{ row }">
            <span class="win">{{ row.won_bets }}</span>
            <span class="divider">/</span>
            <span class="loss-count">{{ row.lost_bets }}</span>
          </template>
        </el-table-column>

        <el-table-column label="胜率" sortable="custom" prop="win_rate" width="100">
          <template #default="{ row }">
            <el-progress
              :percentage="row.win_rate"
              :color="row.win_rate >= 50 ? '#67c23a' : '#f56c6c'"
              :stroke-width="10"
              :show-text="false"
              style="width: 60px; display: inline-block; margin-right: 8px"
            />
            <span :class="{ high: row.win_rate >= 50 }">{{ row.win_rate }}%</span>
          </template>
        </el-table-column>

        <el-table-column label="综合评分" sortable="custom" prop="score" width="100">
          <template #default="{ row }">
            <span class="score">{{ row.score }}</span>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-if="total > pageSize"
        v-model:current-page="page"
        v-model:page-size="pageSize"
        class="pagination"
        background
        layout="total, sizes, prev, pager, next"
        :page-sizes="[10, 20, 50]"
        :total="total"
        @current-change="fetchLeaderboard"
        @size-change="handleSizeChange"
      />
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../api/axios'

const leaderboard = ref([])
const loading = ref(false)
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const sortBy = ref('score')
const sortOrder = ref('descending')

const formatMoney = (amount) => {
  if (amount === null || amount === undefined) return '0.00'
  return Number(amount).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

const handleSort = ({ prop, order }) => {
  sortBy.value = prop || 'score'
  sortOrder.value = order === 'ascending' ? 'ascending' : 'descending'
  page.value = 1
  fetchLeaderboard()
}

const fetchLeaderboard = async () => {
  loading.value = true
  try {
    const response = await api.get('/stats/leaderboard', {
      params: {
        page: page.value,
        page_size: pageSize.value,
        sort_by: sortBy.value,
        sort_order: sortOrder.value
      }
    })
    leaderboard.value = response.data.leaderboard
    total.value = response.data.total || 0
  } catch (error) {
    console.error('Failed to fetch leaderboard:', error)
  } finally {
    loading.value = false
  }
}

const handleSizeChange = () => {
  page.value = 1
  fetchLeaderboard()
}

onMounted(() => {
  fetchLeaderboard()
})
</script>

<style scoped>
.leaderboard {
  max-width: 1100px;
  margin: 0 auto;
}

.leaderboard h1 {
  margin-bottom: 8px;
  color: #333;
}

.subtitle {
  color: #666;
  margin-bottom: 24px;
  font-size: 14px;
}

.rank {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: bold;
}

.medal {
  font-size: 24px;
}

.balance {
  font-weight: 600;
  color: #333;
}

.profit {
  color: #67c23a;
  font-weight: 600;
}

.loss {
  color: #f56c6c;
  font-weight: 600;
}

.win {
  color: #67c23a;
}

.loss-count {
  color: #f56c6c;
}

.divider {
  margin: 0 4px;
  color: #999;
}

.high {
  color: #67c23a;
  font-weight: 600;
}

.score {
  font-weight: bold;
  color: #667eea;
  font-size: 16px;
}

.pagination {
  justify-content: center;
  margin-top: 20px;
}

@media (max-width: 768px) {
  .leaderboard h1 {
    font-size: 24px;
  }

  .subtitle {
    line-height: 1.6;
    margin-bottom: 16px;
  }

  .pagination {
    overflow-x: auto;
    justify-content: flex-start;
  }
}
</style>
