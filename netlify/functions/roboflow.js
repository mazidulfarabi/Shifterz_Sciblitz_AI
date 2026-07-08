const axios = require("axios");

function normalizeImageBase64(value) {
  if (!value) {
    return "";
  }

  const dataUrlMatch = value.match(/^data:(image\/\w+);base64,(.+)$/i);
  if (dataUrlMatch) {
    return dataUrlMatch[2];
  }

  return value;
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const imageBase64 = normalizeImageBase64(body.imageBase64 || body.image || "");
    const mimeType = body.mimeType || "image/jpeg";

    if (!imageBase64) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing imageBase64 payload" })
      };
    }

    const apiKey = process.env.ROBOFLOW_API_KEY;

    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "ROBOFLOW_API_KEY is not configured" })
      };
    }

    if (!imageBase64) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid image payload" })
      };
    }

    const inferenceUrls = [
      "https://serverless.roboflow.com/sign-language-words-wenlz/1",
      "https://detect.roboflow.com/sign-language-words-wenlz/1"
    ];

    let lastError;

    for (const inferenceUrl of inferenceUrls) {
      try {
        const response = await axios({
          method: "POST",
          url: inferenceUrl,
          params: {
            api_key: apiKey
          },
          data: imageBase64,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          },
          timeout: 60000
        });

        return {
          statusCode: 200,
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(response.data)
        };
      } catch (error) {
        lastError = error;
        if (error.response?.status && [400, 404].includes(error.response.status)) {
          continue;
        }
        throw error;
      }
    }

    throw lastError;
  } catch (error) {
    console.error(error);

    const upstreamMessage = error.response?.data?.message || error.response?.data?.error || error.message || "Roboflow request failed";

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        error: upstreamMessage
      })
    };
  }
};
