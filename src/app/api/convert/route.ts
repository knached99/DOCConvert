import { NextResponse } from 'next/server';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
export const runtime = 'nodejs';

type SupportedExt = '.pdf' | '.docx' | '.doc' | '.txt' | '.rtf' | '.odt';

// libreoffice-convert typings (the package exports a function in CJS)
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
		tmpOptions?: Record<string, unknown>;
		asyncOptions?: Record<string, unknown>;
		execOptions?: Record<string, unknown>;
		fileName?: string;
		sofficeBinaryPaths?: string[];
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
		// common Linux paths
		envPaths.push('/usr/bin/soffice', '/usr/local/bin/soffice');
	}
	// De-dup
	return Array.from(new Set(envPaths.filter(Boolean)));
}

export async function POST(req: Request) {
	try {
		const form = await req.formData();
		const file = form.get('file');
		const targetExt = (form.get('targetExt') as string | null)?.toLowerCase() as SupportedExt | null;
		const sourceExt = (form.get('sourceExt') as string | null)?.toLowerCase() as SupportedExt | null;
		if (!(file instanceof Blob) || !targetExt) {
			return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
		}

		const inputBuf = Buffer.from(await file.arrayBuffer());
	const uploadedName = (file as unknown as { name?: string })?.name ?? '';
	const safeUploaded = uploadedName.replace(/[^A-Za-z0-9_.-]+/g, '_');
	const uploadedExt = path.extname(safeUploaded);
	const baseName = path.basename(safeUploaded || 'source', uploadedExt || undefined) || 'source';
	const effectiveSourceExt = sourceExt || (uploadedExt ? (uploadedExt as SupportedExt) : null) || '.pdf';
	const inferredName = baseName; // avoid double extension like source.odt.pdf

		// Reject known-unsupported combinations early
		if ((sourceExt === '.pdf' || (/\.pdf$/i.test((file as any).name || ''))) && (targetExt === '.docx' || targetExt === '.odt')) {
			return NextResponse.json({ error: 'PDF to DOCX/ODT is not reliably supported by LibreOffice on the server. Use client conversion with Preserve layout or convert to TXT/RTF instead.' }, { status: 400 });
		}

		// Fully free server conversion using local LibreOffice (must be installed on host)
		try {
			const lcModule = await import('libreoffice-convert');
			const { convert, convertWithOptions } = getLibreOfficeFns(lcModule);
			if (!convert && !convertWithOptions) {
				return NextResponse.json({ error: 'libreoffice-convert module load failed' }, { status: 500 });
			}
			const target = targetExt.replace(/^\./, '');
			const sofficeBinaryPaths = resolveSofficeBinaryPaths();
			const options = { fileName: inferredName, sofficeBinaryPaths, execOptions: { windowsHide: true } } as const;
			let result: Buffer;
			if (convertWithOptions) {
				result = await new Promise<Buffer>((resolve, reject) =>
					convertWithOptions(
						inputBuf,
						target,
						undefined,
						{ ...options, asyncOptions: { times: 30, interval: 500 } },
						(err, res) => (err ? reject(err) : resolve(res as Buffer))
					)
				);
			} else {
				result = await new Promise<Buffer>((resolve, reject) =>
					(convert as LcConvert)(inputBuf, target, undefined, (err, res) =>
						err ? reject(err) : resolve(res as Buffer)
					)
				);
			}
			const mime =
				targetExt === '.pdf' ? 'application/pdf' :
				targetExt === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
				targetExt === '.doc' ? 'application/msword' :
				targetExt === '.rtf' ? 'application/rtf' :
				targetExt === '.odt' ? 'application/vnd.oasis.opendocument.text' :
				'application/octet-stream';
			const data = new Uint8Array(result); // copy to typed array
			return new NextResponse(data.buffer, {
				status: 200,
				headers: {
					'Content-Type': mime,
					'Content-Disposition': `attachment; filename="converted${targetExt}"`,
				},
			});
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			const hints: string[] = [];
			const paths = resolveSofficeBinaryPaths();
			if (/ENOENT/i.test(msg)) {
				hints.push('Output file not found. This often means soffice did not run or failed.');
				hints.push('Ensure LibreOffice is installed and soffice is on PATH, or set LIBREOFFICE_BIN to the full path to soffice.exe.');
			}
			hints.push(`Paths tried: ${paths.join(', ')}`);
			return NextResponse.json({ error: `LibreOffice conversion failed: ${msg}`, hints }, { status: 502 });
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Unexpected error';
		return NextResponse.json({ error: msg }, { status: 500 });
	}
}

export function GET() {
	return NextResponse.json({ ok: true }, { status: 200 });
}
