/**
 * Camera scanner — the till's fallback for when there is no USB scanner (or
 * the USB scanner is in another room). Opens the device camera, decodes
 * continuously, and stays open so a cashier can rattle through a basket.
 *
 * ZXing is imported lazily on first open: the main till bundle must not pay
 * for a capability a hardware-scanner terminal never uses, and the chunk stays
 * cached for the terminals that do.
 *
 * Decoding is restricted to the retail symbologies (EAN/UPC/Code128/Code39/ITF)
 * on purpose — a QR code on a shelf tag is a URL, not a product, and reading it
 * would put nonsense into the lookup.
 */

import { useEffect, useRef, useState } from 'react';
import { Flashlight, FlashlightOff, ScanLine } from 'lucide-react';
import { money } from '../../lib/format';
import { scanBeepError, scanBeepOk } from '../../lib/posAudio';
import type { ScanOutcome } from '../../pos/types';
import type { DecodeHintType } from '@zxing/library';
import { Badge, Button, EmptyState, IconButton, Modal, Select, Spinner } from './ui';

export interface CameraScannerProps {
  open: boolean;
  onClose: () => void;
  /** Same handler as the hardware scanner — one lookup, one cart, one beep. */
  onScan: (code: string) => Promise<ScanOutcome>;
}

type Phase = 'starting' | 'running' | 'error';

interface IScannerControls {
  stop: () => void;
  switchTorch?: (on: boolean) => Promise<void>;
  streamVideoCapabilitiesGet?: (
    filter: (track: MediaStreamTrack) => MediaStreamTrack[],
  ) => MediaTrackConstraints | undefined;
}

/** Symbols a till actually scans. QR and Datamatrix are deliberately excluded. */
const POSSIBLE_FORMATS = ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39', 'ITF'];

function describeCameraError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access was blocked. Allow the camera for this page, then press Retry.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera was found on this device. Plug one in, or use a hardware scanner or the search box.';
  }
  if (name === 'NotReadableError') {
    return 'The camera is in use by another program. Close it and press Retry.';
  }
  return error instanceof Error ? error.message : 'The camera could not be started.';
}

export function CameraScanner({ open, onClose, onScan }: CameraScannerProps) {
  const [phase, setPhase] = useState<Phase>('starting');
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<Array<{ id: string; label: string }>>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<ScanOutcome | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  /** Retry counter — re-runs the start effect when everything else is equal. */
  const [attempt, setAttempt] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    setPhase('starting');
    setError(null);
    setLastScan(null);
    setTorchOn(false);
    setTorchAvailable(false);

    void (async () => {
      try {
        // Lazy chunks: the decoders only reach the network on the first open.
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
          import('@zxing/browser'),
          import('@zxing/library'),
        ]);
        if (cancelled || !videoRef.current) return;

        const hints = new Map<DecodeHintType, unknown>();
        hints.set(
          DecodeHintType.POSSIBLE_FORMATS,
          POSSIBLE_FORMATS.map((name) => BarcodeFormat[name as keyof typeof BarcodeFormat]),
        );
        hints.set(DecodeHintType.TRY_HARDER, true);
        const reader = new BrowserMultiFormatReader(hints as Map<DecodeHintType, unknown>);

        // The same barcode in a steady frame is decoded over and over; only a
        // fresh read (different code, or the same one after a pause) counts.
        let lastCode = '';
        let lastAt = 0;

        const controls = (await reader.decodeFromVideoDevice(deviceId ?? undefined, videoRef.current, (result) => {
          if (cancelled || !result) return;
          const code = result.getText().trim();
          if (code === '') return;
          const now = Date.now();
          if (code === lastCode && now - lastAt < 1500) return;
          lastCode = code;
          lastAt = now;
          void onScanRef.current(code).then((outcome) => {
            if (outcome.status === 'added') scanBeepOk();
            else scanBeepError();
            setLastScan(outcome);
          });
        })) as IScannerControls;

        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;

        const capabilities = controls.streamVideoCapabilitiesGet?.((track) => (track.kind === 'video' ? [track] : []));
        setTorchAvailable(
          typeof controls.switchTorch === 'function' && Boolean((capabilities as { torch?: unknown } | undefined)?.torch),
        );

        // Labels are only visible once permission is granted, so enumerate
        // after the stream is up.
        const tracks = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const cameras = tracks
          .filter((device) => device.kind === 'videoinput')
          .map((device, index) => ({ id: device.deviceId, label: device.label || `Camera ${index + 1}` }));
        setDevices(cameras);
        setPhase('running');
      } catch (cause) {
        if (cancelled) return;
        setError(describeCameraError(cause));
        setPhase('error');
      }
    })();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [open, deviceId, attempt]);

  const toggleTorch = (): void => {
    const next = !torchOn;
    void controlsRef.current
      ?.switchTorch?.(next)
      .then(() => setTorchOn(next))
      .catch(() => setTorchAvailable(false));
  };

  return (
    <Modal
      open={open}
      title="Scan with camera"
      onClose={onClose}
      width="md"
      footer={
        <>
          {devices.length > 1 ? (
            <Select
              value={deviceId ?? ''}
              onChange={(event) => setDeviceId(event.target.value || null)}
              options={devices.map((device) => ({ value: device.id, label: device.label }))}
              placeholder="Camera"
              className="w-48"
              size="sm"
            />
          ) : null}
          {torchAvailable ? (
            <IconButton label={torchOn ? 'Turn light off' : 'Turn light on'} onClick={toggleTorch}>
              {torchOn ? <Flashlight size={15} strokeWidth={1.75} /> : <FlashlightOff size={15} strokeWidth={1.75} />}
            </IconButton>
          ) : null}
          <span className="text-[11px] text-[var(--text-tertiary)]">Point at a barcode — it stays open for the next item.</span>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-black">
          <video ref={videoRef} className="size-full object-cover" muted playsInline />

          {/* Reticle: a steady target the eye can hold while aiming. */}
          {phase === 'running' ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 m-auto h-24 w-52 rounded-[var(--radius-md)] border-2 border-white/80"
            />
          ) : null}

          {phase === 'starting' ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/90">
              <Spinner />
              <p className="text-[12px]">Starting camera…</p>
            </div>
          ) : null}

          {phase === 'error' ? (
            <div className="absolute inset-0 bg-[var(--bg-canvas)]">
              <EmptyState
                icon={<ScanLine size={24} strokeWidth={1.75} />}
                title="Camera unavailable"
                description={error ?? undefined}
                action={
                  <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
                    Retry
                  </Button>
                }
              />
            </div>
          ) : null}
        </div>

        <div className="flex min-h-[2rem] items-center gap-2">
          {lastScan === null ? (
            <span className="text-[12px] text-[var(--text-tertiary)]">Nothing scanned yet.</span>
          ) : lastScan.status === 'added' ? (
            <Badge tone="success" className="max-w-full">
              <span className="truncate">Added — {lastScan.product.name}</span>
              <span className="tabular shrink-0">{money(lastScan.product.price)}</span>
            </Badge>
          ) : (
            <Badge tone="danger">
              No product for code <span className="tabular">{lastScan.code}</span>
            </Badge>
          )}
        </div>
      </div>
    </Modal>
  );
}
