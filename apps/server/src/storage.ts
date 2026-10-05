import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Chemin racine du stockage des photos. 
 * Peut pointer vers un point de montage NFS via la variable d'environnement PHOTO_STORAGE_PATH.
 */
const STORAGE_PATH = process.env.PHOTO_STORAGE_PATH ?? "./data/photos";

/**
 * Enregistre une nouvelle photo pour un utilisateur donné.
 * 
 * @param userId - Identifiant unique de l'utilisateur (permet d'isoler ses fichiers)
 * @param buffer - Le contenu binaire de la photo
 * @param extension - L'extension du fichier (ex: ".jpg", ".png")
 * @returns Un objet contenant le nom du fichier et une clé de stockage abstraite
 */
export async function savePhoto(
  userId: string,
  buffer: Buffer,
  extension: string,
) {
  // Génération d'un nom de fichier unique pour éviter les collisions
  const filename = `${randomUUID()}${extension}`;
  
  // Organisation des fichiers par sous-dossier utilisateur
  const userDirectory = path.join(STORAGE_PATH, userId);
  const filePath = path.join(userDirectory, filename);

  // Création récursive du dossier utilisateur s'il n'existe pas encore
  await mkdir(userDirectory, { recursive: true });
  
  // Écriture du fichier binaire sur le stockage (compatible NFS)
  await writeFile(filePath, buffer);

  // Abstraction : Le reste de l'application récupère uniquement le 'storageKey' 
  // (ex: "user-123/uuid.jpg") à sauvegarder en base de données, 
  // évitant ainsi d'exposer les chemins absolus ou la logique du système de fichiers.
  return {
    filename,
    storageKey: path.join(userId, filename),
  };
}

/**
 * Lit le contenu binaire d'une photo à partir de sa clé de stockage abstraite.
 * 
 * @param storageKey - Clé d'accès relative (fournie par la base de données)
 */
export async function readPhoto(storageKey: string) {
  const filePath = path.join(STORAGE_PATH, storageKey);

  return readFile(filePath);
}

/**
 * Supprime une photo du système de fichiers à partir de sa clé de stockage.
 * 
 * @param storageKey - Clé d'accès relative du fichier à supprimer
 */
export async function deletePhoto(storageKey: string) {
  const filePath = path.join(STORAGE_PATH, storageKey);

  await unlink(filePath);
}