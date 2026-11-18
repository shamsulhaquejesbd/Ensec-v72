import QRCode from 'qrcode';
import JSZip from 'jszip';
import type { FieldForceRep } from '../types/erp';

export interface EmployeeQrTokenMap {
  [employeeId: string]: string;
}

const tokenCache = new Map<string, string>();

const makeCacheKey = (id: string, code?: string) => `${String(id).trim()}::${String(code || '').trim()}`;

export function getCachedEmployeeQrToken(emp: Pick<FieldForceRep, 'id' | 'code'>): string | null {
  return tokenCache.get(makeCacheKey(emp.id, emp.code)) || null;
}

/**
 * Fetches permanent server-signed HMAC QR payloads for one or more employees.
 * The signed QR token encodes employeeId + employeeCode (never name alone) and
 * remains identical across sessions and restarts for the same employee record.
 */
export async function fetchEmployeeQrTokens(
  employees: Array<Pick<FieldForceRep, 'id' | 'code'>>,
  authHeaders: Record<string, string>
): Promise<EmployeeQrTokenMap> {
  const result: EmployeeQrTokenMap = {};
  const missing: Array<{ id: string; code: string }> = [];

  for (const emp of employees) {
    if (!emp?.id) continue;
    const key = makeCacheKey(emp.id, emp.code);
    const cached = tokenCache.get(key);
    if (cached) {
      result[emp.id] = cached;
    } else {
      missing.push({ id: String(emp.id), code: String(emp.code || emp.id) });
    }
  }

  if (missing.length === 0) {
    return result;
  }

  const resp = await fetch('/api/employees/qr-tokens', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({ employees: missing }),
  });

  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error(errBody?.error || `Failed to generate secure employee QR tokens (HTTP ${resp.status}).`);
  }

  const data = await resp.json();
  const serverTokens: Record<string, string> = data?.tokens || {};

  for (const emp of missing) {
    const token = serverTokens[emp.id];
    if (token) {
      tokenCache.set(makeCacheKey(emp.id, emp.code), token);
      result[emp.id] = token;
    }
  }

  return result;
}

export async function generateQrCodeDataUrl(payload: string, width = 320): Promise<string> {
  return QRCode.toDataURL(payload, {
    width,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function loadImageSafe(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let current = text;
  while (current.length > 3 && ctx.measureText(`${current}…`).width > maxWidth) {
    current = current.slice(0, -1);
  }
  return `${current}…`;
}

/**
 * Renders a crisp high-resolution downloadable PNG card with Employee ID, Name,
 * Department/Designation, and scannable QR code.
 */
export async function renderEmployeeQrBadgePngBlob(
  employee: FieldForceRep,
  qrToken: string,
  companyName = 'ENSEC ERP'
): Promise<Blob> {
  const width = 640;
  const height = 840;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context is not available.');
  }

  // White card background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Outer border
  drawRoundedRect(ctx, 16, 16, width - 32, height - 32, 28);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#cbd5e1';
  ctx.stroke();

  // Top Header Banner
  ctx.save();
  drawRoundedRect(ctx, 16, 16, width - 32, 136, 28);
  ctx.clip();
  const headerGrad = ctx.createLinearGradient(16, 16, width - 16, 152);
  headerGrad.addColorStop(0, '#0f172a');
  headerGrad.addColorStop(1, '#1e3a8a');
  ctx.fillStyle = headerGrad;
  ctx.fillRect(16, 16, width - 32, 136);
  ctx.restore();

  // Header text
  ctx.fillStyle = '#93c5fd';
  ctx.font = 'bold 18px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(truncateText(ctx, (companyName || 'ENSEC ERP').toUpperCase(), 540), width / 2, 64);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 26px system-ui, -apple-system, sans-serif';
  ctx.fillText('EMPLOYEE ATTENDANCE ID', width / 2, 102);

  // Employee Name & Role
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 34px system-ui, -apple-system, sans-serif';
  ctx.fillText(truncateText(ctx, employee.name || 'Employee', 560), width / 2, 208);

  ctx.fillStyle = '#475569';
  ctx.font = '600 20px system-ui, -apple-system, sans-serif';
  const roleLabel = employee.designation || 'Staff';
  ctx.fillText(truncateText(ctx, roleLabel, 560), width / 2, 242);

  // Employee ID Pill Box
  const codeText = `ID: ${employee.code || employee.id}`;
  ctx.font = 'bold 24px ui-monospace, SFMono-Regular, Menlo, monospace';
  const pillWidth = Math.min(440, Math.max(220, ctx.measureText(codeText).width + 56));
  const pillX = (width - pillWidth) / 2;
  drawRoundedRect(ctx, pillX, 266, pillWidth, 48, 12);
  ctx.fillStyle = '#eff6ff';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#93c5fd';
  ctx.stroke();

  ctx.fillStyle = '#1d4ed8';
  ctx.fillText(codeText, width / 2, 298);

  // QR Frame Box
  const qrBoxSize = 400;
  const qrBoxX = (width - qrBoxSize) / 2;
  const qrBoxY = 338;
  drawRoundedRect(ctx, qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 20);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#e2e8f0';
  ctx.stroke();

  const qrDataUrl = await generateQrCodeDataUrl(qrToken, 368);
  const qrImg = await loadImageSafe(qrDataUrl);
  if (qrImg) {
    ctx.drawImage(qrImg, qrBoxX + 16, qrBoxY + 16, 368, 368);
  }

  // Footer
  ctx.fillStyle = '#64748b';
  ctx.font = '600 17px system-ui, -apple-system, sans-serif';
  ctx.fillText('Scan at Attendance Terminal for Auto IN / OUT', width / 2, 774);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '500 14px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(`Permanent Key • ${employee.id}`, width / 2, 802);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to encode PNG image.'));
    }, 'image/png');
  });
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sanitizeFileSegment(val: string): string {
  return String(val || 'employee')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'employee';
}

export async function downloadSingleEmployeeQrPng(
  employee: FieldForceRep,
  qrToken: string,
  companyName?: string
): Promise<void> {
  const blob = await renderEmployeeQrBadgePngBlob(employee, qrToken, companyName);
  const filename = `${sanitizeFileSegment(employee.code || employee.id)}_${sanitizeFileSegment(employee.name)}_QR.png`;
  triggerBlobDownload(blob, filename);
}

export async function downloadBulkEmployeeQrZip(
  employees: FieldForceRep[],
  tokensById: EmployeeQrTokenMap,
  companyName?: string,
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  const zip = new JSZip();
  const folder = zip.folder('employee_qr_codes');
  const csvLines = ['Employee ID,Employee Name,Designation,Department,Status,Filename'];

  let processed = 0;
  const total = employees.length;

  for (const emp of employees) {
    const token = tokensById[emp.id];
    if (!token || !folder) continue;
    const filename = `${sanitizeFileSegment(emp.code || emp.id)}_${sanitizeFileSegment(emp.name)}_QR.png`;
    const blob = await renderEmployeeQrBadgePngBlob(emp, token, companyName);
    folder.file(filename, blob);
    csvLines.push(
      [
        `"${(emp.code || emp.id || '').replace(/"/g, '""')}"`,
        `"${(emp.name || '').replace(/"/g, '""')}"`,
        `"${(emp.designation || '').replace(/"/g, '""')}"`,
        `"${(emp.department || '').replace(/"/g, '""')}"`,
        `"${emp.status || (emp.isActive === false ? 'Inactive' : 'Active')}"`,
        `"${filename}"`,
      ].join(',')
    );
    processed += 1;
    onProgress?.(processed, total);
  }

  zip.file('employee_qr_index.csv', csvLines.join('\n'));
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const todayStr = new Date().toISOString().slice(0, 10);
  triggerBlobDownload(zipBlob, `ensec_employee_qr_codes_${todayStr}.zip`);
  return processed;
}
