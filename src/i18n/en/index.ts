// Dizionario inglese, diviso per area. Chiave = testo italiano esatto usato nel codice.
import core from "./core.ts";
import contracts from "./contracts.ts";
import tasks from "./tasks.ts";
import vendors from "./vendors.ts";
import clm from "./clm.ts";
import admin from "./admin.ts";
import server from "./server.ts";

export const EN: Record<string, string> = { ...server, ...admin, ...clm, ...vendors, ...tasks, ...contracts, ...core };
