/**
 * Audio receiver — subscribes to user audio streams from a VoiceConnection,
 * decodes opus to PCM, and downsamples to 16kHz mono for VAD and STT processing.
 *
 * Discord user audio streams can be either mono or stereo depending on the
 * client. We auto-detect the format on the first packet and adapt accordingly.
 */

import type { VoiceConnection } from "@discordjs/voice";
import opus from "@discordjs/opus";
import fs from "node:fs";
import path from "node:path";
const { OpusEncoder } = opus;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Discord sends 48kHz opus */
const DISCORD_SAMPLE_RATE = 48000;

/** Silero VAD expects 16kHz mono */
export const VAD_SAMPLE_RATE = 16000;
export const VAD_CHANNELS = 1;

/** Frame duration in ms — Discord sends 20ms opus frames */
const FRAME_DURATION_MS = 20;

/** Expected samples per 20ms frame at 48kHz */
const MONO_FRAME_SAMPLES = 960;   // 48000 * 0.020
const STEREO_FRAME_SAMPLES = 1920; // 48000 * 0.020 * 2

// ---------------------------------------------------------------------------
// Opus decoders — one for each channel configuration
// ---------------------------------------------------------------------------

const opusDecoderMono = new OpusEncoder(DISCORD_SAMPLE_RATE, 1);
const opusDecoderStereo = new OpusEncoder(DISCORD_SAMPLE_RATE, 2);

// ---------------------------------------------------------------------------
// Audio processing
// ---------------------------------------------------------------------------

/**
 * Decode an opus packet to PCM Int16.
 * Auto-detects mono vs stereo by trying stereo first, then falling back.
 */
export function decodeOpus(opusPacket: Buffer, channels: 1 | 2): Int16Array {
  const decoder = channels === 2 ? opusDecoderStereo : opusDecoderMono;
  const pcmBuffer = decoder.decode(opusPacket);
  return new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.byteLength / 2);
}

/**
 * Downsample from 48kHz Int16 to 16kHz mono Float32.
 * Handles both mono and stereo input.
 */
export function downsampleToMono16k(pcm48k: Int16Array, channels: 1 | 2): Float32Array {
  const ratio = DISCORD_SAMPLE_RATE / VAD_SAMPLE_RATE; // 3
  const step = ratio * channels; // 3 for mono, 6 for stereo
  const outputLength = Math.floor(pcm48k.length / step);
  const output = new Float32Array(outputLength);

  if (channels === 1) {
    // Mono: just take every 3rd sample
    for (let i = 0; i < outputLength; i++) {
      output[i] = pcm48k[i * step] / 32768;
    }
  } else {
    // Stereo: average L+R channels, then downsample
    for (let i = 0; i < outputLength; i++) {
      const baseIdx = i * step;
      const left = pcm48k[baseIdx];
      const right = pcm48k[baseIdx + 1];
      output[i] = ((left + right) / 2) / 32768;
    }
  }

  return output;
}

/**
 * Convert PCM 48kHz Int16 to 16kHz mono Int16 (for WAV encoding / STT).
 * Handles both mono and stereo input.
 */
export function downsampleToMono16kInt16(pcm48k: Int16Array, channels: 1 | 2): Int16Array {
  const ratio = DISCORD_SAMPLE_RATE / VAD_SAMPLE_RATE;
  const step = ratio * channels;
  const outputLength = Math.floor(pcm48k.length / step);
  const output = new Int16Array(outputLength);

  if (channels === 1) {
    for (let i = 0; i < outputLength; i++) {
      output[i] = pcm48k[i * step];
    }
  } else {
    for (let i = 0; i < outputLength; i++) {
      const baseIdx = i * step;
      const left = pcm48k[baseIdx];
      const right = pcm48k[baseIdx + 1];
      output[i] = Math.round((left + right) / 2);
    }
  }

  return output;
}

// ---------------------------------------------------------------------------
// Debug: WAV file writer for raw audio dumps
// ---------------------------------------------------------------------------

function writeWav(filePath: string, pcmData: Int16Array, sampleRate: number, channels: number): void {
  const bytesPerSample = 2;
  const dataLength = pcmData.length * bytesPerSample;
  const headerLength = 44;
  const buffer = Buffer.alloc(headerLength + dataLength);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVE", 8);

  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28); // byte rate
  buffer.writeUInt16LE(channels * bytesPerSample, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample

  // data chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);

  // Write PCM data
  for (let i = 0; i < pcmData.length; i++) {
    buffer.writeInt16LE(pcmData[i], headerLength + i * 2);
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
}

// ---------------------------------------------------------------------------
// Per-user audio subscription
// ---------------------------------------------------------------------------

export interface UserAudioStream {
  userId: string;
  /** Callback when we receive a decoded + downsampled audio frame */
  onFrame: (frame: Float32Array) => void;
  /** Callback when the raw PCM is available for buffering */
  onRawPcm: (pcm: Int16Array) => void;
  /** Detected channel count for this stream */
  channels: 1 | 2;
  /** Stop listening */
  destroy: () => void;
}

/**
 * Subscribe to a user's audio stream from a voice connection.
 * Decodes opus and downsamples to 16kHz mono for VAD processing.
 *
 * Auto-detects mono vs stereo on the first decoded packet based on
 * the number of samples returned.
 *
 * @param onStreamEnd - Called when the opus stream ends/closes, so the caller
 *   can clean up and allow re-subscription on the next speaking:start event.
 */
export function subscribeToUser(
  connection: VoiceConnection,
  userId: string,
  onFrame: (frame: Float32Array) => void,
  onRawPcm: (pcm: Int16Array) => void,
  onStreamEnd?: () => void,
): UserAudioStream {
  const receiver = connection.receiver;

  const opusStream = receiver.subscribe(userId, {
    end: {
      behavior: 1, // AfterSilence
      duration: 5000, // 5 seconds
    },
  });

  let packetCount = 0;
  let decodeErrors = 0;
  let ended = false;

  // Auto-detect channels on first packet. Default to stereo but will
  // correct on first decode.
  let detectedChannels: 1 | 2 = 2;
  let channelsDetected = false;

  // ---------------------------------------------------------------------------
  // Debug: capture raw audio for diagnosis
  // ---------------------------------------------------------------------------
  const DEBUG_DUMP = true;
  const DUMP_PACKETS = 250; // ~5 seconds of audio
  const rawOpusPackets: Buffer[] = [];
  const rawPcmChunks: Int16Array[] = [];
  let dumpWritten = false;

  const handleData = (packet: Buffer) => {
    try {
      packetCount++;

      // Capture raw opus packets for debug dump
      if (DEBUG_DUMP && packetCount <= DUMP_PACKETS) {
        rawOpusPackets.push(Buffer.from(packet));
      }

      // On the first packet, try to detect mono vs stereo
      if (!channelsDetected) {
        // Log raw opus packet details
        console.log(`[voice:recv] Raw opus packet #1 for ${userId}: ${packet.length} bytes, first 16 bytes: [${Array.from(packet.subarray(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ')}]`);

        // Try decoding as stereo first
        const stereoPcm = decodeOpus(packet, 2);

        // Try mono too
        const monoPcm = decodeOpus(packet, 1);

        // Calculate RMS for each (use ALL samples, not just first 100)
        let stereoRms = 0;
        for (let i = 0; i < stereoPcm.length; i++) {
          stereoRms += stereoPcm[i] * stereoPcm[i];
        }
        stereoRms = Math.sqrt(stereoRms / stereoPcm.length);

        let monoRms = 0;
        for (let i = 0; i < monoPcm.length; i++) {
          monoRms += monoPcm[i] * monoPcm[i];
        }
        monoRms = Math.sqrt(monoRms / monoPcm.length);

        // Find max absolute value for each
        let stereoMax = 0, monoMax = 0;
        for (let i = 0; i < stereoPcm.length; i++) {
          const abs = Math.abs(stereoPcm[i]);
          if (abs > stereoMax) stereoMax = abs;
        }
        for (let i = 0; i < monoPcm.length; i++) {
          const abs = Math.abs(monoPcm[i]);
          if (abs > monoMax) monoMax = abs;
        }

        console.log(`[voice:recv] Channel detection for ${userId}:`);
        console.log(`[voice:recv]   stereo: ${stereoPcm.length} samples, rms=${stereoRms.toFixed(1)}, max=${stereoMax}`);
        console.log(`[voice:recv]   mono:   ${monoPcm.length} samples, rms=${monoRms.toFixed(1)}, max=${monoMax}`);

        // Log first 40 samples of stereo decode to check interleaving
        const stereoSamples = Array.from(stereoPcm.slice(0, 40));
        console.log(`[voice:recv] First 40 stereo PCM: [${stereoSamples.join(', ')}]`);

        // Log first 20 samples of mono decode
        const monoSamples = Array.from(monoPcm.slice(0, 20));
        console.log(`[voice:recv] First 20 mono PCM: [${monoSamples.join(', ')}]`);

        // If stereo decode gives 1920 samples (expected), use stereo.
        // If it gives 960, it's actually mono.
        // Also: if mono RMS is much higher, the stream is likely mono.
        if (stereoPcm.length === MONO_FRAME_SAMPLES) {
          detectedChannels = 1;
          console.log(`[voice:recv] Detected MONO stream for ${userId} (stereo decode returned ${stereoPcm.length} samples, expected ${STEREO_FRAME_SAMPLES})`);
        } else if (monoRms > stereoRms * 2 && monoRms > 100) {
          detectedChannels = 1;
          console.log(`[voice:recv] Detected MONO stream for ${userId} (mono RMS ${monoRms.toFixed(1)} >> stereo RMS ${stereoRms.toFixed(1)})`);
        } else {
          detectedChannels = 2;
          console.log(`[voice:recv] Detected STEREO stream for ${userId} (${stereoPcm.length} samples)`);
        }

        channelsDetected = true;
        // Update the stream object's channels field
        stream.channels = detectedChannels;

        // Process this first packet with detected channels
        const pcm = detectedChannels === 2 ? stereoPcm : monoPcm;

        // Show the downsampled values
        const frame16k = downsampleToMono16k(pcm, detectedChannels);
        const f32Samples = Array.from(frame16k.slice(0, 10)).map(v => v.toFixed(6)).join(', ');
        console.log(`[voice:recv] First 10 VAD frame values (${detectedChannels}ch→16k): [${f32Samples}]`);

        if (DEBUG_DUMP) {
          rawPcmChunks.push(new Int16Array(pcm));
        }

        onRawPcm(pcm);
        onFrame(frame16k);
        return;
      }

      // Normal packet processing
      const pcm48k = decodeOpus(packet, detectedChannels);

      // Capture PCM for debug dump
      if (DEBUG_DUMP && packetCount <= DUMP_PACKETS) {
        rawPcmChunks.push(new Int16Array(pcm48k));
      }

      // Write debug dump after collecting enough packets
      if (DEBUG_DUMP && packetCount === DUMP_PACKETS && !dumpWritten) {
        dumpWritten = true;
        try {
          // Concatenate all PCM chunks
          const totalSamples = rawPcmChunks.reduce((sum, chunk) => sum + chunk.length, 0);
          const allPcm = new Int16Array(totalSamples);
          let offset = 0;
          for (const chunk of rawPcmChunks) {
            allPcm.set(chunk, offset);
            offset += chunk.length;
          }

          // Calculate overall stats
          let rms = 0, maxVal = 0, nonZero = 0;
          for (let i = 0; i < allPcm.length; i++) {
            rms += allPcm[i] * allPcm[i];
            const abs = Math.abs(allPcm[i]);
            if (abs > maxVal) maxVal = abs;
            if (allPcm[i] !== 0) nonZero++;
          }
          rms = Math.sqrt(rms / allPcm.length);

          console.log(`[voice:recv] 📊 DEBUG DUMP for ${userId}:`);
          console.log(`[voice:recv]   ${DUMP_PACKETS} packets → ${totalSamples} samples (${detectedChannels}ch @ 48kHz)`);
          console.log(`[voice:recv]   RMS=${rms.toFixed(1)}, Max=${maxVal}, NonZero=${nonZero}/${allPcm.length} (${(nonZero/allPcm.length*100).toFixed(1)}%)`);

          // Write raw 48kHz WAV (as decoded)
          const wavPath48k = `data/debug-audio-48k-${detectedChannels}ch-${userId}.wav`;
          writeWav(wavPath48k, allPcm, DISCORD_SAMPLE_RATE, detectedChannels);
          console.log(`[voice:recv]   Wrote raw 48kHz WAV: ${wavPath48k}`);

          // Also write downsampled 16kHz mono WAV
          const mono16k = downsampleToMono16kInt16(allPcm, detectedChannels);
          const wavPath16k = `data/debug-audio-16k-mono-${userId}.wav`;
          writeWav(wavPath16k, mono16k, VAD_SAMPLE_RATE, 1);
          console.log(`[voice:recv]   Wrote 16kHz mono WAV: ${wavPath16k}`);

          // Calculate 16k stats
          let rms16k = 0, max16k = 0;
          for (let i = 0; i < mono16k.length; i++) {
            rms16k += mono16k[i] * mono16k[i];
            const abs = Math.abs(mono16k[i]);
            if (abs > max16k) max16k = abs;
          }
          rms16k = Math.sqrt(rms16k / mono16k.length);
          console.log(`[voice:recv]   16kHz mono: ${mono16k.length} samples, RMS=${rms16k.toFixed(1)}, Max=${max16k}`);

          // Also save raw opus packets for external decode test
          const opusDumpPath = `data/debug-opus-${userId}.bin`;
          const opusParts: Buffer[] = [];
          for (const pkt of rawOpusPackets) {
            // Write 2-byte length prefix + packet data
            const lenBuf = Buffer.alloc(2);
            lenBuf.writeUInt16LE(pkt.length);
            opusParts.push(lenBuf, pkt);
          }
          fs.writeFileSync(opusDumpPath, Buffer.concat(opusParts));
          console.log(`[voice:recv]   Wrote raw opus dump: ${opusDumpPath} (${rawOpusPackets.length} packets)`);

        } catch (dumpErr) {
          console.error(`[voice:recv] Debug dump error: ${dumpErr}`);
        }
      }

      onRawPcm(pcm48k);
      const frame16k = downsampleToMono16k(pcm48k, detectedChannels);
      onFrame(frame16k);

      // Log audio level periodically (every 50 packets = ~1 second)
      if (packetCount % 50 === 0) {
        let rms = 0;
        let maxVal = 0;
        for (let i = 0; i < pcm48k.length; i++) {
          rms += pcm48k[i] * pcm48k[i];
          const abs = Math.abs(pcm48k[i]);
          if (abs > maxVal) maxVal = abs;
        }
        rms = Math.sqrt(rms / pcm48k.length);
        console.log(`[voice:recv] Audio level for ${userId} at packet #${packetCount}: rms=${rms.toFixed(1)}, max=${maxVal}, channels=${detectedChannels}`);
      }

      // Extra: log first 5 packets in detail
      if (packetCount <= 5) {
        console.log(`[voice:recv] Packet #${packetCount}: ${packet.length} opus bytes → ${pcm48k.length} PCM samples, first 10: [${Array.from(pcm48k.slice(0, 10)).join(', ')}]`);
      }
    } catch (err) {
      decodeErrors++;
      if (decodeErrors <= 3) {
        console.log(`[voice:recv] Opus decode error #${decodeErrors} for ${userId}: ${err}`);
      }
    }
  };

  const handleEnd = () => {
    if (ended) return;
    ended = true;
    console.log(`[voice:recv] Opus stream ended for ${userId} (total packets: ${packetCount})`);
    onStreamEnd?.();
  };

  opusStream.on("data", handleData);

  opusStream.on("close", () => {
    console.log(`[voice:recv] Opus stream closed for ${userId} (total packets: ${packetCount}, errors: ${decodeErrors})`);
    handleEnd();
  });

  opusStream.on("end", handleEnd);

  const destroy = () => {
    console.log(`[voice:recv] Destroying audio stream for ${userId} (total packets: ${packetCount})`);
    opusStream.removeListener("data", handleData);
    opusStream.destroy();
  };

  const stream: UserAudioStream = { userId, onFrame, onRawPcm, channels: detectedChannels, destroy };
  return stream;
}
