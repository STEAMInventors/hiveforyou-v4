/** True on `/dev/gallery/*` fixture routes (not production hive pages). */
export function isDevGalleryPath(pathname?: string): boolean {
  const path = pathname ?? (typeof window !== "undefined" ? window.location.pathname : "");
  return path.startsWith("/dev/gallery/");
}