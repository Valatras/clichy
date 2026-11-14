import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export const DERIVATIVE_VARIANTS = {
  thumbnail: 256,
  medium: 1024,
  large: 2048,
} as const;

export type DerivativeVariant = keyof typeof DERIVATIVE_VARIANTS;

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * Service de stockage des fichiers basé sur le système de fichiers (compatible NFS).
 * Encapsule la logique d'écriture, lecture, suppression et vérification des photos.
 */
export class FileSystemStorage {
  private readonly rootPath: string;

  /**
   * @param rootPath - Chemin racine du stockage (par défaut récupéré depuis les variables d'environnement)
   */
  constructor(
    rootPath: string = process.env.PHOTO_STORAGE_PATH ?? "./data/photos",
  ) {
    this.rootPath = rootPath;
  }

  /**
   * Enregistre une nouvelle photo pour un utilisateur donné.
   * 
   * @param userId - Identifiant unique de l'utilisateur (isole ses fichiers)
   * @param buffer - Le contenu binaire de la photo
   * @param extension - L'extension du fichier (ex: ".jpg", ".png")
   * @returns La clé de stockage abstraite à enregistrer en base de données
   */
  async save(
    userId: string,
    buffer: Buffer,
    extension: string,
  ): Promise<string> {
    // Génération d'un nom de fichier unique pour éviter les collisions
    const filename = `${randomUUID()}${extension}`;
    const userDirectory = path.join(this.rootPath, userId);
    
    // Abstraction : Le reste de l'application manipule uniquement ce 'storageKey' 
    // (ex: "user-123/uuid.jpg"), cachant l'arborescence physique exacte.
    const storageKey = path.join(userId, filename);
    const filePath = path.join(this.rootPath, storageKey);

    // Création récursive du dossier utilisateur s'il n'existe pas encore
    await mkdir(userDirectory, { recursive: true });
    
    // Écriture du fichier binaire sur le stockage (compatible NFS)
    await writeFile(filePath, buffer);

    return storageKey;
  }

  async saveDerivative(
    photoId: string,
    variant: DerivativeVariant,
    buffer: Buffer,
  ): Promise<string> {
    const storageKey = path.join(
      "derivatives",
      photoId,
      `${variant}.webp`,
    );
    const directory = path.join(this.rootPath, "derivatives", photoId);
    const filePath = path.join(this.rootPath, storageKey);
    const temporaryPath = path.join(
      directory,
      `.${variant}-${randomUUID()}.tmp`,
    );

    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, buffer);

    try {
      await rename(temporaryPath, filePath);
    } catch (error) {
      try {
        await unlink(temporaryPath);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Unable to save or clean up an image derivative",
        );
      }
      throw error;
    }

    return storageKey;
  }

  derivativeKey(photoId: string, variant: DerivativeVariant): string {
    return path.join("derivatives", photoId, `${variant}.webp`);
  }

  /**
   * Lit le contenu binaire d'une photo à partir de sa clé de stockage abstraite.
   * 
   * @param storageKey - Clé d'accès relative (fournie par la base de données)
   */
  async read(storageKey: string): Promise<Buffer> {
    const filePath = path.join(this.rootPath, storageKey);

    return readFile(filePath);
  }

  /**
   * Supprime une photo du système de fichiers à partir de sa clé de stockage.
   * 
   * @param storageKey - Clé d'accès relative du fichier à supprimer
   */
  async delete(storageKey: string): Promise<void> {
    await this.deleteFile(storageKey, false);
  }

  async deletePhotoAssets(
    userId: string,
    photoId: string,
    storageKey: string,
  ): Promise<void> {
    const segments = storageKey.split(/[\\/]/);
    if (
      segments.length !== 2 ||
      segments[0] !== userId ||
      segments.some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      throw new Error("Invalid photo storage key");
    }

    if (
      photoId === "" ||
      photoId === "." ||
      photoId === ".." ||
      /[\\/\0]/.test(photoId)
    ) {
      throw new Error("Invalid photo identifier");
    }

    await this.deleteFile(storageKey, true);

    await this.deleteDerivatives(photoId);
  }

  async deleteDerivatives(photoId: string): Promise<void> {
    if (
      photoId === "" ||
      photoId === "." ||
      photoId === ".." ||
      /[\\/\0]/.test(photoId)
    ) {
      throw new Error("Invalid photo identifier");
    }

    const derivativeDirectory = path.resolve(
      this.rootPath,
      "derivatives",
      photoId,
    );
    const rootPath = path.resolve(this.rootPath);
    const relativeDirectory = path.relative(rootPath, derivativeDirectory);
    if (
      relativeDirectory === "" ||
      relativeDirectory === ".." ||
      relativeDirectory.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeDirectory)
    ) {
      throw new Error("Invalid derivative directory");
    }
    await rm(derivativeDirectory, { recursive: true, force: true });
  }

  /**
   * Vérifie si un fichier existe physiquement sur le stockage.
   * 
   * @param storageKey - Clé d'accès relative à vérifier
   * @returns true si le fichier existe, false sinon
   */
  async exists(storageKey: string): Promise<boolean> {
    try {
      await access(path.join(this.rootPath, storageKey));
      return true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }

  private async deleteFile(
    storageKey: string,
    ignoreMissing: boolean,
  ): Promise<void> {
    const segments = storageKey.split(/[\\/]/);
    if (
      path.isAbsolute(storageKey) ||
      segments.some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      throw new Error("Invalid storage key");
    }

    const filePath = path.resolve(this.rootPath, storageKey);
    const rootPath = path.resolve(this.rootPath);
    const relativePath = path.relative(rootPath, filePath);
    if (
      relativePath === "" ||
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error("Invalid storage key");
    }

    try {
      await unlink(filePath);
    } catch (error) {
      if (!ignoreMissing || !isMissingFile(error)) {
        throw error;
      }
    }
  }
}