import path from "node:path";

import type { FastifyPluginAsync, FastifyRequest } from "fastify";

import type { Database } from "@clichy/db";

import { auth, db } from "../services";
import {
  hammingDistance,
  ImageValidationError,
  inspectImage,
} from "../image-processing";
import {
  DERIVATIVE_VARIANTS,
  type DerivativeVariant,
  FileSystemStorage,
} from "../storage";
import {
  exactDuplicateWhere,
  ownedPhotoWhere,
  similarPhotoWhere,
} from "../photo-queries";

async function getAuthSession(request: FastifyRequest) {
  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (value) {
      headers.append(key, value.toString());
    }
  }

  return auth.api.getSession({ headers });
}

type PhotoRouteDependencies = {
  db: Pick<Database, "photo">;
  storage: FileSystemStorage;
  createPhotoWithOutbox?: (input: {
    userId: string;
    filename: string;
    mimeType: string;
    size: number;
    storageKey: string;
  }) => Promise<{
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    createdAt: Date;
  }>;
  getSession: (
    request: FastifyRequest,
  ) => Promise<{ user: { id: string } } | null>;
};

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isDerivativeVariant(value: string): value is DerivativeVariant {
  return Object.hasOwn(DERIVATIVE_VARIANTS, value);
}

export function createPhotoRoutes({
  db,
  storage,
  createPhotoWithOutbox,
  getSession,
}: PhotoRouteDependencies): FastifyPluginAsync {
  const photoRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.get("/photos", async (request, reply) => {
      const session = await getSession(request);

      if (!session) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const photos = await db.photo.findMany({
        where: { userId: session.user.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          filename: true,
          mimeType: true,
          size: true,
          width: true,
          height: true,
          processingStatus: true,
          createdAt: true,
        },
      });

      return reply.send(photos);
    });

    fastify.post("/photos", async (request, reply) => {
      const session = await getSession(request);

      if (!session) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const file = await request.file();

      if (!file) {
        return reply.status(400).send({ error: "No file provided" });
      }

      let buffer: Buffer;
      let image: Awaited<ReturnType<typeof inspectImage>>;

      try {
        buffer = await file.toBuffer();
        image = await inspectImage(buffer);
      } catch (error) {
        if (error instanceof ImageValidationError) {
          return reply.status(400).send({
            error: "Unsupported, malformed, or oversized image",
          });
        }
        throw error;
      }

      const storageKey = await storage.save(
        session.user.id,
        buffer,
        image.extension,
      );

      let photo;
      try {
        const input = {
          userId: session.user.id,
          filename: path.basename(file.filename),
          mimeType: image.mimeType,
          size: buffer.length,
          storageKey,
        };
        photo = createPhotoWithOutbox
          ? await createPhotoWithOutbox(input)
          : await db.photo.create({
              data: input,
              select: {
                id: true,
                filename: true,
                mimeType: true,
                size: true,
                createdAt: true,
              },
            });
      } catch (error) {
        try {
          await storage.delete(storageKey);
        } catch (cleanupError) {
          request.log.error(
            { err: cleanupError, storageKey },
            "Unable to clean up original after photo creation failed",
          );
        }
        throw error;
      }

      request.log.info({ photoId: photo.id }, "Photo accepted for processing");
      return reply.status(202).send({
        ...photo,
        processingStatus: "PENDING",
        width: image.width,
        height: image.height,
      });
    });

    fastify.get<{ Params: { id: string } }>(
      "/photos/:id/metadata",
      async (request, reply) => {
        const session = await getSession(request);

        if (!session) {
          return reply.status(401).send({ error: "Unauthorized" });
        }

        const photo = await db.photo.findFirst({
          where: ownedPhotoWhere(request.params.id, session.user.id),
          select: {
            id: true,
            filename: true,
            mimeType: true,
            size: true,
            imageFormat: true,
            width: true,
            height: true,
            orientation: true,
            dateTaken: true,
            cameraMake: true,
            cameraModel: true,
            exposureTime: true,
            aperture: true,
            iso: true,
            focalLength: true,
            gpsLatitude: true,
            gpsLongitude: true,
            sha256: true,
            perceptualHash: true,
            processingStatus: true,
            processedAt: true,
            createdAt: true,
          },
        });

        if (!photo) {
          return reply.status(404).send({ error: "Photo not found" });
        }

        return reply.send(photo);
      },
    );

    fastify.get<{
      Params: { id: string; variant: string };
    }>("/photos/:id/thumbnail/:variant", async (request, reply) => {
      const session = await getSession(request);

      if (!session) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const variant = request.params.variant;
      if (!isDerivativeVariant(variant)) {
        return reply.status(404).send({ error: "Thumbnail not found" });
      }

      const photo = await db.photo.findFirst({
        where: ownedPhotoWhere(request.params.id, session.user.id),
        select: { id: true, processingStatus: true },
      });

      if (!photo) {
        return reply.status(404).send({ error: "Photo not found" });
      }

      if (photo.processingStatus !== "COMPLETED") {
        return reply.status(404).send({ error: "Thumbnail not available" });
      }

      try {
        const content = await storage.read(
          storage.derivativeKey(photo.id, variant),
        );
        return reply
          .type("image/webp")
          .header("Cache-Control", "private, max-age=3600")
          .send(content);
      } catch (error) {
        if (isMissingFile(error)) {
          return reply.status(404).send({ error: "Thumbnail not found" });
        }
        throw error;
      }
    });

    fastify.get<{ Params: { id: string } }>(
      "/photos/:id/duplicates",
      async (request, reply) => {
        const session = await getSession(request);

        if (!session) {
          return reply.status(401).send({ error: "Unauthorized" });
        }

        const photo = await db.photo.findFirst({
          where: ownedPhotoWhere(request.params.id, session.user.id),
          select: { id: true, sha256: true, processingStatus: true },
        });

        if (!photo) {
          return reply.status(404).send({ error: "Photo not found" });
        }

        if (photo.processingStatus !== "COMPLETED" || !photo.sha256) {
          return reply.send([]);
        }

        const duplicates = await db.photo.findMany({
          where: exactDuplicateWhere(
            session.user.id,
            photo.sha256,
            photo.id,
          ),
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            filename: true,
            mimeType: true,
            size: true,
            createdAt: true,
          },
        });

        return reply.send(duplicates);
      },
    );

    fastify.get<{
      Params: { id: string };
      Querystring: { threshold?: string; limit?: string };
    }>("/photos/:id/similar", async (request, reply) => {
      const session = await getSession(request);

      if (!session) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const threshold =
        request.query.threshold === undefined ? 14 : Number(request.query.threshold);
      const limit = request.query.limit === undefined ? 10 : Number(request.query.limit);

      if (
        !Number.isInteger(threshold) ||
        threshold < 0 ||
        threshold > 64 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 50
      ) {
        return reply.status(400).send({
          error: "threshold must be 0-64 and limit must be 1-50",
        });
      }

      const photo = await db.photo.findFirst({
        where: ownedPhotoWhere(request.params.id, session.user.id),
        select: {
          id: true,
          perceptualHash: true,
          processingStatus: true,
        },
      });

      if (!photo) {
        return reply.status(404).send({ error: "Photo not found" });
      }

      const targetHash = photo.perceptualHash;
      if (photo.processingStatus !== "COMPLETED" || !targetHash) {
        return reply.send({ threshold, matches: [] });
      }

      const candidates = await db.photo.findMany({
        where: similarPhotoWhere(session.user.id, photo.id),
        select: {
          id: true,
          filename: true,
          mimeType: true,
          perceptualHash: true,
          createdAt: true,
        },
      });

      const matches = candidates
        .flatMap((candidate) => {
          if (!candidate.perceptualHash) {
            return [];
          }

          return [{
            id: candidate.id,
            filename: candidate.filename,
            mimeType: candidate.mimeType,
            createdAt: candidate.createdAt,
            hammingDistance: hammingDistance(targetHash, candidate.perceptualHash),
          }];
        })
        .filter((candidate) => candidate.hammingDistance <= threshold)
        .sort((left, right) => left.hammingDistance - right.hammingDistance)
        .slice(0, limit);

      return reply.send({ threshold, matches });
    });

    fastify.get<{ Params: { id: string } }>(
      "/photos/:id",
      async (request, reply) => {
        const session = await getSession(request);

        if (!session) {
          return reply.status(401).send({ error: "Unauthorized" });
        }

        const photo = await db.photo.findFirst({
          where: ownedPhotoWhere(request.params.id, session.user.id),
          select: { storageKey: true, mimeType: true },
        });

        if (!photo) {
          return reply.status(404).send({ error: "Photo not found" });
        }

        try {
          const content = await storage.read(photo.storageKey);
          return reply.type(photo.mimeType).send(content);
        } catch (error) {
          if (isMissingFile(error)) {
            return reply.status(404).send({ error: "Photo file not found" });
          }
          throw error;
        }
      },
    );

    fastify.delete<{ Params: { id: string } }>(
      "/photos/:id",
      async (request, reply) => {
        const session = await getSession(request);

        if (!session) {
          return reply.status(401).send({ error: "Unauthorized" });
        }

        const photo = await db.photo.findFirst({
          where: ownedPhotoWhere(request.params.id, session.user.id),
          select: {
            id: true,
            storageKey: true,
            processingStatus: true,
            deletingAt: true,
          },
        });

        if (!photo) {
          return reply.status(404).send({ error: "Photo not found" });
        }

        if (photo.processingStatus === "PROCESSING") {
          return reply.status(409).send({
            error: "Photo processing is still in progress",
          });
        }

        const deletionClaim = await db.photo.updateMany({
          where: {
            id: photo.id,
            userId: session.user.id,
            deletingAt: null,
            processingStatus: { not: "PROCESSING" },
          },
          data: { deletingAt: new Date() },
        });
        if (deletionClaim.count === 0 && !photo.deletingAt) {
          const current = await db.photo.findFirst({
            where: ownedPhotoWhere(request.params.id, session.user.id),
            select: { id: true, processingStatus: true },
          });
          if (!current) {
            return reply.status(404).send({ error: "Photo not found" });
          }
          return reply.status(409).send({
            error: "Photo processing is still in progress",
          });
        }

        try {
          await storage.deletePhotoAssets(
            session.user.id,
            photo.id,
            photo.storageKey,
          );
        } catch (error) {
          request.log.error(
            { err: error, photoId: photo.id },
            "Unable to clean up photo files",
          );
          return reply.status(500).send({
            error: "Unable to remove the photo files; retry the deletion",
          });
        }

        try {
          const result = await db.photo.deleteMany({
            where: {
              id: photo.id,
              userId: session.user.id,
              deletingAt: { not: null },
            },
          });

          if (result.count === 0) {
            return reply.status(404).send({ error: "Photo not found" });
          }
        } catch (error) {
          request.log.error(
            { err: error, photoId: photo.id },
            "Photo files removed but database record deletion failed",
          );
          return reply.status(500).send({
            error: "Photo files were removed, but the library record could not be deleted; retry the deletion",
          });
        }

        return reply.status(204).send();
      },
    );
  };

  return photoRoutes;
}

export default createPhotoRoutes({
  db,
  storage: new FileSystemStorage(),
  createPhotoWithOutbox: (input) =>
    db.$transaction(async (transaction) => {
      const photo = await transaction.photo.create({
        data: input,
        select: {
          id: true,
          filename: true,
          mimeType: true,
          size: true,
          createdAt: true,
        },
      });
      await transaction.photoProcessingOutbox.create({
        data: { photoId: photo.id },
      });
      return photo;
    }),
  getSession: getAuthSession,
});
