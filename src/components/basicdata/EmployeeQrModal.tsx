import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileArchive,
  Loader2,
  Printer,
  QrCode,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { FieldForceRep } from '../../types/erp';
import { useERP } from '../../context/ERPContext';
import {
  downloadBulkEmployeeQrZip,
  downloadSingleEmployeeQrPng,
  fetchEmployeeQrTokens,
  generateQrCodeDataUrl,
} from '../../lib/employeeQr';

interface SingleQrModalProps {
  isOpen: boolean;
  employee: FieldForceRep | null;
  onClose: () => void;
}

export const EmployeeQrSingleModal: React.FC<SingleQrModalProps> = ({
  isOpen,
  employee,
  onClose,
}) => {
  const { getErpAuthHeaders, systemBranding, payrollSettings } = useERP();
  const [qrToken, setQrToken] = useState<string>('');
  const [qrImageUrl, setQrImageUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const companyName =
    systemBranding?.softwareName || payrollSettings?.companyName || 'Ensec ERP';

  useEffect(() => {
    if (!isOpen || !employee) return;
    let cancelled = false;
    setIsLoading(true);
    setError('');
    setQrImageUrl('');

    (async () => {
      try {
        const tokens = await fetchEmployeeQrTokens(
          [{ id: employee.id, code: employee.code }],
          getErpAuthHeaders()
        );
        const token = tokens[employee.id];
        if (!token) {
          throw new Error('Could not generate permanent QR token for this employee.');
        }
        const dataUrl = await generateQrCodeDataUrl(token, 340);
        if (!cancelled) {
          setQrToken(token);
          setQrImageUrl(dataUrl);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || 'Failed to generate employee QR code.');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, employee, getErpAuthHeaders]);

  if (!isOpen || !employee) return null;

  const handlePrintSingle = () => {
    document.body.classList.add('printing-qr-badges');
    const cleanup = () => {
      document.body.classList.remove('printing-qr-badges');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    setTimeout(cleanup, 2000);
  };

  const handleDownload = async () => {
    if (!qrToken) return;
    setIsDownloading(true);
    try {
      await downloadSingleEmployeeQrPng(employee, qrToken, companyName);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto print:static print:p-0 print:bg-white">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden print:border-none print:shadow-none print:max-w-none print:rounded-none">
        {/* Modal Header (Hidden on Print) */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-2xs">
              <QrCode className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Employee Attendance QR Code
              </h3>
              <p className="text-[11px] text-slate-500">
                Permanent encrypted identifier linked to {employee.code || employee.id}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Printable ID Badge Area */}
        <div className="p-6 flex flex-col items-center bg-slate-50 dark:bg-slate-950/40 print:bg-white print:p-8">
          <div
            id="qr-badges-a4-print"
            className="w-full max-w-[330px] mx-auto bg-white rounded-2xl border-2 border-slate-200 shadow-sm overflow-hidden text-center"
          >
            <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-blue-900 px-4 py-3 text-white">
              <div className="text-[10px] font-bold uppercase tracking-widest text-blue-200">
                {companyName}
              </div>
              <div className="text-xs font-extrabold tracking-wide mt-0.5">
                ATTENDANCE ID CARD
              </div>
            </div>

            <div className="p-5 space-y-3">
              <div>
                <h4 className="text-base font-black text-slate-900 leading-tight">
                  {employee.name}
                </h4>
                <p className="text-xs font-semibold text-slate-500 mt-0.5">
                  {[employee.designation, employee.department].filter(Boolean).join(' • ') || 'Staff'}
                </p>
                <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 font-mono font-bold text-xs">
                  <span>ID: {employee.code || employee.id}</span>
                </div>
              </div>

              <div className="mx-auto w-52 h-52 rounded-2xl border border-slate-200 bg-white p-2.5 flex items-center justify-center">
                {isLoading ? (
                  <div className="flex flex-col items-center gap-2 text-slate-400">
                    <Loader2 className="w-7 h-7 animate-spin text-blue-600" />
                    <span className="text-[11px] font-medium">Generating secure QR...</span>
                  </div>
                ) : error ? (
                  <div className="text-xs text-rose-600 font-semibold px-2">{error}</div>
                ) : qrImageUrl ? (
                  <img
                    src={qrImageUrl}
                    alt={`QR Code for ${employee.name}`}
                    className="w-full h-full object-contain"
                  />
                ) : null}
              </div>

              <div className="pt-1 border-t border-slate-100 flex items-center justify-center gap-1.5 text-[10px] font-semibold text-slate-500">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Permanent Signed QR • Auto IN / OUT Attendance</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions (Hidden on Print) */}
        <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-2 print:hidden">
          <button
            type="button"
            disabled={!qrToken || isDownloading}
            onClick={handleDownload}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold transition-colors shadow-2xs"
          >
            {isDownloading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>Download PNG</span>
          </button>
          <button
            type="button"
            disabled={!qrImageUrl}
            onClick={handlePrintSingle}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-50 text-white text-xs font-bold transition-colors"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print QR</span>
          </button>
        </div>
      </div>
    </div>
  );
};

interface BulkQrModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const EmployeeQrBulkModal: React.FC<BulkQrModalProps> = ({ isOpen, onClose }) => {
  const { fieldForceReps, getErpAuthHeaders, systemBranding, payrollSettings } = useERP();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [onlyActive, setOnlyActive] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [tokensById, setTokensById] = useState<Record<string, string>>({});
  const [qrImagesById, setQrImagesById] = useState<Record<string, string>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');

  const companyName =
    systemBranding?.softwareName || payrollSettings?.companyName || 'Ensec ERP';

  const categories = useMemo(() => {
    const set = new Set<string>();
    fieldForceReps.forEach((r) => {
      if (r.employeeCategory) set.add(r.employeeCategory);
    });
    return ['ALL', ...Array.from(set).sort()];
  }, [fieldForceReps]);

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    return fieldForceReps.filter((emp) => {
      const active = emp.status === 'Active' || emp.isActive !== false;
      if (onlyActive && !active) return false;
      if (categoryFilter !== 'ALL' && emp.employeeCategory !== categoryFilter) return false;
      if (q) {
        const hay = `${emp.code} ${emp.name} ${emp.department || ''} ${emp.designation || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [fieldForceReps, onlyActive, categoryFilter, search]);

  // Select all filtered employees by default on open
  useEffect(() => {
    if (!isOpen) return;
    setSelectedIds(new Set(filteredEmployees.map((e) => e.id)));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || fieldForceReps.length === 0) return;
    let cancelled = false;
    setIsGenerating(true);
    setError('');

    (async () => {
      try {
        const tokenMap = await fetchEmployeeQrTokens(
          fieldForceReps.map((e) => ({ id: e.id, code: e.code })),
          getErpAuthHeaders()
        );
        if (cancelled) return;
        setTokensById(tokenMap);

        const imgEntries = await Promise.all(
          fieldForceReps.map(async (emp) => {
            const t = tokenMap[emp.id];
            if (!t) return [emp.id, ''] as const;
            const url = await generateQrCodeDataUrl(t, 220);
            return [emp.id, url] as const;
          })
        );
        if (!cancelled) {
          const nextImgs: Record<string, string> = {};
          for (const [id, url] of imgEntries) {
            if (url) nextImgs[id] = url;
          }
          setQrImagesById(nextImgs);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || 'Failed to generate bulk employee QR codes.');
        }
      } finally {
        if (!cancelled) setIsGenerating(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, fieldForceReps, getErpAuthHeaders]);

  const printableEmployees = useMemo(() => {
    return filteredEmployees.filter((emp) => selectedIds.has(emp.id));
  }, [filteredEmployees, selectedIds]);

  if (!isOpen) return null;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAllFiltered = () => {
    setSelectedIds(new Set(filteredEmployees.map((e) => e.id)));
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  const handleBulkPrintA4 = () => {
    if (printableEmployees.length === 0) return;
    document.body.classList.add('printing-qr-badges');
    const cleanup = () => {
      document.body.classList.remove('printing-qr-badges');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    setTimeout(cleanup, 2500);
  };

  const handleBulkZipDownload = async () => {
    if (printableEmployees.length === 0) return;
    setIsZipping(true);
    setZipProgress({ done: 0, total: printableEmployees.length });
    try {
      await downloadBulkEmployeeQrZip(
        printableEmployees,
        tokensById,
        companyName,
        (done, total) => setZipProgress({ done, total })
      );
    } finally {
      setIsZipping(false);
      setZipProgress(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-2 sm:p-4 bg-slate-950/75 backdrop-blur-xs overflow-y-auto print:static print:p-0 print:bg-white print:overflow-visible">
      <div className="w-full max-w-6xl max-h-[94vh] flex flex-col bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden print:max-h-none print:border-none print:shadow-none print:rounded-none print:overflow-visible">
        {/* Top Modal Action Bar (Hidden on Print) */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex flex-col lg:flex-row lg:items-center justify-between gap-3 print:hidden">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-2xs shrink-0">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Bulk Employee QR Code Generator (A4 Print &amp; ZIP Download)
              </h3>
              <p className="text-[11px] text-slate-500">
                A4 Portrait Sheet Layout (8 Badges / Page) • Permanent HMAC-Signed Employee ID QR Codes
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isGenerating || isZipping || printableEmployees.length === 0}
              onClick={handleBulkZipDownload}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold shadow-2xs transition-colors"
            >
              {isZipping ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileArchive className="w-3.5 h-3.5" />
              )}
              <span>
                {isZipping && zipProgress
                  ? `Packing ${zipProgress.done}/${zipProgress.total}...`
                  : `Download All (.zip) (${printableEmployees.length})`}
              </span>
            </button>

            <button
              type="button"
              disabled={isGenerating || printableEmployees.length === 0}
              onClick={handleBulkPrintA4}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold shadow-2xs transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print A4 Sheets ({printableEmployees.length})</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filter & Selection Toolbar (Hidden on Print) */}
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-2.5 text-xs print:hidden">
          <div className="flex flex-wrap items-center gap-2 flex-1">
            <div className="relative min-w-[210px] flex-1 max-w-xs">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, ID, department..."
                className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
              />
            </div>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold"
            >
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat === 'ALL' ? 'All Categories' : cat}
                </option>
              ))}
            </select>

            <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 cursor-pointer font-semibold">
              <input
                type="checkbox"
                checked={onlyActive}
                onChange={(e) => setOnlyActive(e.target.checked)}
                className="rounded border-slate-300 text-blue-600"
              />
              <span>Active Only</span>
            </label>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-500">
              Selected: <b className="text-slate-900 dark:text-white">{printableEmployees.length}</b> / {filteredEmployees.length}
            </span>
            <button
              type="button"
              onClick={handleSelectAllFiltered}
              className="px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 font-bold text-[11px] hover:bg-blue-100"
            >
              Select All
            </button>
            <button
              type="button"
              onClick={handleClearSelection}
              className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold text-[11px] hover:bg-slate-200"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Scrollable A4 Sheet Preview / Printable Container */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-100 dark:bg-slate-950 print:p-0 print:bg-white print:overflow-visible">
          {error ? (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
              {error}
            </div>
          ) : isGenerating && Object.keys(qrImagesById).length === 0 ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-slate-500">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
              <div className="text-xs font-semibold">Generating permanent employee QR badges...</div>
            </div>
          ) : (
            <>
              {/* Selection Chips Strip (Hidden on Print) */}
              <div className="mb-4 flex flex-wrap gap-1.5 print:hidden">
                {filteredEmployees.map((emp) => {
                  const isChecked = selectedIds.has(emp.id);
                  return (
                    <button
                      key={`chip-${emp.id}`}
                      type="button"
                      onClick={() => toggleSelect(emp.id)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                        isChecked
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {isChecked && <CheckCircle2 className="w-3 h-3" />}
                      <span className="font-mono">{emp.code}</span>
                      <span>• {emp.name}</span>
                    </button>
                  );
                })}
              </div>

              {/* A4 Printable Grid */}
              <div
                id="qr-badges-a4-print"
                className="mx-auto max-w-[210mm] bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-slate-200 print:max-w-none print:shadow-none print:border-none print:p-0 print:rounded-none"
              >
                {printableEmployees.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-400">
                    Select one or more employees above to preview A4 QR badges or download ZIP.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 print:grid-cols-2 gap-3.5 print:gap-3">
                    {printableEmployees.map((emp) => (
                      <div
                        key={`badge-${emp.id}`}
                        className="border-2 border-slate-200 rounded-xl p-3 bg-white flex items-center gap-3.5 break-inside-avoid print:break-inside-avoid"
                      >
                        <div className="w-28 h-28 shrink-0 rounded-xl border border-slate-200 bg-white p-1.5 flex items-center justify-center">
                          {qrImagesById[emp.id] ? (
                            <img
                              src={qrImagesById[emp.id]}
                              alt={`QR ${emp.code}`}
                              className="w-full h-full object-contain"
                            />
                          ) : (
                            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1 text-left">
                          <div className="text-[9px] font-bold uppercase tracking-wider text-blue-700 truncate">
                            {companyName} • ATTENDANCE ID
                          </div>
                          <div className="text-sm font-black text-slate-900 truncate mt-0.5">
                            {emp.name}
                          </div>
                          <div className="inline-block mt-1 px-2 py-0.5 rounded bg-blue-50 border border-blue-200 font-mono text-xs font-bold text-blue-700">
                            {emp.code || emp.id}
                          </div>
                          <div className="text-[11px] text-slate-600 font-medium truncate mt-1">
                            {emp.designation || 'Staff'}
                          </div>
                          <div className="text-[10px] text-slate-500 truncate">
                            {emp.department || emp.employeeCategory || 'Operations'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
