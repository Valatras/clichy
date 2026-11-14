export function ownedPhotoWhere(id: string, userId: string) {
  return { id, userId };
}

export function exactDuplicateWhere(
  userId: string,
  sha256: string,
  photoId: string,
) {
  return {
    userId,
    sha256,
    id: { not: photoId },
    processingStatus: "COMPLETED" as const,
  };
}

export function similarPhotoWhere(userId: string, photoId: string) {
  return {
    userId,
    id: { not: photoId },
    perceptualHash: { not: null },
    processingStatus: "COMPLETED" as const,
  };
}
