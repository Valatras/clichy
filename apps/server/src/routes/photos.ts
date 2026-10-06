import path from "node:path";

import type { FastifyPluginAsync } from "fastify";

import { db, auth } from "../services";
import { FileSystemStorage } from "../storage";

const storage = new FileSystemStorage();

const ALLOWED_TYPES = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);

const photoRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/photos", async (request, reply) => {
    // Get the authenticated user from Better Auth.
    const headers = new Headers();

    for (const [key, value] of Object.entries(request.headers)) {
      if (value) {
        headers.append(key, value.toString());
      }
    }

    const session = await auth.api.getSession({ headers });

    if (!session) {
      return reply.status(401).send({
        error: "Unauthorized",
      });
    }

    const file = await request.file();

    if (!file) {
      return reply.status(400).send({
        error: "No file provided",
      });
    }

    const extension = ALLOWED_TYPES.get(file.mimetype);

    if (!extension) {
      return reply.status(400).send({
        error: "Unsupported image type",
        supportedTypes: [...ALLOWED_TYPES.keys()],
      });
    }

    const buffer = await file.toBuffer();

    const storageKey = await storage.save(
      session.user.id,
      buffer,
      extension,
    );

    try {
      const photo = await db.photo.create({
        data: {
          userId: session.user.id,
          filename: path.basename(file.filename),
          mimeType: file.mimetype,
          size: buffer.length,
          storageKey,
        },
      });

      return reply.status(201).send({
        id: photo.id,
        filename: photo.filename,
        mimeType: photo.mimeType,
        size: photo.size,
        createdAt: photo.createdAt,
      });
    } catch (error) {
      // Avoid leaving an orphaned file if the database operation fails.
      await storage.delete(storageKey);

      throw error;
    }
  });
};

export default photoRoutes;