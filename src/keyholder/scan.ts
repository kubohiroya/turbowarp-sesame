/**
 * Reading a sharing QR code from the camera.
 *
 * This runs only in a top-level window on the keyholder origin. The `camera`
 * Permissions Policy defaults to an allowlist of `self`, and the QR code
 * carries the device secret in cleartext, so neither the frame nor the
 * TurboWarp page may do this.
 *
 * Decoding uses the platform's own barcode support where it exists — macOS,
 * Android, and ChromeOS. No third-party decoder is bundled: this page holds a
 * door key, and the less code that runs beside it the better. Elsewhere the
 * person pastes the text their own QR reader produced, which is a worse
 * experience but not a worse outcome.
 */

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?(): Promise<string[]>;
}

/** Whether this platform can decode a QR code from the camera. */
export async function isScanningSupported(): Promise<boolean> {
  const constructor = detectorConstructor();
  if (constructor === undefined) return false;
  try {
    const formats = (await constructor.getSupportedFormats?.()) ?? ["qr_code"];
    return formats.includes("qr_code");
  } catch {
    return false;
  }
}

export interface ScanHandle {
  /** Resolves with the decoded text, or rejects if cancelled or timed out. */
  readonly result: Promise<string>;
  /** The live camera stream, for the caller to display. */
  readonly stream: MediaStream;
  cancel(): void;
}

/**
 * Opens the camera and resolves with the first QR code seen.
 *
 * The caller owns displaying {@link ScanHandle.stream}; showing the operator
 * what the camera sees is what lets them aim it. The stream is stopped however
 * the scan ends.
 */
export async function scanQrCode(
  timeoutMs = 60_000,
  intervalMs = 200,
): Promise<ScanHandle> {
  const constructor = detectorConstructor();
  if (constructor === undefined) {
    throw new Error(
      "This browser cannot read a QR code from the camera. Paste the code's text instead.",
    );
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
  });

  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();

  const detector = new constructor({ formats: ["qr_code"] });
  let stop = (): void => undefined;

  const result = new Promise<string>((resolve, reject) => {
    const finish = (action: () => void): void => {
      stop();
      action();
    };
    const timer = setTimeout(() => {
      finish(() => {
        reject(new Error("No QR code was found. Try again."));
      });
    }, timeoutMs);
    const poll = setInterval(() => {
      void (async () => {
        try {
          const found = await detector.detect(video);
          const text = found[0]?.rawValue;
          if (text !== undefined && text.length > 0) {
            finish(() => {
              resolve(text);
            });
          }
        } catch {
          // A frame that cannot be decoded is ordinary; keep looking.
        }
      })();
    }, intervalMs);

    stop = () => {
      clearTimeout(timer);
      clearInterval(poll);
      for (const track of stream.getTracks()) track.stop();
      video.srcObject = null;
    };
  });

  return {
    result,
    stream,
    cancel: () => {
      stop();
    },
  };
}

function detectorConstructor(): BarcodeDetectorConstructor | undefined {
  return (globalThis as { BarcodeDetector?: BarcodeDetectorConstructor })
    .BarcodeDetector;
}
