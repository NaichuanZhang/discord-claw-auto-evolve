/**
 * Text-to-Speech client using EigenAI Chatterbox.
 *
 * Supports two modes:
 * 1. synthesize() — full synthesis, returns complete WAV buffer (legacy)
 * 2. synthesizeStream() — SSE streaming, yields PCM16 chunks as they arrive
 *
 * Streaming mode starts playback ~1s earlier than non-streaming.
 */

import { PassThrough } from "node:stream";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EIGENAI_TTS_URL = "https://api-web.eigenai.com/api/chatterbox";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TTSStreamResult {
  /** A readable stream that emits a WAV header followed by PCM16 audio data.
   *  Compatible with discord.js createAudioResource(stream, { inputType: StreamType.Arbitrary }). */
  stream: PassThrough;
  /** Resolves when streaming is complete. Rejects on error. */
  done: Promise<void>;
  /** Sample rate from the metadata event (typically 24000) */
  sampleRate: number;
  /** Number of channels from metadata (typically 1) */
  channels: number;
}

// ---------------------------------------------------------------------------
// TTS API — Full Synthesis (legacy)
// ---------------------------------------------------------------------------

/**
 * Synthesize text to speech using EigenAI Chatterbox.
 * @param text The text to speak
 * @returns WAV audio buffer
 */
export async function synthesize(text: string, signal?: AbortSignal): Promise<Buffer> {
  const apiKey = process.env.EIGENAI_API_KEY;
  if (!apiKey) {
    throw new Error("EIGENAI_API_KEY environment variable is not set");
  }

  console.log(`[tts] Synthesizing ${text.length} chars: "${text.slice(0, 100)}${text.length > 100 ? "..." : ""}"`);

  const startTime = Date.now();

  const response = await fetch(EIGENAI_TTS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ text }),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "unknown error");
    console.error(`[tts] ❌ API error ${response.status}: ${errText}`);
    throw new Error(`EigenAI TTS failed (${response.status}): ${errText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const elapsed = Date.now() - startTime;

  console.log(`[tts] ✅ Synthesized in ${elapsed}ms: ${buffer.length} bytes audio for "${text.slice(0, 50)}"`);

  return buffer;
}

// ---------------------------------------------------------------------------
// TTS API — Streaming
// ---------------------------------------------------------------------------

/**
 * Write a WAV header for PCM16 mono audio.
 * We write a placeholder total size and patch it later, but for streaming
 * playback the player usually doesn't care about exact size — it reads until EOF.
 */
function createWavHeader(sampleRate: number, channels: number, dataSize: number = 0xFFFFFFFF - 36): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2; // 16-bit = 2 bytes per sample
  const blockAlign = channels * 2;

  // RIFF header
  header.write("RIFF", 0);
  header.writeUInt32LE(dataSize + 36, 4); // File size - 8
  header.write("WAVE", 8);

  // fmt sub-chunk
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (PCM)
  header.writeUInt16LE(1, 20); // AudioFormat (PCM)
  header.writeUInt16LE(channels, 22); // NumChannels
  header.writeUInt32LE(sampleRate, 24); // SampleRate
  header.writeUInt32LE(byteRate, 28); // ByteRate
  header.writeUInt16LE(blockAlign, 32); // BlockAlign
  header.writeUInt16LE(16, 34); // BitsPerSample

  // data sub-chunk
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40); // Subchunk2Size

  return header;
}

/**
 * Synthesize text to speech using EigenAI Chatterbox with SSE streaming.
 *
 * Returns a PassThrough stream that emits a WAV header + PCM16 chunks as they arrive.
 * The stream can be directly fed to discord.js createAudioResource().
 *
 * @param text The text to speak
 * @param signal Optional abort signal
 * @returns TTSStreamResult with stream, done promise, and audio metadata
 */
export function synthesizeStream(text: string, signal?: AbortSignal): TTSStreamResult {
  const apiKey = process.env.EIGENAI_API_KEY;
  if (!apiKey) {
    throw new Error("EIGENAI_API_KEY environment variable is not set");
  }

  console.log(`[tts:stream] Synthesizing ${text.length} chars: "${text.slice(0, 100)}${text.length > 100 ? "..." : ""}"`);

  const passthrough = new PassThrough();
  let sampleRate = 24000;
  let channels = 1;
  let headerWritten = false;
  let totalPcmBytes = 0;
  let chunkCount = 0;
  const startTime = Date.now();
  let ttfb = 0;

  const done = (async () => {
    const response = await fetch(EIGENAI_TTS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ text, stream: true }),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "unknown error");
      console.error(`[tts:stream] ❌ API error ${response.status}: ${errText}`);
      passthrough.destroy(new Error(`EigenAI TTS stream failed (${response.status}): ${errText}`));
      throw new Error(`EigenAI TTS stream failed (${response.status}): ${errText}`);
    }

    if (!response.body) {
      passthrough.destroy(new Error("No response body for SSE stream"));
      throw new Error("No response body for SSE stream");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        if (signal?.aborted) break;

        const { done: readerDone, value } = await reader.read();
        if (readerDone) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE lines
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete last line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const jsonStr = trimmed.slice(6); // Remove "data: "

          let event: any;
          try {
            event = JSON.parse(jsonStr);
          } catch {
            continue; // Skip malformed JSON
          }

          // Handle different event types
          const eventType = event.type || event.data?.type;

          if (eventType === "metadata") {
            const meta = event.data || event;
            sampleRate = meta.sample_rate || 24000;
            channels = meta.channels || 1;
            console.log(`[tts:stream] Metadata: ${sampleRate}Hz, ${channels}ch, pcm16`);
          } else if (eventType === "audio_chunk") {
            const b64Data = event.data?.data || event.data;
            if (typeof b64Data === "string") {
              const pcmChunk = Buffer.from(b64Data, "base64");

              // Write WAV header before first audio chunk
              if (!headerWritten) {
                ttfb = Date.now() - startTime;
                console.log(`[tts:stream] ⚡ TTFB: ${ttfb}ms — writing WAV header and first chunk`);
                passthrough.write(createWavHeader(sampleRate, channels));
                headerWritten = true;
              }

              chunkCount++;
              totalPcmBytes += pcmChunk.length;
              passthrough.write(pcmChunk);
            }
          } else if (eventType === "complete" || eventType === "audio_complete") {
            const elapsed = Date.now() - startTime;
            const durationSec = totalPcmBytes / (sampleRate * channels * 2);
            console.log(
              `[tts:stream] ✅ Stream complete in ${elapsed}ms (TTFB=${ttfb}ms, chunks=${chunkCount}, ` +
              `${totalPcmBytes} bytes, ${durationSec.toFixed(2)}s audio) for "${text.slice(0, 50)}"`
            );
          } else if (eventType === "done") {
            // End of stream
            break;
          }
        }
      }
    } catch (err) {
      if (signal?.aborted) {
        // Expected — abort is not an error
      } else {
        console.error(`[tts:stream] ❌ Stream error:`, err);
        passthrough.destroy(err instanceof Error ? err : new Error(String(err)));
        throw err;
      }
    } finally {
      reader.releaseLock();
      passthrough.end();
    }
  })();

  return {
    stream: passthrough,
    done,
    sampleRate,
    channels,
  };
}
