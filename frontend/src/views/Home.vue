<template>
  <div class="home">
    <div class="hero-section">
      <h1>欢迎来到模拟赌球</h1>
      <p>体验真实的赔率和盘口，但不涉及真实金钱</p>
      <div class="hero-stats">
        <div class="stat-item">
          <span class="stat-number">{{ stats.totalBets || 0 }}</span>
          <span class="stat-label">总下注次数</span>
        </div>
        <div class="stat-item">
          <span class="stat-number">{{ stats.totalMatches || 0 }}</span>
          <span class="stat-label">可投赛事</span>
        </div>
      </div>
      <div class="hero-actions">
        <router-link to="/matches">
          <el-button type="primary" size="large">开始下注</el-button>
        </router-link>
        <router-link to="/leaderboard">
          <el-button size="large">查看排行榜</el-button>
        </router-link>
      </div>
    </div>

    <div class="features-section">
      <h2>平台特色</h2>
      <div class="features-grid">
        <div class="feature-card">
          <el-icon><DataLine /></el-icon>
          <h3>真实赔率</h3>
          <p>使用真实的博彩公司赔率数据，双重验证确保准确性</p>
        </div>
        <div class="feature-card">
          <el-icon><Money /></el-icon>
          <h3>虚拟资金</h3>
          <p>注册即送10000虚拟金币，无需真实金钱即可体验</p>
        </div>
        <div class="feature-card">
          <el-icon><Trophy /></el-icon>
          <h3>排行榜</h3>
          <p>与其他玩家比拼投注技巧，争夺排行榜榜首</p>
        </div>
        <div class="feature-card">
          <el-icon><Document /></el-icon>
          <h3>详细统计</h3>
          <p>完整的投注历史和盈亏统计，分析你的投注策略</p>
        </div>
      </div>
    </div>

    <div class="disclaimer-section">
      <el-alert
        title="免责声明"
        type="warning"
        description="本网站仅供娱乐用途，不涉及真实金钱交易。所有投注均为虚拟行为，投注结果不影响任何真实利益。请理性娱乐，切勿沉迷。"
        show-icon
        :closable="false"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { DataLine, Money, Trophy, Document } from '@element-plus/icons-vue'
import api from '../api/axios'

const stats = ref({
  totalBets: 0,
  totalMatches: 0
})

onMounted(async () => {
  try {
    const response = await api.get('/stats/homepage')
    stats.value = response.data
  } catch (error) {
    console.error('Failed to fetch stats:', error)
  }
})
</script>

<style scoped>
.home {
  max-width: 1200px;
  margin: 0 auto;
}

.hero-section {
  text-align: center;
  padding: 60px 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12px;
  color: white;
  margin-bottom: 40px;
}

.hero-section h1 {
  font-size: 48px;
  margin-bottom: 16px;
}

.hero-section p {
  font-size: 20px;
  opacity: 0.9;
  margin-bottom: 40px;
}

.hero-stats {
  display: flex;
  justify-content: center;
  gap: 60px;
  margin-bottom: 40px;
}

.stat-item {
  display: flex;
  flex-direction: column;
}

.stat-number {
  font-size: 36px;
  font-weight: bold;
}

.stat-label {
  font-size: 14px;
  opacity: 0.8;
}

.hero-actions {
  display: flex;
  justify-content: center;
  gap: 20px;
}

.features-section {
  margin-bottom: 40px;
}

.features-section h2 {
  text-align: center;
  font-size: 32px;
  margin-bottom: 30px;
  color: #333;
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
}

.feature-card {
  background: white;
  padding: 30px;
  border-radius: 12px;
  text-align: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  transition: transform 0.3s;
}

.feature-card:hover {
  transform: translateY(-5px);
}

.feature-card .el-icon {
  font-size: 48px;
  color: #667eea;
  margin-bottom: 16px;
}

.feature-card h3 {
  font-size: 20px;
  margin-bottom: 12px;
  color: #333;
}

.feature-card p {
  font-size: 14px;
  color: #666;
  line-height: 1.6;
}

.disclaimer-section {
  margin-top: 40px;
}

@media (max-width: 900px) {
  .features-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 600px) {
  .hero-section {
    padding: 32px 16px;
    margin-bottom: 28px;
  }

  .hero-section h1 {
    font-size: 30px;
  }

  .hero-section p {
    font-size: 16px;
    margin-bottom: 28px;
  }

  .hero-stats {
    gap: 24px;
    margin-bottom: 28px;
  }

  .stat-number {
    font-size: 28px;
  }

  .hero-actions {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }

  .hero-actions a,
  .hero-actions .el-button {
    width: 100%;
  }

  .features-section h2 {
    font-size: 24px;
  }

  .features-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .feature-card {
    padding: 20px;
  }
}
</style>
