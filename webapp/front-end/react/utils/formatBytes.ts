export function formatBytes(bytes: number, decimals = 2): string {
  if (!+bytes) return "0 Bytes";

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["b", "k", "M", "G", "T", "P", "E", "Z", "Y"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseInt((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
