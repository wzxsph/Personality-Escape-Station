import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import personalityRoutes from "./api/routes/personality.js";
import { initDatabase } from "./store/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function main() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  initDatabase();

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", project: "personality-escape-station" });
  });

  app.use("/api/personality", personalityRoutes);
  app.use("/generated", express.static(path.resolve("../generated"), { dotfiles: "deny" }));

  const clientDistPath = path.resolve("../client/dist");
  const clientIndexPath = path.join(clientDistPath, "index.html");
  if (fs.existsSync(clientDistPath) && fs.existsSync(clientIndexPath)) {
    app.use("/", express.static(clientDistPath));
    app.get("*", (_req, res) => {
      res.sendFile(clientIndexPath);
    });
  }

  const PORT = process.env.PORT || 3100;
  app.listen(PORT, () => {
    console.log(`[Personality Escape Station] Server running on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error("[Personality Escape Station] Fatal error during startup:", err);
  process.exit(1);
});
