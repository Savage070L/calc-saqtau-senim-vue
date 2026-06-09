/**
 * Расчёт индексации полиса — Saqtau Senim
 *
 * Эталон: «010626 Saqtau SENIM индексация NBS123.xlsm» (макрос Final_Stable_Macro_HiddenSheet,
 * листы «Данные i», «Параметры i», «Расчет i»).
 *
 * Идея индексации:
 *   Каждую годовщину страховая сумма увеличивается на фиксированный процент (по умолчанию 7 %).
 *   Премия пересчитывается под новый возраст, оставшийся срок и индексированную СС.
 *   После 1-го года уже не списывается «АВ 1-й год» (G2 = 0),
 *   после 2-го года — «АВ 2-й год» (G3 = 0) тоже.
 *
 * Формулы:
 *   ─── для каждой годовщины m = 0..indexYears ─────────────────────────────────
 *   SA_m = SA_0 × (1 + rate)^m              // индексированная СС
 *   age_m = age_0 + m                       // возраст вырос
 *   remaining_n = n_0 - m                   // срок уменьшился
 *
 *   ─── актуарные при новом возрасте и сроке (single, t = 1) ───────────────────
 *   Ax:n = (M(age_m) − M(age_m + remaining_n) + D(age_m + remaining_n)) / D(age_m)
 *   ax:t = (N(age_m) − N(age_m + 1)) / D(age_m) ≈ 1
 *
 *   ─── нагрузки с поэтапным обнулением аквизиции ─────────────────────────────
 *   G6, G7 — берутся по сроку remaining_n (тот же expense_table)
 *   G2_m = 0  если m ≥ 1 (уже не первый год полиса)
 *   G3_m = 0  если m ≥ 2 (уже не второй год полиса)
 *   На m = 0 G2/G3 = стандартные (как при обычном single-расчёте).
 *
 *   ─── брутто-ставка и премия года m ─────────────────────────────────────────
 *   BP_m = (Ax:n + G7 × ax:n) / (ax:t − G6 × ax:t − (G2_m + G3_m × D(x+1)/D(x)))
 *   premium_m = ROUND(BP_m × SA_m × freqFactor, 0)
 */

import { PolicyCalculator, roundHalfUp } from './calculator.js';
import { PRODUCT_CONFIG }                from '../config/product.js';

function clampTermKey(n) {
  return Math.min(Math.max(Math.round(n), 3), 15);
}

/**
 * Получить G6, G7 (нагрузки от премий / от СС) для срока n из expenseTable.
 * G6/G7 не зависят от срока оплаты t, только от срока страхования.
 */
function getG6G7(config, n) {
  const en = config.expenseTable[clampTermKey(n)];
  return { G6: en.N, G7: en.O };
}

/**
 * Получить G2_raw, G3_raw из expenseTable.
 *   Для single (t = 1): G2 = G3 = ROUNDUP(M[n], 2).
 *   Для рассрочки    : G2 = ROUNDUP(K[t], 2), G3 = ROUNDUP(L[t], 2).
 */
function getG2G3(config, n, isSingle) {
  if (isSingle) {
    const g10 = Math.ceil(config.expenseTable[clampTermKey(n)].M * 100) / 100;
    return { G2: g10, G3: 0 };  // при t=1 G3 = 0 (Excel: ROUNDUP(IF(t=1, 0, ...)))
  }
  const en = config.expenseTable[clampTermKey(n)];
  return {
    G2: Math.ceil(en.K * 100) / 100,
    G3: Math.ceil(en.L * 100) / 100,
  };
}

/**
 * Рассчитать таблицу индексации.
 *
 * @param {Object} params
 * @param {string} params.dob              — дата рождения 'YYYY-MM-DD'
 * @param {string} params.gender           — 'male' | 'female'
 * @param {number} params.term             — изначальный срок страхования
 * @param {string} params.frequency        — обычно 'single'
 * @param {number} params.initialSumAssured — СС года 0
 * @param {number} params.indexRate         — ставка индексации (0..1), напр. 0.07
 * @param {number} params.indexYears        — на сколько лет показывать индексацию (3..maxIndexYears)
 * @param {Date}   [params.baseDate]        — дата старта (по умолчанию сегодня)
 * @param {Object} [params.engine]          — ActuarialEngine
 * @param {Object} [params.config]          — PRODUCT_CONFIG
 *
 * @returns {Array<{
 *   year: number, date: string,
 *   sumAssured: number, premium: number,
 *   BP_rate: number,
 *   G2: number, G3: number, G6: number, G7: number,
 *   reserve: number, surrender: number, reducedSA: number,
 *   age: number, remainingTerm: number,
 * }>}
 */
// Какие рейдеры считаются SA-linked (СС растёт с индексацией основного)
const SA_LINKED_KEYS = [
  'accidental_death', 'traffic_death',
  'disability_any_lumpsum', 'disability_accident_lumpsum',
];
// Fixed-sum рейдеры: их сумма НЕ индексируется (сумма выбрана пользователем)
const FIXED_SUM_KEYS = [
  'trauma', 'trauma_extra', 'temporary_disability', 'hospitalization',
];

export function calculateIndexationSchedule(params) {
  const {
    dob, gender, term, frequency = 'single',
    initialSumAssured, indexRate,
    baseDate = new Date(),
    engine, config = PRODUCT_CONFIG,
    // Опционально: проброс выбранных рейдеров для расчёта ПОЛНОЙ премии
    ridersSelection = null,
    ridersCalc      = null,
  } = params;

  if (!engine) throw new Error('calculateIndexationSchedule: engine is required');
  if (!dob || !gender || !term || !initialSumAssured) return [];
  if (indexRate < 0 || indexRate > 1) return [];

  const isSingle  = frequency === 'single';
  const baseAge   = PolicyCalculator.calculateAge(dob);
  const freqAdj   = config.frequencyAdjustment ?? {};
  const freqFactor = isSingle ? 1.0 : (freqAdj[frequency] ?? 1.0);
  const surrenderPenalty = config.surrenderPenalty;

  const rows = [];
  // Срок индексации фиксированный: term - 1 (год 0 = базовый, до года term-1 включительно).
  // При n=10 → строки Y0..Y9 (10 строк), при n=5 → Y0..Y4 (5 строк).
  const maxM = term - 1;

  for (let m = 0; m <= maxM; m++) {
    const ageM           = baseAge + m;
    const remainingTerm  = term - m;
    if (remainingTerm < 1) break;
    // Возрастной cut-off страховщика (для Saqtau Senim — 70 на выход)
    if (ageM + remainingTerm > (config.maxExitAge ?? 70)) {
      // выход за допустимый возраст — обрываем индексацию
      break;
    }

    // Индексированная страховая сумма
    const saM = initialSumAssured * Math.pow(1 + indexRate, m);

    // Ставка доходности (для Saqtau Senim — всегда 7 % в Excel-эталоне)
    const rate = engine.getInterestRate(frequency, remainingTerm);
    const comm = engine.getCommutationTable(gender, 1.0, 0.0, rate);

    // Актуарные величины при возрасте ageM (= x_iz эталона).
    //
    // ВАЖНО: эталон Excel «Расчет i» использует разные возрасты в разных
    // ячейках (defined names x = Параметры!C7 = ИСХОДНЫЙ возраст, x_iz =
    // Параметры i!D7 = возраст на дату индексации):
    //   B1 (Dx)   = D(x_iz)
    //   B2 (Dx+1) = D(x + 1)             ← исходный возраст
    //   B5 (Dx+n) = D(x + n)             ← исходный возраст и срок
    //   B7 (Nx)   = N(x_iz)
    //   B8 (Nx+n) = N(x + n)             ← исходный
    //   B9 (Nx+t) = N(x_iz + n)          ← новый x_iz, исходный n
    //   B11 (Mx)  = M(x_iz)
    //   B12 (Mx+n)= M(x + n)             ← исходный
    //
    // (x_iz + n) = (ageM + term), а (x + n) = (baseAge + term) = тот же
    // конечный возраст. (x + 1) = (baseAge + 1) — НЕ ageM + 1!
    const Dx     = comm.Dx(ageM);
    const Dxn    = comm.Dx(baseAge + term);            // = D(x + n)
    const Dx1    = comm.Dx(baseAge + 1);               // = D(x + 1), исходный возраст
    const Mx     = comm.Mx(ageM);
    const Mxn    = comm.Mx(baseAge + term);            // = M(x + n)
    const Nx     = comm.Nx(ageM);
    const Nxn    = comm.Nx(baseAge + term);            // = N(x + n)
    const Nxt    = comm.Nx(ageM + (isSingle ? 1 : term));  // = N(x_iz + n)

    const Ax_n = Dx > 0 ? (Mx - Mxn + Dxn) / Dx : 0;
    const ax_n = Dx > 0 ? (Nx - Nxn) / Dx       : 0;
    const ax_t = Dx > 0 ? (Nx - Nxt) / Dx       : 0;

    // Нагрузки. В эталоне (Excel «Параметры i»):
    //   • G6 / G7 — по ИСХОДНОМУ сроку n (формула =INDEX(N1:N13, MIN(n-2,13)))
    //   • G2 / G3 — по исходному сроку оплаты t, но
    //       G2 = IF(n-n_iz>0, 0, ROUNDUP(...))  → обнуляется при m ≥ 1
    //       G3 = IF(n-n_iz>1, 0, ROUNDUP(...))  → обнуляется при m ≥ 2
    const { G6, G7 } = getG6G7(config, term);                      // по исходному n
    const rawG2G3    = getG2G3(config, term, isSingle);            // по исходному t

    const G2 = m >= 1 ? 0 : rawG2G3.G2;
    const G3 = m >= 2 ? 0 : rawG2G3.G3;

    // Брутто-ставка года m
    const num = Ax_n + G7 * ax_n;
    const den = ax_t - G6 * ax_t - (G2 + G3 * Dx1 / Dx);
    const BP  = den > 0 ? num / den : 0;

    // Премия основного покрытия года m
    const mainPremium = roundHalfUp(BP * saM * freqFactor);

    // ── Премии всех включённых рейдеров (для отображения «итого» в таблице) ──
    // SA-linked рейдеры считаются с новой СС (saM); fixed-sum — со своей суммой.
    // Возраст и срок — текущие (ageM, remainingTerm). CI пересчитывается актуарно.
    let ridersPremium = 0;
    if (ridersSelection && ridersCalc) {
      const tCur = isSingle ? 1 : remainingTerm;
      for (const rk of SA_LINKED_KEYS) {
        if (ridersSelection[rk]?.enabled) {
          ridersPremium += ridersCalc.calculateSimpleRider(rk, saM, remainingTerm, frequency).riderPremium;
        }
      }
      for (const rk of FIXED_SUM_KEYS) {
        const sel = ridersSelection[rk];
        if (sel?.enabled && (sel.sum ?? 0) > 0) {
          ridersPremium += ridersCalc.calculateSimpleRider(rk, sel.sum, remainingTerm, frequency).riderPremium;
        }
      }
      const ciSel = ridersSelection.critical_illness;
      if (ciSel?.enabled && (ciSel.sum ?? 0) > 0) {
        ridersPremium += ridersCalc.calculateCIRider(ageM, remainingTerm, tCur, gender, ciSel.sum, frequency).riderPremium;
      }
      // Premium waiver — при single или t≤1 = 0; иначе считается от mainPremium
      if (ridersSelection.premium_waiver?.enabled) {
        ridersPremium += ridersCalc.calculateWaiverRider(ageM, remainingTerm, tCur, gender, saM, BP, frequency).riderPremium;
      }
    }
    const premium = mainPremium + ridersPremium;

    // Резерв/выкуп на КОНЕЦ года 1 (для отображения первого года полиса m)
    // У single t=1, поэтому alpha при k=1: только G3 (если он > 0)
    const Mx1 = comm.Mx(ageM + 1);
    const Nx1 = comm.Nx(ageM + 1);
    const Ax_n_1 = Dx1 > 0 ? (Mx1 - Mxn + Dxn) / Dx1 : 0;
    const ax_n_1 = Dx1 > 0 ? (Nx1 - Nxn) / Dx1       : 0;
    const ax_t_1 = remainingTerm > 1 && Dx1 > 0
      ? (Nx1 - Nxt) / Dx1 : 0;
    const alpha_1 = G3;
    const reserveRate   = Ax_n_1 + G7 * ax_n_1 - BP * (ax_t_1 - G6 * ax_t_1 - alpha_1);
    const surrenderRate = reserveRate - (1 - reserveRate) * surrenderPenalty;
    const reserve   = Math.max(reserveRate * saM, 0);
    const surrender = remainingTerm === 1
      ? saM   // дожитие
      : Math.max(surrenderRate * saM, 0);
    const reducedSA = Ax_n_1 > 0 ? roundHalfUp(surrender / Ax_n_1) : 0;

    // Дата годовщины: baseDate + m лет
    const date = new Date(baseDate.getTime());
    date.setFullYear(date.getFullYear() + m);

    // Дата конца года (период оплаты = дата .. дата + 1 год)
    const dateEnd = new Date(date.getTime());
    dateEnd.setFullYear(dateEnd.getFullYear() + 1);

    rows.push({
      year:           m,
      date:           date.toISOString().slice(0, 10),
      dateEnd:        dateEnd.toISOString().slice(0, 10),
      age:            ageM,
      remainingTerm,
      sumAssured:     Math.round(saM * 100) / 100,
      mainPremium,
      ridersPremium,
      premium,
      BP_rate:        BP,
      G2, G3, G6, G7,
      reserve:        Math.round(reserve   * 100) / 100,
      surrender:      Math.round(surrender * 100) / 100,
      reducedSA,
    });
  }

  return rows;
}
