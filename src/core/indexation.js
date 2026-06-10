/**
 * Расчёт индексации полиса — Saqtau Senim
 *
 * Эталон: «09_06_2026 SAQTAU SENIM NBS.xlsm» (макрос Final_Stable_Macro_HiddenSheet,
 * листы «Данные i», «Параметры i», «Расчет i»).
 *
 * Модель эталона — «доплата за прирост СС с накопленным резервом Vx_m»:
 *   Каждую годовщину m страховая сумма увеличивается на ставку индексации, и клиент
 *   платит НЕ полную премию за новую СС, а премию за (СС_m − F9_m), где F9_m —
 *   «оплаченная» часть СС, эквивалентная накопленному резерву Vx_m.
 *
 * Точная рекурсия (восстановлена из формул Excel и подтверждена до тенге на
 * закэшированном прогоне макроса — 20 годовщин, n=20, индексация 20 %):
 *
 *   ─── кривые ИСХОДНОГО полиса (k = 0..n, исходный возраст x, исходные n и t) ──
 *   A(k)  = (M(x+k) − M(x+n) + D(x+n)) / D(x+k)        // Ax:n на год k («Расчет i» E18+)
 *   aN(k) = (N(x+k) − N(x+n)) / D(x+k)                 // ax:n на год k (F18+)
 *   aT(k) = (N(x+k) − N(x+t)) / D(x+k)                 // ax:t на год k (G18+); t = n при
 *                                                      // рассрочке (⇒ aT = aN), t = 1 при single
 *
 *   ─── состояние годовщины m (m = 0..n−1) ────────────────────────────────────
 *   SA_m = SA_0 × (1 + i)^m
 *   G2_m = 0 при m ≥ 1; G3_m = 0 при m ≥ 2 (аквизиция списана)
 *   F1 = A(m); F2 = aN(m)            // верхний блок «Расчет i» (x_iz = x+m даёт те же значения)
 *   F3 = aN(m) при рассрочке         // B9 = N(x+t) с ИСХОДНЫМИ x и t ⇒ ax:t = ax:n
 *      = 1      при single           // (N(x_iz) − N(x_iz+1))/D(x_iz)
 *   BP_m = (F1 + G7×F2) / (F3 − G6×F3 − (G2_m + G3_m × D(x+1)/D(x+m)))   // «Расчет i»!F7
 *   F9_m = ROUND(Vx_m / (F1 + G7×F2))                                    // «Расчет i»!F9
 *   премия_m = ROUND(BP_m × (SA_m − F9_m) × коэф.периодичности)          // «Расчет i»!F8
 *
 *   ─── накопление резерва («Данные i» E54+ → «Расчет i» I/J(18+m+1), счит. в состоянии m) ──
 *   alfa = G3_m при k = m+1 = 1, иначе 0                                 // «Расчет i» H19+
 *   Irate = A(k) + G7×aN(k) − BP_m × (aT(k)×(1−G6) − alfa)               // I(18+k)
 *   Vx_{m+1} = ROUND(Irate × (SA_m − F9_m) + F9_m × A(k)),  k = m+1      // I×(C15−F9)+J
 *   Vx_0 = 0
 *
 * ВАЖНО: кривые A/aN/aT берутся по исходному возрасту x+k (НЕ по x_iz), а в шаге
 * накопления Vx участвует BP текущего года m. Выкупная — по эталонным колонкам
 * K/L/M «Расчет i»: L = I − (1−I)×штраф; K = J − (F9−J)×штраф; M = max(L,0)×(СС−F9)+K.
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

  // Техническая ставка фиксируется при выпуске полиса (в Excel — одна таблица
  // «Комутационные i» на весь прогон), поэтому берётся по ИСХОДНОМУ сроку.
  const rate = engine.getInterestRate(frequency, term);
  const comm = engine.getCommutationTable(gender, 1.0, 0.0, rate);

  const D = a => comm.Dx(a);
  const N = a => comm.Nx(a);
  const M = a => comm.Mx(a);

  // Константы исходного полиса
  const Dxn  = D(baseAge + term);                          // D(x+n)
  const Nxn  = N(baseAge + term);                          // N(x+n)
  const Mxn  = M(baseAge + term);                          // M(x+n)
  const NxtO = N(baseAge + (isSingle ? 1 : term));         // B9 = N(x+t), исходные x и t

  // Кривые исходного полиса на год k (эталон: «Расчет i», строки 18+, возраст x+k)
  const A_  = k => { const d = D(baseAge + k); return d > 0 ? (M(baseAge + k) - Mxn + Dxn) / d : 0; };
  const aN_ = k => { const d = D(baseAge + k); return d > 0 ? (N(baseAge + k) - Nxn) / d : 0; };
  // Для single t=1 ⇒ (N(x+k) − N(x+1))/D < 0 при k ≥ 2 — в эталоне вырождено;
  // актуарно корректно 0 (после года 0 взносов нет), поэтому clamp. При рассрочке
  // t = n ⇒ NxtO = Nxn и clamp никогда не срабатывает (aT = aN ≥ 0).
  const aT_ = k => { const d = D(baseAge + k); return d > 0 ? Math.max(0, (N(baseAge + k) - NxtO) / d) : 0; };

  // Нагрузки. В эталоне (Excel «Параметры i»):
  //   • G6 / G7 — по ИСХОДНОМУ сроку n (формула =INDEX(N1:N13, MIN(n-2,13)))
  //   • G2 / G3 — по исходному сроку оплаты t, но
  //       G2 = IF(n-n_iz>0, 0, ROUNDUP(...))  → обнуляется при m ≥ 1
  //       G3 = IF(n-n_iz>1, 0, ROUNDUP(...))  → обнуляется при m ≥ 2
  const { G6, G7 } = getG6G7(config, term);                      // по исходному n
  const rawG2G3    = getG2G3(config, term, isSingle);            // по исходному t

  const rows = [];
  // Срок индексации фиксированный: term - 1 (год 0 = базовый, до года term-1 включительно).
  // При n=10 → строки Y0..Y9 (10 строк), при n=5 → Y0..Y4 (5 строк).
  const maxM = term - 1;

  let Vx = 0;  // накопленный резерв Vx_m («Данные i»!J7); Vx_0 = 0 (E53 = 0)

  for (let m = 0; m <= maxM; m++) {
    const ageM           = baseAge + m;
    const remainingTerm  = term - m;
    if (remainingTerm < 1) break;
    // Возрастной cut-off страховщика (для Saqtau Senim — 70 на выход)
    if (ageM + remainingTerm > (config.maxExitAge ?? 70)) {
      // выход за допустимый возраст — обрываем индексацию
      break;
    }

    // Индексированная страховая сумма («Данные i»!C15 = I7 = G7 × (1 + ставка))
    const saM = initialSumAssured * Math.pow(1 + indexRate, m);

    const G2 = m >= 1 ? 0 : rawG2G3.G2;
    const G3 = m >= 2 ? 0 : rawG2G3.G3;

    // Верхний блок «Расчет i»: F1 = (M(x_iz) − M(x+n) + D(x+n))/D(x_iz) и т.д.
    // При x_iz = x+m эти значения совпадают с кривыми исходного полиса на год m.
    const Dx   = D(ageM);
    const F1   = A_(m);                                    // Ax:n
    const F2   = aN_(m);                                   // ax:n
    const F3   = isSingle
      ? (Dx > 0 ? (N(ageM) - N(ageM + 1)) / Dx : 0)        // = 1 (рента на 1 платёж)
      : F2;                                                // B9 = N(x+t) исходные ⇒ ax:t = ax:n

    // Брутто-ставка года m («Расчет i»!F7). В alfa-части — B2/B1 = D(x+1)/D(x_iz):
    // исходный возраст x+1 в числителе, текущий x_iz в знаменателе.
    const den = F3 - G6 * F3 - (G2 + G3 * D(baseAge + 1) / Dx);
    const BP  = den > 0 ? (F1 + G7 * F2) / den : 0;

    // F9 — «оплаченная» резервом часть СС («Расчет i»!F9)
    const denF9 = F1 + G7 * F2;
    const F9 = m > 0 && denF9 > 0 ? roundHalfUp(Vx / denF9) : 0;

    // Премия основного покрытия года m — ДОПЛАТА за прирост СС («Расчет i»!F8)
    const mainPremium = roundHalfUp(BP * (saM - F9) * freqFactor);

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

    // ── Накопление резерва: Vx на годовщину m+1, посчитанный в состоянии m ──
    // («Данные i» E[53+m+1] = ROUND('Расчет i'!I[18+k] × (C15 − F9) + 'Расчет i'!J[18+k]), k = m+1)
    const k     = m + 1;
    const alfa  = k === 1 ? G3 : 0;                        // H19 = G3 (G4 = G5 = 0); H20+ = 0
    const Ak    = A_(k);
    const Irate = Ak + G7 * aN_(k) - BP * (aT_(k) * (1 - G6) - alfa);
    const VxNext = roundHalfUp(Irate * (saM - F9) + F9 * Ak);

    // Резерв/выкупная на конец года m (= годовщина m+1) — эталонные колонки K/L/M:
    //   L = I − (1−I)×штраф; J = F9×A(k); K = J − (F9−J)×штраф; M = max(L,0)×(СС−F9) + K
    const Lrate = Irate - (1 - Irate) * surrenderPenalty;
    const Jres  = F9 * Ak;
    const Kres  = Jres - (F9 - Jres) * surrenderPenalty;
    const reserve   = Math.max(VxNext, 0);
    const surrender = remainingTerm === 1
      ? saM   // дожитие
      : Math.max(roundHalfUp(Math.max(Lrate, 0) * (saM - F9) + Kres), 0);
    const reducedSA = Ak > 0 ? roundHalfUp(surrender / Ak) : 0;

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

    Vx = VxNext;
  }

  return rows;
}
