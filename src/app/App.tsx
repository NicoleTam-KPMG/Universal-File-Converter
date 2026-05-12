import { useState, useRef } from 'react';
import { Upload, Download, CheckCircle2, AlertCircle, FileText, X, DownloadCloud, Loader2, Image as ImageIcon, FileCode, Film, Music, Info, RefreshCw } from 'lucide-react';
import JSZip from 'jszip';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

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
  progress?: number;
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
    browserSupported: true // Now supported via FFmpeg WASM
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
    browserSupported: true // Now supported via FFmpeg WASM
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
  
  // FFmpeg State
  const [isFfmpegLoaded, setIsFfmpegLoaded] = useState(false);
  const [isFfmpegLoading, setIsFfmpegLoading] = useState(false);
  const [ffmpegError, setFfmpegError] = useState<string | null>(null);
  const ffmpegRef = useRef(new FFmpeg());

  const loadFfmpeg = async () => {
    if (isFfmpegLoaded || isFfmpegLoading) return;
    setIsFfmpegLoading(true);
    setFfmpegError(null);
    try {
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
      const ffmpeg = ffmpegRef.current;
      
      // Load FFmpeg WASM core
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      
      setIsFfmpegLoaded(true);
    } catch (error) {
      console.error("FFmpeg load error:", error);
      setFfmpegError("Failed to load FFmpeg engine. Your environment might lack required security headers.");
    } finally {
      setIsFfmpegLoading(false);
    }
  };

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

  // Convert media formats using FFmpeg WASM
  const convertMedia = async (conversion: FileConversion): Promise<Blob> => {
    const ffmpeg = ffmpegRef.current;
    
    // Auto-load FFmpeg if it hasn't been loaded yet
    if (!isFfmpegLoaded) {
      await loadFfmpeg();
    }
    
    if (!ffmpegRef.current.loaded) {
      throw new Error("FFmpeg engine failed to load.");
    }

    const fileExt = conversion.fileName.split('.').pop()?.toLowerCase();
    const inputName = `input_${conversion.id}.${fileExt}`;
    const outputName = `output_${conversion.id}.${conversion.outputFormat}`;

    // Write file to FFmpeg's virtual file system
    await ffmpeg.writeFile(inputName, await fetchFile(conversion.inputFile));

    // Listen for progress
    ffmpeg.on('progress', ({ progress }) => {
      setConversions(prev => prev.map(c => 
        c.id === conversion.id 
          ? { ...c, progress: Math.max(0, Math.min(100, Math.round(progress * 100))) } 
          : c
      ));
    });

    // Execute FFmpeg command (e.g., ffmpeg -i input.webm output.mp4)
    await ffmpeg.exec(['-i', inputName, outputName]);

    // Read the result
    const data = await ffmpeg.readFile(outputName);
    const mimeType = getFileType(conversion.fileName) === 'video' ? 'video' : 'audio';
    const blob = new Blob([(data as Uint8Array).buffer], { type: `${mimeType}/${conversion.outputFormat}` });

    // Clean up virtual file system
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);

    // Remove progress listener
    ffmpeg.off('progress', () => {});

    return blob;
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
      } else if (fileType === 'video' || fileType === 'audio') {
        outputBlob = await convertMedia(conversion);
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

  const hasMediaFiles = conversions.some(c => {
    const type = getFileType(c.fileName);
    return type === 'video' || type === 'audio';
  });

  const allAccepts = Object.values(SUPPORTED_CONVERSIONS).map(c => c.accepts).join(',');

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-900">
      
      {/* Header Section (Moved to the Top) */}
      <div className="max-w-[1400px] mx-auto mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-3">
            Universal Converter
          </h1>
          <p className="text-slate-600 leading-relaxed text-sm max-w-2xl">
            Convert images, subtitles, video, and audio files without ever leaving your browser.
          </p>
          <div className="inline-flex items-center gap-1.5 mt-4 px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-xs font-semibold shadow-sm">
            <CheckCircle2 className="w-4 h-4" />
            100% Private — No Uploads
          </div>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto flex flex-col lg:flex-row gap-8 items-start">
        
        {/* Left Sidebar: Fixed content like Info */}
        <div className="w-full lg:w-[380px] shrink-0 lg:sticky lg:top-8 flex flex-col gap-6">

          {/* Info Section moved here */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <h3 className="font-semibold text-slate-800 mb-5 flex items-center gap-2">
              <Info className="w-5 h-5 text-blue-500" />
              Supported Formats
            </h3>
            
            <div className="space-y-6">
              {/* Images */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-emerald-500" /> Images
                  </p>
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Native</span>
                </div>
                <p className="text-xs text-slate-500 mb-2">PNG, JPG, WebP</p>
                <div className="flex flex-wrap gap-1 text-[11px] font-medium text-slate-600">
                  <span className="bg-slate-50 border border-slate-200 px-2 py-1 rounded-md">PNG → JPG</span>
                  <span className="bg-slate-50 border border-slate-200 px-2 py-1 rounded-md">JPG → WebP</span>
                  <span className="bg-slate-50 border border-slate-200 px-2 py-1 rounded-md">WebP → PNG</span>
                </div>
              </div>

              {/* Subtitles */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <FileCode className="w-4 h-4 text-purple-500" /> Subtitles
                  </p>
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">Native</span>
                </div>
                <p className="text-xs text-slate-500 mb-2">SRT, VTT, SBV</p>
                <div className="flex flex-wrap gap-1 text-[11px] font-medium text-slate-600">
                  <span className="bg-slate-50 border border-slate-200 px-2 py-1 rounded-md">SRT → VTT</span>
                  <span className="bg-slate-50 border border-slate-200 px-2 py-1 rounded-md">VTT → SRT</span>
                  <span className="bg-slate-50 border border-slate-200 px-2 py-1 rounded-md">SRT → SBV</span>
                </div>
              </div>

              <div className="h-px bg-slate-100 w-full" />

              {/* Video */}
              <div className="opacity-75">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <Film className="w-4 h-4 text-blue-500" /> Video
                  </p>
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">FFmpeg</span>
                </div>
                <p className="text-xs text-slate-500">MP4, WebM, AVI, MOV, MKV, FLV</p>
              </div>

              {/* Audio */}
              <div className="opacity-75">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <Music className="w-4 h-4 text-orange-500" /> Audio
                  </p>
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">FFmpeg</span>
                </div>
                <p className="text-xs text-slate-500">MP3, WAV, OGG, AAC, M4A, FLAC</p>
              </div>
            </div>
          </div>
          
          {/* Instructions */}
          <div className="bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-700 text-slate-300">
             <h4 className="font-semibold text-white mb-4 text-sm">How it works</h4>
             <ul className="space-y-3 text-sm">
               <li className="flex gap-3"><span className="text-blue-400 font-bold">1</span> <span>Upload files by clicking or dragging</span></li>
               <li className="flex gap-3"><span className="text-blue-400 font-bold">2</span> <span>Choose target output formats</span></li>
               <li className="flex gap-3"><span className="text-blue-400 font-bold">3</span> <span>Convert instantly in your browser</span></li>
               <li className="flex gap-3"><span className="text-blue-400 font-bold">4</span> <span>Download single files or bundled ZIP</span></li>
             </ul>
          </div>
        </div>

        {/* Right Column: Dynamic Content Area */}
        <div className="flex-1 min-w-0 w-full space-y-6">
          
          {/* FFmpeg Load Warning or Status */}
          {ffmpegError ? (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-red-900 mb-1">FFmpeg Initialization Failed</h3>
                  <p className="text-sm text-red-800 leading-relaxed mb-3">
                    {ffmpegError} You can still convert images and subtitles natively.
                  </p>
                  <button 
                    onClick={loadFfmpeg}
                    className="text-xs bg-red-100 hover:bg-red-200 text-red-800 font-semibold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Retry Loading
                  </button>
                </div>
              </div>
            </div>
          ) : !isFfmpegLoaded && hasMediaFiles ? (
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 shadow-sm">
              <div className="flex items-start gap-3">
                {isFfmpegLoading ? (
                  <Loader2 className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5 animate-spin" />
                ) : (
                  <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                )}
                <div>
                  <h3 className="font-semibold text-blue-900 mb-1">
                    {isFfmpegLoading ? 'Loading FFmpeg Engine...' : 'FFmpeg Engine Required'}
                  </h3>
                  <p className="text-sm text-blue-800 leading-relaxed mb-3">
                    Video and audio conversions require the FFmpeg WebAssembly engine to be loaded into your browser's memory. This is a one-time download (~30MB) for this session.
                  </p>
                  {!isFfmpegLoading && (
                    <button 
                      onClick={loadFfmpeg}
                      className="text-sm bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded-lg transition-colors shadow-sm"
                    >
                      Load Engine Now
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {/* File Upload Area */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden p-2">
            <label
              className={`flex flex-col items-center justify-center w-full min-h-[160px] border-2 border-dashed rounded-xl cursor-pointer transition-all duration-200 ease-in-out ${
                isDragging
                  ? 'border-blue-500 bg-blue-50 scale-[0.99] shadow-inner'
                  : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'
              }`}
              onDragOver={handleDragOver}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="flex flex-col items-center justify-center py-8 px-4 text-center pointer-events-none">
                <div className={`p-4 rounded-full mb-4 transition-colors ${isDragging ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                  <Upload className="w-8 h-8" />
                </div>
                <p className="text-lg text-slate-700 mb-1">
                  <span className="font-semibold text-blue-600">Click to upload</span> or drag and drop
                </p>
                <p className="text-sm text-slate-500">Images, Subtitles, Video & Audio files supported</p>
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

          {/* Summary Stats Grid */}
          {conversions.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium text-slate-500">Total Files</p>
                  <div className="p-2 bg-slate-50 rounded-lg"><FileText className="w-4 h-4 text-slate-400" /></div>
                </div>
                <p className="text-3xl font-bold text-slate-800">{conversions.length}</p>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium text-slate-500">Converting</p>
                  <div className="p-2 bg-blue-50 rounded-lg"><Loader2 className="w-4 h-4 text-blue-500 animate-spin" /></div>
                </div>
                <p className="text-3xl font-bold text-blue-600">{convertingConversions.length}</p>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium text-slate-500">Completed</p>
                  <div className="p-2 bg-emerald-50 rounded-lg"><CheckCircle2 className="w-4 h-4 text-emerald-500" /></div>
                </div>
                <p className="text-3xl font-bold text-emerald-600">{completedConversions.length}</p>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium text-slate-500">Failed</p>
                  <div className="p-2 bg-red-50 rounded-lg"><AlertCircle className="w-4 h-4 text-red-500" /></div>
                </div>
                <p className="text-3xl font-bold text-red-600">{failedConversions.length}</p>
              </div>
            </div>
          )}

          {/* Batch Actions Bar */}
          {conversions.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sticky top-4 z-10">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
                  <h2 className="text-lg font-bold text-slate-800">
                    Queue ({conversions.length})
                  </h2>
                  {completedConversions.length > 0 && (
                    <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer hover:text-slate-900 transition-colors bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === completedConversions.length && completedConversions.length > 0}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      Select all completed
                    </label>
                  )}
                </div>
                <div className="flex items-center gap-3 w-full sm:w-auto">
                  {selectedValidCount > 0 && (
                    <button
                      onClick={downloadSelected}
                      className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
                    >
                      {selectedValidCount === 1 ? (
                        <>
                          <Download className="w-4 h-4" />
                          Download Selected (1)
                        </>
                      ) : (
                        <>
                          <DownloadCloud className="w-4 h-4" />
                          Download ZIP ({selectedValidCount})
                        </>
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setConversions([]);
                      setSelectedIds(new Set());
                    }}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-slate-100 text-slate-600 font-medium rounded-xl hover:bg-slate-200 transition-colors border border-slate-200"
                  >
                    Clear All
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Conversions List */}
          {conversions.length > 0 && (
            <div className="space-y-3">
              {conversions.map((conversion) => {
                const fileType = getFileType(conversion.fileName);
                const TypeIcon = fileType !== 'unknown' ? SUPPORTED_CONVERSIONS[fileType].icon : FileText;
                const availableFormats = getAvailableFormats(conversion.fileName);

                return (
                  <div
                    key={conversion.id}
                    className={`bg-white rounded-2xl shadow-sm p-5 border border-slate-200 transition-all hover:shadow-md ${
                      conversion.status === 'completed'
                        ? 'border-l-4 border-l-emerald-500'
                        : conversion.status === 'failed'
                        ? 'border-l-4 border-l-red-500'
                        : conversion.status === 'converting'
                        ? 'border-l-4 border-l-blue-500'
                        : 'border-l-4 border-l-slate-300'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div className="flex items-start gap-4 flex-1 w-full">
                        <div className="mt-1 flex items-center">
                          {conversion.status === 'completed' ? (
                            <input
                              type="checkbox"
                              checked={selectedIds.has(conversion.id)}
                              onChange={() => toggleSelection(conversion.id)}
                              className="w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                            />
                          ) : (
                            <div className="w-5 h-5" />
                          )}
                        </div>
                        
                        <div className={`p-2 rounded-xl flex-shrink-0 ${
                            conversion.status === 'completed' ? 'bg-emerald-50 text-emerald-600' : 
                            conversion.status === 'failed' ? 'bg-red-50 text-red-600' : 
                            conversion.status === 'converting' ? 'bg-blue-50 text-blue-600' : 
                            'bg-slate-50 text-slate-500'
                        }`}>
                          {conversion.status === 'completed' ? (
                            <CheckCircle2 className="w-5 h-5" />
                          ) : conversion.status === 'failed' ? (
                            <AlertCircle className="w-5 h-5" />
                          ) : conversion.status === 'converting' ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : (
                            <TypeIcon className="w-5 h-5" />
                          )}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                            <h3 className="font-semibold text-slate-900 truncate">{conversion.fileName}</h3>
                            <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                              {formatBytes(conversion.fileSize)}
                            </span>
                            {fileType !== 'unknown' && (
                              <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md ${
                                fileType === 'image'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : fileType === 'subtitle'
                                  ? 'bg-purple-100 text-purple-700'
                                  : fileType === 'video'
                                  ? 'bg-blue-100 text-blue-700'
                                  : 'bg-orange-100 text-orange-700'
                              }`}>
                                {fileType}
                              </span>
                            )}
                          </div>

                          {conversion.status === 'pending' && (
                            <div className="mt-3 bg-slate-50 border border-slate-100 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-4">
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-medium text-slate-600 whitespace-nowrap">Convert to:</span>
                                <div className="relative">
                                  <select
                                    value={conversion.outputFormat}
                                    onChange={(e) => changeOutputFormat(conversion.id, e.target.value)}
                                    className="appearance-none text-sm font-medium border border-slate-300 rounded-lg pl-3 pr-8 py-1.5 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer shadow-sm"
                                  >
                                    {availableFormats.map(format => (
                                      <option key={format} value={format}>{format.toUpperCase()}</option>
                                    ))}
                                  </select>
                                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-500">
                                    <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                                  </div>
                                </div>
                              </div>
                              
                              {(() => {
                                const recommended = getRecommendedFormats(conversion.fileName);
                                return recommended.length > 0 && (
                                  <>
                                    <div className="hidden sm:block w-px h-6 bg-slate-200" />
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-slate-500 whitespace-nowrap">Quick select:</span>
                                      <div className="flex flex-wrap gap-1.5">
                                        {recommended.map(format => (
                                          <button
                                            key={format}
                                            onClick={() => changeOutputFormat(conversion.id, format)}
                                            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all shadow-sm ${
                                              conversion.outputFormat === format
                                                ? 'bg-slate-800 text-white'
                                                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                                            }`}
                                          >
                                            {format.toUpperCase()}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  </>
                                );
                              })()}
                            </div>
                          )}

                          {conversion.status === 'converting' && (
                            <div className="mt-2 flex items-center gap-2">
                              <div className="h-1.5 w-24 bg-blue-100 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out" 
                                  style={{width: conversion.progress !== undefined ? `${conversion.progress}%` : '60%'}}
                                ></div>
                              </div>
                              <p className="text-sm font-medium text-blue-600">
                                {conversion.progress !== undefined 
                                  ? `Converting ${conversion.progress}%...`
                                  : `Converting to ${conversion.outputFormat.toUpperCase()}...`}
                              </p>
                            </div>
                          )}

                          {conversion.status === 'completed' && (
                            <div className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md">
                              ✓ Converted to {conversion.outputFormat.toUpperCase()}
                              {conversion.outputSize && <span className="text-emerald-600 opacity-80">({formatBytes(conversion.outputSize)})</span>}
                            </div>
                          )}

                          {conversion.status === 'failed' && (
                            <p className="text-sm font-medium text-red-600 mt-2 bg-red-50 px-3 py-1.5 rounded-md inline-block">
                              Failed: {conversion.error || 'Unknown error'}
                            </p>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2 w-full sm:w-auto justify-end mt-2 sm:mt-0 pl-14 sm:pl-0">
                        {conversion.status === 'completed' && (
                          <button
                            onClick={() => downloadFile(conversion)}
                            className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 font-medium text-sm rounded-lg hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-sm"
                          >
                            <Download className="w-4 h-4 text-slate-500" />
                            Download
                          </button>
                        )}
                        {conversion.status === 'failed' && (
                          <button
                            onClick={() => retryConversion(conversion)}
                            className="flex items-center gap-2 px-3 py-1.5 bg-red-50 border border-red-200 text-red-700 font-medium text-sm rounded-lg hover:bg-red-100 transition-colors"
                          >
                            Retry
                          </button>
                        )}
                        {conversion.status === 'pending' && (
                          <button
                            onClick={() => convertFile(conversion)}
                            className="flex items-center gap-2 px-4 py-1.5 bg-slate-900 text-white font-medium text-sm rounded-lg hover:bg-slate-800 transition-colors shadow-sm"
                          >
                            Convert
                          </button>
                        )}
                        <button
                          onClick={() => removeConversion(conversion.id)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-100"
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
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
              <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-6">
                <Upload className="w-10 h-10 text-slate-300" />
              </div>
              <h3 className="text-xl font-bold text-slate-800 mb-2">Ready to convert</h3>
              <p className="text-slate-500 max-w-sm mx-auto mb-2">
                Drop your files here to get started. Images and subtitles process instantly in your browser.
              </p>
              <p className="text-xs text-slate-400">
                (Video & audio uses WebAssembly FFmpeg inside your browser memory)
              </p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
