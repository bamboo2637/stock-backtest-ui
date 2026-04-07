import React, { useState } from "react";
import axios from "axios";
import BacktestCharts from "./components/BacktestCharts.jsx";

/** 超过此时长未响应则中止，避免界面一直停在「加载中」 */
const BACKTEST_TIMEOUT_MS = 120_000;

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function timeToKey(t) {
  if (!t) return "";
  if (typeof t === "string") return t.slice(0, 10);
  if (typeof t === "number") {
    const d = new Date(t > 1e12 ? t : t * 1000);
    return d.toISOString().slice(0, 10);
  }
  return String(t).slice(0, 10);
}

function buildTradeRows(kline = [], trades = []) {
  if (!Array.isArray(trades) || trades.length === 0) return [];
  const closeByDate = new Map(
    (Array.isArray(kline) ? kline : []).map((x) => [timeToKey(x.time), Number(x.close)])
  );

  const rows = [];
  let openTrade = null;
  let cumulativePnl = 0;

  for (const t of trades) {
    const type = String(t.type ?? t.side ?? t.action ?? "").toLowerCase();
    const date = timeToKey(t.time ?? t.date ?? t.datetime);
    const px = Number(
      t.price ?? t.trade_price ?? t.deal_price ?? closeByDate.get(date)
    );
    if (Number.isNaN(px)) continue;

    const isBuy = type.includes("buy") || type === "b" || type === "long";
    const isSell = type.includes("sell") || type === "s" || type === "short";

    if (isBuy) {
      openTrade = { date, price: px };
    } else if (isSell && openTrade) {
      const pnl = px - openTrade.price;
      const pnlPct = (pnl / openTrade.price) * 100;
      cumulativePnl += pnl;
      rows.push({
        buyDate: openTrade.date,
        sellDate: date,
        buyPrice: openTrade.price,
        sellPrice: px,
        pnl,
        pnlPct,
        cumulativePnl,
      });
      openTrade = null;
    }
  }
  return rows;
}

export default function App() {
  const [symbol, setSymbol] = useState("000001");
  const [short, setShort] = useState(5);
  const [long, setLong] = useState(20);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [rangePreset, setRangePreset] = useState("all");

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const tradeRows = buildTradeRows(data?.kline, data?.trades);
  const totalPnl = tradeRows.length ? tradeRows[tradeRows.length - 1].cumulativePnl : 0;

  const applyPreset = (preset) => {
    const today = new Date();
    const end = fmtDate(today);
    if (preset === "all") {
      setStartDate("");
      setEndDate("");
      return;
    }
    if (preset === "ytd") {
      setStartDate(`${today.getFullYear()}-01-01`);
      setEndDate(end);
      return;
    }
    const monthsMap = {
      m3: 3,
      m6: 6,
      y1: 12,
      y2: 24,
      y3: 36,
      y4: 48,
      y5: 60,
      y6: 72,
      y7: 84,
      y8: 96,
      y9: 108,
      y10: 120,
    };
    const months = monthsMap[preset];
    if (!months) return;
    const start = new Date(today);
    start.setMonth(start.getMonth() - months);
    setStartDate(fmtDate(start));
    setEndDate(end);
  };

  const runBacktest = async () => {
    setLoading(true);
    setError("");
    setData(null); // ⭐ 关键：每次请求前清空旧数据

    try {
      const params = {
        stock_code: symbol,
        short,
        long,
      };
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;

      const res = await axios.get("/backtest", {
        params,
        timeout: BACKTEST_TIMEOUT_MS,
      });

      console.log("✅ 成功返回:", res.data);

      setData(res.data);   // ⭐ 更新数据
      setError("");        // ⭐ 清掉错误（关键修复）
    } catch (err) {
      setData(null); // ⭐ 出错时清空数据

      const isTimeout =
        err.code === "ECONNABORTED" ||
        err.message?.toLowerCase().includes("timeout");

      if (isTimeout) {
        const sec = Math.round(BACKTEST_TIMEOUT_MS / 1000);
        setError(
          `请求超时（${sec} 秒内无响应）。请检查后端是否在运行、是否卡在计算；数据量过大时也会很慢。需要更久可在 App.jsx 里增大 BACKTEST_TIMEOUT_MS。`
        );
      } else if (err.response) {
        const { status, statusText, data } = err.response;
        const body =
          typeof data === "string"
            ? data
            : data != null
              ? JSON.stringify(data)
              : "";
        const msg = `后端报错 ${status}${statusText ? ` ${statusText}` : ""}${body ? ` — ${body}` : ""}`;
        console.error("❌ 请求失败:", msg, err.response);
        setError(msg);
      } else if (err.request) {
        const hint =
          err.message === "Network Error"
            ? "（常见原因：后端未启动，或直连跨域被拦截；开发时请用 npm run dev 并确保本机 8000 端口 API 已启动）"
            : "";
        const msg = `无法连接后端，请确认 http://127.0.0.1:8000 已运行 — ${err.message}${hint}`;
        console.error("❌ 请求失败:", msg, err.request);
        setError(msg);
      } else {
        const msg = "请求异常：" + err.message;
        console.error("❌ 请求失败:", msg, err);
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>📈 股票回测系统</h1>

      {/* 输入区 */}
      <div style={{ marginBottom: 20 }}>
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="股票代码"
        />

        <input
          type="number"
          value={short}
          onChange={(e) => setShort(Number(e.target.value))}
          style={{ marginLeft: 10 }}
        />

        <input
          type="number"
          value={long}
          onChange={(e) => setLong(Number(e.target.value))}
          style={{ marginLeft: 10 }}
        />
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          style={{ marginLeft: 10 }}
          title="开始日期"
        />
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          style={{ marginLeft: 10 }}
          title="结束日期"
        />
        <select
          value={rangePreset}
          onChange={(e) => {
            const v = e.target.value;
            setRangePreset(v);
            applyPreset(v);
          }}
          style={{ marginLeft: 10 }}
          title="快捷时段"
        >
          <option value="all">全部</option>
          <option value="m3">近3月</option>
          <option value="m6">近6月</option>
          <option value="y1">近1年</option>
          <option value="y2">近2年</option>
          <option value="y3">近3年</option>
          <option value="y4">近4年</option>
          <option value="y5">近5年</option>
          <option value="y6">近6年</option>
          <option value="y7">近7年</option>
          <option value="y8">近8年</option>
          <option value="y9">近9年</option>
          <option value="y10">近10年</option>
          <option value="ytd">今年</option>
        </select>

        <button
          type="button"
          onClick={runBacktest}
          disabled={loading}
          style={{ marginLeft: 10, opacity: loading ? 0.65 : 1 }}
        >
          {loading ? "⏳ 请求中…" : "🚀 开始回测"}
        </button>
      </div>

      {/* 状态 */}
      {loading && <p>⏳ 加载中...</p>}

      {/* ❗只有在“没有数据”时才显示错误 */}
      {!data && error && <p style={{ color: "red" }}>{error}</p>}

      {/* 数据展示 */}
      {data && (
        <div className="backtest-panel">
          <h3>✅ 数据加载成功</h3>

          <p style={{ margin: "8px 0" }}>
            K线：{data.kline?.length ?? 0} 根 · 交易：{data.trades?.length ?? 0} 笔
          </p>

          <BacktestCharts
            kline={data.kline}
            trades={data.trades}
          />

          <details style={{ marginTop: 28 }} >
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>
              📋 交易收益明细（点击展开）
            </summary>
            {tradeRows.length === 0 ? (
              <p style={{ marginTop: 10 }}>暂无可配对的买卖交易（需要 buy/sell 成对）</p>
            ) : (
              <div style={{ overflow: "auto", marginTop: 10 }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 14,
                    background: "var(--code-bg)",
                    borderRadius: 8,
                  }}
                >
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: 8 }}>买入日期</th>
                      <th style={{ textAlign: "left", padding: 8 }}>卖出日期</th>
                      <th style={{ textAlign: "right", padding: 8 }}>买入价</th>
                      <th style={{ textAlign: "right", padding: 8 }}>卖出价</th>
                      <th style={{ textAlign: "right", padding: 8 }}>单笔收益</th>
                      <th style={{ textAlign: "right", padding: 8 }}>单笔收益率</th>
                      <th style={{ textAlign: "right", padding: 8 }}>累计收益</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tradeRows.map((r, idx) => (
                      <tr key={`${r.buyDate}-${r.sellDate}-${idx}`}>
                        <td style={{ padding: 8 }}>{r.buyDate}</td>
                        <td style={{ padding: 8 }}>{r.sellDate}</td>
                        <td style={{ padding: 8, textAlign: "right" }}>{r.buyPrice.toFixed(3)}</td>
                        <td style={{ padding: 8, textAlign: "right" }}>{r.sellPrice.toFixed(3)}</td>
                        <td
                          style={{
                            padding: 8,
                            textAlign: "right",
                            color: r.pnl >= 0 ? "#dc2626" : "#16a34a",
                          }}
                        >
                          {r.pnl.toFixed(3)}
                        </td>
                        <td
                          style={{
                            padding: 8,
                            textAlign: "right",
                            color: r.pnlPct >= 0 ? "#dc2626" : "#16a34a",
                          }}
                        >
                          {r.pnlPct.toFixed(2)}%
                        </td>
                        <td style={{ padding: 8, textAlign: "right" }}>
                          {r.cumulativePnl.toFixed(3)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </details>
          <p style={{ marginTop: 10, fontWeight: 600 }}>
            总收益：<span style={{ color: totalPnl >= 0 ? "#dc2626" : "#16a34a" }}>{totalPnl.toFixed(3)}</span>
          </p>
        </div>
      )}
    </div>
  );
}