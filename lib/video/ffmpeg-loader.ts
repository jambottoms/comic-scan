/**
 * Runtime loader for FFmpeg binary
 * This file is kept separate to prevent bundlers from statically analyzing the require()
 */

export function loadFfmpegPath(): string {
  // Use Function constructor to prevent static analysis
  const requireFunc = new Function('moduleName', 'return require(moduleName)');
  // @ts-ignore
  const ffmpegStatic = requireFunc('ffmpeg-static');
  
  // Handle different export formats
  if (typeof ffmpegStatic === 'string') {
    return ffmpegStatic;
  }
  if (ffmpegStatic?.default && typeof ffmpegStatic.default === 'string') {
    return ffmpegStatic.default;
  }
  if (ffmpegStatic?.path && typeof ffmpegStatic.path === 'string') {
    return ffmpegStatic.path;
  }
  
  throw new Error('ffmpeg-static returned invalid path');
}

