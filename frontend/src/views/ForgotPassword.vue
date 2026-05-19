<template>
  <div class="forgot-container">
    <el-card class="forgot-card">
      <template #header>
        <h2>重置密码</h2>
      </template>

      <el-alert
        title="输入用户名或邮箱。如果账号存在，系统会发送重置密码邮件。"
        type="info"
        :closable="false"
        style="margin-bottom: 20px"
      />

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
        <el-form-item label="用户名或邮箱" prop="identifier">
          <el-input v-model="form.identifier" placeholder="请输入用户名或邮箱" />
        </el-form-item>

        <el-form-item>
          <el-button type="primary" :loading="loading" style="width: 100%" @click="handleSubmit">
            发送重置密码邮件
          </el-button>
        </el-form-item>
      </el-form>

      <div class="forgot-footer">
        <router-link to="/login">返回登录</router-link>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()
const formRef = ref(null)
const loading = ref(false)

const form = reactive({
  identifier: ''
})

const rules = {
  identifier: [{ required: true, message: '请输入用户名或邮箱', trigger: 'blur' }]
}

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  const result = await authStore.forgotPassword(form.identifier)
  loading.value = false

  if (!result.success) {
    ElMessage.error(result.error)
    return
  }

  ElMessage.success(result.message)
}
</script>

<style scoped>
.forgot-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: calc(100vh - 200px);
}

.forgot-card {
  width: 420px;
}

.forgot-card h2 {
  margin: 0;
  text-align: center;
}

.forgot-footer {
  margin-top: 12px;
  text-align: center;
}

.forgot-footer a {
  color: #667eea;
  text-decoration: none;
}

@media (max-width: 600px) {
  .forgot-container {
    align-items: flex-start;
    min-height: auto;
    padding: 8px 0;
  }

  .forgot-card {
    width: 100%;
  }
}
</style>
