'use client';

import { useState, useEffect } from 'react';
import { analyzeComic } from './actions';

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Clean up previous video URL if exists
    if (videoPreview) {
      URL.revokeObjectURL(videoPreview);
    }

    // Create video preview
    const videoUrl = URL.createObjectURL(file);
    setVideoPreview(videoUrl);

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // 1. Pack the file into a FormData object
      const formData = new FormData();
      formData.append("file", file); // This matches 'formData.get("file")' in actions.ts

      // 2. Send it to the server
      const data = await analyzeComic(formData);
      setResult(data);
    } catch (err) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : "Failed to analyze. Check terminal for details.";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }

  // Cleanup video URL on unmount
  useEffect(() => {
    return () => {
      if (videoPreview) {
        URL.revokeObjectURL(videoPreview);
      }
    };
  }, [videoPreview]);

  return (
    <main className="min-h-screen bg-gray-900 text-white p-4 flex flex-col items-center justify-center">
      <h1 className="text-3xl font-bold mb-8">Comic Video Scanner</h1>

      {/* The Upload Button */}
      <div className="mb-8">
        <label className="cursor-pointer bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 px-8 rounded-full text-xl transition disabled:opacity-50 disabled:cursor-not-allowed">
          {loading ? "Analyzing..." : "🎥 Record Video"}
          <input 
            type="file" 
            accept="video/*"
            capture="environment"
            className="hidden" 
            onChange={handleFileChange}
            disabled={loading}
          />
        </label>
      </div>

      {/* Video Preview */}
      {videoPreview && !loading && (
        <div className="mb-8 w-full max-w-md">
          <video 
            src={videoPreview} 
            controls 
            className="w-full rounded-xl border border-gray-700"
          >
            Your browser does not support the video tag.
          </video>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-100 p-4 rounded mb-4">
          {error}
        </div>
      )}

      {/* The Result Card */}
      {result && (
        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 max-w-md w-full shadow-2xl">
          <h2 className="text-2xl font-bold text-yellow-400 mb-2">
            {result.title || "Unknown Comic"}
          </h2>
          <div className="flex justify-between items-center mb-4">
            <span className="text-gray-400">
              {result.issue ? `Issue #${result.issue}` : "Issue Unknown"}
            </span>
            {result.estimatedGrade && (
              <span className="bg-green-900 text-green-300 px-3 py-1 rounded-full font-bold">
                Grade: {result.estimatedGrade}
              </span>
            )}
          </div>
          {result.reasoning && (
            <p className="text-gray-300 text-sm border-t border-gray-700 pt-4">
              {result.reasoning}
            </p>
          )}
          {!result.title && !result.issue && !result.estimatedGrade && (
            <p className="text-gray-400 text-sm pt-4">
              Received response: {JSON.stringify(result, null, 2)}
            </p>
          )}
        </div>
      )}
    </main>
  );
}