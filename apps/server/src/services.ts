import { createAuth } from "@clichy/auth";
import { createPrismaClient } from "@clichy/db";

import { ENV } from "./env.server";

export const db = createPrismaClient(ENV);
export const auth = createAuth(ENV, db);
