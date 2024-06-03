const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const SCOPES = ["https://www.googleapis.com/auth/drive"];

async function createAuth(credentials) {
  return new google.auth.GoogleAuth({
    scopes: SCOPES,
    credentials: {
      client_email: credentials.client_email,
      private_key: credentials.private_key,
    },
  }).getClient();
}

async function uploadFileToDrive(file, credentials, folderId) {
  const authClient = await createAuth(credentials);
  const drive = google.drive({ version: "v3", auth: authClient });

  const filePath = path.join(__dirname, "uploads", file.filename);
  const fileMetadata = {
    name: file.originalname,
    parents: [folderId],
  };
  const media = {
    mimeType: file.mimetype,
    body: fs.createReadStream(filePath),
  };

  const response = await drive.files.create({
    resource: fileMetadata,
    media: media,
    fields: "id, name",
  });

  console.log("File uploaded to Google Drive:", response.data);
  return response.data;
}

async function downloadFile(fileId, credentials) {
  const authClient = await createAuth(credentials);
  const drive = google.drive({ version: "v3", auth: authClient });
  const downloadsDir = path.join(__dirname, "downloads");

  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
  }

  const metadata = await drive.files.get({ fileId, fields: "name" });
  const fileName = metadata.data.name;
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
          console.log("File downloaded successfully:", filePath);
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

async function listDriveFiles(folderId, credentials) {
  const authClient = await createAuth(credentials);
  const drive = google.drive({ version: "v3", auth: authClient });

  const response = await drive.files.list({
    q: `'${folderId}' in parents`,
    fields: "files(id, name)",
  });

  return response.data.files;
}

module.exports = {
  uploadFileToDrive,
  downloadFile,
  listDriveFiles,
};
