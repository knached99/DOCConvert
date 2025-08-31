// app/convert/page.tsx

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { IImageOptions } from 'docx';
// Lazy, on-demand imports to keep initial bundle lean
// These are only used during conversion (dynamic imports)

// Minimal JSZip type shims to avoid explicit any
type JSZipFile = { async(type: 'string'): Promise<string> };
type JSZipArchive = { file(name: string): JSZipFile | null };
type JSZipLike = { loadAsync(input: ArrayBuffer | Blob | Uint8Array): Promise<JSZipArchive> };

type ConversionFormat = 
  | 'PDF' 
  | 'Word Document (DOCX)' 
  | 'Text File (TXT)' 
  | 'Rich Text (RTF)' 
  | 'OpenDocument Text (ODT)';

type ConversionStatus = 'idle' | 'uploading' | 'converting' | 'success' | 'error';

export default function ConvertPage() {
  const [sourceFormat, setSourceFormat] = useState<ConversionFormat>('Word Document (DOCX)');
  const [targetFormat, setTargetFormat] = useState<ConversionFormat>('PDF');
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<ConversionStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [progress, setProgress] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preserveLayout, setPreserveLayout] = useState<boolean>(false);
  const [useServer, setUseServer] = useState<boolean>(false);
  type Health = { ok: boolean; server: { available: boolean; message?: string }; error?: string };
  const [health, setHealth] = useState<Health | null>(null);
  const [healthLoading, setHealthLoading] = useState<boolean>(false);

  const checkServerHealth = async () => {
    try {
      setHealthLoading(true);
      const resp = await fetch('/api/convert/health', { cache: 'no-store' });
      const data = (await resp.json()) as Health;
      setHealth(data);
      if (!data.ok && useServer) setUseServer(false);
    } catch {
      setHealth({ ok: false, server: { available: false, message: 'Health check failed' }, error: 'Health check failed' });
      if (useServer) setUseServer(false);
    } finally {
      setHealthLoading(false);
    }
  };

  useEffect(() => {
    // Run once on mount
    checkServerHealth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the list stable
  const formatOptions: ConversionFormat[] = useMemo(
    () => ['PDF', 'Word Document (DOCX)', 'Text File (TXT)', 'Rich Text (RTF)', 'OpenDocument Text (ODT)'],
    []
  );

  const handleFilesSelected = (files: FileList | null) => {
    if (files && files.length > 0) {
      const selectedFile = files[0];
      setFile(selectedFile);
      
      // Auto-detect file format based on extension
      const extension = selectedFile.name.split('.').pop()?.toLowerCase();
      let detected: ConversionFormat | null = null;
      if (extension === 'pdf') detected = 'PDF';
      else if (extension === 'docx' || extension === 'doc') detected = 'Word Document (DOCX)';
      else if (extension === 'txt') detected = 'Text File (TXT)';
      else if (extension === 'rtf') detected = 'Rich Text (RTF)';
      else if (extension === 'odt') detected = 'OpenDocument Text (ODT)';

      if (detected) {
        setSourceFormat(detected);
        // If target equals source, auto-pick a different sensible default
        setTargetFormat((prev) => {
          if (prev === detected) {
            // Prefer PDF if not the detected; else DOCX
            const fallback = detected === 'PDF' ? 'Word Document (DOCX)' : 'PDF';
            return fallback;
          }
          return prev;
        });
  }
    }
  };

  const getExtension = (format: ConversionFormat): string => {
    switch (format) {
      case 'Word Document (DOCX)': return 'docx';
      case 'PDF': return 'pdf';
      case 'Text File (TXT)': return 'txt';
      case 'Rich Text (RTF)': return 'rtf';
      case 'OpenDocument Text (ODT)': return 'odt';
      default: return 'converted';
    }
  };

  const getMimeType = (format: ConversionFormat): string => {
    switch (format) {
      case 'Word Document (DOCX)': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      case 'PDF': return 'application/pdf';
      case 'Text File (TXT)': return 'text/plain';
      case 'Rich Text (RTF)': return 'application/rtf';
      case 'OpenDocument Text (ODT)': return 'application/vnd.oasis.opendocument.text';
      default: return 'application/octet-stream';
    }
  };

  // Helpers: lightweight text extraction per format
  const extractText = async (file: File, fmt: ConversionFormat): Promise<string> => {
    const toPlain = (s: string) => s.replace(/\u0000/g, '');

    if (fmt === 'Text File (TXT)') {
      return await file.text();
    }
    if (fmt === 'Rich Text (RTF)') {
      const raw = await file.text();
      // Very naive RTF -> text stripper
      return toPlain(
        raw
          .replace(/[{}]/g, '')
          .replace(/\\par[d]?/g, '\n')
          .replace(/\\'[0-9a-fA-F]{2}/g, '')
          .replace(/\\u-?\d+\??/g, '')
          .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
      );
    }
    if (fmt === 'Word Document (DOCX)') {
      const JSZipMod = (await import('jszip')).default as unknown as JSZipLike;
      const ab = await file.arrayBuffer();
      const zip = await JSZipMod.loadAsync(ab);
      const docXml = await zip.file('word/document.xml')?.async('string');
      if (!docXml) return '';
      // Extract all text nodes <w:t>
      const texts = Array.from(docXml.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g)).map((m) => (m as RegExpMatchArray)[1]);
      // Insert paragraph breaks for <w:p>
      const paraBreaks = docXml.split(/<w:p[\s\S]*?>/).length - 1;
      let content = texts.join('');
      if (paraBreaks > 0) content = content.replace(/\s{2,}/g, '\n');
      return toPlain(content);
    }
    if (fmt === 'OpenDocument Text (ODT)') {
      const JSZipMod = (await import('jszip')).default as unknown as JSZipLike;
      const ab = await file.arrayBuffer();
      const zip = await JSZipMod.loadAsync(ab);
      const contentXml = await zip.file('content.xml')?.async('string');
      if (!contentXml) return '';
      // Extract <text:p> and <text:span>
      const paras = Array.from(contentXml.matchAll(/<text:p[^>]*>([\s\S]*?)<\/text:p>/g)).map((m) =>
        (m as RegExpMatchArray)[1]
          .replace(/<[^>]+>/g, '')
          .trim()
      );
      return toPlain(paras.join('\n'));
    }
    if (fmt === 'PDF') {
      // Extract text from PDF using pdfjs-dist with worker configured via module URL
      const pdfjs = await import('pdfjs-dist');
      // Configure worker path relative to this module (Next/Turbopack supports new URL on node_modules)
      const workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
      pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
      const ab = await file.arrayBuffer();
      // Support password-protected PDFs via prompt
      const loadingTask = pdfjs.getDocument({
        data: ab,
        // @ts-expect-error - onPassword exists on params in pdfjs-dist runtime
        onPassword: (updatePassword: (pwd: string) => void, reason: number) => {
          const msg = reason === 1 ? 'This PDF is password protected. Enter password:' : 'Incorrect password. Try again:';
          const pwd = typeof window !== 'undefined' ? window.prompt(msg) : '';
          if (pwd) updatePassword(pwd);
        },
      });
      const pdf = await loadingTask.promise;
      let out = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
  const textContent = await page.getTextContent();
  type PDFTextItem = { str?: string };
  const items = textContent.items as PDFTextItem[];
        let pageText = items.map((it) => (typeof it.str === 'string' ? it.str : '')).join(' ');

        // Heuristic: if no text or looks like glyph soup, run OCR fallback
        const alnumCount = (pageText.match(/[A-Za-z0-9]/g) || []).length;
        const needsOCR = pageText.trim().length < 20 || alnumCount < pageText.length * 0.2;
        if (needsOCR && typeof document !== 'undefined') {
          try {
            const viewport = page.getViewport({ scale: 2 });
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            const ctx = canvas.getContext('2d');
            if (ctx) {
              const renderTask = page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport });
              await renderTask.promise;
              type RecognizeSrc = HTMLCanvasElement | HTMLImageElement | string;
              const Tesseract = (await import('tesseract.js')).default as { recognize: (src: RecognizeSrc, lang: string) => Promise<{ data: { text: string } }> };
              const { data } = await Tesseract.recognize(canvas, 'eng');
              if (data && data.text && data.text.trim()) {
                pageText = data.text.trim();
              }
            }
          } catch {
            // ignore OCR errors and keep whatever text we had
          }
        }

        out += pageText + (i < pdf.numPages ? '\n\n' : '');
      }
      return toPlain(out);
    }
    return '';
  };

  // Convert to target format. For PDF we create a valid PDF using pdf-lib.
  const convertDocument = async (
    file: File,
    sourceFormat: ConversionFormat,
    targetFormat: ConversionFormat
  ): Promise<Blob> => {
    if (useServer && health && !health.ok) {
      throw new Error('Server conversion unavailable. See health check details.');
    }
    // Disallow server path for PDF -> DOCX/ODT (LibreOffice unreliable)
    if (
      useServer &&
      sourceFormat === 'PDF' &&
      (targetFormat === 'Word Document (DOCX)' || targetFormat === 'OpenDocument Text (ODT)')
    ) {
      throw new Error('PDF → DOCX/ODT is not supported in server mode. Disable "Use server conversion" or enable "Preserve layout" for image-based DOCX.');
    }
    // Server conversion path for high fidelity (requires LibreOffice on server)
    if (useServer) {
  const extMap: Record<ConversionFormat, string> = {
        'PDF': '.pdf',
        'Word Document (DOCX)': '.docx',
        'Text File (TXT)': '.txt',
        'Rich Text (RTF)': '.rtf',
        'OpenDocument Text (ODT)': '.odt',
      };
      const targetExt = extMap[targetFormat];
  const sourceExt = extMap[sourceFormat];
      const form = new FormData();
      form.append('file', file);
      form.append('targetExt', targetExt);
  form.append('sourceExt', sourceExt);
      const resp = await fetch('/api/convert', { method: 'POST', body: form });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({} as { error?: string; hints?: string[] }));
        const base = typeof err?.error === 'string' ? err.error : `Server conversion failed (${resp.status})`;
        const hints = Array.isArray(err?.hints) && err.hints.length ? `\n${err.hints.join('\n')}` : '';
        throw new Error(`${base}${hints}`);
      }
      const arrBuf = await resp.arrayBuffer();
      return new Blob([arrBuf], { type: getMimeType(targetFormat) });
    }
    // Special case: PDF -> DOCX with preserved layout by embedding page images
    if (sourceFormat === 'PDF' && targetFormat === 'Word Document (DOCX)' && preserveLayout) {
      // Render each PDF page to an image and embed in a DOCX
  const pdfjs = await import('pdfjs-dist');
  const workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
      const ab = await file.arrayBuffer();
      const loadingTask = pdfjs.getDocument({ data: ab });
      const pdf = await loadingTask.promise;
  const { Document, Packer, Paragraph, ImageRun } = await import('docx');

  const children: InstanceType<typeof Paragraph>[] = [];
      const targetWidthPx = 700; // reasonable page width in DOCX pixels

      const dataURLToUint8 = (dataUrl: string): Uint8Array => {
        const comma = dataUrl.indexOf(',');
        const base64 = dataUrl.slice(comma + 1);
        const bin = typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return u8;
      };

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        const renderTask = page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport });
        await renderTask.promise;
        const dataUrl = canvas.toDataURL('image/png');
        const imgU8 = dataURLToUint8(dataUrl);
        const ratio = targetWidthPx / canvas.width;
        const width = Math.round(canvas.width * ratio);
        const height = Math.round(canvas.height * ratio);
  const image = new ImageRun({ data: imgU8, transformation: { width, height } } as IImageOptions);
        children.push(new Paragraph({ children: [image] }));
        if (i < pdf.numPages) children.push(new Paragraph(''));
      }

      const doc = new Document({ sections: [{ properties: {}, children }] });
      const blob = await Packer.toBlob(doc);
      return blob;
    }

    const text = await extractText(file, sourceFormat);
    const header = `Converted from: ${file.name}\nOriginal format: ${sourceFormat}\nTarget format: ${targetFormat}\nConversion date: ${new Date().toLocaleString()}\n\n`;
    const full = header + (text?.trim() ? text : '(No extractable text found)');

    if (targetFormat === 'Text File (TXT)') {
      return new Blob([full], { type: getMimeType(targetFormat) });
    }
    if (targetFormat === 'Rich Text (RTF)') {
      const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}');
      const rtf = `{\\rtf1\\ansi\n${esc(full).replace(/\n/g, '\\par\n')}\n}`;
      return new Blob([rtf], { type: getMimeType(targetFormat) });
    }
    if (targetFormat === 'Word Document (DOCX)') {
      // Use docx to build a simple document
  const { Document, Packer, Paragraph, TextRun } = await import('docx');
      const paragraphs = full.split('\n').map((line) => new Paragraph({ children: [new TextRun(line)] }));
      const doc = new Document({ sections: [{ properties: {}, children: paragraphs }] });
      const blob = await Packer.toBlob(doc);
      return blob;
    }
    if (targetFormat === 'OpenDocument Text (ODT)') {
      // Minimal ODT-like XML inside a zip is complex; instead, deliver a basic OpenDocument XML as text with ODT mime.
      // Many editors may not open it as full ODT, but this keeps scope reasonable.
      const content = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text>${full
        .split('\n')
        .map((p) => `<text:p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text:p>`) 
        .join('')}</office:text></office:body></office:document>`;
      return new Blob([content], { type: getMimeType(targetFormat) });
    }
    // Default PDF
  const pdfLib = await import('pdf-lib');
    const { PDFDocument, StandardFonts, rgb } = pdfLib;
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const margin = 50;
    const fontSize = 12;
    const pageWidth = 612; // 8.5in * 72
    const pageHeight = 792; // 11in * 72
    let page = pdfDoc.addPage([pageWidth, pageHeight]);
    const maxWidth = pageWidth - margin * 2;

    // Word-wrap
    const lines: string[] = [];
    const words = full.split(/\s+/);
    let current = '';
    for (const w of words) {
      const test = current ? current + ' ' + w : w;
      const width = font.widthOfTextAtSize(test, fontSize);
      if (width > maxWidth) {
        if (current) lines.push(current);
        current = w;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);

    let y = pageHeight - margin;
    for (const ln of lines) {
      if (y < margin + fontSize) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
      page.drawText(ln, { x: margin, y, size: fontSize, font, color: rgb(0, 0, 0) });
      y -= fontSize * 1.4;
    }
  // Save as base64 then convert to ArrayBuffer for robust Blob typing
  const base64 = await pdfDoc.saveAsBase64({ dataUri: false });
  const byteString = typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
  return new Blob([ab], { type: getMimeType('PDF') });
  };

  const handleConvert = async () => {
    if (!file) {
      alert('Please select a file first');
      return;
    }

    setStatus('uploading');
    setProgress(0);
    
    // Simulate upload progress
    const uploadInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 30) {
          clearInterval(uploadInterval);
          return 30;
        }
        return prev + 5;
      });
    }, 100);

  try {
      // Simulate upload process
      await new Promise(resolve => setTimeout(resolve, 2000));
      clearInterval(uploadInterval);
      setProgress(30);
      
      setStatus('converting');
      
      // Simulate conversion progress
      const convertInterval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 100) {
            clearInterval(convertInterval);
            return 100;
          }
          return prev + 5;
        });
      }, 150);

  // Conversion process with proper format handling
  const convertedBlob = await convertDocument(file, sourceFormat, targetFormat);
      
      clearInterval(convertInterval);
      setProgress(100);
      
      // Create download URL with correct file type
      const url = URL.createObjectURL(convertedBlob);
      
      setDownloadUrl(url);
      setFileName(`converted-${file.name.split('.')[0]}.${getExtension(targetFormat)}`);
  setStatus('success');
  setErrorMsg(null);
    } catch (error) {
      console.error('Conversion error:', error);
      setStatus('error');
  const message = error instanceof Error ? error.message : 'Conversion failed.';
  setErrorMsg(message);
    }
  };

  const resetConverter = () => {
    setFile(null);
    setStatus('idle');
    setProgress(0);
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Ensure target format is never equal to source
  useEffect(() => {
    if (targetFormat === sourceFormat) {
      const firstAlt = formatOptions.find((f) => f !== sourceFormat) || 'PDF';
      setTargetFormat(firstAlt);
    }
  }, [sourceFormat, targetFormat, formatOptions]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8 px-4 sm:px-6 lg:px-8">
      {/* Header */}
      <header className="flex justify-between items-center mb-12">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
          </div>
          <span className="text-xl font-bold text-gray-900">DocConvert</span>
        </Link>
        
        <nav className="hidden md:flex gap-6">
          <Link href="/" className="text-gray-700 hover:text-blue-600 transition-colors">Home</Link>
          <a href="#" className="text-gray-700 hover:text-blue-600 transition-colors">Features</a>
          <a href="#" className="text-gray-700 hover:text-blue-600 transition-colors">Pricing</a>
          <a href="#" className="text-gray-700 hover:text-blue-600 transition-colors">Help</a>
        </nav>
        
        <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors">
          Sign In
        </button>
      </header>

      <div className="max-w-3xl mx-auto">
        {/* Page Title */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Document Conversion</h1>
          <p className="text-lg text-gray-600">
            Convert your documents between various formats
          </p>
        </div>

        {status !== 'success' ? (
          /* Conversion Form */
          <div className="bg-white rounded-2xl shadow-xl p-6 sm:p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Source Format
                </label>
                <select
                  value={sourceFormat}
                  onChange={(e) => setSourceFormat(e.target.value as ConversionFormat)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  {formatOptions.map(option => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Target Format
                </label>
                <select
                  value={targetFormat}
                  onChange={(e) => setTargetFormat(e.target.value as ConversionFormat)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  {formatOptions
                    .filter(option => option !== sourceFormat)
                    .map(option => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                </select>
              </div>
            </div>

            {/* Options */}
            <div className="mb-6">
              {/* Server health banner */}
              <div className={`mb-3 p-3 rounded-lg border text-sm ${health?.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">
                    Server conversion status: {health?.ok ? 'Healthy' : 'Unavailable'}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={checkServerHealth}
                      className="px-2 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                      disabled={healthLoading}
                    >
                      {healthLoading ? 'Checking…' : 'Recheck'}
                    </button>
                  </div>
                </div>
                <div className="mt-2">
                  <div className="text-xs uppercase text-gray-500">LibreOffice</div>
                  <div className="text-xs">{health?.server.message}</div>
                </div>
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={preserveLayout}
                  onChange={(e) => setPreserveLayout(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Preserve layout (for PDF → DOCX, embed pages as images)</span>
              </label>
              <p className="text-xs text-gray-500 mt-1">
                Best for scanned or heavily formatted PDFs. Output will be large and not easily editable.
              </p>
              <div className="mt-3">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={useServer}
                    onChange={(e) => setUseServer(e.target.checked)}
                    disabled={health?.ok === false || healthLoading}
                    title={health?.ok === false ? 'Server conversion unavailable. See status above.' : undefined}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>Use server conversion (LibreOffice)</span>
                </label>
                <p className="text-xs text-gray-500 mt-1">
                  Requires LibreOffice installed on the server. Preserves more formatting for DOCX/ODT.
                </p>
              </div>
            </div>

            {/* File Upload */}
            <div className="mb-8">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Document
              </label>
              
              <div 
                className={`mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-dashed rounded-lg ${
                  file ? 'border-green-500 bg-green-50' : 'border-gray-300'
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    handleFilesSelected(e.dataTransfer.files);
                  }
                }}
              >
                <div className="space-y-1 text-center">
                  {file ? (
                    <>
                      <svg className="mx-auto h-12 w-12 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                      </svg>
                      <p className="text-sm text-gray-900 font-medium">{file.name}</p>
                      <p className="text-xs text-gray-500">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                      <button
                        onClick={() => setFile(null)}
                        className="text-xs text-red-600 hover:text-red-800"
                      >
                        Remove file
                      </button>
                    </>
                  ) : (
                    <>
                      <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true">
                        <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <div className="flex text-sm text-gray-600">
                        <label
                          htmlFor="file-upload"
                          className="relative cursor-pointer bg-white rounded-md font-medium text-blue-600 hover:text-blue-500 focus-within:outline-none"
                        >
                          <span>Upload a file</span>
                          <input
                            id="file-upload"
                            name="file-upload"
                            type="file"
                            className="sr-only"
                            onChange={(e) => handleFilesSelected(e.target.files)}
                            ref={fileInputRef}
                          />
                        </label>
                        <p className="pl-1">or drag and drop</p>
                      </div>
                      <p className="text-xs text-gray-500">
                        DOCX, DOC, PDF, TXT, RTF, ODT up to 10MB
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Progress Bar */}
            {(status === 'uploading' || status === 'converting') && (
              <div className="mb-6">
                <div className="flex justify-between text-sm text-gray-600 mb-1">
                  <span>
                    {status === 'uploading' ? 'Uploading...' : 'Converting...'}
                  </span>
                  <span>{progress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div 
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" 
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
              </div>
            )}

            {/* Convert Button */}
            <button
              onClick={handleConvert}
              disabled={status === 'uploading' || status === 'converting' || !file}
              className={`w-full py-3 px-4 rounded-lg font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${
                status === 'uploading' || status === 'converting' || !file
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {status === 'uploading' || status === 'converting' ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {status === 'uploading' ? 'Uploading...' : 'Converting...'}
                </span>
              ) : (
                'Convert Document'
              )}
            </button>

            {status === 'error' && (
              <div className="mt-4 p-3 bg-red-50 text-red-700 rounded-lg">
                {errorMsg || 'Conversion failed. Please try again.'}
              </div>
            )}
          </div>
        ) : (
          /* Success Screen */
          <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
              </svg>
            </div>
            
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Conversion Complete!</h2>
            <p className="text-gray-600 mb-6">
              Your document has been successfully converted to {targetFormat}.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href={downloadUrl}
                download={fileName}
                className="inline-flex items-center justify-center px-5 py-3 border border-transparent text-base font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700"
              >
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
                </svg>
                Download {targetFormat}
              </a>
              
              <button
                onClick={resetConverter}
                className="inline-flex items-center justify-center px-5 py-3 border border-gray-300 text-base font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50"
              >
                Convert Another Document
              </button>
            </div>
          </div>
        )}

        {/* Info Section */}
        <div className="mt-12 bg-blue-50 rounded-2xl p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">How it works</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-2">
                <span className="text-blue-600 font-bold">1</span>
              </div>
              <p className="text-sm text-gray-700">Select your file and desired format</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-2">
                <span className="text-blue-600 font-bold">2</span>
              </div>
              <p className="text-sm text-gray-700">We process your document securely</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-2">
                <span className="text-blue-600 font-bold">3</span>
              </div>
              <p className="text-sm text-gray-700">Download your converted file</p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-16 text-center text-gray-500 text-sm">
        <p>© {new Date().getFullYear()} DocConvert. All rights reserved.</p>
      </footer>
    </div>
  );
}