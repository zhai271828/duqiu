<template>
  <div class="odds-validation">
    <h1>赔率对比中心</h1>
    <p class="subtitle">对比同一比赛不同博彩公司的真实赔率，数据来自 The Odds API</p>

    <el-card class="summary-card">
      <div class="summary-stats">
        <div class="stat-item">
          <span class="stat-value">{{ summary.total }}</span>
          <span class="stat-label">可对比比赛</span>
        </div>
      </div>

      <div class="actions">
        <el-button type="primary" @click="fetchValidation" :loading="loading">
          刷新数据
        </el-button>
        <el-tag type="info" style="margin-left: 12px">
          赔率差异仅供参考，不代表数据错误
        </el-tag>
      </div>
    </el-card>

    <el-card class="explanation-card">
      <h3>说明</h3>
      <ul>
        <li><strong>数据来源</strong>：The Odds API 聚合的真实博彩公司赔率</li>
        <li><strong>对比方式</strong>：同一比赛各博彩公司赔率的最高/最低/平均值</li>
        <li><strong>偏差率</strong>：(最高赔率 - 最低赔率) / 平均赔率 × 100%</li>
        <li><strong>说明</strong>：全量博彩公司混合对比时，冷门结果和高赔率结果的偏差率会天然偏大</li>
      </ul>
    </el-card>

    <div class="validation-results" v-if="results.length > 0">
      <el-card v-for="result in results" :key="result.match_id" class="result-card">
        <div class="result-header">
          <div class="match-info">
            <h3>{{ result.home_team }} vs {{ result.away_team }}</h3>
            <span class="bookmakers">
              {{ result.league }} · {{ result.bookmakers_count }} 家博彩公司
            </span>
          </div>
          <el-tag type="info" size="large">
            最大差异 {{ result.max_spread }}%
          </el-tag>
        </div>

        <el-table :data="formatOddsTable(result)" border size="small" class="odds-table">
          <el-table-column prop="outcome" label="结果" width="80" />
          <el-table-column prop="avg" label="平均赔率" />
          <el-table-column prop="min" label="最低赔率" />
          <el-table-column prop="max" label="最高赔率" />
          <el-table-column prop="spread" label="偏差率">
            <template #default="{ row }">
              <span :class="{ danger: parseFloat(row.spread) > 15 }">
                {{ row.spread }}%
              </span>
            </template>
          </el-table-column>
        </el-table>

        <el-collapse class="bookmaker-detail">
          <el-collapse-item title="查看各博彩公司赔率明细">
            <el-table :data="result.bookmakers" border size="small">
              <el-table-column prop="bookmaker" label="博彩公司" width="150" />
              <el-table-column prop="home_odds" label="主胜" />
              <el-table-column prop="draw_odds" label="平局" />
              <el-table-column prop="away_odds" label="客胜" />
            </el-table>
          </el-collapse-item>
        </el-collapse>
      </el-card>
    </div>

    <el-empty v-else-if="!loading" description="暂无可对比的比赛数据" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../api/axios'

const loading = ref(false)
const results = ref([])
const summary = ref({
  total: 0
})

const formatOddsTable = (result) => {
  const rows = []
  if (result.home) {
    rows.push({
      outcome: '主胜',
      avg: result.home.avg,
      min: result.home.min,
      max: result.home.max,
      spread: result.home.spread
    })
  }
  if (result.draw) {
    rows.push({
      outcome: '平局',
      avg: result.draw.avg,
      min: result.draw.min,
      max: result.draw.max,
      spread: result.draw.spread
    })
  }
  if (result.away) {
    rows.push({
      outcome: '客胜',
      avg: result.away.avg,
      min: result.away.min,
      max: result.away.max,
      spread: result.away.spread
    })
  }
  return rows
}

const fetchValidation = async () => {
  loading.value = true
  try {
    const response = await api.get('/matches/validate-odds')
    results.value = response.data.results
    summary.value = {
      total: response.data.total
    }
  } catch (error) {
    console.error('Validation failed:', error)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchValidation()
})
</script>

<style scoped>
.odds-validation {
  max-width: 1000px;
  margin: 0 auto;
}

.odds-validation h1 {
  margin-bottom: 8px;
  color: #333;
}

.subtitle {
  color: #666;
  margin-bottom: 24px;
}

.summary-card {
  margin-bottom: 20px;
}

.summary-stats {
  display: flex;
  justify-content: space-around;
  margin-bottom: 20px;
}

.stat-item {
  text-align: center;
}

.stat-value {
  display: block;
  font-size: 36px;
  font-weight: bold;
  color: #333;
}

.stat-label {
  font-size: 14px;
  color: #666;
}

.actions {
  text-align: center;
}

.explanation-card {
  margin-bottom: 20px;
}

.explanation-card h3 {
  margin-top: 0;
  margin-bottom: 12px;
}

.explanation-card ul {
  margin: 0;
  padding-left: 20px;
}

.explanation-card li {
  margin-bottom: 8px;
  color: #555;
}

.validation-results {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.result-card {
  margin-bottom: 0;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.match-info h3 {
  margin: 0 0 4px 0;
  color: #333;
}

.bookmakers {
  font-size: 12px;
  color: #999;
}

.odds-table {
  margin-bottom: 12px;
}

.bookmaker-detail {
  margin-top: 8px;
}

.danger {
  color: #f56c6c;
  font-weight: bold;
}

@media (max-width: 768px) {
  .odds-validation h1 {
    font-size: 24px;
  }

  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .result-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
}
</style>
