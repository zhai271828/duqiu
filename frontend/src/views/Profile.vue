<template>
  <div class="profile">
    <el-card class="profile-card">
      <template #header>
        <h2>个人中心</h2>
      </template>

      <el-alert
        v-if="user && !authStore.isEmailVerified"
        title="邮箱状态待确认"
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom: 20px"
      >
        <template #default>
          <div class="verify-alert">
            <span>如果你已经点过验证邮件，这里会顺便检查并同步最新状态；否则可以重新发送一封。</span>
            <el-button type="warning" size="small" :loading="resending" @click="handleResendVerification">
              检查状态 / 重新发送验证邮件
            </el-button>
          </div>
        </template>
      </el-alert>

      <div v-if="user" class="user-info">
        <div class="avatar">
          <el-avatar :size="80">{{ user.username?.charAt(0)?.toUpperCase() }}</el-avatar>
        </div>
        <div class="info">
          <h3>
            {{ user.username }}
            <el-tag v-if="user.is_admin" type="danger" size="small" style="margin-left: 8px">管理员</el-tag>
          </h3>
          <p>{{ user.email }}</p>
          <p class="join-time">注册时间：{{ formatTime(user.created_at) }}</p>
          <el-tag :type="authStore.isEmailVerified ? 'success' : 'warning'">
            {{ authStore.isEmailVerified ? '邮箱已验证' : '邮箱未验证' }}
          </el-tag>
        </div>
      </div>

      <el-divider />

      <div class="balance-section" v-if="user">
        <h3>账户余额</h3>
        <div class="balance-amount">
          <span class="currency">¥</span>
          <span class="amount">{{ Number(user.balance || 0).toFixed(2) }}</span>
        </div>
        <p class="balance-note">虚拟金币，仅供娱乐使用</p>

        <div class="redeem-section">
          <el-divider />
          <h4>兑换码充值</h4>
          <div class="redeem-form">
            <el-input
              v-model="redeemCode"
              :disabled="!authStore.isEmailVerified"
              placeholder="请输入兑换码"
              style="width: 220px; margin-right: 12px"
            />
            <el-button
              type="primary"
              :disabled="!authStore.isEmailVerified"
              :loading="redeeming"
              @click="handleRedeem"
            >
              兑换
            </el-button>
          </div>
          <p v-if="!authStore.isEmailVerified" class="verify-note">
            请先完成邮箱验证，再使用兑换码。
          </p>
        </div>
      </div>
    </el-card>

    <el-card class="stats-card">
      <template #header>
        <h3>投注统计</h3>
      </template>

      <div class="stats-grid">
        <div class="stat-item">
          <span class="stat-value">{{ stats.total_bets }}</span>
          <span class="stat-label">总下注</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{{ stats.won_bets }}</span>
          <span class="stat-label">获胜</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{{ stats.lost_bets }}</span>
          <span class="stat-label">失败</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{{ stats.pending_bets }}</span>
          <span class="stat-label">待结算</span>
        </div>
      </div>

      <el-divider />

      <div class="profit-section">
        <div class="profit-item">
          <span class="label">总投注金额</span>
          <span class="value">{{ Number(stats.total_wagered || 0).toFixed(2) }}</span>
        </div>
        <div class="profit-item">
          <span class="label">总盈亏</span>
          <span class="value" :class="{ profit: stats.total_profit > 0, loss: stats.total_profit < 0 }">
            {{ stats.total_profit > 0 ? '+' : '' }}{{ Number(stats.total_profit || 0).toFixed(2) }}
          </span>
        </div>
        <div class="profit-item">
          <span class="label">胜率</span>
          <span class="value">{{ stats.win_rate || 0 }}%</span>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'

import api from '../api/axios'
import { useAuthStore } from '../stores/auth'
import { formatTime } from '../utils/format'

const authStore = useAuthStore()

const redeemCode = ref('')
const redeeming = ref(false)
const resending = ref(false)
const stats = ref({
  total_bets: 0,
  won_bets: 0,
  lost_bets: 0,
  pending_bets: 0,
  total_wagered: 0,
  total_profit: 0,
  win_rate: 0
})

const user = computed(() => authStore.user)

async function fetchStats() {
  try {
    const response = await api.get('/stats/me')
    stats.value = response.data
  } catch (error) {
    console.error('Failed to fetch stats:', error)
  }
}

async function handleRedeem() {
  if (!authStore.isEmailVerified) {
    ElMessage.warning('请先完成邮箱验证')
    return
  }

  if (!redeemCode.value) {
    ElMessage.warning('请输入兑换码')
    return
  }

  redeeming.value = true
  try {
    const response = await api.post('/auth/redeem', {
      code: redeemCode.value
    })
    ElMessage.success(response.data.message)
    await authStore.fetchProfile()
    redeemCode.value = ''
  } catch (error) {
    ElMessage.error(error.response?.data?.error || '兑换失败')
  } finally {
    redeeming.value = false
  }
}

async function handleResendVerification() {
  resending.value = true
  const result = await authStore.resendVerification()
  resending.value = false

  if (!result.success) {
    ElMessage.error(result.error)
    return
  }

  ElMessage.success(result.message)
}

onMounted(async () => {
  await authStore.fetchProfile()
  await fetchStats()
})
</script>

<style scoped>
.profile {
  max-width: 840px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.profile-card h2,
.stats-card h3 {
  margin: 0;
}

.verify-alert {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

.user-info {
  display: flex;
  gap: 24px;
  align-items: center;
}

.info h3 {
  margin-bottom: 8px;
  font-size: 24px;
}

.info p {
  margin-bottom: 4px;
  color: #666;
}

.join-time {
  font-size: 14px;
}

.balance-section {
  text-align: center;
  padding: 20px 0;
}

.balance-amount {
  color: #667eea;
  font-size: 48px;
  font-weight: bold;
}

.currency {
  margin-right: 4px;
  font-size: 24px;
}

.balance-note,
.verify-note {
  margin-top: 8px;
  font-size: 14px;
  color: #999;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
  text-align: center;
}

.stat-item,
.profit-item {
  display: flex;
  flex-direction: column;
}

.stat-value {
  color: #333;
  font-size: 28px;
  font-weight: bold;
}

.stat-label,
.profit-item .label {
  margin-top: 4px;
  font-size: 14px;
  color: #666;
}

.profit-section {
  display: flex;
  justify-content: space-around;
}

.profit-item .value {
  color: #333;
  font-size: 24px;
  font-weight: bold;
}

.profit-item .value.profit {
  color: #67c23a;
}

.profit-item .value.loss {
  color: #f56c6c;
}

.redeem-section {
  margin-top: 20px;
}

.redeem-section h4 {
  margin-bottom: 16px;
  color: #333;
}

.redeem-form {
  display: flex;
  justify-content: center;
  align-items: center;
}

@media (max-width: 768px) {
  .user-info,
  .verify-alert,
  .redeem-form,
  .profit-section {
    flex-direction: column;
    align-items: stretch;
  }

  .user-info {
    text-align: center;
    gap: 16px;
  }

  .info h3 {
    font-size: 22px;
  }

  .balance-section {
    padding: 12px 0;
  }

  .balance-amount {
    font-size: 36px;
  }

  .stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .stat-value,
  .profit-item .value {
    font-size: 24px;
  }

  .profit-section {
    gap: 16px;
  }

  .redeem-form {
    gap: 10px;
  }

  .redeem-form .el-input,
  .redeem-form .el-button {
    width: 100% !important;
    margin-right: 0 !important;
  }
}
</style>
