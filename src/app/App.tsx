import { useState, useEffect } from 'react';
import { Upload, Download, CheckCircle2, AlertCircle, FileText, X, DownloadCloud } from 'lucide-react';
import JSZip from 'jszip';

interface ValidationResult {
  isValid: boolean;
  message: string;
  srtTextLines: string[];
  vttTextLines: string[];
}

interface FileConversion {
  id: string;
  fileName: string;
  srtContent: string;
  vttContent: string;
  validation: ValidationResult;
}

const STORAGE_KEY = 'srt-vtt-conversions';

export default function App() {
  const [conversions, setConversions] = useState<FileConversion[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);

  // Load from sessionStorage on mount
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setConversions(parsed);
      }
    } catch (error) {
      console.error('Failed to load from sessionStorage:', error);
    }
  }, []);

  // Save to sessionStorage whenever conversions change
  useEffect(() => {
    try {
      if (conversions.length > 0) {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(conversions));
      } else {
        sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch (error) {
      console.error('Failed to save to sessionStorage:', error);
    }
  }, [conversions]);

  const convertSrtToVtt = (srt: string): string => {
    if (!srt.trim()) return '';

    // Split into blocks
    const blocks = srt.trim().split(/\n\s*\n/);
    const vttBlocks: string[] = [];

    blocks.forEach(block => {
      const lines = block.split('\n');

      // Skip sequence number (first line) and process timestamp (second line)
      if (lines.length >= 2) {
        const timestampLine = lines.find(line => line.includes('-->'));
        if (timestampLine) {
          // Convert comma to dot for milliseconds
          const vttTimestamp = timestampLine.replace(/,/g, '.');

          // Get all text lines after timestamp
          const timestampIndex = lines.indexOf(timestampLine);
          const textLines = lines.slice(timestampIndex + 1);

          vttBlocks.push(vttTimestamp);
          vttBlocks.push(...textLines);
          vttBlocks.push(''); // Empty line between cues
        }
      }
    });

    return 'WEBVTT\n\n' + vttBlocks.join('\n');
  };

  const extractTextLines = (content: string, format: 'srt' | 'vtt'): string[] => {
    const lines = content.split('\n');
    const textLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines, sequence numbers, timestamps, and WEBVTT header
      if (!line ||
          line === 'WEBVTT' ||
          line === 'WEBVTT FILE' ||
          /^\d+$/.test(line) ||
          line.includes('-->')) {
        continue;
      }

      textLines.push(line);
    }

    return textLines;
  };

  const validateConversion = (srt: string, vtt: string): ValidationResult => {
    const srtTextLines = extractTextLines(srt, 'srt');
    const vttTextLines = extractTextLines(vtt, 'vtt');

    if (srtTextLines.length !== vttTextLines.length) {
      return {
        isValid: false,
        message: `Line count mismatch: SRT has ${srtTextLines.length} text lines, VTT has ${vttTextLines.length} text lines`,
        srtTextLines,
        vttTextLines
      };
    }

    for (let i = 0; i < srtTextLines.length; i++) {
      if (srtTextLines[i] !== vttTextLines[i]) {
        return {
          isValid: false,
          message: `Text mismatch at line ${i + 1}: "${srtTextLines[i]}" !== "${vttTextLines[i]}"`,
          srtTextLines,
          vttTextLines
        };
      }
    }

    return {
      isValid: true,
      message: `✓ Conversion verified: ${srtTextLines.length} text lines match perfectly`,
      srtTextLines,
      vttTextLines
    };
  };

  const processFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        const converted = convertSrtToVtt(content);
        const result = validateConversion(content, converted);

        const conversion: FileConversion = {
          id: `${file.name}-${Date.now()}-${Math.random()}`,
          fileName: file.name,
          srtContent: content,
          vttContent: converted,
          validation: result
        };

        setConversions(prev => [...prev, conversion]);
      };
      reader.readAsText(file);
    });
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    processFiles(event.target.files);
    // Reset input to allow re-uploading the same file
    event.target.value = '';
  };

  const handleDragOver = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  };

  const handleDragEnter = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);

    const files = event.dataTransfer.files;
    processFiles(files);
  };

  const removeConversion = (id: string) => {
    setConversions(prev => prev.filter(c => c.id !== id));
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(id);
      return newSet;
    });
  };

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    const validIds = conversions.filter(c => c.validation.isValid).map(c => c.id);
    if (selectedIds.size === validIds.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(validIds));
    }
  };

  const downloadVtt = (conversion: FileConversion) => {
    const blob = new Blob([conversion.vttContent], { type: 'text/vtt' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = conversion.fileName.replace(/\.(srt|txt)$/i, '.vtt') || 'subtitles.vtt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadSelected = async () => {
    const selectedConversions = conversions.filter(c => selectedIds.has(c.id) && c.validation.isValid);

    if (selectedConversions.length === 0) return;

    if (selectedConversions.length === 1) {
      // Single file - download directly
      downloadVtt(selectedConversions[0]);
    } else {
      // Multiple files - download as ZIP
      const zip = new JSZip();

      selectedConversions.forEach(conversion => {
        const vttFileName = conversion.fileName.replace(/\.(srt|txt)$/i, '.vtt') || 'subtitles.vtt';
        zip.file(vttFileName, conversion.vttContent);
      });

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `converted-subtitles-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const validConversions = conversions.filter(c => c.validation.isValid);
  const invalidConversions = conversions.filter(c => !c.validation.isValid);
  const selectedValidCount = Array.from(selectedIds).filter(id =>
    conversions.find(c => c.id === id)?.validation.isValid
  ).length;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">SRT to VTT Converter</h1>
          <p className="text-gray-600">Convert SubRip (.srt) subtitles to WebVTT (.vtt) format with validation</p>
        </div>

        {/* File Upload */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <label
            className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
              isDragging
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-300 hover:border-blue-500 hover:bg-gray-50'
            }`}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="flex flex-col items-center justify-center pt-5 pb-6 pointer-events-none">
              <Upload className={`w-10 h-10 mb-2 ${isDragging ? 'text-blue-500' : 'text-gray-400'}`} />
              <p className="text-sm text-gray-600">
                <span className="font-semibold">Click to upload</span> or drag and drop
              </p>
              <p className="text-xs text-gray-500 mt-1">Multiple SRT files supported</p>
            </div>
            <input
              type="file"
              className="hidden"
              accept=".srt,.txt"
              multiple
              onChange={handleFileUpload}
            />
          </label>
        </div>

        {/* Summary Stats */}
        {conversions.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Files</p>
                  <p className="text-2xl font-bold text-gray-900">{conversions.length}</p>
                </div>
                <FileText className="w-8 h-8 text-gray-400" />
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Valid Conversions</p>
                  <p className="text-2xl font-bold text-green-600">{validConversions.length}</p>
                </div>
                <CheckCircle2 className="w-8 h-8 text-green-400" />
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Failed Conversions</p>
                  <p className="text-2xl font-bold text-red-600">{invalidConversions.length}</p>
                </div>
                <AlertCircle className="w-8 h-8 text-red-400" />
              </div>
            </div>
          </div>
        )}

        {/* Batch Actions */}
        {conversions.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-4">
                <h2 className="text-xl font-semibold text-gray-900">
                  Conversions ({conversions.length})
                </h2>
                {validConversions.length > 0 && (
                  <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === validConversions.length && validConversions.length > 0}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                    />
                    Select all valid
                  </label>
                )}
              </div>
              <div className="flex gap-3">
                {selectedValidCount > 0 && (
                  <button
                    onClick={downloadSelected}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    {selectedValidCount === 1 ? (
                      <>
                        <Download className="w-4 h-4" />
                        Download Selected (1)
                      </>
                    ) : (
                      <>
                        <DownloadCloud className="w-4 h-4" />
                        Download as ZIP ({selectedValidCount})
                      </>
                    )}
                  </button>
                )}
                <button
                  onClick={() => {
                    setConversions([]);
                    setSelectedIds(new Set());
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Clear All
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Conversions List */}
        {conversions.length > 0 && (
          <div className="space-y-4 mb-6">
            {conversions.map((conversion) => (
              <div
                key={conversion.id}
                className={`bg-white rounded-lg shadow-sm p-6 border-l-4 ${
                  conversion.validation.isValid
                    ? 'border-l-green-500'
                    : 'border-l-red-500'
                }`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-start gap-3 flex-1">
                    {conversion.validation.isValid ? (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(conversion.id)}
                        onChange={() => toggleSelection(conversion.id)}
                        className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 mt-0.5 cursor-pointer"
                      />
                    ) : (
                      <div className="w-5 h-5 mt-0.5" />
                    )}
                    {conversion.validation.isValid ? (
                      <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <FileText className="w-4 h-4 text-gray-400" />
                        <h3 className="font-semibold text-gray-900">{conversion.fileName}</h3>
                      </div>
                      <p className={`text-sm ${
                        conversion.validation.isValid ? 'text-green-700' : 'text-red-700'
                      }`}>
                        {conversion.validation.message}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {conversion.validation.isValid && (
                      <button
                        onClick={() => downloadVtt(conversion)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download
                      </button>
                    )}
                    <button
                      onClick={() => removeConversion(conversion.id)}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                      aria-label="Remove"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Preview */}
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm text-gray-600 hover:text-gray-900 select-none">
                    View Details
                  </summary>
                  <div className="grid md:grid-cols-2 gap-4 mt-4">
                    <div>
                      <h4 className="text-xs font-semibold text-gray-700 mb-2">SRT Content (preview)</h4>
                      <pre className="text-xs bg-gray-50 p-3 rounded border border-gray-200 overflow-auto max-h-40 font-mono">
                        {conversion.srtContent.substring(0, 500)}
                        {conversion.srtContent.length > 500 && '...'}
                      </pre>
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-gray-700 mb-2">VTT Content (preview)</h4>
                      <pre className="text-xs bg-gray-50 p-3 rounded border border-gray-200 overflow-auto max-h-40 font-mono">
                        {conversion.vttContent.substring(0, 500)}
                        {conversion.vttContent.length > 500 && '...'}
                      </pre>
                    </div>
                  </div>
                </details>
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {conversions.length === 0 && (
          <div className="bg-white rounded-lg shadow-sm p-12 text-center">
            <Upload className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No files uploaded yet</h3>
            <p className="text-gray-600">Upload one or more SRT files to get started</p>
          </div>
        )}

        {/* Info Section */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mt-6">
          <h3 className="font-semibold text-blue-900 mb-2">How it works</h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• Upload multiple SRT files at once for batch conversion</li>
            <li>• Converts timestamp format from comma (00:00:00,000) to dot (00:00:00.000)</li>
            <li>• Adds WEBVTT header required for VTT format</li>
            <li>• Removes sequence numbers (optional in VTT)</li>
            <li>• Validates that all subtitle text is preserved exactly</li>
            <li>• Compares line-by-line to ensure no text was lost or modified</li>
            <li>• Select which files to download - single file downloads directly, multiple files download as ZIP</li>
            <li>• Files persist through page refresh during your session (cleared when browser closes)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}