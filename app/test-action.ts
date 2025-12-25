'use server';

// Simple test server action to verify server actions work at all
export async function testAction(formData: FormData) {
  const file = formData.get("file") as File;
  
  if (!file) {
    return { 
      success: false, 
      error: "No file provided",
      timestamp: new Date().toISOString()
    };
  }
  
  return {
    success: true,
    fileName: file.name,
    fileSize: file.size,
    fileSizeMB: (file.size / 1024 / 1024).toFixed(2),
    fileType: file.type,
    timestamp: new Date().toISOString()
  };
}


