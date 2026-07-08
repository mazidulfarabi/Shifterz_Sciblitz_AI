const axios = require("axios");
const fs = require("fs");
const path = require("path");

const imagePath = process.argv[2];

if (!imagePath) {
  console.error("Usage: node scripts/run-image-inference.js <image-path-or-url>");
  process.exit(1);
}

async function main() {
  const apiKey = process.env.ROBOFLOW_API_KEY;
  if (!apiKey) {
    console.error("Set ROBOFLOW_API_KEY before running this script.");
    process.exit(1);
  }

  let imageData;
  let contentType = "application/x-www-form-urlencoded";

  if (/^https?:\/\//i.test(imagePath)) {
    const response = await axios.get(imagePath, { responseType: "arraybuffer" });
    imageData = Buffer.from(response.data).toString("base64");
  } else {
    const resolvedPath = path.resolve(process.cwd(), imagePath);
    imageData = fs.readFileSync(resolvedPath, { encoding: "base64" });
  }

  const response = await axios({
    method: "POST",
    url: "https://serverless.roboflow.com/american-sign-language-letters/6",
    params: {
      api_key: apiKey
    },
    data: imageData,
    headers: {
      "Content-Type": contentType
    },
    timeout: 120000
  });

  console.log(JSON.stringify(response.data, null, 2));
}

main().catch((error) => {
  console.error(error.response?.data || error.message || error);
  process.exit(1);
});
