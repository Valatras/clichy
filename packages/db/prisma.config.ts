import path from "node:path";

import { defineConfig } from "prisma/config";
import "varlock/auto-load";

export default defineConfig({
  schema: path.join("prisma", "schema"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
