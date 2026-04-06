// ---------------------------------------------------------------------------
// Health endpoint — used by start.sh to verify bot is running
// ---------------------------------------------------------------------------

import type { Router, Request, Response } from "express";
import { getDb } from "../db/index.js";

let _discordClient: any = null;
let _servicesReady = false;

export function setHealthDiscordClient(client: any): void {
  _discordClient = client;
}

export function setServicesReady(ready: boolean): void {
  _servicesReady = ready;
}

export function registerHealthRoute(router: Router): void {
  router.get("/health", (_req: Request, res: Response) => {
    try {
      // Check SQLite is responding
      const dbOk = (() => {
        try {
          getDb().prepare("SELECT 1").get();
          return true;
        } catch {
          return false;
        }
      })();

      // Check Discord client is connected
      const discordOk = _discordClient?.ws?.status === 0;

      // Check all services initialized
      const allOk = dbOk && discordOk && _servicesReady;

      if (allOk) {
        res.json({ status: "ok" });
      } else {
        const reasons: string[] = [];
        if (!dbOk) reasons.push("database not responding");
        if (!discordOk) reasons.push("discord not connected");
        if (!_servicesReady) reasons.push("services not initialized");
        res.status(503).json({ status: "unhealthy", reasons });
      }
    } catch (err) {
      res.status(503).json({ status: "unhealthy", reasons: [String(err)] });
    }
  });
}
