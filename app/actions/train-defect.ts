'use server';

const NYCKEL_FUNCTION_ID = process.env.NYCKEL_DEFECT_FUNCTION_ID;
const NYCKEL_CLIENT_ID = process.env.NYCKEL_CLIENT_ID;
const NYCKEL_CLIENT_SECRET = process.env.NYCKEL_CLIENT_SECRET;

async function getNyckelToken() {
  const tokenRes = await fetch('https://www.nyckel.com/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: NYCKEL_CLIENT_ID!,
      client_secret: NYCKEL_CLIENT_SECRET!,
      grant_type: 'client_credentials',
    }),
  });
  const data = await tokenRes.json();
  return data.access_token;
}

export async function trainDefect(imageUrl: string, label: string) {
  try {
    // Debug logging
    console.log("[TrainDefect] Environment Check:", {
      hasFunctionId: !!NYCKEL_FUNCTION_ID,
      hasClientId: !!NYCKEL_CLIENT_ID,
      hasClientSecret: !!NYCKEL_CLIENT_SECRET,
      functionIdStart: NYCKEL_FUNCTION_ID ? NYCKEL_FUNCTION_ID.substring(0, 4) : 'null'
    });

    if (!NYCKEL_FUNCTION_ID || !NYCKEL_CLIENT_ID) {
      throw new Error("Nyckel credentials missing - check server logs for details");
    }

    // 1. Get Token
    const accessToken = await getNyckelToken();

    // 2. Send to Nyckel
    const response = await fetch(
      `https://www.nyckel.com/v1/functions/${NYCKEL_FUNCTION_ID}/samples`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: imageUrl,
          annotation: { labelName: label },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      
      // Check if it's a duplicate sample error - treat as success
      if (errorText.includes('already exists') || errorText.includes('existingSample')) {
        console.log('[TrainDefect] Sample already exists in training data - skipping');
        return { success: true, skipped: true };
      }
      
      throw new Error(`Nyckel Error: ${errorText}`);
    }

    return { success: true };
  } catch (error) {
    console.error("Training Error:", error);
    return { success: false, error: (error as Error).message };
  }
}
