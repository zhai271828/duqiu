<template>
  <div class="admin-matches">
    <div class="page-header">
      <div>
        <h1>自定义比赛</h1>
        <p class="subtitle">创建比赛、设置赔率并手动结算</p>
      </div>
      <div class="header-actions">
        <el-button @click="fetchMatches" :loading="loading">刷新</el-button>
        <el-button type="primary" @click="openCreateDialog">新增比赛</el-button>
      </div>
    </div>

    <AdminSubnav />

    <el-card>
      <el-table :data="matches" stripe border v-loading="loading">
        <el-table-column label="联赛" min-width="120" prop="league" />
        <el-table-column label="球队" min-width="220">
          <template #default="{ row }">
            {{ row.home_team }} vs {{ row.away_team }}
          </template>
        </el-table-column>
        <el-table-column label="开赛时间" min-width="170">
          <template #default="{ row }">
            {{ formatTime(row.start_time) }}
          </template>
        </el-table-column>
        <el-table-column label="玩法" width="100">
          <template #default="{ row }">
            <el-tag :type="row.allow_draw ? 'success' : 'info'">
              {{ row.allow_draw ? '三项' : '两项' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="赔率" min-width="160">
          <template #default="{ row }">
            <div class="odds-cell">
              <span>主 {{ row.odds.home }}</span>
              <span v-if="row.allow_draw">平 {{ row.odds.draw }}</span>
              <span>客 {{ row.odds.away }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="下注" width="120">
          <template #default="{ row }">
            <div class="count-cell">
              <span>{{ row.total_bets || 0 }}</span>
              <small>{{ row.pending_bets || 0 }} 待结算</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusType(row)">
              {{ statusText(row) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-space wrap>
              <el-button size="small" @click="openEditDialog(row)" :disabled="row.locked || row.status === 'finished'">
                编辑
              </el-button>
              <el-button size="small" type="warning" @click="openSettleDialog(row)">
                结算
              </el-button>
            </el-space>
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
        @current-change="fetchMatches"
        @size-change="handlePageSizeChange"
      />
    </el-card>

    <el-dialog
      v-model="editorVisible"
      :title="editorMode === 'create' ? '新增比赛' : '编辑比赛'"
      width="720px"
      destroy-on-close
    >
      <el-form :model="editorForm" label-width="110px">
        <el-form-item label="运动类型">
          <el-select v-model="editorForm.sport">
            <el-option label="足球" value="soccer" />
            <el-option label="篮球" value="basketball" />
          </el-select>
        </el-form-item>
        <el-form-item label="联赛">
          <el-input v-model="editorForm.league" placeholder="例如：自定义友谊赛 / 英超 / NBA" />
        </el-form-item>
        <el-form-item label="主队">
          <el-input v-model="editorForm.home_team" />
        </el-form-item>
        <el-form-item label="客队">
          <el-input v-model="editorForm.away_team" />
        </el-form-item>
        <el-form-item label="开赛时间">
          <el-date-picker
            v-model="editorForm.start_time"
            type="datetime"
            placeholder="选择开赛时间"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="允许平局">
          <el-switch v-model="editorForm.allow_draw" />
        </el-form-item>
        <el-form-item label="主胜赔率">
          <el-input-number v-model="editorForm.odds.home" :min="1.01" :step="0.01" :precision="2" />
        </el-form-item>
        <el-form-item v-if="editorForm.allow_draw" label="平局赔率">
          <el-input-number v-model="editorForm.odds.draw" :min="1.01" :step="0.01" :precision="2" />
        </el-form-item>
        <el-form-item label="客胜赔率">
          <el-input-number v-model="editorForm.odds.away" :min="1.01" :step="0.01" :precision="2" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="editorVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitEditor">
          {{ editorMode === 'create' ? '创建' : '保存' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="settleVisible"
      title="录入比分并结算"
      width="560px"
      destroy-on-close
    >
      <div v-if="settleMatch" class="settle-meta">
        <p>{{ settleMatch.home_team }} vs {{ settleMatch.away_team }}</p>
        <p>{{ formatTime(settleMatch.start_time) }}</p>
        <el-alert
          v-if="!settleMatch.allow_draw"
          title="该比赛不允许平局，比分不能录成平分"
          type="warning"
          :closable="false"
          show-icon
        />
      </div>

      <el-form :model="settleForm" label-width="110px" style="margin-top: 16px">
        <el-form-item label="主队比分">
          <el-input-number v-model="settleForm.home_score" :min="0" :step="1" />
        </el-form-item>
        <el-form-item label="客队比分">
          <el-input-number v-model="settleForm.away_score" :min="0" :step="1" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="settleVisible = false">取消</el-button>
        <el-button type="warning" :loading="settling" @click="submitSettlement">
          结算
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api/axios'
import { formatTime } from '../utils/format'
import AdminSubnav from '../components/AdminSubnav.vue'

const loading = ref(false)
const saving = ref(false)
const settling = ref(false)
const matches = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const editorVisible = ref(false)
const editorMode = ref('create')
const settleVisible = ref(false)
const settleMatch = ref(null)
const editingId = ref(null)

const defaultEditorForm = () => ({
  sport: 'soccer',
  league: '',
  home_team: '',
  away_team: '',
  start_time: new Date(Date.now() + 60 * 60 * 1000),
  allow_draw: true,
  odds: {
    home: 1.9,
    draw: 3.2,
    away: 3.2
  }
})

const editorForm = reactive(defaultEditorForm())

const settleForm = reactive({
  home_score: 0,
  away_score: 0
})

const loadMatch = async (id) => {
  const response = await api.get(`/admin/matches/${id}`)
  return response.data?.match || null
}

const syncForm = (match) => {
  editorForm.sport = match.sport || 'soccer'
  editorForm.league = match.league || ''
  editorForm.home_team = match.home_team || ''
  editorForm.away_team = match.away_team || ''
  editorForm.start_time = match.start_time ? new Date(match.start_time) : new Date()
  editorForm.allow_draw = !!match.allow_draw
  editorForm.odds.home = match.odds_rows?.[0]?.home_odds ?? match.odds?.home ?? 1.9
  editorForm.odds.draw = match.odds_rows?.[0]?.draw_odds ?? match.odds?.draw ?? 3.2
  editorForm.odds.away = match.odds_rows?.[0]?.away_odds ?? match.odds?.away ?? 3.2
}

const resetEditorForm = () => {
  const next = defaultEditorForm()
  Object.assign(editorForm, next)
}

const fetchMatches = async () => {
  loading.value = true
  try {
    const response = await api.get('/admin/matches', {
      params: {
        page: page.value,
        page_size: pageSize.value
      }
    })
    matches.value = response.data.matches || []
    total.value = response.data.total || 0
  } catch (error) {
    ElMessage.error(error.response?.data?.error || '获取自定义比赛失败')
  } finally {
    loading.value = false
  }
}

const handlePageSizeChange = () => {
  page.value = 1
  fetchMatches()
}

const openCreateDialog = () => {
  editorMode.value = 'create'
  editingId.value = null
  resetEditorForm()
  editorVisible.value = true
}

const openEditDialog = async (row) => {
  editorMode.value = 'edit'
  editingId.value = row.id
  try {
    const match = await loadMatch(row.id)
    if (!match) {
      ElMessage.error('比赛不存在')
      return
    }
    syncForm(match)
    editorVisible.value = true
  } catch (error) {
    ElMessage.error(error.response?.data?.error || '读取比赛信息失败')
  }
}

const openSettleDialog = async (row) => {
  try {
    const match = await loadMatch(row.id)
    if (!match) {
      ElMessage.error('比赛不存在')
      return
    }
    settleMatch.value = match
    settleForm.home_score = match.home_score ?? 0
    settleForm.away_score = match.away_score ?? 0
    settleVisible.value = true
  } catch (error) {
    ElMessage.error(error.response?.data?.error || '读取比赛信息失败')
  }
}

const buildPayload = () => ({
  sport: editorForm.sport,
  league: editorForm.league.trim(),
  home_team: editorForm.home_team.trim(),
  away_team: editorForm.away_team.trim(),
  start_time: new Date(editorForm.start_time).toISOString(),
  allow_draw: !!editorForm.allow_draw,
  odds: {
    home: Number(editorForm.odds.home),
    draw: editorForm.allow_draw ? Number(editorForm.odds.draw) : null,
    away: Number(editorForm.odds.away)
  }
})

const submitEditor = async () => {
  if (!editorForm.league.trim() || !editorForm.home_team.trim() || !editorForm.away_team.trim()) {
    ElMessage.warning('请填写完整的比赛信息')
    return
  }

  if (!editorForm.start_time || Number.isNaN(new Date(editorForm.start_time).getTime())) {
    ElMessage.warning('请选择有效的开赛时间')
    return
  }

  saving.value = true
  try {
    const payload = buildPayload()
    if (editorMode.value === 'create') {
      await api.post('/admin/matches', payload)
      ElMessage.success('自定义比赛已创建')
    } else {
      await api.put(`/admin/matches/${editingId.value}`, payload)
      ElMessage.success('自定义比赛已更新')
    }
    editorVisible.value = false
    await fetchMatches()
  } catch (error) {
    ElMessage.error(error.response?.data?.error || '保存失败')
  } finally {
    saving.value = false
  }
}

const submitSettlement = async () => {
  settling.value = true
  try {
    await api.post(`/admin/matches/${settleMatch.value.id}/settle`, {
      home_score: Number(settleForm.home_score),
      away_score: Number(settleForm.away_score)
    })
    ElMessage.success('比赛已结算')
    settleVisible.value = false
    await fetchMatches()
  } catch (error) {
    ElMessage.error(error.response?.data?.error || '结算失败')
  } finally {
    settling.value = false
  }
}

const statusText = (row) => {
  if (row.status === 'finished') return '已结算'
  if (row.status === 'live') return '进行中'
  if (row.status === 'upcoming' && new Date(row.start_time).getTime() <= Date.now()) return '待结算'
  return '未开始'
}

const statusType = (row) => {
  if (row.status === 'finished') return 'info'
  if (row.status === 'live') return 'danger'
  if (row.status === 'upcoming' && new Date(row.start_time).getTime() <= Date.now()) return 'warning'
  return 'success'
}

watch(
  () => editorForm.sport,
  (sport) => {
    if (sport === 'basketball') {
      editorForm.allow_draw = false
    }
  }
)

onMounted(() => {
  fetchMatches()
})
</script>

<style scoped>
.admin-matches {
  max-width: 1400px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.page-header h1 {
  margin: 0 0 6px 0;
}

.subtitle {
  margin: 0;
  color: #666;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.odds-cell {
  display: grid;
  gap: 4px;
}

.count-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.count-cell small {
  color: #666;
}

.pagination {
  justify-content: center;
  margin-top: 20px;
}

.settle-meta {
  display: grid;
  gap: 4px;
}

.settle-meta p {
  margin: 0;
  color: #4b5563;
}

@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
  }

  .header-actions {
    justify-content: stretch;
  }

  .header-actions .el-button {
    flex: 1;
  }
}
</style>
