import axios from "axios";

export function fetchStockData(stockCode) {
  return axios.get("/stock", { params: { stock_code: stockCode } });
}