# Document Converter (Next.js)

Convert documents between PDF, DOCX, TXT, RTF, and ODT. Includes client-side PDF text extraction with OCR fallback and an optional server conversion path powered by LibreOffice.

Routes:
- UI: `/convert`
- Health: `/api/convert/health`
- Server conversion API: `/api/convert` (multipart/form-data)

## Features

- PDF → text extraction in the browser using pdfjs-dist; prompts for password if protected.
- OCR fallback with Tesseract.js for scanned/low-text PDF pages.
- PDF → DOCX “Preserve layout” option (embeds page images into DOCX for visual fidelity).
- Create simple TXT/RTF/DOCX/ODT/PDF from extracted text.
- Optional server conversion via LibreOffice for higher-fidelity non-PDF paths (e.g., DOCX → PDF). Includes a health check and UI diagnostics.
- Guardrails for unreliable free paths: PDF → DOCX/ODT server conversion is blocked; use client mode instead.

## Architecture

- Client-side: pdfjs-dist + Tesseract.js handle PDF text/OCR; docx/pdf-lib generate outputs. Works anywhere (including Vercel) without server dependencies.
- Server-side (optional): API routes call `libreoffice-convert` (requires LibreOffice installed on the host). A health endpoint reports availability to the UI.

## Requirements

- Node.js 18+ (Next.js 15). Recommend Node 18.18 or Node 20.
- Optional (for server conversion): LibreOffice installed on the host. The app can auto-try common paths or accept a configured `LIBREOFFICE_BIN`.

Supported OS for local server conversion:
- Windows 10/11 (e.g., `C:\\Program Files\\LibreOffice\\program\\soffice.exe`)
- macOS (`/Applications/LibreOffice.app/Contents/MacOS/soffice`)
- Linux (`/usr/bin/soffice` or `/usr/local/bin/soffice`)

## Getting Started (Local)

1) Install dependencies

```bash
npm install
```

2) (Optional) Configure LibreOffice path for server conversion

Create `.env.local` in the project root and set the binary path. Use quotes if the path contains spaces.

Windows (PowerShell):
```powershell
# Typical installation path
"LIBREOFFICE_BIN=C:\Program Files\LibreOffice\program\soffice.exe" | Out-File -Encoding utf8 -FilePath .env.local
```

macOS/Linux (bash):
```bash
printf '%s\n' 'LIBREOFFICE_BIN=/usr/bin/soffice' > .env.local
# or on macOS
# LIBREOFFICE_BIN=/Applications/LibreOffice.app/Contents/MacOS/soffice
```

You can verify the binary manually:

Windows (PowerShell):
```powershell
Test-Path 'C:\Program Files\LibreOffice\program\soffice.exe'
& 'C:\Program Files\LibreOffice\program\soffice.exe' --version
```

macOS/Linux:
```bash
soffice --version
```

3) Run the dev server

```bash
npm run dev
```

Open http://localhost:3000/convert and try a conversion. The “Server conversion status” banner shows whether the server-side LibreOffice path is healthy.

## Usage Tips

- To preserve visual formatting from PDFs, enable “Preserve layout” and convert PDF → DOCX (image-based; not easily editable).
- For editable output from PDFs, disable “Preserve layout” and convert to DOCX/TXT/RTF (formatting may be simplified).
- Server conversion (LibreOffice) is good for DOCX/RTF/ODT → PDF and similar. PDF → DOCX/ODT server conversions are blocked (unreliable in a free setup).
- Use the “Recheck” button in the health banner to re-run the server health probe after changing environment variables or installing LibreOffice.

## Health Check

- Endpoint: `GET /api/convert/health`
- Returns JSON with availability and a message. Example when healthy:

```json
{"ok":true,"server":{"available":true,"message":"LibreOffice is available for server conversion."}}
```

If unavailable, the message often includes an error from LibreOffice. Common Windows fixes:
- Ensure `.env.local` contains the exact path to `soffice.exe`.
- Restart the dev server after changing environment variables.

## Production Build

```bash
npm run build
npm start
```

## Deploying

### Vercel

This app deploys to Vercel like any Next.js project, but note:
- Vercel’s serverless runtime doesn’t include LibreOffice, so server-side conversions will be “Unavailable”. The UI will disable the server toggle automatically.
- Client-side conversions (including PDF extraction + OCR and “Preserve layout”) work fine on Vercel.

Steps:
1) Push this repo to GitHub.
2) Import the project in Vercel and deploy.
3) Visit `/convert` and use client-side conversion features.

If you need server-side conversion in production, use one of the options below.

### Alternatives for Server Conversion in Production

- Deploy to a VM/container with LibreOffice installed (e.g., Render, Railway, Fly.io, or your VPS):
  - Install OS packages for LibreOffice.
  - Set the `LIBREOFFICE_BIN` environment variable to the full path to `soffice`.
  - Run `npm run build && npm start`.
  - Verify `GET /api/convert/health` returns ok:true.
- Or run a separate microservice that exposes conversion via HTTP and point your app to it (not included here).

## Environment Variables

- `LIBREOFFICE_BIN` (recommended): Full path to `soffice` binary.
  - Windows example: `C:\\Program Files\\LibreOffice\\program\\soffice.exe`
  - macOS example: `/Applications/LibreOffice.app/Contents/MacOS/soffice`
  - Linux example: `/usr/bin/soffice`

The app also tries common default paths per OS if this variable is not set.

## Troubleshooting

- Health shows Unavailable on Windows:
  - Confirm `.env.local` path to `soffice.exe` is correct and quoted if needed.
  - Restart the dev server, click “Recheck,” and refresh `/api/convert/health`.

- Error ENOENT with a temp path (e.g., `.../health.pdf` or `.../source.odt.pdf`):
  - Usually means LibreOffice didn’t produce the expected output. Ensure `soffice` runs (check `--version`) and the path is correct.
  - The server now uses a base file name to avoid double extensions and includes retry logic; recheck health.

- PDF → DOCX/ODT server conversion blocked:
  - This is by design for reliability in a free setup. Use client conversion instead:
    - Editable text (formatting simplified), or
    - “Preserve layout” (image-based DOCX, visual fidelity, not easily editable).

## Tech Stack

- Next.js 15 (App Router), React 19, TypeScript
- Client: pdfjs-dist, Tesseract.js, docx, jszip, pdf-lib
- Server (optional): libreoffice-convert (requires LibreOffice)

## Project Structure

```
src/
  app/
    convert/
      page.tsx           # UI + client conversion
    api/
      convert/
        route.ts         # Server conversion via LibreOffice
      convert/health/
        route.ts         # Health check endpoint
```

---

If you run into issues, check the health endpoint and the console error messages surfaced by the UI. Most problems are path/installation related for LibreOffice.
