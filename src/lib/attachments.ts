/** Formats WebKit can show as a thumbnail. */
const IMAGE = /\.(png|jpe?g|gif|webp|heic|avif|bmp|tiff?|svg)$/i;

export const isImage = (name: string) => IMAGE.test(name);

/** The extension, for tiles that can't show a thumbnail, e.g. "pdf". */
export const extension = (name: string) => (name.includes(".") ? (name.split(".").pop() ?? "") : "");

/** "820 B", "14 KB", "2.3 MB". Sizes cross from Rust as `number | null` (f64). */
export function formatSize(bytes: number | null): string {
  if (bytes === null || bytes < 1000) return `${bytes ?? 0} B`;
  const units = ["KB", "MB", "GB"];
  let size = bytes;
  let unit = -1;
  do {
    size /= 1000;
    unit++;
  } while (size >= 1000 && unit < units.length - 1);
  return `${size < 10 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`;
}

/** Clipboard images arrive as "image.png"; name them like macOS screenshots instead. */
export function pastedName(file: File): string {
  if (file.name && file.name !== "image.png") return file.name;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} at ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
  return `Pasted image ${stamp}.${file.type.split("/")[1] || "png"}`;
}

/** A file's contents as base64, for sending to Rust. */
export function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
