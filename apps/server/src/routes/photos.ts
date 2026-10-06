import path from "node:path";

import type { FastifyPluginAsync, FastifyRequest } from "fastify";

import { auth, db } from "../services";
import { FileSystemStorage } from "../storage";

const storage = new FileSystemStorage();

const ALLOWED_TYPES = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);

async function getSession(request: FastifyRequest) {  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (value) {
      headers.append(key, value.toString());
    }
  }

  return auth.api.getSession({ headers });
}

const photoRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * List all photos belonging to the authenticated user.
   */
  fastify.get("/photos", async (request, reply) => {
    const session = await getSession(request);

    if (!session) {
      return reply.status(401).send({
        error: "Unauthorized",
      });
    }

    const photos = await db.photo.findMany({
      where: {
        userId: session.user.id,
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        size: true,
        createdAt: true,
      },
    });

    return reply.send(photos);
  });

  /**
   * Upload a photo for the authenticated user.
   */
  fastify.post("/photos", async (request, reply) => {
    const session = await getSession(request);

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
      await storage.delete(storageKey);
      throw error;
    }
  });

  /**
   * Serve a photo belonging to the authenticated user.
   */
  fastify.get<{ Params: { id: string } }>(
    "/photos/:id",
    async (request, reply) => {
      const session = await getSession(request);

      if (!session) {
        return reply.status(401).send({
          error: "Unauthorized",
        });
      }

      const photo = await db.photo.findUnique({
        where: {
          id: request.params.id,
        },
      });

      if (!photo || photo.userId !== session.user.id) {
        return reply.status(404).send({
          error: "Photo not found",
        });
      }

      try {
        const buffer = await storage.read(photo.storageKey);

        return reply
          .type(photo.mimeType)
          .send(buffer);
      } catch {
        return reply.status(404).send({
          error: "Photo file not found",
        });
      }
    },
  );
};

export default photoRoutes;
