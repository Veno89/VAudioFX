declare module 'wasm-media-encoders' {
  export function createEncoder(
    mime: 'audio/ogg' | 'audio/mpeg',
    wasm: string,
  ): Promise<{
    configure(options: {
      sampleRate: number;
      channels: number;
      vbrQuality?: number;
      bitrate?: number;
      outputSampleRate?: number;
    }): void;
    encode(channels: Float32Array[]): Uint8Array<ArrayBuffer>;
    finalize(): Uint8Array<ArrayBuffer>;
  }>;
}
