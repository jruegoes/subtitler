import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME!;

export async function uploadAudio(
  buffer: Buffer,
  originalFilename: string,
  contentType: string,
): Promise<string> {
  const ext = originalFilename.split(".").pop() || "mp3";
  const key = `srtsound/${randomUUID()}.${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );

  console.log(`[storage] Uploaded ${originalFilename} → ${key} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
  return key;
}

export async function getPlaybackUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  const url = await getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hour
  return url;
}
