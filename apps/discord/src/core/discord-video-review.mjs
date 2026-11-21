import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractVideoAudio } from '../media-normalize.js';
import { defang } from './discord-batch.mjs';
import { createMediaQueue, prepareVideoUrlBlock } from './discord-media.mjs';
import { clipTranscript, fetchVideoLink, formatVideoTime, isBilibiliVideoLink, videoLinks } from './discord-video-link.mjs';

const REVIEW_TIMEOUT_MS = 155_000;
const MAX_SHEET_SECONDS = 60;
const MAX_SPEECH_SECONDS = 180;
const reviewQueue = createMediaQueue(1, { maxWaiting: 0 });
const localWhisper = fileURLToPath(new URL('../../../../.tools/whisper/', import.meta.url));

/** 短片連續抽樣，長片把有限的抽樣區段分散到整個指定範圍。 */
export function videoReviewWindows(start, end, maxSheets) {
  const span = end - start;
  const count = Math.min(3, maxSheets, Math.max(1, Math.ceil(span / 20)));
  const length = Math.min(MAX_SHEET_SECONDS, span / count);
  const step = count > 1 ? (span - length) / (count - 1) : 0;
  return Array.from({ length: count }, (_, i) => {
    const from = start + i * step;
    return { start: from, end: Math.min(end, from + length) };
  });
}

function runWhisper(bin, model, audio, output, timeoutMs) {
  return new Promise((resolve) => {
    const signal = AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs)));
    let child;
    try {
      child = spawn(bin, [
        '-m', model, '-f', audio, '-l', 'auto', '-t', '1', '-ng', '-oj', '-of', output,
      ], { signal, killSignal: 'SIGKILL', stdio: 'ignore', windowsHide: true });
    } catch { resolve(false); return; }
    child.once('error', () => {});
    child.once('close', (code) => resolve(code === 0 && !signal.aborted));
  });
}

async function transcribeVideo(streams, range, options) {
  if (!streams.length) return { error: 'yt-dlp 未提供音軌' };
  const exe = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  const bin = process.env.WHISPER_PATH || path.join(localWhisper, 'bin', exe);
  const model = process.env.WHISPER_MODEL || path.join(localWhisper, 'ggml-tiny-q5_1.bin');
  try {
    fs.accessSync(bin, fs.constants.X_OK);
    fs.accessSync(model, fs.constants.R_OK);
  } catch { return { error: '本機 Whisper 尚未設定（WHISPER_PATH、WHISPER_MODEL）' }; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-video-speech-'));
  try {
    const output = path.join(dir, 'transcript');
    let selected;
    for (const [index, stream] of streams.entries()) {
      const audio = path.join(dir, `audio-${index}.wav`);
      const timeoutMs = Math.min(18_000, options.deadline - Date.now());
      if (timeoutMs <= 0) break;
      const run = await extractVideoAudio(stream.url, audio, {
        range, timeoutMs, httpHeaders: stream.httpHeaders, ffmpegPath: options.ffmpegPath, bilibili: options.bilibili,
      });
      if (!run.ok) continue;
      // FFmpeg 寫的 16kHz / 16-bit 單聲道 WAV。用音訊長度辨認中途被 CDN 截斷的回應。
      const seconds = ((fs.statSync(audio, { throwIfNoEntry: false })?.size ?? 0) - 78) / 32_000;
      if (seconds > (selected?.seconds ?? 0)) selected = { audio, seconds };
      if (seconds >= range.end - range.start - 0.2) break;
    }
    if (!selected) return { error: '抓不到可辨識的音軌' };
    const remaining = options.deadline - Date.now();
    if (remaining <= 0 || !await runWhisper(bin, model, selected.audio, output, remaining)) {
      return { error: '本機語音辨識失敗或逾時' };
    }
    const doc = JSON.parse(fs.readFileSync(`${output}.json`, 'utf8'));
    const segments = Array.isArray(doc.transcription) ? doc.transcription : [];
    const transcript = clipTranscript(segments.flatMap((segment) => {
      const text = segment.text?.trim().replace(/\s+/g, ' ');
      const millis = segment.offsets?.from;
      return text && Number.isFinite(millis) ? [`[${formatVideoTime(range.start + millis / 1000)}] ${text}`] : [];
    }).join('\n'));
    return { ...transcript, end: Math.min(range.end, range.start + selected.seconds) };
  } catch {
    return { error: '讀不到本機語音辨識結果' };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const indentTranscript = (value) => defang(value).split('\n').map((line) => `  ${line}`).join('\n');

export async function reviewVideoLink(url, limits, { ytDlpPath, start = 0, end } = {}) {
  const deadline = Date.now() + REVIEW_TIMEOUT_MS;
  if (!videoLinks(url).includes(url)) return { error: '請使用支援的 YouTube 或 Bilibili 網址' };
  if (!Number.isFinite(start) || start < 0 || (end !== undefined && (!Number.isFinite(end) || end <= start))) {
    return { error: '時間範圍無效，結束秒數必須大於開始秒數' };
  }
  return reviewQueue(async () => {
    const video = await fetchVideoLink(url, { ytDlpPath, timeoutMs: 24_000, includeAudio: true, subtitleWindow: { start, end } });
    if (!video.ok) return { error: video.reason };
    const stop = video.duration > 0 ? Math.min(end ?? video.duration, video.duration) : end;
    if (!Number.isFinite(stop)) return { error: '找不到影片長度，請指定結束秒數' };
    if (stop <= start) return { error: '開始秒數已超過影片範圍' };

    const bilibili = isBilibiliVideoLink(url);
    const lines = [`影片 ${defang(video.title).replace(/\s+/g, ' ').slice(0, 180) || '（標題不明）'}`,
      `要求範圍 ${start.toFixed(1)}–${stop.toFixed(1)}s`];
    const images = [];
    const visualDeadline = Math.min(deadline, Date.now() + (video.transcript ? 100_000 : 50_000));
    const windows = videoReviewWindows(start, stop, limits.maxCount ?? 3);
    if (windows.reduce((total, item) => total + item.end - item.start, 0) < stop - start - 0.1) {
      lines.push('較長範圍的畫面涵蓋下列抽樣區段。要查細節請指定時間範圍。');
    }
    if (!video.url) lines.push('yt-dlp 未提供視訊串流。');
    for (const range of video.url ? windows : []) {
      const sheet = await prepareVideoUrlBlock(video.url, limits, {
        bilibili, duration: video.duration || stop, httpHeaders: video.httpHeaders, alternate: video.alternate,
        range, videoFrames: 8, timeoutMs: 24_000, deadline: visualDeadline,
      }).catch((error) => ({ error: error.message }));
      if (sheet.block) {
        images.push({ data: sheet.block.data, mimeType: sheet.block.mediaType });
        lines.push(`第 ${images.length} 張：${sheet.note}`);
      } else {
        lines.push(`區段 ${range.start.toFixed(1)}–${range.end.toFixed(1)}s 未能抽格：${sheet.error}`);
      }
    }

    if (video.transcript) {
      lines.push(`影片字幕（${video.transcriptLang}${video.transcriptTruncated ? '，文字超過上限，請縮小範圍' : ''}）：\n${indentTranscript(video.transcript)}`);
    } else {
      const range = { start, end: Math.min(stop, start + MAX_SPEECH_SECONDS) };
      const speech = await transcribeVideo(video.audioStreams, range, { deadline, bilibili, ffmpegPath: limits.ffmpegPath });
      if (speech.error) lines.push(`語音辨識：${speech.error}。`);
      else {
        if (range.end < stop) lines.push(`每次辨識最多 ${MAX_SPEECH_SECONDS}s，可從 start_seconds=${range.end} 繼續。`);
        if (speech.end < range.end - 0.2) lines.push('音軌提早結束，語音辨識僅涵蓋下列時間。');
        lines.push(`語音辨識 (${range.start.toFixed(1)}–${speech.end.toFixed(1)}s${speech.truncated ? '，文字超過上限，請縮小範圍' : ''})：\n${speech.text ? indentTranscript(speech.text) : '  沒有辨識出語句。'}`);
      }
    }
    return { text: lines.join('\n'), images };
  });
}
