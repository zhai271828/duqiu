<template>
  <div class="login-container">
    <el-card class="login-card">
      <template #header>
        <h2>用户登录</h2>
      </template>

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
        <el-form-item label="用户名或邮箱" prop="identifier">
          <el-input v-model="form.identifier" placeholder="请输入用户名或邮箱" />
        </el-form-item>

        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" type="password" show-password placeholder="请输入密码" />
        </el-form-item>

        <el-form-item>
          <el-button type="primary" :loading="loading" style="width: 100%" @click="handleLogin">
            登录
          </el-button>
        </el-form-item>
      </el-form>

      <div class="login-actions">
        <router-link to="/forgot-password">忘记密码？</router-link>
      </div>

      <div class="login-footer">
        <span>还没有账号？</span>
        <router-link to="/register">立即注册</router-link>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

import { useAuthStore } from '../stores/auth'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const formRef = ref(null)
const loading = ref(false)

const form = reactive({
  identifier: '',
  password: ''
})

const rules = {
  identifier: [{ required: true, message: '请输入用户名或邮箱', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
}

async function handleLogin() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  const result = await authStore.login(form.identifier, form.password)
  loading.value = false

  if (!result.success) {
    ElMessage.error(result.error)
    return
  }

  ElMessage.success(result.message || '登录成功')

  if (!authStore.isEmailVerified) {
    ElMessage.warning('邮箱尚未验证，当前无法下注或兑换')
  }

  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
  router.push(redirect)
}
</script>

<style scoped>
.login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: calc(100vh - 200px);
}

.login-card {
  width: 420px;
}

.login-card h2 {
  margin: 0;
  text-align: center;
}

.login-actions {
  margin-top: 8px;
  text-align: right;
}

.login-actions a,
.login-footer a {
  color: #667eea;
  text-decoration: none;
}

.login-footer {
  margin-top: 16px;
  text-align: center;
  color: #666;
}

@media (max-width: 600px) {
  .login-container {
    align-items: flex-start;
    min-height: auto;
    padding: 8px 0;
  }

  .login-card {
    width: 100%;
  }
}
</style>
