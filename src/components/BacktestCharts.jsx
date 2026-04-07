import { useEffect, useMemo, useRef, useState } from "react";
import {
  ColorType,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  createChart,
  createSeriesMarkers,
} from "lightweight-charts";
import {
  candlesToVolumeHistogramData,
  klineToCandles,
  klineToMALines,
  tradesToMarkers,
} from "../utils/chartData";
import "./BacktestCharts.css";

const MA_COLORS = [
  "#f59e0b",
  "#60a5fa",
  "#a78bfa",
  "#34d399",
  "#f472b6",
  "#fb7185",
  "#22d3ee",
  "#f97316",
];

function chartTheme() {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return {
    bg: dark ? "#13141a" : "#ffffff",
    text: dark ? "#d1d5db" : "#374151",
    grid: dark ? "#2a2d36" : "#e5e7eb",
    border: dark ? "#2a2d36" : "#e5e7eb",
  };
}

/**
 * @param {{ kline?: unknown[], trades?: unknown[] }} props
 */
export default function BacktestCharts({ kline, trades }) {
  const containerRef = useRef(null);
  const [crosshairInfo, setCrosshairInfo] = useState(null);
  const [showVolume, setShowVolume] = useState(true);
  const [showMarkers, setShowMarkers] = useState(true);
  const [hiddenMA, setHiddenMA] = useState(() => new Set());

  const candles = useMemo(() => klineToCandles(kline ?? []), [kline]);
  const hasVolume = useMemo(
    () => candles.some((c) => typeof c.volume === "number" && !Number.isNaN(c.volume)),
    [candles]
  );
  const volumeData = useMemo(
    () => (hasVolume ? candlesToVolumeHistogramData(candles) : []),
    [hasVolume, candles]
  );
  const markers = useMemo(
    () => tradesToMarkers(trades ?? [], candles),
    [trades, candles]
  );
  const maLines = useMemo(() => klineToMALines(kline ?? []), [kline]);
  const visibleMALines = useMemo(
    () => maLines.filter((x) => !hiddenMA.has(x.key)),
    [maLines, hiddenMA]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !candles.length) return;

    const t = chartTheme();
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: t.bg },
        textColor: t.text,
      },
      grid: {
        vertLines: { color: t.grid },
        horzLines: { color: t.grid },
      },
      rightPriceScale: { borderColor: t.border },
      timeScale: { borderColor: t.border },
      crosshair: { mode: 1 },
      autoSize: true,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#16a34a",
      downColor: "#dc2626",
      borderVisible: false,
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626",
    });
    candleSeries.setData(candles);
    chart.priceScale("right", 0).applyOptions({
      scaleMargins: { top: 0.1, bottom: 0.1 },
    });

    for (let i = 0; i < visibleMALines.length; i++) {
      const line = visibleMALines[i];
      const maSeries = chart.addSeries(LineSeries, {
        color: MA_COLORS[i % MA_COLORS.length],
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      maSeries.setData(line.points);
    }

    if (showMarkers && markers.length > 0) {
      createSeriesMarkers(candleSeries, markers);
    }

    const needVolumePane = showVolume && volumeData.length > 0;
    const needEquityPane = false;
    let volumeSeries = null;

    // 根据需要创建 pane：0=蜡烛图；1=成交量；2=资金曲线(如果有)
    if (needVolumePane) chart.addPane();
    if (needEquityPane) chart.addPane();

    chart.panes()[0].setHeight(360);
    if (needVolumePane) chart.panes()[1].setHeight(160);
    if (needEquityPane) chart.panes()[needVolumePane ? 2 : 1].setHeight(200);

    if (needVolumePane) {
      volumeSeries = chart.addSeries(
        HistogramSeries,
        {
          priceFormat: { type: "volume" },
        },
        1
      );
      volumeSeries.setData(volumeData);
      chart.priceScale("right", 1).applyOptions({
        scaleMargins: { top: 0.1, bottom: 0.1 },
      });
    }

    // 资金曲线已按需求隐藏，不再绘制紫色线

    const formatTime = (time) => {
      if (!time) return "";
      if (typeof time === "number") {
        const d = new Date(time * 1000);
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, "0");
        const day = String(d.getUTCDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      }
      if (typeof time === "object" && "year" in time) {
        const bd = /** @type {{ year: number, month: number, day: number }} */ (time);
        return `${bd.year}-${String(bd.month).padStart(2, "0")}-${String(bd.day).padStart(2, "0")}`;
      }
      return "";
    };

    const onCrosshairMove = (param) => {
      try {
        if (!param || param.time == null) {
          setCrosshairInfo(null);
          return;
        }

        const dateStr = formatTime(param.time);
        let vol = null;
        if (volumeSeries && param.seriesData) {
          const v = param.seriesData.get(volumeSeries);
          if (v && typeof v.value === "number") vol = v.value;
        }
        setCrosshairInfo({ date: dateStr, volume: vol });
      } catch (e) {
        // 图表交互异常不影响渲染主流程
      }
    };

    chart.subscribeCrosshairMove(onCrosshairMove);

    chart.timeScale().fitContent();

    return () => {
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      chart.remove();
    };
  }, [candles, markers, volumeData, visibleMALines, showMarkers, showVolume]);

  if (!candles.length) {
    return (
      <p className="backtest-empty">
        暂无有效 K 线数据（需包含 open / high / low / close，或可解析的日期字段）
      </p>
    );
  }

  return (
    <div className="backtest-charts">
      <p className="backtest-chart-caption">
        K 线（蜡烛图）
        {maLines.length > 0 ? (
          <span>
            {" "}
            · 均线：
            <span className="backtest-togglebar">
              {maLines.map((x, i) => {
                const on = !hiddenMA.has(x.key);
                return (
                  <button
                    key={x.key}
                    type="button"
                    className={`backtest-chip ${on ? "is-on" : "is-off"}`}
                    onClick={() => {
                      setHiddenMA((prev) => {
                        const next = new Set(prev);
                        if (next.has(x.key)) next.delete(x.key);
                        else next.add(x.key);
                        return next;
                      });
                    }}
                    title={on ? "点击隐藏" : "点击显示"}
                    style={{ borderColor: MA_COLORS[i % MA_COLORS.length], color: MA_COLORS[i % MA_COLORS.length] }}
                  >
                    {x.label}
                  </button>
                );
              })}
              <button
                type="button"
                className="backtest-chip"
                onClick={() => setHiddenMA(new Set())}
                title="显示全部均线"
              >
                全开
              </button>
              <button
                type="button"
                className="backtest-chip"
                onClick={() => setHiddenMA(new Set(maLines.map((x) => x.key)))}
                title="隐藏全部均线"
              >
                全关
              </button>
            </span>
          </span>
        ) : ""}
        <span className="backtest-togglebar">
          <button
            type="button"
            className={`backtest-chip ${showVolume ? "is-on" : "is-off"}`}
            onClick={() => setShowVolume((v) => !v)}
            disabled={!hasVolume}
            title={hasVolume ? "切换成交量显示" : "当前数据未包含成交量字段（volume/vol）"}
          >
            成交量
          </button>
          <button
            type="button"
            className={`backtest-chip ${showMarkers ? "is-on" : "is-off"}`}
            onClick={() => setShowMarkers((v) => !v)}
            disabled={markers.length === 0}
            title={markers.length ? "切换买卖箭头显示" : "暂无买卖信号"}
          >
            买卖箭头
          </button>
        </span>
        {crosshairInfo ? (
          <span className="backtest-crosshair-info">
            {" "}
            · 日期：{crosshairInfo.date || "-"}
            {" "}
            成交量：{crosshairInfo.volume != null ? crosshairInfo.volume : "-"}
          </span>
        ) : null}
      </p>
      <div ref={containerRef} className="backtest-chart-host" />
    </div>
  );
}
