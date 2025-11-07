import { existsSync, mkdirSync } from "fs";

import type { ApiConfig } from "../config";

export function ensureAssetsDir(cfg: ApiConfig) {
  if (!existsSync(cfg.assetsRoot)) {
    mkdirSync(cfg.assetsRoot, { recursive: true });
  }
}

export function fileTypeToExt(fileType: string) {
  const deconstructed = fileType.split("/");
  if (deconstructed.length !== 2) {
    return ".bin";
  }
  return "." + deconstructed[1];
}


