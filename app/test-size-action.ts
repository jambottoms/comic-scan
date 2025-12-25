'use server';

// Test server action to verify Next.js bodySizeLimit configuration
// This will help us confirm if the issue is Next.js config or Vercel platform limits

export async function testSizeAction(formData: FormData) {
  const file = formData.get("file") as File;
  
  if (!file) {
    return { 
      success: false, 
      error: "No file provided",
      config: "Next.js serverActions.bodySizeLimit should be 100mb"
    };
  }
  
  const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
  
  // If we can receive files larger than 4.5MB, Next.js config is working
  // If we can't, it's a platform limitation
  return {
    success: true,
    fileName: file.name,
    fileSize: file.size,
    fileSizeMB: fileSizeMB,
    fileType: file.type,
    configWorking: file.size > 4.5 * 1024 * 1024, // True if > 4.5MB
    message: file.size > 4.5 * 1024 * 1024 
      ? "✅ Next.js config is working - file > 4.5MB accepted"
      : "⚠️ File is under 4.5MB - test with larger file to verify config",
    timestamp: new Date().toISOString()
  };
}


