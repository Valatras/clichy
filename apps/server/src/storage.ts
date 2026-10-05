import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { ENV } from "./env";

/**
 * Service de stockage des fichiers basé sur le système de fichiers (compatible NFS).
 * Encapsule la logique d'écriture, lecture, suppression et vérification des photos.
 */
export class FileSystemStorage {
  private readonly rootPath: string;

  /**
   * @param rootPath - Chemin racine du stockage (par défaut récupéré depuis les variables d'environnement)
   */
  constructor(rootPath: string = ENV.PHOTO_STORAGE_PATH) {
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
    const filePath = path.join(this.rootPath, storageKey);

    await unlink(filePath);
  }

  /**
   * Vérifie si un fichier existe physiquement sur le stockage.
   * 
   * @param storageKey - Clé d'accès relative à vérifier
   * @returns true si le fichier existe, false sinon
   */
  async exists(storageKey: string): Promise<boolean> {
    try {
      await readFile(path.join(this.rootPath, storageKey));
      return true;
    } catch {
      return false;
    }
  }
}