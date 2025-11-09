import path from 'node:path';
import randomBytes from 'node:crypto';
import { fileTypeToExt } from "./assets";
import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

//const videoThumbnails: Map<string, Thumbnail> = new Map();

export async function handlerGetThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  const thumbnail = videoThumbnails.get(videoId);
  if (!thumbnail) {
    throw new NotFoundError("Thumbnail not found");
  }

  return new Response(thumbnail.data, {
    headers: {
      "Content-Type": thumbnail.mediaType,
      "Cache-Control": "no-store",
    },
  });
}

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  // Parse form data and get thumbnail from the form
  const formData = await req.formData();
  const file = formData.get("thumbnail");
  if (!(file instanceof File)) {
    throw new BadRequestError("Thumbnail file missing");
  }

  // Check file size of thumbnail
  const MAX_UPLOAD_SIZE = 10 << 20;
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("File too large, max size is 10MB");
  }

  // Get media type of thumbnail
  const fileType = file.type;
  if (fileType !== "image/jpeg") {
    if (fileType !== "image/png") {
      throw new BadRequestError("Thumbnail must be JPEG or PNG");
    }
  }

  // Read image data into a const
  const imageData = await file.arrayBuffer();
  //const encodedImage = Buffer.from(imageData).toString("base64"); // Encodes image data in a base64 string

  // Get video metadata from SQLite database
  const videoMetadata = await getVideo(cfg.db, videoId);
  
  // Check if provided userID matches userID of the video in the DB
  if (!videoMetadata || userID !== videoMetadata.userID) {
    throw new UserForbiddenError(`Video owner ${userID} does not match`);
  }

  // Save thumbnail to the global map (videoThumbnails, in this file)
  //videoThumbnails.set(videoMetadata.id, {data: imageData, mediaType: fileType});

  // Generate thumbnail file path
  //const filename = `${videoId}${fileTypeToExt(fileType)}`;
  const { randomBytes } = await import('node:crypto');
  const buf = randomBytes(32);
  const filename = `${buf.toString('base64url')}${fileTypeToExt(fileType)}`;
  const thumbnailFilepath = path.join(cfg.assetsRoot, filename);

  // Generate thumbnail URL
  //const thumbnailURL = `http://localhost:${cfg.port}/api/thumbnails/${videoId}`;
  //const thumbnailURL = `data:${fileType};base64,${encodedImage}`; // Creates a data URL
  const thumbnailURL = `http://localhost:${cfg.port}/${thumbnailFilepath}`

  // Save the thumbnail file to the server file system
  await Bun.write(thumbnailFilepath, imageData);

  // Update video metadata in the DB to use the thumbnail URL
  videoMetadata.thumbnailURL = thumbnailURL;  
  updateVideo(cfg.db, videoMetadata);

  // Respond with updated JSON of video's metadata 
  return respondWithJSON(200, videoMetadata);
}
