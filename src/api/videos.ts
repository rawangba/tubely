import { respondWithJSON } from "./json";
import { rm } from "fs/promises";
import path from "path";

import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";

import { fileTypeToExt } from "./assets";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import { uploadVideoToS3 } from "../s3";

import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  // Extract videoID from URL path parameter, parse as UUID
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  // Authenticate user
  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  // Get video metadata from SQLite database
  const videoMetadata = await getVideo(cfg.db, videoId);
  
  // Check if provided userID matches userID of the video in the DB
  if (!videoMetadata || userID !== videoMetadata.userID) {
    throw new UserForbiddenError(`Video owner ${userID} does not match`);
  }

  console.log("uploading video", videoId, "by user", userID);

  // Parse form data and get video from the form
  const formData = await req.formData();
  const file = formData.get("video");
  if (!(file instanceof File)) {
    throw new BadRequestError("Video file missing");
  }

  // Check file size of video
  const MAX_UPLOAD_SIZE = 1 << 30;
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("File too large, max size is 1GB");
  }

  // Get media type of video
  const fileType = file.type;
  if (fileType !== "video/mp4") {
    throw new BadRequestError("Thumbnail must be JPEG or PNG");
  }

  // create a temporary file on the disk
  const tempFileName = path.join("/tmp", `${videoId}.mp4`);
  const tempFile = Bun.file(tempFileName);
  
  // Write video to temporary file 
  await Bun.write(tempFile, file);

  // Process temporary file so that it has "fast start" encoding
  const processedFilePath = await processVideoForFastStart(tempFileName);

  // Get the aspect ratio of the video
  const aspectRatio = await getVideoAspectRatio(processedFilePath);

  // Generate S3 file key
  //const { randomBytes } = await import('node:crypto');
  //const buf = randomBytes(32);
  //const fileKey = `${buf.toString('base64url')}${fileTypeToExt(fileType)}`;
  const fileKey = `${aspectRatio}/${videoId}${fileTypeToExt(fileType)}`;
  console.log(`S3 File Key is ${fileKey}`);

  // Write to S3
  await uploadVideoToS3(cfg, fileKey, processedFilePath, fileType);

  // Generate S3 URL
  const videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${fileKey}`
  console.log(`Video uploaded to ${videoURL}`);

  // Update video metadata in the DB to use the video URL
  videoMetadata.videoURL = videoURL;
  updateVideo(cfg.db, videoMetadata);

  // Delete temporary file
  await Promise.all([rm(tempFileName, { force: true })]);
  await Promise.all([rm(processedFilePath, { force: true })]);

  // Respond with updated JSON of video's metadata 
  return respondWithJSON(200, videoMetadata);
}

async function getVideoAspectRatio(filePath: string): string {
  const proc = Bun.spawn(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", filePath], {
    stderr: "pipe",
  });
  
  const errors: string = await proc.stderr.text();
  if (errors) {
    console.error(errors);
  }
  await proc.exited;
  if (proc.exitCode !== 0) {
    throw new Error(`ffprobe error: ${errors}`);
  }
  
  const text = await proc.stdout.text();
  const output = JSON.parse(text);
  if (!output.streams || output.streams.length === 0) {
    throw new Error("No video streams found");
  }

  const width = output.streams[0].width;
  const height = output.streams[0].height;

  if (width / height > 1.75 && width / height < 1.8) {
    return "landscape";
  }
  else if (width / height > .55 && width / height < .57) {
    return "portrait";
  }
  return "other";
}

export async function processVideoForFastStart(inputFilePath: string): string {
  const newFilePath = `${inputFilePath}.processed`;
  const proc = Bun.spawn(["ffmpeg", "-i", inputFilePath, "-movflags", "faststart", "-map_metadata", "0", "-codec", "copy", "-f", "mp4", newFilePath], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const errors: string = await proc.stderr.text();
  if (errors) {
    console.error(errors);
  }
  await proc.exited;
  if (proc.exitCode !== 0) {
    throw new Error(`ffmpeg error: ${errors}`);
  }

  return newFilePath;
}

