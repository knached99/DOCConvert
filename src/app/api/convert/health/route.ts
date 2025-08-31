import { NextResponse } from 'next/server';
import os from 'node:os';

export const runtime = 'nodejs';

type Health = {
  ok: boolean;
  server: { available: boolean; message?: string };
  details?: { bin?: string };
};

type LcConvert = (
  input: Buffer,
  targetFormat: string,
  filterOrOptions: unknown,
  callback: (err: Error | null, result?: Buffer) => void
) => void;

type LcConvertWithOptions = (
  input: Buffer,
  targetFormat: string,
  filter: string | undefined,
  options: {
    fileName?: string;
    sofficeBinaryPaths?: string[];
    tmpOptions?: Record<string, unknown>;
    asyncOptions?: Record<string, unknown>;
    execOptions?: Record<string, unknown>;
  } | undefined,
  callback: (err: Error | null, result?: Buffer) => void
) => void;

function getLibreOfficeFns(mod: unknown): { convert?: LcConvert; convertWithOptions?: LcConvertWithOptions } {
  if (typeof mod === 'function') return { convert: mod as LcConvert };
  if (mod && typeof mod === 'object') {
    const withDefault = mod as { default?: unknown };
    if (withDefault && typeof withDefault.default === 'function') return { convert: withDefault.default as LcConvert };
    const obj = mod as { convert?: unknown; convertWithOptions?: unknown };
    return {
      convert: typeof obj.convert === 'function' ? (obj.convert as LcConvert) : undefined,
      convertWithOptions: typeof obj.convertWithOptions === 'function' ? (obj.convertWithOptions as LcConvertWithOptions) : undefined,
    };
  }
  return {};
}

function resolveSofficeBinaryPaths(): string[] {
  const envPaths: string[] = [];
  const envBin = process.env.LIBREOFFICE_BIN || process.env.LIBRE_OFFICE_EXE || process.env.LIBRE_OFFICE_BIN;
  if (envBin && typeof envBin === 'string') envPaths.push(envBin);
  const platform = os.platform();
  if (platform === 'win32') {
    envPaths.push(
      'C\\Program Files\\LibreOffice\\program\\soffice.exe',
      'C\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
    );
  } else if (platform === 'darwin') {
    envPaths.push('/Applications/LibreOffice.app/Contents/MacOS/soffice');
  } else {
    envPaths.push('/usr/bin/soffice', '/usr/local/bin/soffice');
  }
  return Array.from(new Set(envPaths.filter(Boolean)));
}

export async function GET() {
  let available = false;
  let message = 'LibreOffice not detected. Install LibreOffice and ensure soffice is on PATH or set LIBREOFFICE_BIN.';
  try {
    const mod = await import('libreoffice-convert');
    const { convert, convertWithOptions } = getLibreOfficeFns(mod);
    if (convert || convertWithOptions) {
      try {
        const sample = Buffer.from('health-check');
        const sofficeBinaryPaths = resolveSofficeBinaryPaths();
        if (convertWithOptions) {
          await new Promise<Buffer>((resolve, reject) =>
            convertWithOptions(
              sample,
              'pdf',
              undefined,
              { fileName: 'health', sofficeBinaryPaths, asyncOptions: { times: 20, interval: 500 } },
              (err, res) => (err ? reject(err) : resolve(res as Buffer))
            )
          );
        } else if (convert) {
          await new Promise<Buffer>((resolve, reject) =>
            (convert as LcConvert)(sample, 'pdf', undefined, (err, res) => (err ? reject(err) : resolve(res as Buffer)))
          );
        }
        available = true;
        message = 'LibreOffice is available for server conversion.';
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        message = `LibreOffice convert failed: ${msg}`;
      }
    } else {
      message = 'libreoffice-convert module could not be loaded.';
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    message = `Health check error: ${msg}`;
  }

  const result: Health = {
    ok: available,
    server: { available, message },
  details: { bin: process.env.LIBREOFFICE_BIN },
  };
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
