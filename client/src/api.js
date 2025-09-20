// client/src/api.js
import axios from "axios";

// Hiq çdo / në fund që të mos krijohen URL si http://...//meta
const API_BASE =
    (import.meta.env.VITE_API_URL?.replace(/\/$/, "")) || "http://localhost:8081";

console.log("[API] baseURL =", API_BASE);

const api = axios.create({
    baseURL: API_BASE,
    withCredentials: false,
    timeout: 20000,
    headers: { Accept: "application/json" },
});

// ATTACH JWT
api.interceptors.request.use((cfg) => {
    const t = localStorage.getItem("token");
    if (t) cfg.headers.Authorization = `Bearer ${t}`;
    if (!cfg.headers["Content-Type"]) {
        cfg.headers["Content-Type"] = "application/json";
    }
    return cfg;
});

// LOG GABIMET QARTË
api.interceptors.response.use(
    (r) => r,
    (err) => {
        const status = err?.response?.status;
        const data = err?.response?.data;
        console.error("[API ERR]", status, data || err?.message);
        return Promise.reject(err);
    }
);

export default api;
