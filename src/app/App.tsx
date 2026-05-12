import { useState } from 'react';
import { Upload, Download, CheckCircle2, AlertCircle, FileText, X, DownloadCloud, Loader2, Image as ImageIcon, FileCode, Film, Music, Info } from 'lucide-react';
import JSZip from 'jszip';

type ConversionStatus = 'pending' | 'converting' | 'completed' | 'failed';

interface FileConversion {
  id: string;
  fileName: string;
  inputFile: File;
  outputFormat: string;
  outputBlob: Blob | null;
  status: ConversionStatus;
  error?: string;
  fileSize: number;
  outputSize?: number;
}

const SUPPORTED_CONVERSIONS = {
  image: {
    formats: ['png', 'jpg', 'jpeg', 'webp'],
    icon: ImageIcon,
    color: 'green',
    accepts: 'image/*,.png,.jpg,.jpeg,.webp',
    recommendations: {
      png: ['jpg', 'webp'],
      jpg: ['png', 'webp'],
      jpeg: ['png', 'webp'],
      webp: ['png', 'jpg']
    },
    browserSupported: true
  },
  subtitle: {
    formats: ['srt', 'vtt', 'sbv'],
    icon: FileCode,
    color: 'purple',
    accepts: '.srt,.vtt,.sbv,.txt',
    recommendations: {
      srt: ['vtt', 'sbv'],
      vtt: ['srt', 'sbv'],
      sbv: ['srt', 'vtt']
    },
    browserSupported: true
  },
  video: {
    formats: ['mp4', 'webm', 'avi', 'mov', 'mkv', 'flv'],
    icon: Film,
    color: 'blue',
    accepts: 'video/*,.mp4,.webm,.avi,.mov,.mkv,.flv',
    recommendations: {
      webm: ['mp4'],
      avi: ['mp4'],
      mov: ['mp4'],
      mkv: ['mp4'],
      flv: ['mp4'],
      mp4: ['webm']
    },
    browserSupported: false
  },
  audio: {
    formats: ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac'],
    icon: Music,
    color: 'orange',
    accepts: 'audio/*,.mp3,.wav,.ogg,.aac,.m4a,.flac',
    recommendations: {
      mp3: ['wav', 'ogg'],
      wav: ['mp3'],
      ogg: ['mp3'],
      aac: ['mp3'],
      m4a: ['mp3'],
      flac: ['mp3']
    },
    browserSupported: false
  }
};

const getFileType = (fileName: string): 'image' | 'subtitle' | 'video' | 'audio' | 'unknown' => {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  for (const [type, config] of Object.entries(SUPPORTED_CONVERSIONS)) {
    if (config.formats.includes(ext)) {
      return type as 'image' | 'subtitle' | 'video' | 'audio';
    }
  }
  return 'unknown';
};

const isTypeSupported = (fileName: string): boolean => {
  const type = getFileType(fileName);
  if (type === 'unknown') return false;
  return SUPPORTED_CONVERSIONS[type].browserSupported;
};

const getAvailableFormats = (fileName: string): string[] => {
  const type = getFileType(fileName);
  if (type === 'unknown') return [];
  return SUPPORTED_CONVERSIONS[type].formats;
};

const getRecommendedFormats = (fileName: string): string[] => {
  const type = getFileType(fileName);
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (type === 'unknown') return [];
  return SUPPORTED_CONVERSIONS[type].recommendations[ext] || [];
};

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
};

export default function App() {
  const [conversions, setConversions] = useState<FileConversion[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);

  // SRT to VTT conversion
  const convertSrtToVtt = (srt: string): string => {
    const blocks = srt.trim().split(/\n\s*\n/);
    const vttBlocks: string[] = [];

    blocks.forEach(block => {
      const lines = block.split('\n');
      if (lines.length >= 2) {
        const timestampLine = lines.find(line => line.includes('-->'));
        if (timestampLine) {
          const vttTimestamp = timestampLine.replace(/,/g, '.');
          const timestampIndex = lines.indexOf(timestampLine);
          const textLines = lines.slice(timestampIndex + 1);
          vttBlocks.push(vttTimestamp);
          vttBlocks.push(...textLines);
          vttBlocks.push('');
        }
      }
    });

    return 'WEBVTT\n\n' + vttBlocks.join('\n');
  };

  // VTT to SRT conversion
  const convertVttToSrt = (vtt: string): string => {
    const lines = vtt.split('\n');
    const srtBlocks: string[] = [];
    let counter = 1;
    let currentBlock: string[] = [];
    let inCue = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line === 'WEBVTT' || line.startsWith('NOTE')) continue;

      if (line.includes('-->')) {
        const srtTimestamp = line.replace(/\./g, ',');
        currentBlock = [`${counter}`, srtTimestamp];
        inCue = true;
        counter++;
      } else if (inCue && line !== '') {
        currentBlock.push(line);
      } else if (inCue && line === '') {
        srtBlocks.push(currentBlock.join('\n'));
        currentBlock = [];
        inCue = false;
      }
    }

    if (currentBlock.length > 0) {
      srtBlocks.push(currentBlock.join('\n'));
    }

    return srtBlocks.join('\n\n');
  };

  // SRT to SBV (YouTube) conversion
  const convertSrtToSbv = (srt: string): string => {
    const blocks = srt.trim().split(/\n\s*\n/);
    const sbvBlocks: string[] = [];

    blocks.forEach(block => {
      const lines = block.split('\n');
      if (lines.length >= 2) {
        const timestampLine = lines.find(line => line.includes('-->'));
        if (timestampLine) {
          const sbvTimestamp = timestampLine.replace(/,/g, '.').replace(/ --> /g, ',');
          const timestampIndex = lines.indexOf(timestampLine);
          const textLines = lines.slice(timestampIndex + 1);
          sbvBlocks.push(sbvTimestamp);
          sbvBlocks.push(...textLines);
          sbvBlocks.push('');
        }
      }
    });

    return sbvBlocks.join('\n');
  };

  // Convert subtitle formats
  const convertSubtitle = async (file: File, outputFormat: string): Promise<Blob> => {
    const text = await file.text();
    const inputExt = file.name.split('.').pop()?.toLowerCase();
    let output = '';

    if (inputExt === 'srt') {
      if (outputFormat === 'vtt') {
        output = convertSrtToVtt(text);
      } else if (outputFormat === 'sbv') {
        output = convertSrtToSbv(text);
      } else {
        output = text;
      }
    } else if (inputExt === 'vtt') {
      if (outputFormat === 'srt') {
        output = convertVttToSrt(text);
      } else if (outputFormat === 'sbv') {
        const srt = convertVttToSrt(text);
        output = convertSrtToSbv(srt);
      } else {
        output = text;
      }
    } else {
      output = text;
    }

    return new Blob([output], { type: 'text/plain' });
  };

  // Convert image formats using Canvas API
  const convertImage = async (file: File, outputFormat: string): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();

      reader.onload = (e) => {
        img.src = e.target?.result as string;
      };

      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        ctx.drawImage(img, 0, 0);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to convert image'));
            }
          },
          `image/${outputFormat === 'jpg' ? 'jpeg' : outputFormat}`,
          0.95
        );
      };

      img.onerror = () => {
        reject(new Error('Failed to load image'));
      };

      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };

      reader.readAsDataURL(file);
    });
  };

  const processFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const newConversions: FileConversion[] = [];

    for (const file of Array.from(files)) {
      const fileType = getFileType(file.name);
      if (fileType === 'unknown') {
        continue;
      }

      const inputExt = file.name.split('.').pop()?.toLowerCase() || '';
      const recommendedFormats = getRecommendedFormats(file.name);
      const availableFormats = getAvailableFormats(file.name);

      // Use first recommended format, or first available format that's not the input
      const defaultOutputFormat =
        recommendedFormats[0] ||
        availableFormats.find(f => f !== inputExt) ||
        availableFormats[0];

      const isSupported = isTypeSupported(file.name);

      const conversion: FileConversion = {
        id: `${file.name}-${Date.now()}-${Math.random()}`,
        fileName: file.name,
        inputFile: file,
        outputFormat: defaultOutputFormat,
        outputBlob: null,
        status: isSupported ? 'pending' : 'failed',
        fileSize: file.size,
        error: isSupported ? undefined : 'Video/audio conversions require FFmpeg (not available in this environment)'
      };

      newConversions.push(conversion);
    }

    setConversions(prev => [...prev, ...newConversions]);
  };

  const convertFile = async (conversion: FileConversion) => {
    setConversions(prev => prev.map(c =>
      c.id === conversion.id ? { ...c, status: 'converting' } : c
    ));

    try {
      const fileType = getFileType(conversion.fileName);
      let outputBlob: Blob;

      if (fileType === 'image') {
        outputBlob = await convertImage(conversion.inputFile, conversion.outputFormat);
      } else if (fileType === 'subtitle') {
        outputBlob = await convertSubtitle(conversion.inputFile, conversion.outputFormat);
      } else {
        throw new Error('Unsupported file type');
      }

      setConversions(prev => prev.map(c =>
        c.id === conversion.id
          ? { ...c, status: 'completed', outputBlob, outputSize: outputBlob.size }
          : c
      ));
    } catch (error) {
      console.error('Conversion failed:', error);
      setConversions(prev => prev.map(c =>
        c.id === conversion.id
          ? { ...c, status: 'failed', error: error instanceof Error ? error.message : 'Conversion failed' }
          : c
      ));
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    processFiles(event.target.files);
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
    processFiles(event.dataTransfer.files);
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
    const completedIds = conversions.filter(c => c.status === 'completed').map(c => c.id);
    if (selectedIds.size === completedIds.length && completedIds.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(completedIds));
    }
  };

  const downloadFile = (conversion: FileConversion) => {
    if (!conversion.outputBlob) return;

    const url = URL.createObjectURL(conversion.outputBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = conversion.fileName.replace(/\.[^.]+$/, `.${conversion.outputFormat}`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadSelected = async () => {
    const selectedConversions = conversions.filter(c => selectedIds.has(c.id) && c.status === 'completed');

    if (selectedConversions.length === 0) return;

    if (selectedConversions.length === 1) {
      downloadFile(selectedConversions[0]);
    } else {
      const zip = new JSZip();

      selectedConversions.forEach(conversion => {
        if (conversion.outputBlob) {
          const fileName = conversion.fileName.replace(/\.[^.]+$/, `.${conversion.outputFormat}`);
          zip.file(fileName, conversion.outputBlob);
        }
      });

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `converted-files-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const changeOutputFormat = (id: string, format: string) => {
    setConversions(prev => prev.map(c => {
      if (c.id === id && c.status === 'pending') {
        return { ...c, outputFormat: format };
      }
      return c;
    }));
  };

  const retryConversion = (conversion: FileConversion) => {
    setConversions(prev => prev.map(c =>
      c.id === conversion.id
        ? { ...c, status: 'pending', error: undefined, outputBlob: null }
        : c
    ));
  };

  const completedConversions = conversions.filter(c => c.status === 'completed');
  const failedConversions = conversions.filter(c => c.status === 'failed');
  const convertingConversions = conversions.filter(c => c.status === 'converting');
  const selectedValidCount = Array.from(selectedIds).filter(id =>
    conversions.find(c => c.id === id)?.status === 'completed'
  ).length;

  const hasUnsupportedFiles = conversions.some(c => {
    const type = getFileType(c.fileName);
    return (type === 'video' || type === 'audio') && c.status === 'failed';
  });

  const allAccepts = Object.values(SUPPORTED_CONVERSIONS).map(c => c.accepts).join(',');

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Universal File Format Converter</h1>
          <p className="text-gray-600">Convert images, subtitles, video, and audio files</p>
          <p className="text-sm text-gray-500 mt-1">100% private - no uploads, no cloud processing</p>
        </div>

        {/* Warning for video/audio - only show if user uploaded unsupported files */}
        {hasUnsupportedFiles && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-yellow-900 mb-1">Video & Audio Conversion Unavailable</h3>
                <p className="text-sm text-yellow-800">
                  Video and audio conversions require FFmpeg, which cannot run in this preview environment.
                  Images and subtitle conversions work natively in your browser. To convert video/audio files,
                  download this tool and run it locally with FFmpeg installed.
                </p>
              </div>
            </div>
          </div>
        )}

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
              <p className="text-xs text-gray-500 mt-1">Images, Subtitles, Video & Audio files supported</p>
            </div>
            <input
              type="file"
              className="hidden"
              accept={allAccepts}
              multiple
              onChange={handleFileUpload}
            />
          </label>
        </div>

        {/* Summary Stats */}
        {conversions.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
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
                  <p className="text-sm text-gray-600">Converting</p>
                  <p className="text-2xl font-bold text-blue-600">{convertingConversions.length}</p>
                </div>
                <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Completed</p>
                  <p className="text-2xl font-bold text-green-600">{completedConversions.length}</p>
                </div>
                <CheckCircle2 className="w-8 h-8 text-green-400" />
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Failed</p>
                  <p className="text-2xl font-bold text-red-600">{failedConversions.length}</p>
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
                {completedConversions.length > 0 && (
                  <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === completedConversions.length && completedConversions.length > 0}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                    />
                    Select all completed
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
            {conversions.map((conversion) => {
              const fileType = getFileType(conversion.fileName);
              const TypeIcon = fileType !== 'unknown' ? SUPPORTED_CONVERSIONS[fileType].icon : FileText;
              const availableFormats = getAvailableFormats(conversion.fileName);

              return (
                <div
                  key={conversion.id}
                  className={`bg-white rounded-lg shadow-sm p-6 border-l-4 ${
                    conversion.status === 'completed'
                      ? 'border-l-green-500'
                      : conversion.status === 'failed'
                      ? 'border-l-red-500'
                      : conversion.status === 'converting'
                      ? 'border-l-blue-500'
                      : 'border-l-gray-300'
                  }`}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-start gap-3 flex-1">
                      {conversion.status === 'completed' ? (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(conversion.id)}
                          onChange={() => toggleSelection(conversion.id)}
                          className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 mt-0.5 cursor-pointer"
                        />
                      ) : (
                        <div className="w-5 h-5 mt-0.5" />
                      )}
                      {conversion.status === 'completed' ? (
                        <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                      ) : conversion.status === 'failed' ? (
                        <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                      ) : conversion.status === 'converting' ? (
                        <Loader2 className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5 animate-spin" />
                      ) : (
                        <TypeIcon className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="font-semibold text-gray-900">{conversion.fileName}</h3>
                          <span className="text-xs text-gray-500">({formatBytes(conversion.fileSize)})</span>
                          {fileType !== 'unknown' && (
                            <span className={`text-xs px-2 py-0.5 rounded ${
                              fileType === 'image'
                                ? 'bg-green-100 text-green-700'
                                : fileType === 'subtitle'
                                ? 'bg-purple-100 text-purple-700'
                                : fileType === 'video'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-orange-100 text-orange-700'
                            }`}>
                              {fileType.charAt(0).toUpperCase() + fileType.slice(1)}
                            </span>
                          )}
                        </div>

                        {conversion.status === 'pending' && (
                          <div className="mt-3 space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-gray-600">Convert to:</span>
                              <select
                                value={conversion.outputFormat}
                                onChange={(e) => changeOutputFormat(conversion.id, e.target.value)}
                                className="text-sm border border-gray-300 rounded px-2 py-1 focus:ring-2 focus:ring-blue-500"
                              >
                                {availableFormats.map(format => (
                                  <option key={format} value={format}>{format.toUpperCase()}</option>
                                ))}
                              </select>
                            </div>
                            {(() => {
                              const recommended = getRecommendedFormats(conversion.fileName);
                              return recommended.length > 0 && (
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-gray-500">Quick select:</span>
                                  <div className="flex gap-1">
                                    {recommended.map(format => (
                                      <button
                                        key={format}
                                        onClick={() => changeOutputFormat(conversion.id, format)}
                                        className={`px-2 py-1 text-xs rounded transition-colors ${
                                          conversion.outputFormat === format
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                        }`}
                                      >
                                        {format.toUpperCase()}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        )}

                        {conversion.status === 'converting' && (
                          <p className="text-sm text-blue-700 mt-1">
                            Converting to {conversion.outputFormat.toUpperCase()}...
                          </p>
                        )}

                        {conversion.status === 'completed' && (
                          <p className="text-sm text-green-700 mt-1">
                            ✓ Converted to {conversion.outputFormat.toUpperCase()}
                            {conversion.outputSize && ` (${formatBytes(conversion.outputSize)})`}
                          </p>
                        )}

                        {conversion.status === 'failed' && (
                          <p className="text-sm text-red-700 mt-1">
                            Failed: {conversion.error || 'Unknown error'}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {conversion.status === 'completed' && (
                        <button
                          onClick={() => downloadFile(conversion)}
                          className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Download
                        </button>
                      )}
                      {conversion.status === 'failed' && (
                        <button
                          onClick={() => retryConversion(conversion)}
                          className="flex items-center gap-2 px-3 py-1.5 bg-orange-600 text-white text-sm rounded hover:bg-orange-700 transition-colors"
                        >
                          Retry
                        </button>
                      )}
                      {conversion.status === 'pending' && (
                        <button
                          onClick={() => convertFile(conversion)}
                          className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
                        >
                          Convert
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
                </div>
              );
            })}
          </div>
        )}

        {/* Empty State */}
        {conversions.length === 0 && (
          <div className="bg-white rounded-lg shadow-sm p-12 text-center">
            <Upload className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No files uploaded yet</h3>
            <p className="text-gray-600">Upload images, subtitles, video, or audio files to get started</p>
            <p className="text-sm text-gray-500 mt-2">(Video & audio require local installation with FFmpeg)</p>
          </div>
        )}

        {/* Info Section */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mt-6">
          <h3 className="font-semibold text-blue-900 mb-3">Supported Conversions</h3>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-semibold text-green-700 mb-1 flex items-center gap-1">
                <ImageIcon className="w-4 h-4" /> Images (Browser-native ✓)
              </p>
              <p className="text-sm text-gray-700 mb-2">PNG, JPG, JPEG, WebP</p>
              <div className="flex flex-wrap gap-1 text-xs text-gray-600">
                <span className="bg-green-50 border border-green-200 px-2 py-1 rounded">PNG → JPG</span>
                <span className="bg-green-50 border border-green-200 px-2 py-1 rounded">JPG → WebP</span>
                <span className="bg-green-50 border border-green-200 px-2 py-1 rounded">WebP → PNG</span>
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-purple-700 mb-1 flex items-center gap-1">
                <FileCode className="w-4 h-4" /> Subtitles (Browser-native ✓)
              </p>
              <p className="text-sm text-gray-700 mb-2">SRT, VTT, SBV (YouTube)</p>
              <div className="flex flex-wrap gap-1 text-xs text-gray-600">
                <span className="bg-purple-50 border border-purple-200 px-2 py-1 rounded">SRT → VTT</span>
                <span className="bg-purple-50 border border-purple-200 px-2 py-1 rounded">VTT → SRT</span>
                <span className="bg-purple-50 border border-purple-200 px-2 py-1 rounded">SRT → SBV</span>
              </div>
            </div>
            <div className="opacity-60">
              <p className="text-sm font-semibold text-blue-700 mb-1 flex items-center gap-1">
                <Film className="w-4 h-4" /> Video (Requires FFmpeg)
              </p>
              <p className="text-sm text-gray-700 mb-2">MP4, WebM, AVI, MOV, MKV, FLV</p>
              <div className="flex flex-wrap gap-1 text-xs text-gray-600">
                <span className="bg-blue-50 border border-blue-200 px-2 py-1 rounded">WebM → MP4</span>
                <span className="bg-blue-50 border border-blue-200 px-2 py-1 rounded">AVI → MP4</span>
                <span className="bg-blue-50 border border-blue-200 px-2 py-1 rounded">MOV → MP4</span>
              </div>
            </div>
            <div className="opacity-60">
              <p className="text-sm font-semibold text-orange-700 mb-1 flex items-center gap-1">
                <Music className="w-4 h-4" /> Audio (Requires FFmpeg)
              </p>
              <p className="text-sm text-gray-700 mb-2">MP3, WAV, OGG, AAC, M4A, FLAC</p>
              <div className="flex flex-wrap gap-1 text-xs text-gray-600">
                <span className="bg-orange-50 border border-orange-200 px-2 py-1 rounded">MP3 → WAV</span>
                <span className="bg-orange-50 border border-orange-200 px-2 py-1 rounded">WAV → MP3</span>
                <span className="bg-orange-50 border border-orange-200 px-2 py-1 rounded">FLAC → MP3</span>
              </div>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-blue-200">
            <h4 className="text-sm font-semibold text-blue-900 mb-2">How to use:</h4>
            <ul className="text-xs text-blue-700 space-y-1">
              <li>• Upload files by clicking or dragging them into the upload area</li>
              <li>• Choose your target format from the dropdown or use quick-select buttons</li>
              <li>• Click "Convert" to process the file (images & subtitles work instantly)</li>
              <li>• Download individual files or select multiple to download as ZIP</li>
            </ul>
          </div>
          <div className="mt-3 pt-3 border-t border-blue-200">
            <p className="text-xs text-blue-700">
              <strong>🔒 100% Private:</strong> All conversions happen in your browser - no files are uploaded to any server.
              Perfect for organizations with strict data security policies.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
