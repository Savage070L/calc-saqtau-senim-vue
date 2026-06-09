<template>
  <div v-if="rows.length > 0" class="indexation-block">
    <div class="ix-toggle" @click="open = !open" :class="{ expanded: open }">
      <span class="icon">📈</span>
      <span class="ix-title">{{ t('indexation.title') }}</span>
      <InfoTooltip v-bind="tip('indexationResult')" />
      <span class="ix-arrow">{{ open ? '▲' : '▼' }}</span>
    </div>

    <div v-if="open" class="ix-wrap">
      <table class="data-table ix-table">
        <thead>
          <tr>
            <th class="col-num">{{ t('indexation.colNum') }}</th>
            <th>{{ t('indexation.colPeriod') }}</th>
            <th class="num">{{ t('indexation.colPremium') }}</th>
            <th class="num">{{ t('indexation.colSA') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, idx) in rows" :key="r.year">
            <td class="col-num">{{ idx + 1 }}</td>
            <td class="col-date">{{ formatPeriod(r) }}</td>
            <td class="num col-prem">{{ fmt(r.premium) }}</td>
            <td class="num col-sa">{{ fmt(r.sumAssured) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import InfoTooltip from './InfoTooltip.vue';
import { useI18n } from '../i18n/index.js';

const { t, tip } = useI18n();

const props = defineProps({
  result: { type: Object, default: null },
});

const open = ref(true);

const rows = computed(() => props.result?.indexationSchedule ?? []);

function fmt(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
    .format(Math.round(v)) + ' ₸';
}
function formatDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}
function formatPeriod(r) {
  if (!r.dateEnd) return formatDate(r.date);
  return `${formatDate(r.date)} – ${formatDate(r.dateEnd)}`;
}
</script>

<style scoped>
.indexation-block {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(95,189,245,0.22);
  border-radius: 16px;
  padding: 14px 16px;
  margin-top: 14px;
}
.ix-toggle {
  display: flex; align-items: center; gap: 10px;
  cursor: pointer;
  user-select: none;
  font-weight: 700;
  font-size: 15px;
  color: #FFFFFF;
}
.ix-toggle .icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px;
  border-radius: 10px;
  background: rgba(161,201,90,0.18);
  font-size: 18px;
}
.ix-title { flex: 1 1 auto; min-width: 0; }
.ix-arrow { font-size: 12px; opacity: 0.7; }
.ix-toggle.expanded { padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.10); margin-bottom: 10px; }

.ix-wrap {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.ix-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 15px;
}
.ix-table th, .ix-table td {
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  text-align: center;            /* всё по центру */
  vertical-align: middle;
  white-space: nowrap;
}
.ix-table th {
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 13px;
  color: #B3D9FF;
  background: linear-gradient(135deg, #2D5171, #4A7295);
  position: sticky; top: 0; z-index: 1;
}
.ix-table tbody tr:nth-child(odd) td { background: rgba(161,201,90,0.07); }
.ix-table tbody tr:nth-child(even) td { background: rgba(95,189,245,0.05); }
.ix-table tbody tr:hover td { background: rgba(95,189,245,0.16); }

.num { font-family: 'SF Mono', 'Menlo', monospace; }
.col-num { color: #5FBDF5; font-weight: 700; width: 60px; }
.col-date { color: #B3D9FF; }
.col-prem { color: #FFFFFF; font-weight: 600; }
.col-sa   { color: #A1C95A; font-weight: 700; }

@media (max-width: 720px) {
  .ix-table { font-size: 13px; }
  .ix-table th, .ix-table td { padding: 8px 10px; }
  .ix-table th { font-size: 11px; }
}
</style>
