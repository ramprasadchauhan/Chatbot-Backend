const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const dotenv = require("dotenv");
dotenv.config();

const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];

const auth = new google.auth.GoogleAuth({
  scopes: SCOPES,
  credentials: {
    client_email: process.env.CLIENT_EMAIL,
    private_key: process.env.PRIVATE_KEY,
  },
});

async function downloadFile(fileId, fileName) {
  const authClient = await auth.getClient();
  const drive = google.drive({ version: "v3", auth: authClient });
  const downloadsDir = path.join(__dirname, "downloads");

  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
  }

  const filePath = path.join(downloadsDir, fileName);
  const dest = fs.createWriteStream(filePath);

  await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" },
    (err, res) => {
      if (err) {
        console.error("Error downloading file:", err);
        return;
      }
      res.data
        .on("end", () => {
          console.log("File downloaded successfully:", filePath); // Added file path logging
        })
        .on("error", (err) => {
          console.error("Error downloading file:", err);
        })
        .pipe(dest);
    }
  );

  return new Promise((resolve, reject) => {
    dest.on("finish", () => resolve(filePath));
    dest.on("error", reject);
  });
}

module.exports = { downloadFile };
