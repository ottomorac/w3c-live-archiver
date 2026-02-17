#!/usr/bin/env node

/**
 * Simple test script to send audio to the gateway
 * Usage: node test-audio-sender.js [audio-file.raw]
 */

const WebSocket = require('ws');
const fs = require('fs');

const GATEWAY_URL = process.env.GATEWAY_WS_URL || 'ws://localhost:8080';
const audioFile = process.argv[2];

if (!audioFile) {
  console.log('Usage: node test-audio-sender.js <audio-file.raw>');
  console.log('');
  console.log('Audio file must be 16kHz, mono, 16-bit linear PCM');
  console.log('');
  console.log('To generate test audio with ffmpeg:');
  console.log('  ffmpeg -i input.mp3 -ar 16000 -ac 1 -f s16le output.raw');
  process.exit(1);
}

if (!fs.existsSync(audioFile)) {
  console.error(`Error: File not found: ${audioFile}`);
  process.exit(1);
}

const ws = new WebSocket(GATEWAY_URL);

ws.on('open', () => {
  console.log(`Connected to gateway at ${GATEWAY_URL}`);
  console.log(`Sending audio file: ${audioFile}`);

  const audio = fs.readFileSync(audioFile);
  console.log(`Audio size: ${audio.length} bytes`);

  // Send audio in chunks (simulating real-time streaming)
  const CHUNK_SIZE = 3200; // 100ms of audio at 16kHz mono 16-bit
  let offset = 0;

  const interval = setInterval(() => {
    if (offset >= audio.length) {
      clearInterval(interval);
      console.log('Finished sending audio');
      setTimeout(() => {
        ws.close();
        process.exit(0);
      }, 1000);
      return;
    }

    const chunk = audio.slice(offset, offset + CHUNK_SIZE);
    ws.send(chunk);
    offset += CHUNK_SIZE;

    const progress = ((offset / audio.length) * 100).toFixed(1);
    process.stdout.write(`\rProgress: ${progress}%`);
  }, 100); // Send every 100ms
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('\nConnection closed');
});
