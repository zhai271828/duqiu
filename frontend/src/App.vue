<template>
  <el-container class="app-container">
    <el-header class="app-header">
      <div class="header-content">
        <div class="logo">
          <h1>模拟赌球</h1>
          <span class="subtitle">仅供娱乐 - 不涉及真实金钱</span>
        </div>
        <div class="nav-links">
          <router-link to="/" class="nav-link">首页</router-link>
          <router-link to="/matches" class="nav-link">赛事</router-link>
          <router-link to="/odds-validation" class="nav-link">赔率对比</router-link>
          <router-link to="/leaderboard" class="nav-link">排行榜</router-link>
          <template v-if="isLoggedIn">
            <router-link to="/my-bets" class="nav-link">我的下注</router-link>
            <router-link v-if="isAdmin" to="/admin/matches" class="nav-link">管理后台</router-link>
            <router-link to="/profile" class="nav-link">个人中心</router-link>
            <el-button type="danger" @click="logout">退出</el-button>
          </template>
          <template v-else>
            <router-link to="/login" class="nav-link">登录</router-link>
            <router-link to="/register">
              <el-button type="primary">注册</el-button>
            </router-link>
          </template>
        </div>
      </div>
    </el-header>

    <el-main class="app-main">
      <router-view />
    </el-main>

    <el-footer class="app-footer">
      <div class="footer-content">
        <p>本网站仅供娱乐用途，不涉及真实金钱交易</p>
        <p>All odds are for entertainment purposes only</p>
      </div>
    </el-footer>
  </el-container>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const isLoggedIn = computed(() => authStore.isAuthenticated)
const isAdmin = computed(() => authStore.isAdmin)

const logout = () => {
  authStore.logout()
  router.push('/login')
}

onMounted(() => {
  authStore.initialize()
})
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background-color: #f5f7fa;
}

.app-container {
  min-height: 100vh;
}

.app-header {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  color: white;
  padding: 0 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
}

.header-content {
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 100%;
}

.logo h1 {
  font-size: 24px;
  font-weight: bold;
  background: linear-gradient(90deg, #ffd700, #ff6b6b);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.logo .subtitle {
  font-size: 12px;
  color: #aaa;
}

.nav-links {
  display: flex;
  align-items: center;
  gap: 20px;
}

.nav-link {
  color: white;
  text-decoration: none;
  font-size: 16px;
  transition: color 0.3s;
}

.nav-link:hover {
  color: #ffd700;
}

.router-link-active {
  color: #ffd700;
}

.app-main {
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px;
  width: 100%;
}

.app-footer {
  background-color: #1a1a2e;
  color: #aaa;
  text-align: center;
  padding: 20px;
}

.footer-content p {
  margin: 5px 0;
  font-size: 14px;
}

@media (max-width: 768px) {
  .app-header.el-header {
    height: auto;
    min-height: 60px;
    padding: 10px 12px 8px;
  }

  .header-content {
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start;
    gap: 8px;
  }

  .logo {
    text-align: center;
  }

  .logo h1 {
    font-size: 20px;
  }

  .logo .subtitle {
    display: block;
    font-size: 11px;
  }

  .nav-links {
    width: 100%;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 4px;
    justify-content: flex-start;
    scrollbar-width: none;
  }

  .nav-links::-webkit-scrollbar {
    display: none;
  }

  .nav-link,
  .nav-links .el-button {
    flex: 0 0 auto;
    white-space: nowrap;
    font-size: 14px;
  }

  .app-main {
    padding: 12px;
  }

  .app-footer {
    padding: 16px 12px;
  }

  .el-card__body {
    padding: 16px;
    overflow-x: auto;
  }

  .el-table {
    min-width: 680px;
  }
}
</style>
