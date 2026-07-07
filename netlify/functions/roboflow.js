const axios = require("axios");

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const imageBase64 = body.imageBase64 || body.image || "";

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

    const response = await axios({
      method: "POST",
      url: "https://serverless.roboflow.com/asl-vp1tt/1",
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
    console.error(error);

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        error: error.message || "Roboflow request failed"
      })
    };
  }
};
