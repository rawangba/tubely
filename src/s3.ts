import type { ApiConfig } from "./config";

export async function uploadVideoToS3(cfg: ApiConfig, key: string, serverFilePath: string, contentType: string) {
  const s3file: S3File = cfg.s3Client.file(key, { bucket: cfg.s3Bucket });
  const videoFile = Bun.file(serverFilePath);
  await s3file.write(videoFile, { type: contentType });
}

