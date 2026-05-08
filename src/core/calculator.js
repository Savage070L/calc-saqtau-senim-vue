/**
 * Калькулятор полиса — Saqtau Senim
 *
 * Основные формулы:
 *   Ax:n  = (M(x) − M(x+n) + D(x+n)) / D(x)
 *   ax:n  = (N(x) − N(x+n)) / D(x)
 *   ax:t  = (N(x) − N(x+t)) / D(x)
 *   NP    = Ax:n / ax:t
 *   BP    = (Ax:n + G7×ax:n) / (ax:t − G6×ax:t − (G2 + G3×D(x+1)/D(x)))
 *
 * Особенности Saqtau Senim:
 *   • Ставка доходности 7% (12% при single + n=3) — выбирается в актуар. движке.
 *   • Нагрузки G6/G7 берутся по СРОКУ полиса n (clamp к 3..15).
 *   • Нагрузки G2/G3 — по СРОКУ УПЛАТЫ t (clamp к 3..15), округление вверх до 2 знаков.
 *   • При t=1 (единовременно): G2 = G3 = M (clamp(n,3..15)) с тем же округлением.
 *   • Формула резерва: alpha_k = G3 при k=1, иначе 0.
 *     surrender = max((reserve_rate − (1−rate)·G8)×SA, 0).
 */

import { ActuarialEngine } from './actuarial.js';
import { PRODUCT_CONFIG }  from '../config/product.js';

// ─── Вспомогательное округление (ROUND_HALF_UP, как в Excel) ─────────────────

export function roundHalfUp(value, decimals = 0) {
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function clampTermKey(n) {
  return Math.min(Math.max(Math.round(n), 3), 15);
}

// ─── PolicyCalculator ─────────────────────────────────────────────────────────

export class PolicyCalculator {

  constructor(engine, config = PRODUCT_CONFIG) {
    this.engine           = engine;
    this.config           = config;
    this.expenseTable     = config.expenseTable;
    this.freqAdj          = config.frequencyAdjustment;
    this.surrenderPenalty = config.surrenderPenalty;
    this.annuityExpense   = config.annuityExpense;
  }

  // ─── Утилиты ────────────────────────────────────────────────────────────────

  static calculateAge(dob, ref = new Date()) {
    const [y, m, d] = dob.split('-').map(Number);
    let age = ref.getFullYear() - y;
    if (ref.getMonth() + 1 < m || (ref.getMonth() + 1 === m && ref.getDate() < d)) {
      age -= 1;
    }
    return age;
  }

  _freqFactor(frequency) {
    return frequency === 'single' ? 1.0 : (this.freqAdj[frequency] ?? 1.0);
  }

  /**
   * Saqtau Senim:
   *   G6 = N (нагрузка от премий) при сроке n
   *   G7 = O (нагрузка от страховой суммы) при сроке n
   *   G10 = ROUNDUP(M, 2) — единовременная аквизиция при сроке n
   *   При t > 1 (рассрочка):
   *       G2 = ROUNDUP(K[t], 2)
   *       G3 = ROUNDUP(L[t], 2)
   *   При t = 1 (единовр.): G2 = G3 = G10
   */
  _getExpenses(n, t) {
    const en = this.expenseTable[clampTermKey(n)];
    const G6 = en.N, G7 = en.O;
    const g10 = Math.ceil(en.M * 100) / 100;
    if (t === 1) {
      return { G2: g10, G3: g10, G6, G7, G8: this.surrenderPenalty };
    }
    const et = this.expenseTable[clampTermKey(t)];
    const G2 = Math.ceil(et.K * 100) / 100;
    const G3 = Math.ceil(et.L * 100) / 100;
    return { G2, G3, G6, G7, G8: this.surrenderPenalty };
  }

  _getRate(frequency, term) {
    return this.engine.getInterestRate(frequency, term);
  }

  // ─── Актуарные значения ──────────────────────────────────────────────────────

  _actuarialValues(comm, x, n, t) {
    const Dx  = comm.Dx(x);
    const Dxn = comm.Dx(x + n);
    const Dx1 = comm.Dx(x + 1);
    const Mx  = comm.Mx(x);
    const Mxn = comm.Mx(x + n);
    const Nx  = comm.Nx(x);
    const Nxn = comm.Nx(x + n);
    const Nxt = comm.Nx(x + t);

    const Ax_n = Dx > 0 ? (Mx - Mxn + Dxn) / Dx : 0.0;
    const ax_n = Dx > 0 ? (Nx - Nxn) / Dx       : 0.0;
    const ax_t = Dx > 0 ? (Nx - Nxt) / Dx       : 0.0;

    const NP = ax_t > 0 ? Ax_n / ax_t : 0.0;

    return { Dx, Dxn, Dx1, Mx, Mxn, Nx, Nxn, Nxt, Ax_n, ax_n, ax_t, NP };
  }

  // ─── Брутто-ставка ───────────────────────────────────────────────────────────

  calcGrossPremiumRate(x, n, t, gender, frequency, kMult = 1.0, lAdd = 0.0) {
    const rate     = this._getRate(frequency, n);
    const comm     = this.engine.getCommutationTable(gender, kMult, lAdd, rate);
    const vals     = this._actuarialValues(comm, x, n, t);
    const expenses = this._getExpenses(n, t);

    const { G2, G3, G6, G7 } = expenses;
    const { Ax_n, ax_n, ax_t, Dx, Dx1 } = vals;

    const numerator   = Ax_n + G7 * ax_n;
    const denominator = ax_t - G6 * ax_t - (G2 + G3 * Dx1 / Dx);
    const BP = denominator > 0 ? numerator / denominator : 0.0;

    return { ...vals, ...expenses, BP, NP: vals.NP, interestRate: rate };
  }

  // ─── Расчёт премии по заданной СС ────────────────────────────────────────────

  calculatePremium(dob, gender, term, frequency, sumAssured, kMult = 1.0, lAdd = 0.0) {
    const x    = PolicyCalculator.calculateAge(dob);
    const t    = frequency === 'single' ? 1 : term;
    const vals = this.calcGrossPremiumRate(x, term, t, gender, frequency, kMult, lAdd);

    const { BP, NP, interestRate } = vals;
    const freqFactor = this._freqFactor(frequency);

    const annualPremium = roundHalfUp(BP * sumAssured);
    const grossPremium  = frequency === 'single'
      ? annualPremium
      : roundHalfUp(BP * sumAssured * freqFactor);

    return {
      age: x, term, paymentTerm: t, gender, frequency,
      sumAssured, interestRate,
      BP_rate: BP, NP_rate: NP,
      annualPremium, grossPremium,
      netPremium: NP * sumAssured,
      freqFactor,
      actuarial: vals,
    };
  }

  // ─── Расчёт СС по заданной премии ────────────────────────────────────────────

  calculateSumAssured(dob, gender, term, frequency, premium, kMult = 1.0, lAdd = 0.0) {
    const x    = PolicyCalculator.calculateAge(dob);
    const t    = frequency === 'single' ? 1 : term;
    const vals = this.calcGrossPremiumRate(x, term, t, gender, frequency, kMult, lAdd);

    const { BP, NP, interestRate } = vals;
    const freqFactor = this._freqFactor(frequency);

    let sumAssured;
    if (frequency === 'single') {
      sumAssured = BP > 0 ? premium / BP : 0.0;
    } else {
      sumAssured = BP > 0 ? premium / (BP * freqFactor) : 0.0;
    }
    sumAssured = Math.round(sumAssured * 100) / 100;

    const annualPremium = roundHalfUp(BP * sumAssured);
    const grossPremium  = frequency === 'single'
      ? annualPremium
      : roundHalfUp(BP * sumAssured * freqFactor);

    return {
      age: x, term, paymentTerm: t, gender, frequency,
      sumAssured, interestRate,
      BP_rate: BP, NP_rate: NP,
      annualPremium, grossPremium,
      netPremium: NP * sumAssured,
      freqFactor,
      actuarial: vals,
    };
  }

  // ─── Обратный расчёт с учётом райдеров (3-фазный солвер из engine.js) ───────

  calculateSumAssuredWithRiders(dob, gender, term, frequency, totalPremium,
                                ridersCalc, saLinkedKeys, fixedRiders,
                                hasWaiver = false,
                                kMult = 1.0, lAdd = 0.0) {
    if (!totalPremium || !term) {
      return this.calculateSumAssured(dob, gender, term, frequency, 0, kMult, lAdd);
    }

    const x    = PolicyCalculator.calculateAge(dob);
    const t    = frequency === 'single' ? 1 : term;
    const vals = this.calcGrossPremiumRate(x, term, t, gender, frequency, kMult, lAdd);
    const { BP: bpRate, NP, interestRate } = vals;

    if (!bpRate) {
      return this.calculateSumAssured(dob, gender, term, frequency, 0, kMult, lAdd);
    }

    const freqFactor = this._freqFactor(frequency);

    // Сумма брутто-тарифов SA-linked простых допов
    let saLinkedTariffSum = 0.0;
    for (const rk of saLinkedKeys) {
      saLinkedTariffSum += this._getSimpleRiderGrossTariff(rk);
    }

    // Тариф waiver
    const j6 = (() => {
      const rcDis = this.config.riders?.disability_accident_lumpsum ?? {};
      const bt = rcDis.tariff ?? 0.0;
      return roundHalfUp(bt * (1.0 + (rcDis.expenses ?? 0)) / (1.0 - (rcDis.acquisition ?? 0)), 4);
    })();
    const waiverActive = hasWaiver && frequency !== 'single' && t > 1 && term > 1;

    // Фиксированная часть (fixed-sum допы) — не зависят от SA
    let fixedTotal = 0.0;
    for (const [rk, rs] of fixedRiders) {
      const riderSum = parseFloat(rs);
      if (riderSum > 0) {
        if (rk === 'critical_illness') {
          const r = ridersCalc.calculateCIRider(x, term, t, gender, riderSum, frequency);
          fixedTotal += r.riderPremium;
        } else {
          const r = ridersCalc.calculateSimpleRider(rk, riderSum, term, frequency);
          fixedTotal += r.riderPremium;
        }
      }
    }

    const waiverPremium = (sa) => {
      if (!waiverActive) return 0;
      const annualPayment = roundHalfUp(bpRate * sa);
      let rSum = 0.0;
      for (let k = 0; k < term - 1; k++) {
        const remaining = term - 1 - k;
        rSum += roundHalfUp(remaining * annualPayment * j6);
      }
      return roundHalfUp((rSum / (term - 1)) * freqFactor);
    };

    const tpSmooth = (sa) => {
      const main = frequency === 'single' ? bpRate * sa : bpRate * sa * freqFactor;
      let linked = 0;
      for (const rk of saLinkedKeys) {
        if (rk === 'premium_waiver') continue;
        linked += ridersCalc.calculateSimpleRider(rk, sa, term, frequency).riderPremium;
      }
      return main + linked + fixedTotal + waiverPremium(sa);
    };

    const tpRound = (sa) => {
      const sac  = roundHalfUp(sa);
      const main = frequency === 'single' ? roundHalfUp(bpRate * sac) : roundHalfUp(bpRate * sac * freqFactor);
      let linked = 0;
      for (const rk of saLinkedKeys) {
        if (rk === 'premium_waiver') continue;
        linked += ridersCalc.calculateSimpleRider(rk, sac, term, frequency).riderPremium;
      }
      return main + linked + fixedTotal + waiverPremium(sac);
    };

    let saEst = frequency === 'single'
      ? totalPremium / bpRate * 2
      : totalPremium / (bpRate * freqFactor) * 2;

    let saLo = 0.0, saHi = saEst;
    while (tpSmooth(saHi) < totalPremium) {
      saHi *= 2;
      if (saHi > 1e15) break;
    }
    for (let iter = 0; iter < 300; iter++) {
      const mid = (saLo + saHi) / 2;
      if (tpSmooth(mid) < totalPremium) saLo = mid; else saHi = mid;
      if (saHi - saLo < 1e-6) break;
    }
    const saSmooth = (saLo + saHi) / 2;

    const pwMult = waiverActive ? (j6 * term / 2.0) : 0.0;
    const totalRate = waiverActive
      ? (bpRate * (1.0 + pwMult) + saLinkedTariffSum) * freqFactor
      : (bpRate + saLinkedTariffSum) * (frequency === 'single' ? 1.0 : freqFactor);
    const saCont = totalRate > 0 ? (totalPremium - fixedTotal) / totalRate : saSmooth;

    let bestSA   = saSmooth;
    let bestDiff = Math.abs(tpRound(saSmooth) - totalPremium);

    const candidates = [];
    for (let off = -5; off <= 5; off++) candidates.push(Math.round(saSmooth) + off);
    for (const d of [-0.5, -0.25, -0.1, -0.01, 0, 0.01, 0.1, 0.25, 0.5]) candidates.push(saSmooth + d);
    candidates.push(saCont);
    for (let off = -5; off <= 5; off++) candidates.push(Math.round(saCont) + off);
    for (const d of [-0.5, -0.25, -0.1, -0.01, 0, 0.01, 0.1, 0.25, 0.5]) candidates.push(saCont + d);

    for (const sa of candidates) {
      if (sa <= 0) continue;
      const diff = Math.abs(tpRound(sa) - totalPremium);
      if (diff < bestDiff) { bestDiff = diff; bestSA = sa; }
    }

    const sumAssured    = Math.round(bestSA * 100) / 100;
    const annualPremium = roundHalfUp(bpRate * sumAssured);
    const grossPremium  = frequency === 'single'
      ? annualPremium
      : roundHalfUp(bpRate * sumAssured * freqFactor);

    return {
      age: x, term, paymentTerm: t, gender, frequency,
      sumAssured, interestRate,
      BP_rate: bpRate, NP_rate: NP,
      annualPremium, grossPremium,
      netPremium: NP * sumAssured,
      freqFactor,
      actuarial: vals,
    };
  }

  _getSimpleRiderGrossTariff(riderKey) {
    const rc = this.config.riders?.[riderKey] ?? {};
    if (rc.type) return 0.0;       // waiver/CI — обрабатываются отдельно
    const bt = rc.tariff ?? 0.0;
    return roundHalfUp(bt * (1.0 + (rc.expenses ?? 0)) / (1.0 - (rc.acquisition ?? 0)), 4);
  }

  // ─── Таблица резервов ─────────────────────────────────────────────────────────

  calculateReserves(dob, gender, term, frequency, sumAssured, kMult = 1.0, lAdd = 0.0) {
    const x    = PolicyCalculator.calculateAge(dob);
    const t    = frequency === 'single' ? 1 : term;
    const rate = this._getRate(frequency, term);
    const comm = this.engine.getCommutationTable(gender, kMult, lAdd, rate);

    const base     = this._actuarialValues(comm, x, term, t);
    const expenses = this._getExpenses(term, t);
    const { G2, G3, G6, G7, G8 } = expenses;

    const numerator   = base.Ax_n + G7 * base.ax_n;
    const denominator = base.ax_t - G6 * base.ax_t - (G2 + G3 * base.Dx1 / base.Dx);
    const BP = denominator > 0 ? numerator / denominator : 0.0;

    const Mxn = comm.Mx(x + term);
    const Dxn = comm.Dx(x + term);
    const Nxn = comm.Nx(x + term);
    const Nxt = comm.Nx(x + t);

    const reserves = [];

    for (let k = 1; k <= term; k++) {
      const xk  = x + k;
      const Dxk = comm.Dx(xk);

      if (Dxk === 0) {
        reserves.push({ year: k, age: xk, reserveRate: 0, surrenderRate: 0,
                        reserve: 0, surrender: 0, reducedSA: 0 });
        continue;
      }

      const Mxk = comm.Mx(xk);
      const Nxk = comm.Nx(xk);

      const Ax_n_k = (Mxk - Mxn + Dxn) / Dxk;
      const ax_n_k = (Nxk - Nxn) / Dxk;
      const ax_t_k = k < t ? (Nxk - Nxt) / Dxk : 0.0;

      const alpha_k = (k === 1 && t > 1) ? G3 : 0.0;

      const reserveRate   = Ax_n_k + G7 * ax_n_k - BP * (ax_t_k - G6 * ax_t_k - alpha_k);
      const surrenderRate = reserveRate - (1.0 - reserveRate) * G8;

      const reserve  = reserveRate * sumAssured;
      let surrender  = Math.max(surrenderRate * sumAssured, 0.0);
      if (k === term) surrender = sumAssured;

      const reducedSA = Ax_n_k > 0 ? roundHalfUp(surrender / Ax_n_k) : 0;

      reserves.push({
        year: k, age: xk,
        Ax_n_k, ax_n_k, ax_t_k, alpha_k,
        reserveRate, surrenderRate,
        reserve:   Math.round(reserve * 100) / 100,
        surrender: Math.round(surrender * 100) / 100,
        reducedSA,
      });
    }

    return reserves;
  }

  // ─── Аннуитет ─────────────────────────────────────────────────────────────────

  calculateAnnuity(x, n, sumAssured, annuityFrequency = 'annual', annuityTerm = 0,
                   guaranteedPeriod = 0, gender = 'male',
                   frequency = 'annual', term = n,
                   kMult = 1.0, lAdd = 0.0) {
    if (annuityTerm <= 0) {
      return { annuityPayment: 0, annuityFactor: 0,
               annuityFrequency, annuityTerm, guaranteedPeriod };
    }

    const i  = this._getRate(frequency, term);
    const freqMap = { annual: 1, semiannual: 2, quarterly: 4, monthly: 12 };
    const m  = freqMap[annuityFrequency] ?? 1;

    const d_m = Math.pow(1.0 + i, 1.0 / m) - 1.0;
    const v_m = d_m > -1.0 ? 1.0 / (1.0 + d_m) : 0.0;

    const comm = this.engine.getCommutationTable(gender, kMult, lAdd, i);
    const Dxn  = comm.Dx(x + n);

    if (Dxn === 0 || d_m <= 0) {
      return { annuityPayment: 0, annuityFactor: 0,
               annuityFrequency, annuityTerm, guaranteedPeriod };
    }

    const gp   = guaranteedPeriod;
    const nAnn = annuityTerm;

    const guaranteedPart = (gp > 0)
      ? (1.0 - Math.pow(v_m, gp * m)) / (v_m * d_m)
      : 0.0;

    const Nxn_gp  = comm.Nx(x + n + gp);
    const Nxn_ann = comm.Nx(x + n + nAnn);
    const Dxn_ann = comm.Dx(x + n + nAnn);

    const lifePart = m * (
      (Nxn_gp - Nxn_ann) / Dxn
      - ((m - 1.0) / (2.0 * m)) * (1.0 - Dxn_ann / Dxn)
    );

    const addExpense = (nAnn === 1 && m === 1) ? 0.0 : this.annuityExpense;
    const aFactor   = (guaranteedPart + lifePart) * (1.0 + addExpense);
    const annuityPayment = aFactor > 0 ? roundHalfUp(sumAssured / aFactor) : 0;

    return {
      annuityPayment, annuityFactor: aFactor,
      annuityFrequency, annuityTerm, guaranteedPeriod,
      guaranteedPart, lifePart, annuityExpense: addExpense,
    };
  }

  // ─── Полный расчёт ────────────────────────────────────────────────────────────

  fullCalculation(params, ridersCalc = null) {
    const {
      dob, gender, term, frequency,
      mode = 'sa_to_premium',
      annuityFrequency = 'annual',
      annuityTerm = 0,
      guaranteedPeriod = 0,
      saLinkedKeys = [],
      fixedRiders = [],
      hasWaiver = false,
      kMult = 1.0,
      lAdd  = 0.0,
    } = params;

    let result, sumAssured;

    if (mode === 'sa_to_premium') {
      result     = this.calculatePremium(dob, gender, term, frequency,
                                         params.sumAssured, kMult, lAdd);
      sumAssured = params.sumAssured;
    } else {
      if (ridersCalc && (saLinkedKeys.length > 0 || fixedRiders.length > 0 || hasWaiver)) {
        result = this.calculateSumAssuredWithRiders(
          dob, gender, term, frequency, params.premium,
          ridersCalc, saLinkedKeys, fixedRiders, hasWaiver, kMult, lAdd,
        );
      } else {
        result = this.calculateSumAssured(dob, gender, term, frequency,
                                          params.premium, kMult, lAdd);
      }
      sumAssured = result.sumAssured;
    }

    const reserves = this.calculateReserves(dob, gender, term, frequency,
                                            sumAssured, kMult, lAdd);

    const x       = PolicyCalculator.calculateAge(dob);
    const annuity = this.calculateAnnuity(
      x, term, sumAssured,
      annuityFrequency, annuityTerm, guaranteedPeriod,
      gender, frequency, term, kMult, lAdd,
    );

    return { ...result, reserves, annuity, annuityPayment: annuity.annuityPayment };
  }
}
