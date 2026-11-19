export function isDevGalleryEnabled(): boolean {
  return !(process.env.NODE_ENV === "production" && process.env.VERCEL_ENV === "production");
}