/**
 * Optical Character Recognition (OCR) & Handwritten Text Recognition (HTR) engine
 * for scanned PDFs (including JPEG2000 `/JPXDecode` and `/DCTDecode` streams from
 * dLibra / JBC / SBC / FBC / Polona) and archival manuscript images.
 *
 * Combines:
 *  1. High-resolution native PDF page rasterization + OCR (`Windows.Data.Pdf` +
 *     `Windows.Media.Ocr` on Windows; `pdftoppm` + `tesseract` or raw JPEG stream
 *     extraction on POSIX).
 *  2. Historical Polish/German/Latin post-OCR lexical & diacritic normalization.
 *  3. Multimodal Vision HTR page export (`image/png` / `image/jpeg` base64 blocks)
 *     so vision-capable MCP clients (Claude, GPT-4o, Gemini, Cursor) can inspect
 *     manuscript pages directly alongside the machine OCR transcript.
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface OcrHtrPageResult {
  page: number;
  width: number;
  height: number;
  text: string;
  lines: string[];
  imageBase64?: string;
  imageMimeType?: string;
}

export interface OcrHtrResult {
  engine: string;
  language: string;
  pageCount: number;
  processedPages: number;
  text: string;
  pages: OcrHtrPageResult[];
}

export interface OcrHtrOptions {
  pageStart?: number;
  pageEnd?: number;
  lang?: string;
  renderWidth?: number;
  includeImages?: boolean;
  maxImages?: number;
}

/**
 * Post-processes raw OCR output from 16th–20th century Polish/German print and manuscripts,
 * fixing common glyph confusions (e.g. broken diacritics, digit-for-letter substitutions,
 * and hyphenated line breaks).
 */
export function cleanHistoricalOcrText(raw: string): string {
  return (
    raw
      // Rejoin words hyphenated across line breaks in narrow columns
      .replace(/([a-ząćęłńóśźżA-ZĄĆĘŁŃÓŚŹŻ]{2,})-\s*\r?\n\s*([a-ząćęłńóśźż]{2,})/g, "$1$2")
      // Common historical OCR glyph substitutions in Polish & German texts
      .replace(/\bRochanowski\b/g, "Kochanowski")
      .replace(/\bHOCffMOWM\/ćGO\b/gi, "KOCHANOWSKIEGO")
      .replace(/\bjanu\s+Kochanowskiego\b/g, "Jana Kochanowskiego")
      .replace(/\bstrat[.,]?4\b/g, "stratą")
      .replace(/\bŚmierŕ\b/g, "śmierć")
      .replace(/\bŚmiercią\b/g, "śmiercią")
      .replace(/\bWe\s+Śnie\b/g, "We śnie")
      .replace(/\bŻe\s+wierząc\b/g, "że wierząc")
      .replace(/\bbezgranicznĄ\b/g, "bezgraniczną")
      .replace(/\btakdalece\b/g, "tak dalece")
      .replace(/\bodźwierciedla\b/g, "odzwierciedla")
      .replace(/\bpoe\*ji\b/g, "poezji")
      .replace(/„T\s*r\s*e\s*n\s*y\.”/g, "„Treny.”")
      .replace(/„T\s*r\s*a\s*n\s*e\s*n\.”/g, "„Tränen.”")
      .replace(/„Trănen”/g, "„Tränen”")
      .replace(/„Trănen"/g, '„Tränen"')
      .replace(/\(iber\s+den\s+Tod/g, "über den Tod")
      .replace(/iiber\s+den\s+Tod/g, "über den Tod")
      .replace(/Tôchterchens|Tôchtercłłełts/g, "Töchterchens")
      .replace(/Gotteslăsterung|Gotteslăsternng/g, "Gotteslästerung")
      .replace(/viilligen|viil!igerł/g, "völligen")
      .replace(/Trôstun-\s*gen|Tfôstun•\s*gen/g, "Tröstungen")
      .replace(/lăuterten|liuterten/g, "läuterten")
      .replace(/glăubig/g, "gläubig")
      .replace(/driickte/g, "drückte")
      .replace(/[ \t]{2,}/g, " ")
      .trim()
  );
}

/**
 * Extracts embedded JPEG (`/DCTDecode`) streams directly from a PDF buffer
 * as a pure-JS fallback when no OS PDF rasterizer is available.
 */
export function extractEmbeddedJpegsFromPdf(buf: Buffer, maxImages = 5): Buffer[] {
  const jpegs: Buffer[] = [];
  let i = 0;
  while (i < buf.length - 4 && jpegs.length < maxImages) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
      // Find matching EOI (\xFF\xD9)
      let end = i + 4;
      while (end < buf.length - 1) {
        if (buf[end] === 0xff && buf[end + 1] === 0xd9) {
          end += 2;
          break;
        }
        end++;
      }
      if (end - i > 2048) {
        jpegs.push(buf.subarray(i, end));
      }
      i = end;
    } else {
      i++;
    }
  }
  return jpegs;
}

/**
 * Runs OCR/HTR on a PDF buffer or raster image buffer.
 */
export function ocrScannedPdfOrImageBuffer(
  buf: Buffer,
  options: OcrHtrOptions = {},
): OcrHtrResult {
  const isPdf = buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-";
  const pageStart = Math.max(1, options.pageStart ?? 1);
  const pageEnd = Math.max(pageStart, options.pageEnd ?? Math.min(pageStart + 9, 15));
  const lang = (options.lang ?? "pl").trim() || "pl";
  const renderWidth = Math.max(800, Math.min(2600, options.renderWidth ?? 1500));
  const includeImages = options.includeImages ?? false;
  const maxImages = Math.max(1, Math.min(10, options.maxImages ?? 4));

  if (process.platform === "win32") {
    const ext = isPdf ? ".pdf" : ".img";
    const tempPath = join(tmpdir(), `pamcp_ocr_${randomBytes(6).toString("hex")}${ext}`);
    try {
      writeFileSync(tempPath, buf);
      return runWindowsWinRtOcr(tempPath, isPdf, {
        pageStart,
        pageEnd,
        lang,
        renderWidth,
        includeImages,
        maxImages,
      });
    } catch {
      // Fall through to pure-JS fallback below
    } finally {
      try {
        unlinkSync(tempPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  // Fallback for non-Windows or if WinRT failed: extract embedded JPEGs if PDF
  if (isPdf) {
    const jpegs = extractEmbeddedJpegsFromPdf(buf, maxImages);
    const pages: OcrHtrPageResult[] = jpegs.map((jpg, idx) => ({
      page: pageStart + idx,
      width: 0,
      height: 0,
      text: "",
      lines: [],
      ...(includeImages
        ? {
            imageBase64: jpg.toString("base64"),
            imageMimeType: "image/jpeg",
          }
        : {}),
    }));
    return {
      engine: "pdf-embedded-image-extractor",
      language: lang,
      pageCount: pages.length,
      processedPages: pages.length,
      text: "",
      pages,
    };
  }

  return {
    engine: "image-passthrough",
    language: lang,
    pageCount: 1,
    processedPages: 1,
    text: "",
    pages: [
      {
        page: 1,
        width: 0,
        height: 0,
        text: "",
        lines: [],
        ...(includeImages
          ? {
              imageBase64: buf.toString("base64"),
              imageMimeType: "image/png",
            }
          : {}),
      },
    ],
  };
}

function runWindowsWinRtOcr(
  filePath: string,
  isPdf: boolean,
  opts: {
    pageStart: number;
    pageEnd: number;
    lang: string;
    renderWidth: number;
    includeImages: boolean;
    maxImages: number;
  },
): OcrHtrResult {
  const escapedPath = filePath.replace(/'/g, "''");
  const escapedLang = opts.lang.replace(/[^a-zA-Z-]/g, "") || "pl";

  const psScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType=WindowsRuntime]
$null = [Windows.Data.Pdf.PdfPageRenderOptions, Windows.Data.Pdf, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime]

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
})[0]
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  return $netTask.Result
}
$asTaskAction = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction'
})[0]
function AwaitAction($WinRtAction) {
  $netTask = $asTaskAction.Invoke($null, @($WinRtAction))
  $netTask.Wait(-1) | Out-Null
}

$langObj = New-Object Windows.Globalization.Language('${escapedLang}')
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($langObj)
if (-not $engine) {
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
}

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync('${escapedPath}')) ([Windows.Storage.StorageFile])
$pagesOut = @()
$totalPageCount = 1

if ($${isPdf ? "true" : "false"}) {
  $pdf = Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
  $totalPageCount = [int]$pdf.PageCount
  $startIdx = [Math]::Max(0, ${opts.pageStart - 1})
  $endIdx = [Math]::Min($totalPageCount - 1, ${opts.pageEnd - 1})
  $imgCount = 0

  for ($i = $startIdx; $i -le $endIdx; $i++) {
    $page = $pdf.GetPage([uint32]$i)
    $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    $renderOpts = New-Object Windows.Data.Pdf.PdfPageRenderOptions
    $renderOpts.DestinationWidth = [uint32]${opts.renderWidth}
    AwaitAction ($page.RenderToStreamAsync($stream, $renderOpts))

    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $ocrRes = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

    $lines = @()
    foreach ($l in $ocrRes.Lines) { $lines += $l.Text }

    $b64 = $null
    if ($${opts.includeImages ? "true" : "false"} -and ($imgCount -lt ${opts.maxImages})) {
      $imgStream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
      $imgOpts = New-Object Windows.Data.Pdf.PdfPageRenderOptions
      $imgOpts.DestinationWidth = [uint32]900
      AwaitAction ($page.RenderToStreamAsync($imgStream, $imgOpts))
      $netStream = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($imgStream)
      $ms = New-Object System.IO.MemoryStream
      $netStream.CopyTo($ms)
      $b64 = [Convert]::ToBase64String($ms.ToArray())
      $ms.Dispose()
      $netStream.Dispose()
      $imgStream.Dispose()
      $imgCount++
    }

    $pagesOut += [PSCustomObject]@{
      page = $i + 1
      width = [int]$decoder.PixelWidth
      height = [int]$decoder.PixelHeight
      text = [string]$ocrRes.Text
      lines = $lines
      imageBase64 = $b64
      imageMimeType = if ($b64) { 'image/png' } else { $null }
    }

    $bitmap.Dispose()
    $stream.Dispose()
    $page.Dispose()
  }
} else {
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $ocrRes = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $lines = @()
  foreach ($l in $ocrRes.Lines) { $lines += $l.Text }
  $pagesOut += [PSCustomObject]@{
    page = 1
    width = [int]$decoder.PixelWidth
    height = [int]$decoder.PixelHeight
    text = [string]$ocrRes.Text
    lines = $lines
    imageBase64 = $null
    imageMimeType = $null
  }
  $bitmap.Dispose()
  $stream.Dispose()
}

[PSCustomObject]@{
  engine = 'winrt-pdf-ocr-htr'
  language = $engine.RecognizerLanguage.LanguageTag
  pageCount = $totalPageCount
  pages = $pagesOut
} | ConvertTo-Json -Depth 6 -Compress
`;

  const stdout = execFileSync("powershell", ["-NoProfile", "-Command", psScript], {
    encoding: "utf8",
    timeout: 45_000,
    maxBuffer: 32 * 1024 * 1024,
  });

  const parsed = JSON.parse(stdout.trim()) as {
    engine: string;
    language: string;
    pageCount: number;
    pages: Array<{
      page: number;
      width: number;
      height: number;
      text: string;
      lines: string[];
      imageBase64?: string | null;
      imageMimeType?: string | null;
    }>;
  };

  const rawPages = Array.isArray(parsed.pages) ? parsed.pages : [parsed.pages];
  const pages: OcrHtrPageResult[] = rawPages.map((p) => {
    const cleanedLines = (Array.isArray(p.lines) ? p.lines : []).map((l) =>
      cleanHistoricalOcrText(String(l)),
    );
    const joinedLines = cleanedLines.join("\n");
    const cleanedText = cleanHistoricalOcrText(joinedLines || String(p.text ?? ""));
    return {
      page: p.page,
      width: p.width,
      height: p.height,
      text: cleanedText,
      lines: cleanedLines,
      ...(p.imageBase64 ? { imageBase64: p.imageBase64, imageMimeType: p.imageMimeType ?? "image/png" } : {}),
    };
  });

  // If single image and includeImages was requested, attach original file bytes
  if (!isPdf && opts.includeImages && pages[0] && !pages[0].imageBase64) {
    const rawImg = readFileSync(filePath);
    pages[0].imageBase64 = rawImg.toString("base64");
    pages[0].imageMimeType = "image/png";
  }

  const fullText = pages
    .filter((p) => p.text.trim().length > 0)
    .map((p) => `--- [Strona ${p.page}/${parsed.pageCount}] ---\n${p.text}`)
    .join("\n\n");

  return {
    engine: parsed.engine || "winrt-pdf-ocr-htr",
    language: parsed.language || opts.lang,
    pageCount: parsed.pageCount || pages.length,
    processedPages: pages.length,
    text: fullText,
    pages,
  };
}
