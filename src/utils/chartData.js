/** @typedef {{ time: import('lightweight-charts').Time, open: number, high: number, low: number, close: number, volume?: number }} Candle */

/**
 * @param {import('lightweight-charts').Time} t
 */
function timeComparable(t) {
  if (typeof t === "number") return t;
  if (t && typeof t === "object" && "year" in t) {
    const bd = /** @type {{ year: number, month: number, day: number }} */ (t);
    return bd.year * 10000 + bd.month * 100 + bd.day;
  }
  return 0;
}

/**
 * @param {import('lightweight-charts').Time} t
 */
function timeKey(t) {
  if (typeof t === "number") return `u:${t}`;
  if (t && typeof t === "object" && "year" in t) {
    const bd = /** @type {{ year: number, month: number, day: number }} */ (t);
    return `b:${bd.year}-${bd.month}-${bd.day}`;
  }
  return `x:${String(t)}`;
}

/**
 * @param {{ year: number, month: number, day: number }} bd
 * @param {number} deltaDays
 */
function addBusinessDays(bd, deltaDays) {
  const d = new Date(Date.UTC(bd.year, bd.month - 1, bd.day + deltaDays));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

/**
 * @param {string} s
 */
function parseISODateString(s) {
  const m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
  };
}

/**
 * 更宽松地提取成交量字段，兼容常见命名。
 * @param {Record<string, unknown>} row
 * @returns {number | undefined}
 */
function parseVolume(row) {
  const candidates = [
    row.volume,
    row.vol,
    row.v,
    row.qty,
    row.amount,
    row.turnover,
    row.Volume,
    row.Vol,
    row.Qty,
    row.AMOUNT,
  ];
  for (const val of candidates) {
    const n = Number(val);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

/**
 * 将后端字段解析为 lightweight-charts 的 Time（日频用 BusinessDay，秒级时间戳用 UTCTimestamp）。
 * @param {Record<string, unknown>} row
 * @param {number} index
 * @returns {import('lightweight-charts').Time}
 */
export function parseTime(row, index) {
  if (row.time != null) {
    if (typeof row.time === "string") {
      const bd = parseISODateString(row.time);
      if (bd) return bd;
      const ms = Date.parse(row.time);
      if (!Number.isNaN(ms)) {
        const d = new Date(ms);
        return {
          year: d.getUTCFullYear(),
          month: d.getUTCMonth() + 1,
          day: d.getUTCDate(),
        };
      }
    } else if (typeof row.time === "number" && !Number.isNaN(row.time)) {
      const t = row.time;
      return /** @type {import('lightweight-charts').UTCTimestamp} */ (
        t > 1e12 ? Math.floor(t / 1000) : Math.floor(t)
      );
    }
  }
  if (row.timestamp != null) {
    const t = Number(row.timestamp);
    return /** @type {import('lightweight-charts').UTCTimestamp} */ (
      t > 1e12 ? Math.floor(t / 1000) : Math.floor(t)
    );
  }
  if (row.date != null) {
    if (typeof row.date === "string") {
      const bd = parseISODateString(row.date);
      if (bd) return bd;
    }
    const ms = new Date(String(row.date)).getTime();
    if (!Number.isNaN(ms)) {
      const d = new Date(ms);
      return {
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
      };
    }
  }
  if (row.datetime != null) {
    const ms = new Date(String(row.datetime)).getTime();
    if (!Number.isNaN(ms)) {
      const d = new Date(ms);
      return {
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
      };
    }
  }
  return /** @type {import('lightweight-charts').UTCTimestamp} */ (
    1577836800 + index * 86400
  );
}

/**
 * @param {Candle[]} candles
 * @returns {Candle[]}
 */
function ensureUniqueCandleTimes(candles) {
  const used = new Set();
  return candles.map((c) => {
    let t = c.time;
    let key = timeKey(t);
    while (used.has(key)) {
      if (typeof t === "number") {
        t += 1;
      } else if (t && typeof t === "object" && "year" in t) {
        t = addBusinessDays(/** @type {{ year: number, month: number, day: number }} */ (t), 1);
      } else {
        break;
      }
      key = timeKey(t);
    }
    used.add(key);
    return { ...c, time: t };
  });
}

/**
 * @param {unknown[]} kline
 * @returns {Candle[]}
 */
export function klineToCandles(kline) {
  if (!Array.isArray(kline) || kline.length === 0) return [];
  const raw = kline.map((row, i) => {
    const r = /** @type {Record<string, unknown>} */ (row);
    const open = Number(r.open ?? r.o);
    const high = Number(r.high ?? r.h);
    const low = Number(r.low ?? r.l);
    const close = Number(r.close ?? r.c);
    const volume = parseVolume(r);
    return {
      time: parseTime(r, i),
      open,
      high,
      low,
      close,
      volume,
    };
  });
  const valid = raw.filter((c) =>
    [c.open, c.high, c.low, c.close].every((v) => typeof v === "number" && !Number.isNaN(v))
  );
  const unique = ensureUniqueCandleTimes(valid);
  return unique.sort((a, b) => timeComparable(a.time) - timeComparable(b.time));
}

/**
 * @param {Candle[]} candles
 * @returns {{ time: import('lightweight-charts').Time, value: number, color: string }[]}
 */
export function candlesToVolumeHistogramData(candles) {
  if (!Array.isArray(candles) || candles.length === 0) return [];
  return candles.map((c) => {
    const v = typeof c.volume === "number" && !Number.isNaN(c.volume) ? c.volume : 0;
    const rise = c.close >= c.open;
    return {
      time: c.time,
      value: v,
      color: rise ? "#16a34acc" : "#dc2626cc",
    };
  });
}

/**
 * @param {unknown[]} kline
 * @returns {Array<{ key: string, label: string, points: Array<{ time: import('lightweight-charts').Time, value: number }> }>}
 */
export function klineToMALines(kline) {
  if (!Array.isArray(kline) || kline.length === 0) return [];
  /** @type {Map<string, Array<{ time: import('lightweight-charts').Time, value: number }>>} */
  const map = new Map();

  for (let i = 0; i < kline.length; i++) {
    const row = /** @type {Record<string, unknown>} */ (kline[i]);
    const time = parseTime(row, i);
    for (const [k, raw] of Object.entries(row)) {
      if (!/^ma/i.test(k)) continue;
      const v = Number(raw);
      if (Number.isNaN(v) || v === 0) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push({ time, value: v });
    }
  }

  const orderWeight = (key) => {
    const s = key.toLowerCase();
    const n = s.match(/\d+/);
    if (n) return Number(n[0]);
    if (s.includes("short")) return 1;
    if (s.includes("long")) return 999;
    return 500;
  };

  return [...map.entries()]
    .map(([key, points]) => ({
      key,
      label: key.toUpperCase(),
      points: ensureUniqueLineTimes(points),
    }))
    .filter((x) => x.points.length > 0)
    .sort((a, b) => orderWeight(a.key) - orderWeight(b.key));
}

/**
 * @param {{ time: import('lightweight-charts').Time, value: number }[]} points
 */
function ensureUniqueLineTimes(points) {
  const used = new Set();
  return points
    .map((p) => {
      let t = p.time;
      let key = timeKey(t);
      while (used.has(key)) {
        if (typeof t === "number") {
          t += 1;
        } else if (t && typeof t === "object" && "year" in t) {
          t = addBusinessDays(/** @type {{ year: number, month: number, day: number }} */ (t), 1);
        } else {
          break;
        }
        key = timeKey(t);
      }
      used.add(key);
      return { time: t, value: p.value };
    })
    .sort((a, b) => timeComparable(a.time) - timeComparable(b.time));
}

/**
 * @param {unknown[]} equity
 * @param {Candle[]} candles
 * @returns {{ time: import('lightweight-charts').Time, value: number }[]}
 */
export function equityToLineData(equity, candles) {
  if (!Array.isArray(equity) || equity.length === 0 || candles.length === 0) return [];
  if (
    equity.length === candles.length &&
    equity.every((x) => typeof x === "number")
  ) {
    const out = equity.map((v, i) => ({
      time: candles[i].time,
      value: v,
    }));
    return ensureUniqueLineTimes(out);
  }
  const out = [];
  for (let i = 0; i < equity.length; i++) {
    const row = equity[i];
    let time;
    let value;
    if (typeof row === "number") {
      time = candles[Math.min(i, candles.length - 1)].time;
      value = row;
    } else {
      const r = /** @type {Record<string, unknown>} */ (row);
      time = parseTime(r, i);
      value = Number(r.value ?? r.equity ?? r.balance ?? r.nav);
    }
    if (Number.isNaN(value)) continue;
    out.push({
      time,
      value,
    });
  }
  return ensureUniqueLineTimes(out);
}

/**
 * @param {import('lightweight-charts').Time} target
 * @param {Candle[]} candles
 */
function nearestCandleTime(target, candles) {
  if (!candles.length) return target;
  const tc = timeComparable(target);
  let best = candles[0].time;
  let bestDiff = Math.abs(timeComparable(best) - tc);
  for (const c of candles) {
    const d = Math.abs(timeComparable(c.time) - tc);
    if (d < bestDiff) {
      bestDiff = d;
      best = c.time;
    }
  }
  return best;
}

/**
 * @param {unknown[]} trades
 * @param {Candle[]} candles
 */
export function tradesToMarkers(trades, candles) {
  if (!Array.isArray(trades) || !candles.length) return [];
  /** @type {Array<{ time: import('lightweight-charts').Time, position: string, color: string, shape: string, text: string }>} */
  const markers = [];
  for (const row of trades) {
    const tr = /** @type {Record<string, unknown>} */ (row);
    const rawTime = parseTime(tr, 0);
    const time = nearestCandleTime(rawTime, candles);
    const raw = String(tr.side ?? tr.action ?? tr.type ?? "").toLowerCase();
    const isBuy =
      raw === "buy" ||
      raw === "b" ||
      raw === "long" ||
      raw.includes("buy");
    markers.push({
      time,
      position: isBuy ? "belowBar" : "aboveBar",
      color: isBuy ? "#eab308" : "#ec4899",
      shape: isBuy ? "arrowUp" : "arrowDown",
      text: isBuy ? "买" : "卖",
    });
  }
  return markers;
}
