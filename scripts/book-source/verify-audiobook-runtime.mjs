import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { AudioFormatExtractor } = require("./dist/modules/metadata/extractors/audio-format.extractor.js");
const execFile = promisify(execFileCallback);
const root = await mkdtemp(join(tmpdir(), "bookorbit-m4a-check-"));
try {
  const cover = join(root, "cover.jpg");
  const chapters = join(root, "chapters.txt");
  const audio = join(root, "test.m4a");
  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  await writeFile(
    chapters,
    ";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=第一章\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=1000\nEND=2000\ntitle=第二章\n",
  );
  await execFile(
    ffmpeg,
    ["-nostdin", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=300x400", "-frames:v", "1", "-update", "1", "-y", cover],
    { timeout: 30000 },
  );
  await execFile(
    ffmpeg,
    [
      "-nostdin",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=2",
      "-i",
      cover,
      "-i",
      chapters,
      "-map",
      "0:a",
      "-map",
      "1:v",
      "-map_metadata",
      "2",
      "-map_chapters",
      "2",
      "-c:a",
      "aac",
      "-b:a",
      "32k",
      "-c:v",
      "copy",
      "-disposition:v",
      "attached_pic",
      "-metadata",
      "album=测试有声书",
      "-metadata",
      "album_artist=测试作者",
      "-metadata",
      "artist=测试演播者",
      "-metadata",
      "composer=测试演播者",
      "-metadata",
      "comment=测试简介",
      "-metadata",
      "date=2024-01-02",
      "-metadata:s:a:0",
      "language=zho",
      "-y",
      audio,
    ],
    { timeout: 30000 },
  );
  const result = await new AudioFormatExtractor().extract(audio);
  assert.ok(result);
  assert.equal(result.title, "测试有声书");
  assert.deepEqual(
    result.authors.map((author) => author.name),
    ["测试作者"],
  );
  assert.deepEqual(result.narrators, ["测试演播者"]);
  assert.ok(Math.abs(result.durationSeconds - 2) < 0.1);
  assert.deepEqual(
    result.chapters.map((chapter) => chapter.title),
    ["第一章", "第二章"],
  );
  assert.ok(result.cover?.length);
  console.log(
    JSON.stringify({
      format: "m4a",
      title: result.title,
      durationSeconds: result.durationSeconds,
      chapters: result.chapters.length,
      coverBytes: result.cover.length,
      language: result.language,
    }),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
