<template>
  <div class="admin-subnav">
    <router-link to="/admin/matches" class="admin-link">自定义比赛</router-link>
    <router-link to="/admin/bets" class="admin-link">注单与系统</router-link>
  </div>
</template>

<style scoped>
.admin-subnav {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  padding: 4px;
  border-radius: 14px;
  background: #f3f5fb;
  width: fit-content;
  max-width: 100%;
}

.admin-link {
  padding: 10px 16px;
  border-radius: 10px;
  color: #4a5568;
  text-decoration: none;
  font-weight: 600;
  transition: all 0.2s ease;
}

.admin-link.router-link-active {
  background: #1f2937;
  color: #fff;
  box-shadow: 0 8px 20px rgba(31, 41, 55, 0.18);
}

@media (max-width: 768px) {
  .admin-subnav {
    width: 100%;
    overflow-x: auto;
  }

  .admin-link {
    white-space: nowrap;
  }
}
</style>
