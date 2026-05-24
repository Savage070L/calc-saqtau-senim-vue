<template>
  <div v-if="enabled && result" class="debug-panel">
    <div class="dbg-header" @click="open = !open">
      <span class="dbg-title">🔬 DEBUG</span>
      <span class="dbg-arrow">{{ open ? '▼' : '▶' }}</span>
    </div>

    <div v-show="open" class="dbg-body">

      <!-- ── Входные данные ── -->
      <section class="dbg-section">
        <h4>Входные / Базовые</h4>
        <table class="dbg-table three-col">
          <thead>
            <tr><th>Параметр</th><th>Что значит</th><th>Значение</th></tr>
          </thead>
          <tbody>
            <tr><td>x</td>     <td>Возраст застрахованного на дату начала договора</td><td>{{ result.age }}</td></tr>
            <tr><td>n</td>     <td>Срок договора (страхования), лет</td><td>{{ result.term }}</td></tr>
            <tr><td>t</td>     <td>Срок уплаты взносов: t = n обычно, t = 1 при single</td><td>{{ result.paymentTerm }}</td></tr>
            <tr><td>gender</td><td>Пол → выбор таблицы смертности</td><td>{{ result.gender }}</td></tr>
            <tr><td>frequency</td><td>Периодичность взносов</td><td>{{ result.frequency }}</td></tr>
            <tr><td>ff</td>    <td>Коэф. периодичности (annual=1, semi=0.51, quart=0.2575, month=0.0875, single=1)</td><td>{{ fmt(result.freqFactor, 6) }}</td></tr>
            <tr><td>i</td>     <td>Ставка доходности: 7% обычно, 12% при single+n=3</td><td>{{ fmt(result.interestRate, 6) }}</td></tr>
            <tr><td>v</td>     <td>Дисконт-фактор: v = 1 / (1 + i)</td><td>{{ fmt(1 / (1 + result.interestRate), 10) }}</td></tr>
          </tbody>
        </table>
      </section>

      <!-- ── Коммутационные числа ── -->
      <section class="dbg-section">
        <h4>Коммутационные числа</h4>
        <table class="dbg-table three-col">
          <thead>
            <tr><th>Величина</th><th>Формула / определение</th><th>Значение</th></tr>
          </thead>
          <tbody>
            <tr><td>D(x)</td>   <td>D(x) = l(x) · vˣ</td><td>{{ fmt(act.Dx, 10) }}</td></tr>
            <tr><td>D(x+1)</td> <td>D(x+1) = l(x+1) · vˣ⁺¹</td><td>{{ fmt(act.Dx1, 10) }}</td></tr>
            <tr><td>D(x+n)</td> <td>D(x+n) = l(x+n) · vˣ⁺ⁿ</td><td>{{ fmt(act.Dxn, 10) }}</td></tr>
            <tr><td>M(x)</td>   <td>M(x) = Σ_{k=x..ω} C(k), где C(k) = (l(k)−l(k+1))·vᵏ⁺¹</td><td>{{ fmt(act.Mx, 10) }}</td></tr>
            <tr><td>M(x+n)</td> <td>M(x+n) — тот же ряд, но с возраста x+n</td><td>{{ fmt(act.Mxn, 10) }}</td></tr>
            <tr><td>N(x)</td>   <td>N(x) = Σ_{k=x..ω} D(k)</td><td>{{ fmt(act.Nx, 10) }}</td></tr>
            <tr><td>N(x+n)</td> <td>N(x+n) — тот же ряд, но с возраста x+n</td><td>{{ fmt(act.Nxn, 10) }}</td></tr>
            <tr><td>N(x+t)</td> <td>N(x+t) — нужно для аннуитета на срок уплаты t</td><td>{{ fmt(act.Nxt, 10) }}</td></tr>
            <tr><td>D(x+1)/D(x)</td><td>дисконтирующий множитель «на 1 год»</td><td>{{ fmt(act.Dx > 0 ? act.Dx1 / act.Dx : 0, 10) }}</td></tr>
          </tbody>
        </table>
      </section>

      <!-- ── Актуарные величины ── -->
      <section class="dbg-section">
        <h4>Актуарные величины</h4>
        <table class="dbg-table three-col">
          <thead>
            <tr><th>Величина</th><th>Формула</th><th>Значение</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Ax:n</td>
              <td>Ax:n = (M(x) − M(x+n) + D(x+n)) / D(x) &nbsp; (нетто-ставка эндаумента)</td>
              <td>{{ fmt(act.Ax_n, 10) }}</td>
            </tr>
            <tr>
              <td>ax:n</td>
              <td>äx:n = (N(x) − N(x+n)) / D(x) &nbsp; (аннуитет на срок страхования)</td>
              <td>{{ fmt(act.ax_n, 10) }}</td>
            </tr>
            <tr>
              <td>ax:t</td>
              <td>äx:t = (N(x) − N(x+t)) / D(x) &nbsp; (аннуитет на срок уплаты)</td>
              <td>{{ fmt(act.ax_t, 10) }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- ── Расходные нагрузки ── -->
      <section class="dbg-section">
        <h4>Расходные нагрузки</h4>
        <table class="dbg-table three-col">
          <thead>
            <tr><th>Параметр</th><th>Откуда</th><th>Значение</th></tr>
          </thead>
          <tbody>
            <tr><td>G2</td><td>аквизиция 1-й год: ⌈K[t]⌉₂ (или ⌈M[n]⌉₂ при t=1)</td><td>{{ fmt(act.G2, 6) }}</td></tr>
            <tr><td>G3</td><td>аквизиция 2-й год: ⌈L[t]⌉₂ (или ⌈M[n]⌉₂ при t=1)</td><td>{{ fmt(act.G3, 6) }}</td></tr>
            <tr><td>G6</td><td>нагрузка от премий: N[n] из таблицы расходов</td><td>{{ fmt(act.G6, 6) }}</td></tr>
            <tr><td>G7</td><td>нагрузка от страх. суммы: O[n] из таблицы расходов</td><td>{{ fmt(act.G7, 6) }}</td></tr>
            <tr><td>G8</td><td>штраф при досрочном расторжении (1%)</td><td>{{ fmt(act.G8, 6) }}</td></tr>
          </tbody>
        </table>
      </section>

      <!-- ── Числитель / Знаменатель формулы БП ── -->
      <section class="dbg-section">
        <h4>Формула брутто-премии</h4>
        <div class="dbg-formula-block">
          BP = ( Ax:n + G7·äx:n ) ÷ ( äx:t − G6·äx:t − (G2 + G3·D(x+1)/D(x)) )
        </div>
        <table class="dbg-table three-col">
          <tbody>
            <tr>
              <td>числитель</td>
              <td>Ax:n + G7·äx:n = {{ fmt(act.Ax_n, 8) }} + {{ fmt(act.G7, 6) }}·{{ fmt(act.ax_n, 8) }}</td>
              <td>{{ fmt(act.Ax_n + act.G7 * act.ax_n, 10) }}</td>
            </tr>
            <tr>
              <td>знаменатель</td>
              <td>äx:t − G6·äx:t − (G2 + G3·D(x+1)/D(x))</td>
              <td>{{ fmt(act.ax_t - act.G6 * act.ax_t - (act.G2 + act.G3 * act.Dx1 / act.Dx), 10) }}</td>
            </tr>
            <tr><td>BP-rate</td><td>= числитель / знаменатель  (ставка БП на 1 ед. СС)</td><td>{{ fmt(result.BP_rate, 10) }}</td></tr>
            <tr><td>NP-rate</td><td>NP = Ax:n / äx:t  (ставка НП на 1 ед. СС)</td><td>{{ fmt(result.NP_rate, 10) }}</td></tr>
          </tbody>
        </table>
      </section>

      <!-- ── Премия / СС ── -->
      <section class="dbg-section">
        <h4>Премия и страховая сумма</h4>
        <table class="dbg-table three-col">
          <thead>
            <tr><th>Величина</th><th>Формула</th><th>Значение</th></tr>
          </thead>
          <tbody>
            <tr><td>SA</td><td>{{ result.mode === 'premium_to_sa' ? 'SA = premium / (BP × ff)  ← обратный расчёт' : 'задано пользователем' }}</td><td>{{ fmt(result.sumAssured, 4) }}</td></tr>
            <tr><td>annualPremium</td><td>= ROUND( BP × SA )</td><td>{{ fmt(result.annualPremium, 4) }}</td></tr>
            <tr><td>grossPremium</td><td>{{ result.frequency === 'single' ? '= ROUND(BP × SA)  (single)' : '= ROUND( BP × SA × ff )' }}</td><td>{{ fmt(result.grossPremium, 4) }}</td></tr>
            <tr><td>netPremium</td><td>= NP × SA</td><td>{{ fmt(result.netPremium, 4) }}</td></tr>
          </tbody>
        </table>
      </section>

      <!-- ── Дополнительные покрытия ── -->
      <section v-if="enabledRiders.length" class="dbg-section">
        <h4>Дополнительные покрытия (рейдеры)</h4>
        <div class="dbg-formula-block">
          Простой рейдер:
            gross_tariff = ROUND( tariff × (1 + e) / (1 − q), 4 );
            rider_premium = single ? ROUND(gross_tariff × sum × n) : ROUND(gross_tariff × sum × ff)
        </div>
        <table class="dbg-table riders">
          <thead>
            <tr>
              <th>Покрытие</th>
              <th>base tariff</th>
              <th>gross tariff / BP_ci / J6</th>
              <th>sum</th>
              <th>annual</th>
              <th>premium</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in enabledRiders" :key="r.key">
              <td>{{ r.key }}</td>
              <td>{{ r.baseTariff != null ? fmt(r.baseTariff, 6) : '—' }}</td>
              <td>{{ r.grossTariff != null ? fmt(r.grossTariff, 6) : (r.BP_ci != null ? fmt(r.BP_ci, 6) + ' (BP_ci)' : (r.grossTariffDis != null ? fmt(r.grossTariffDis, 6) + ' (J6)' : '—')) }}</td>
              <td>{{ r.riderSum != null ? fmt(r.riderSum, 0) : '—' }}</td>
              <td>{{ r.annualPremium != null ? fmt(r.annualPremium, 4) : '—' }}</td>
              <td>{{ fmt(r.riderPremium, 4) }}</td>
            </tr>
            <tr class="total">
              <td colspan="5">ИТОГО рейдеры</td>
              <td>{{ fmt(result.totalRiderPremium, 4) }}</td>
            </tr>
          </tbody>
        </table>

        <!-- waiver-расшифровка -->
        <div v-if="waiver" class="dbg-formula-block secondary">
          <strong>Освобождение от уплаты взносов (premium_waiver):</strong><br>
          J6 = ROUND( tariff_disability × (1 + e) / (1 − q), 4 ) = {{ fmt(waiver.grossTariffDis, 6) }}<br>
          P[k] = ROUND( BP × SA ) для k = 0..n-1 = {{ fmt(waiver.annualPayment, 4) }} (каждый год)<br>
          Q[k] = Σ P[k+1 .. n-1];  R[k] = ROUND( Q[k] × J6 )<br>
          waiver_premium = ROUND( Σ R / (n-1) × ff ) = <b>{{ fmt(waiver.riderPremium, 4) }}</b>
        </div>
      </section>

      <!-- ── CI rider дополнительные параметры ── -->
      <section v-if="ci" class="dbg-section">
        <h4>CI (критические заболевания) — актуарный расчёт</h4>
        <div class="dbg-formula-block">
          A_ci = Σ_{k=0..n-1} ( D_ci(x+k) / D_ci(x) ) · q_ci(x+k) &nbsp; (begin-of-year)<br>
          äx:n (ci) = ( N_ci(x) − N_ci(x+n) ) / D_ci(x)<br>
          äx:t (ci) = ( N_ci(x) − N_ci(x+t) ) / D_ci(x)<br>
          BP_ci = ROUND( ( A_ci + G7·äx:n_ci ) / ( äx:t_ci − G6·äx:t_ci − (G2 + G3·D_ci(x+1)/D_ci(x)) ), 4 )<br>
          rider_premium = single ? ROUND(BP_ci × sum) : ROUND(BP_ci × sum × ff)
        </div>
        <table class="dbg-table three-col">
          <tbody>
            <tr><td>A_ci</td>    <td>PV выплат при первичной диагностике КЗ</td><td>{{ fmt(ci.A_ci, 10) }}</td></tr>
            <tr><td>äx:n (ci)</td><td>аннуитет CI на срок страхования</td><td>{{ fmt(ci.ax_n, 10) }}</td></tr>
            <tr><td>äx:t (ci)</td><td>аннуитет CI на срок уплаты</td><td>{{ fmt(ci.ax_t, 10) }}</td></tr>
            <tr><td>BP_ci</td>   <td>брутто-ставка CI на 1 ед. суммы покрытия</td><td>{{ fmt(ci.BP_ci, 10) }}</td></tr>
          </tbody>
        </table>
      </section>

      <!-- ── Итого ── -->
      <section class="dbg-section">
        <h4>Итог</h4>
        <table class="dbg-table three-col">
          <tbody>
            <tr><td>grossPremium</td><td>основное покрытие</td><td>{{ fmt(result.grossPremium, 4) }}</td></tr>
            <tr><td>totalRiderPremium</td><td>сумма по всем рейдерам</td><td>{{ fmt(result.totalRiderPremium, 4) }}</td></tr>
            <tr class="total"><td>totalPremium</td><td>= grossPremium + totalRiderPremium</td><td>{{ fmt(result.totalPremium, 4) }}</td></tr>
          </tbody>
        </table>
      </section>

      <!-- ── Резервы и выкупные суммы ── -->
      <section class="dbg-section">
        <h4>Резервы / выкупные суммы / УСС</h4>
        <div class="dbg-formula-block">
          Ax:n_k = ( M(x+k) − M(x+n) + D(x+n) ) / D(x+k);
          äx:n_k = ( N(x+k) − N(x+n) ) / D(x+k);
          äx:t_k = ( N(x+k) − N(x+t) ) / D(x+k)  при k&lt;t, иначе 0<br>
          α_k = G3 при k=1, иначе 0<br>
          reserveRate   = Ax:n_k + G7·äx:n_k − BP · ( äx:t_k − G6·äx:t_k − α_k )<br>
          surrenderRate = reserveRate − (1 − reserveRate) · G8<br>
          reserve = reserveRate × SA;
          surrender = max( surrenderRate × SA, 0 );  при k = n → surrender = SA (дожитие)<br>
          reduced_SA = ROUND( surrender / Ax:n_k )
        </div>
        <table class="dbg-table reserves">
          <thead>
            <tr>
              <th>год k</th><th>age</th>
              <th>Ax:n_k</th><th>äx:n_k</th><th>äx:t_k</th><th>α_k</th>
              <th>reserveRate</th><th>surrenderRate</th>
              <th>reserve</th><th>surrender</th><th>reduced SA</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in result.reserves" :key="r.year">
              <td>{{ r.year }}</td>
              <td>{{ r.age }}</td>
              <td>{{ fmt(r.Ax_n_k, 8) }}</td>
              <td>{{ fmt(r.ax_n_k, 8) }}</td>
              <td>{{ fmt(r.ax_t_k, 8) }}</td>
              <td>{{ fmt(r.alpha_k, 6) }}</td>
              <td>{{ fmt(r.reserveRate, 8) }}</td>
              <td>{{ fmt(r.surrenderRate, 8) }}</td>
              <td>{{ fmt(r.reserve, 2) }}</td>
              <td>{{ fmt(r.surrender, 2) }}</td>
              <td>{{ fmt(r.reducedSA, 2) }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- ── Raw JSON ── -->
      <section class="dbg-section">
        <h4>Raw result (JSON)</h4>
        <button class="dbg-copy" @click="copyJson">Скопировать JSON</button>
        <pre class="dbg-pre">{{ rawJson }}</pre>
      </section>

    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';

const props = defineProps({ result: { type: Object, default: null } });

const open = ref(true);

const enabled = computed(() => {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || /^10\./.test(h) || /^192\.168\./.test(h)) {
    return true;
  }
  const params = new URLSearchParams(window.location.search);
  return params.get('debug') === '1';
});

const act = computed(() => props.result?.actuarial ?? {});
const ci  = computed(() => props.result?.riders?.critical_illness ?? null);
const waiver = computed(() => props.result?.riders?.premium_waiver?.riderPremium > 0
  ? props.result.riders.premium_waiver : null);

const enabledRiders = computed(() => {
  const r = props.result?.riders ?? {};
  return Object.entries(r)
    .filter(([, v]) => (v?.riderPremium ?? 0) > 0)
    .map(([key, v]) => ({ key, ...v }));
});

const rawJson = computed(() => JSON.stringify(props.result, null, 2));

function fmt(value, decimals = 4) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString('ru-RU', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: true,
  });
}

function copyJson() {
  navigator.clipboard?.writeText(rawJson.value);
}
</script>

<style scoped>
.debug-panel {
  margin-top: 18px;
  padding: 14px 16px;
  border-radius: 16px;
  background: #1a1f2e;
  border: 2px dashed #ffcc00;
  color: #e6edf3;
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
  font-size: 12px;
}
.dbg-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  font-weight: 700;
  color: #ffcc00;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  user-select: none;
}
.dbg-arrow { font-size: 11px; opacity: 0.8; }
.dbg-body { margin-top: 14px; display: flex; flex-direction: column; gap: 14px; }

.dbg-section h4 {
  margin: 0 0 6px 0;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #79b740;
  font-weight: 700;
}

.dbg-formula-block {
  background: rgba(121,183,64,0.08);
  border-left: 3px solid #79b740;
  padding: 8px 12px;
  margin-bottom: 8px;
  font-size: 11.5px;
  line-height: 1.55;
  color: #d1e8b3;
  border-radius: 6px;
}
.dbg-formula-block.secondary {
  background: rgba(255,204,0,0.08);
  border-left-color: #ffcc00;
  color: #f0e0a8;
  margin-top: 10px;
}

.dbg-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  table-layout: fixed;
}
.dbg-table.three-col col:nth-child(1),
.dbg-table.three-col th:nth-child(1),
.dbg-table.three-col td:nth-child(1) { width: 14%; }
.dbg-table.three-col col:nth-child(2),
.dbg-table.three-col th:nth-child(2),
.dbg-table.three-col td:nth-child(2) { width: 58%; }
.dbg-table.three-col col:nth-child(3),
.dbg-table.three-col th:nth-child(3),
.dbg-table.three-col td:nth-child(3) { width: 28%; }

.dbg-table td, .dbg-table th {
  padding: 4px 8px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  text-align: left;
  vertical-align: top;
  word-break: break-word;
}
.dbg-table th {
  color: #88a0bd;
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
}
.dbg-table.three-col td:first-child {
  font-weight: 700;
  color: #79b740;
}
.dbg-table.three-col td:nth-child(2) {
  color: #b8c5d4;
  font-size: 11.5px;
}
.dbg-table.three-col td:last-child {
  font-family: 'SF Mono', monospace;
  text-align: right;
  color: #fff;
  font-weight: 600;
}

.dbg-table.riders td:last-child,
.dbg-table.reserves td {
  text-align: right;
}
.dbg-table tr.total td { color: #79b740; font-weight: 700; border-top: 1px solid rgba(121,183,64,0.4); }

.dbg-table.reserves {
  font-size: 11px;
  table-layout: auto;
}
.dbg-table.reserves th,
.dbg-table.reserves td {
  padding: 3px 6px;
  white-space: nowrap;
}
.dbg-table.reserves td { text-align: right; }
.dbg-table.reserves td:first-child,
.dbg-table.reserves td:nth-child(2) { text-align: left; }

.dbg-copy {
  background: #2d5171;
  color: #fff;
  border: none;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  cursor: pointer;
  margin-bottom: 6px;
}
.dbg-copy:hover { background: #4a7295; }

.dbg-pre {
  background: #0f1219;
  border: 1px solid rgba(255,255,255,0.08);
  padding: 10px;
  border-radius: 8px;
  max-height: 280px;
  overflow: auto;
  font-size: 11px;
  white-space: pre;
}
</style>
