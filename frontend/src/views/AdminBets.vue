<template>
  <div class="admin-bets">
    <div class="page-header">
      <div>
        <h1>管理后台</h1>
        <p class="subtitle">查看所有用户的下注情况</p>
      </div>
      <el-button type="primary" @click="fetchAll" :loading="loading || usersLoading">刷新数据</el-button>
    </div>

    <AdminSubnav />

    <el-card class="summary-card">
      <div class="summary-grid">
        <div class="summary-item">
          <span class="value">{{ total }}</span>
          <span class="label">总注单数</span>
        </div>
        <div class="summary-item">
          <span class="value">{{ pendingCount }}</span>
          <span class="label">待结算</span>
        </div>
        <div class="summary-item">
          <span class="value">{{ wonCount }}</span>
          <span class="label">已获胜</span>
        </div>
        <div class="summary-item">
          <span class="value">{{ lostCount }}</span>
          <span class="label">已失败</span>
        </div>
      </div>
    </el-card>

    <el-card class="summary-card">
      <template #header>
        <h3>API 配额</h3>
      </template>
      <div class="summary-grid api-grid">
        <div class="summary-item">
          <span class="value">{{ apiQuota.monthlyQuota }}</span>
          <span class="label">月度总额度</span>
        </div>
        <div class="summary-item">
          <span class="value">{{ apiQuota.used }}</span>
          <span class="label">已使用</span>
        </div>
        <div class="summary-item">
          <span class="value">{{ apiQuota.remaining }}</span>
          <span class="label">剩余额度</span>
        </div>
        <div class="summary-item">
          <span class="value small">{{ formatTime(apiQuota.lastCheckedAt) || '未同步' }}</span>
          <span class="label">最近检查时间</span>
        </div>
      </div>
      <div class="api-sync-time">
        最近同步时间：{{ formatTime(apiQuota.lastSyncAt) || '未同步' }}
      </div>
      <div v-if="apiQuota.lastError" class="api-error">
        最近错误：{{ apiQuota.lastError }}
      </div>
      <div class="league-tags" v-if="popularLeagues.length > 0">
        <el-tag v-for="league in popularLeagues" :key="league" style="margin-right: 8px; margin-bottom: 8px">
          {{ league }}
        </el-tag>
      </div>
      <div class="notes" v-if="notes.length > 0">
        <p v-for="note in notes" :key="note">{{ note }}</p>
      </div>
    </el-card>

    <el-card class="summary-card">
      <template #header>
        <h3>赛果与结算</h3>
      </template>
      <div class="summary-grid api-grid">
        <div class="summary-item">
          <span class="value small">{{ formatTime(settlement.lastResultSyncAt) || '未同步' }}</span>
          <span class="label">最近赛果同步</span>
        </div>
        <div class="summary-item">
          <span class="value small">{{ formatTime(settlement.lastSettlementRunAt) || '未结算' }}</span>
          <span class="label">最近自动结算</span>
        </div>
        <div class="summary-item">
          <span class="value">{{ settlement.lastSettlementCounts.settled }}</span>
          <span class="label">最近结算总单数</span>
        </div>
        <div class="summary-item">
          <span class="value">{{ settlement.lastSettlementCounts.skipped }}</span>
          <span class="label">最近跳过单数</span>
        </div>
      </div>
      <div class="league-tags">
        <el-tag type="success" style="margin-right: 8px; margin-bottom: 8px">
          赢 {{ settlement.lastSettlementCounts.won }}
        </el-tag>
        <el-tag type="danger" style="margin-right: 8px; margin-bottom: 8px">
          输 {{ settlement.lastSettlementCounts.lost }}
        </el-tag>
        <el-tag type="warning" style="margin-right: 8px; margin-bottom: 8px">
          退款 {{ settlement.lastSettlementCounts.cancelled }}
        </el-tag>
      </div>
      <div class="summary-grid api-grid settlement-provider-grid">
        <div class="summary-item">
          <span class="value">{{ settlement.oddsApiDailyUsed }} / {{ settlement.oddsApiDailyLimit }}</span>
          <span class="label">今日赛果 API</span>
        </div>
        <div class="summary-item">
          <span class="value small">{{ providerText(settlement.lastResultProvider) }}</span>
          <span class="label">当前赛果来源</span>
        </div>
        <div class="summary-item">
          <span class="value small">{{ skipReasonText(settlement.lastSkipReason) }}</span>
          <span class="label">最近跳过原因</span>
        </div>
      </div>
      <div v-if="settlement.lastSettlementError" class="api-error">
        最近结算错误：{{ settlement.lastSettlementError }}
      </div>
    </el-card>

    <el-card class="summary-card">
      <template #header>
        <div class="card-header-row">
          <h3>注册用户</h3>
          <div class="user-search">
            <el-input
              v-model="userSearch"
              clearable
              placeholder="搜索用户名或邮箱"
              @keyup.enter="handleUserSearch"
              @clear="handleUserSearch"
            />
            <el-button type="primary" @click="handleUserSearch">搜索</el-button>
          </div>
        </div>
      </template>

      <el-table :data="users" stripe border v-loading="usersLoading">
        <el-table-column prop="username" label="用户名" min-width="120" />
        <el-table-column prop="email" label="邮箱" min-width="220" />
        <el-table-column label="余额" width="130">
          <template #default="{ row }">
            {{ formatMoney(row.balance) }}
          </template>
        </el-table-column>
        <el-table-column label="邮箱验证" width="100">
          <template #default="{ row }">
            <el-tag :type="row.email_verified ? 'success' : 'warning'">
              {{ row.email_verified ? '已验证' : '未验证' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="权限" width="100">
          <template #default="{ row }">
            <el-tag :type="row.is_admin ? 'danger' : 'info'">
              {{ row.is_admin ? '管理员' : '用户' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="total_bets" label="下注数" width="90" />
        <el-table-column prop="pending_bets" label="待结算" width="90" />
        <el-table-column label="总盈亏" width="120">
          <template #default="{ row }">
            <span :class="{ profit: row.total_profit > 0, loss: row.total_profit < 0 }">
              {{ row.total_profit > 0 ? '+' : '' }}{{ formatMoney(row.total_profit) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="注册时间" min-width="170">
          <template #default="{ row }">
            {{ formatTime(row.created_at) }}
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-if="userTotal > userPageSize"
        v-model:current-page="userPage"
        v-model:page-size="userPageSize"
        class="pagination"
        background
        layout="total, sizes, prev, pager, next"
        :page-sizes="[10, 20, 50, 100]"
        :total="userTotal"
        @current-change="fetchUsers"
        @size-change="handleUserSizeChange"
      />
    </el-card>

    <el-card>
      <el-table :data="bets" stripe border v-loading="loading">
        <el-table-column prop="user.username" label="用户" min-width="120" />
        <el-table-column prop="user.email" label="邮箱" min-width="220" />
        <el-table-column label="比赛" min-width="220">
          <template #default="{ row }">
            {{ row.match?.home_team }} vs {{ row.match?.away_team }}
          </template>
        </el-table-column>
        <el-table-column label="联赛" min-width="110">
          <template #default="{ row }">
            {{ row.match?.league }}
          </template>
        </el-table-column>
        <el-table-column label="开赛时间" min-width="170">
          <template #default="{ row }">
            {{ formatTime(row.match?.start_time) }}
          </template>
        </el-table-column>
        <el-table-column prop="selection" label="选项" width="90">
          <template #default="{ row }">
            {{ selectionText(row) }}
          </template>
        </el-table-column>
        <el-table-column prop="odds" label="赔率" width="90" />
        <el-table-column prop="amount" label="下注金额" width="110">
          <template #default="{ row }">
            {{ formatMoney(row.amount) }}
          </template>
        </el-table-column>
        <el-table-column prop="potential_win" label="预计收益" width="110">
          <template #default="{ row }">
            {{ formatMoney(row.potential_win) }}
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)">
              {{ statusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="下注时间" min-width="170">
          <template #default="{ row }">
            {{ formatTime(row.created_at) }}
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
        :page-sizes="[10, 20, 50, 100]"
        :total="total"
        @current-change="fetchBets"
        @size-change="handleSizeChange"
      />
    </el-card>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api/axios'
import { formatMoney, formatTime, getMatchSelectionTexts } from '../utils/format'
import AdminSubnav from '../components/AdminSubnav.vue'

const loading = ref(false)
const total = ref(0)
const bets = ref([])
const page = ref(1)
const pageSize = ref(20)
const usersLoading = ref(false)
const users = ref([])
const userTotal = ref(0)
const userPage = ref(1)
const userPageSize = ref(20)
const userSearch = ref('')
const summary = ref({
  pending: 0,
  won: 0,
  lost: 0,
  cancelled: 0
})
const apiQuota = ref({
  monthlyQuota: 500,
  used: 0,
  remaining: 500,
  lastCheckedAt: '',
  lastSyncAt: '',
  lastError: ''
})
const settlement = ref({
  lastResultSyncAt: '',
  lastSettlementRunAt: '',
  lastSettlementError: '',
  oddsApiDailyUsed: 0,
  oddsApiDailyLimit: 16,
  lastResultProvider: '',
  lastSkipReason: '',
  lastSettlementCounts: {
    settled: 0,
    won: 0,
    lost: 0,
    cancelled: 0,
    skipped: 0
  }
})
const popularLeagues = ref([])
const notes = ref([])

const pendingCount = computed(() => summary.value.pending)
const wonCount = computed(() => summary.value.won)
const lostCount = computed(() => summary.value.lost)

const providerText = (provider) => {
  const map = {
    'odds-api': 'Odds API',
    'football-data': 'football-data',
    OpenLigaDB: 'OpenLigaDB',
    TheSportsDB: 'TheSportsDB',
    none: '暂无'
  }
  return map[provider] || provider || '暂无'
}

const skipReasonText = (reason) => {
  const map = {
    night_window: '夜间窗口',
    no_pending_bets: '无待结算注单',
    no_started_pending_bets: '无已开赛注单',
    daily_limit_reached: '已达日限额',
    no_matching_results: '无可匹配赛果'
  }
  return map[reason] || reason || '无'
}

const selectionText = (row) => {
  return getMatchSelectionTexts(row?.match)?.[row?.selection] || row?.selection
}

const statusText = (status) => {
  const map = {
    pending: '待结算',
    won: '已获胜',
    lost: '已失败',
    cancelled: '已取消'
  }
  return map[status] || status
}

const statusType = (status) => {
  const map = {
    pending: 'warning',
    won: 'success',
    lost: 'danger',
    cancelled: 'info'
  }
  return map[status] || 'info'
}

const fetchBets = async () => {
  loading.value = true
  try {
    const [betsResponse, systemResponse] = await Promise.all([
      api.get('/admin/bets', {
        params: {
          page: page.value,
          page_size: pageSize.value
        }
      }),
      api.get('/admin/system')
    ])
    total.value = betsResponse.data.total
    bets.value = betsResponse.data.bets
    summary.value = {
      ...summary.value,
      ...(betsResponse.data.summary || {})
    }
    apiQuota.value = {
      ...apiQuota.value,
      ...(systemResponse.data.oddsApi || {})
    }
    settlement.value = {
      ...settlement.value,
      ...(systemResponse.data.settlement || {})
    }
    popularLeagues.value = systemResponse.data.popularLeagues || []
    notes.value = systemResponse.data.notes || []
  } catch (error) {
    ElMessage.error(error.response?.data?.error || '获取管理数据失败')
  } finally {
    loading.value = false
  }
}

const fetchUsers = async () => {
  usersLoading.value = true
  try {
    const response = await api.get('/admin/users', {
      params: {
        page: userPage.value,
        page_size: userPageSize.value,
        search: userSearch.value || undefined
      }
    })
    users.value = response.data.users || []
    userTotal.value = response.data.total || 0
  } catch (error) {
    ElMessage.error(error.response?.data?.error || '获取用户数据失败')
  } finally {
    usersLoading.value = false
  }
}

const fetchAll = async () => {
  await Promise.all([fetchBets(), fetchUsers()])
}

const handleSizeChange = () => {
  page.value = 1
  fetchBets()
}

const handleUserSearch = () => {
  userPage.value = 1
  fetchUsers()
}

const handleUserSizeChange = () => {
  userPage.value = 1
  fetchUsers()
}

onMounted(() => {
  fetchAll()
})
</script>

<style scoped>
.admin-bets {
  max-width: 1400px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  gap: 12px;
}

.page-header h1 {
  margin: 0 0 6px 0;
}

.subtitle {
  margin: 0;
  color: #666;
}

.summary-card {
  margin-bottom: 20px;
}

.card-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.card-header-row h3 {
  margin: 0;
}

.user-search {
  display: flex;
  gap: 8px;
  width: 360px;
  max-width: 100%;
}

.api-grid .small {
  font-size: 16px;
  line-height: 1.4;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.settlement-provider-grid {
  grid-template-columns: repeat(3, 1fr);
  margin-top: 12px;
}

.summary-item {
  text-align: center;
}

.summary-item .value {
  display: block;
  font-size: 28px;
  font-weight: bold;
  color: #333;
}

.summary-item .label {
  display: block;
  margin-top: 6px;
  color: #666;
  font-size: 14px;
}

.api-error {
  margin-top: 12px;
  color: #f56c6c;
}

.profit {
  color: #67c23a;
  font-weight: 600;
}

.loss {
  color: #f56c6c;
  font-weight: 600;
}

.api-sync-time {
  margin-top: 12px;
  color: #666;
}

.league-tags {
  margin-top: 14px;
}

.notes {
  margin-top: 12px;
  color: #666;
  font-size: 14px;
}

.notes p {
  margin: 4px 0;
}

.pagination {
  justify-content: center;
  margin-top: 20px;
}

@media (max-width: 768px) {
  .admin-bets h1 {
    font-size: 24px;
  }

  .header {
    flex-direction: column;
    align-items: flex-start;
  }

  .summary-grid,
  .settlement-provider-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .card-header-row {
    flex-direction: column;
    align-items: stretch;
  }

  .user-search {
    width: 100%;
  }

  .pagination {
    overflow-x: auto;
    justify-content: flex-start;
  }
}
</style>
