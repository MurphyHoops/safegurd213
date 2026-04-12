import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer } from "ws";
import http from "http";
import cors from "cors";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // Create HTTP server
  const server = http.createServer(app);

  // Initialize WebSocket server instance
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    console.log("🟢 Client connected to WebSocket");
    
    // Send initial connection success message
    ws.send(JSON.stringify({ type: "SYSTEM", message: "Connected to Trading Engine Server" }));

    ws.on("message", (message) => {
      console.log("Received:", message.toString());
      // Handle incoming messages from the frontend
    });

    ws.on("close", () => {
      console.log("🔴 Client disconnected");
    });
  });

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "Trading Engine is running" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Trading Engine Server running on http://localhost:${PORT}`);
  });
}

startServer();
