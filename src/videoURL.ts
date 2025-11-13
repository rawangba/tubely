import { type ApiConfig } from "./config";
import { type Video } from "./db/videos";

async function generatePresignedURL(cfg: ApiConfig, key: string, expireTime: number): string {
  console.log(`Generating Presigned URL for ${key}`);
  const presignedURL = cfg.s3Client.presign(key, {
    expiresIn: expireTime,
  }); // Let Bun infer the needed method and content type. Including them will prevent this from being used for both GET & SET methods.
  return presignedURL;
}

// video_url in the db contains the bucket & key of the video when this func is called. 
// It is used to presign a URL, which is then saved to the video_url field of a new Video
// Don't assign the result of this func into something that reads into the DB!
export async function dbVideoToSignedVideo(cfg: ApiConfig, video: Video): Video {
  console.log(`Working on Video ${video.title}`);

  const currentKey = video.videoURL;
  if (!currentKey) {
    console.error("This Video object doesn't have a file to create a presigned URL with");
    return video;
  }

  const presignedURL = await generatePresignedURL(cfg, currentKey, 3600);
  if (!presignedURL) {
    console.error("Could not generate presigned URL. Returning original Video file");
    return video;
  }

  console.log(`Received presigned URL ${presignedURL}`);
  video.videoURL = presignedURL;
  return video;
}

