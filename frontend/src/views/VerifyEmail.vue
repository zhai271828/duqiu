<template>
  <div class="verify-email-container">
    <el-card class="verify-email-card">
      <div v-if="status === 'loading'" class="status-block">
        <el-icon class="status-icon loading"><Loading /></el-icon>
        <h2>正在确认邮箱验证</h2>
        <p>{{ message }}</p>
      </div>

      <div v-else-if="status === 'success'" class="status-block">
        <el-icon class="status-icon success"><SuccessFilled /></el-icon>
        <h2>邮箱验证成功</h2>
        <p>{{ message }}</p>
        <p v-if="details" class="details">{{ details }}</p>
      </div>

      <div v-else class="status-block">
        <el-icon class="status-icon error"><WarningFilled /></el-icon>
        <h2>验证链接不可用</h2>
        <p>{{ message }}</p>
        <p v-if="details" class="details">{{ details }}</p>
      </div>

      <div class="actions">
        <el-button v-if="status === 'success' && isLoggedIn" type="primary" @click="router.push('/profile')">
          返回个人中心
        </el-button>
        <el-button v-else-if="status === 'success'" type="primary" @click="router.push('/login')">
          去登录
        </el-button>
        <el-button v-if="isLoggedIn" @click="router.push('/profile')">个人中心</el-button>
        <el-button v-else @click="router.push('/register')">重新注册/登录</el-button>
        <el-button text @click="router.push('/')">返回首页</el-button>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import api from '../api/axios'
import { useAuthStore } from '../stores/auth'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const status = ref('loading')
const message = ref('正在处理验证链接，请稍候。')
const details = ref('')

const isLoggedIn = computed(() => authStore.isAuthenticated)

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

async function completeVerification() {
  const mode = typeof route.query.mode === 'string' ? route.query.mode : ''
  const oobCode = typeof route.query.oobCode === 'string' ? route.query.oobCode.trim() : ''

  if (mode !== 'verifyEmail' || !oobCode) {
    status.value = 'error'
    message.value = '当前链接不是有效的邮箱验证链接。'
    details.value = '请回到注册邮箱，打开最新一封验证邮件后再试。'
    return
  }

  try {
    const response = await api.post('/auth/complete-email-verification', { oobCode })
    const user = response.data.user
    const currentUser = authStore.user

    if (user && currentUser && normalizeEmail(currentUser.email) === normalizeEmail(user.email)) {
      authStore.updateUser(user)
      details.value = '当前设备的登录状态已经同步，现在可以直接继续使用账户。'
    } else {
      details.value = '如果你已经登录，请回到个人中心刷新状态；未登录的话现在可以直接登录。'
    }

    status.value = 'success'
    message.value = response.data.message || '邮箱验证成功。'
  } catch (error) {
    status.value = 'error'
    message.value = error.response?.data?.error || '验证链接处理失败，请稍后重试。'
    details.value = '如果这是旧邮件里的链接，请回到个人中心点击“检查状态 / 重新发送验证邮件”。'
  }
}

onMounted(() => {
  completeVerification()
})
</script>

<style scoped>
.verify-email-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: calc(100vh - 220px);
}

.verify-email-card {
  width: min(560px, 100%);
}

.status-block {
  text-align: center;
  padding: 12px 8px 4px;
}

.status-block h2 {
  margin: 16px 0 12px;
}

.status-block p {
  margin: 0;
  line-height: 1.7;
  color: #606266;
}

.details {
  margin-top: 10px !important;
}

.status-icon {
  font-size: 56px;
}

.status-icon.loading {
  color: #e6a23c;
  animation: spin 1.2s linear infinite;
}

.status-icon.success {
  color: #67c23a;
}

.status-icon.error {
  color: #f56c6c;
}

.actions {
  margin-top: 28px;
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 12px;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 600px) {
  .verify-email-container {
    align-items: flex-start;
    min-height: auto;
    padding-top: 12px;
  }

  .verify-email-card {
    width: 100%;
  }

  .actions {
    justify-content: stretch;
  }
}
</style>
