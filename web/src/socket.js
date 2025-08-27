// web/src/socket.js
import { io } from "socket.io-client";

const API = "http://localhost:3000";

export const socket = io(API, {
  path: "/socket.io",
  transports: ["websocket", "polling"], // allow fallback
  withCredentials: false,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 5000,
  timeout: 20000,
  autoConnect: true,
});

// Optional: low-noise logging
socket.on("connect_error", (err) => {
  console.warn("[client] connect_error:", err.message);
});
socket.on("reconnect_attempt", (n) => {
  console.log("[client] reconnect_attempt:", n);
});
