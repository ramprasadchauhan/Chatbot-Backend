const multer = require("multer");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const cors = require("cors");
const express = require("express");
const csv = require("csv-parser");
const pdfParse = require("pdf-parse");
const xlsx = require("xlsx");
const { GoogleGenerativeAI } = require("@google/generative-ai");
dotenv.config();
const genAI = new GoogleGenerativeAI(process.env.GEMENI_API);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const { uploadFileToDrive, downloadFile, listDriveFiles } = require("./drive");

const uploadDir = path.join(__dirname, "./uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  // console.log(`Created upload directory at ${uploadDir}`);
}
const upload = multer({ dest: uploadDir });

let combinedFileData = []; // Array of objects, each containing file data and file name

async function processAllFilesInDriveFolder(folderId, credentials) {
  try {
    const files = await listDriveFiles(folderId, credentials);
    // console.log("Files fetched from Drive:", files);
    const allFileDataPromises = files.map((file) =>
      processFileFromDrive(file.id, file.name, credentials)
    );
    const allFileData = await Promise.all(allFileDataPromises);
    combinedFileData = allFileData; // Array of objects with file data and names
  } catch (error) {
    console.error("Error processing all files in Drive folder:", error);
  }
}

// File Upload Endpoint
app.post("/api/v1/upload", upload.single("file"), async (req, res) => {
  const { client_email, private_key, folderId } = req.body;
  const credentials = { client_email, private_key };
  const file = req.file;

  if (!file) {
    return res.status(400).send("No file uploaded.");
  }

  const filePath = file.path;
  try {
    const driveFile = await uploadFileToDrive(file, credentials, folderId);
    fs.unlinkSync(filePath); // Delete the temporary file after uploading to Drive

    const fileData = await processFileFromDrive(
      driveFile.id,
      driveFile.name,
      credentials
    );
    combinedFileData.push(fileData); // Add new file data to combined data

    res.json({
      message: "File uploaded to Drive and processed successfully!",
      data: fileData,
    });
  } catch (error) {
    console.error("Error processing file:", error);
    res.status(500).send("Error processing file.");
  }
});

// Endpoint to list files in the specified Google Drive folder
app.post("/api/v1/list-files", async (req, res) => {
  const { client_email, private_key, folderId } = req.body;
  const credentials = { client_email, private_key };

  try {
    const files = await listDriveFiles(folderId, credentials);
    res.json({
      message: "Files listed successfully!",
      files: files,
    });
  } catch (error) {
    console.error("Error listing files:", error);
    res.status(500).send("Error listing files.");
  }
});

function readCSV(filePath) {
  return new Promise((resolve, reject) => {
    const data = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (row) => data.push(row))
      .on("end", () => resolve(data))
      .on("error", reject);
  });
}

function readExcel(filePath) {
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return xlsx.utils.sheet_to_json(sheet);
}

async function readPDF(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const pdfData = await pdfParse(dataBuffer);
  return pdfData.text.split("\n").map((line) => ({ text: line }));
}

async function processFileFromDrive(fileId, fileName, credentials) {
  const filePath = await downloadFile(fileId, credentials);
  let fileData;
  console.log("FilePath", filePath);
  const mimeType = path.extname(filePath);
  console.log("mimeType", mimeType);

  if (mimeType.includes("csv")) {
    fileData = await readCSV(filePath);
  } else if (mimeType.includes("xlsx") || mimeType.includes("xls")) {
    fileData = readExcel(filePath);
  } else if (mimeType === ".pdf") {
    fileData = await readPDF(filePath);
  } else {
    throw new Error("Unsupported file type.");
  }

  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    console.error("Error deleting downloaded file:", error);
  }

  return { fileName, fileData };
}

// Question Answering Endpoint
app.post("/api/v1/answer", async (req, res) => {
  const { client_email, private_key, folderId, question } = req.body;
  const credentials = { client_email, private_key };

  await processAllFilesInDriveFolder(folderId, credentials);

  const dataSummary = combinedFileData.map((file) => ({
    fileName: file.fileName,
    fileData: JSON.stringify(file.fileData, null, 2), // Pretty-print JSON
  }));

  const prompt = `Based on the following data, answer the question accurately and not more tahn 100 words:
  ${dataSummary
    .map((file) => `\n\nFile: ${file.fileName}\nData: ${file.fileData}`)
    .join("\n\n")}
  \n\nQuestion: ${question}`;

  try {
    const response = await generateGeminiResponse(prompt);
    res.json({ answer: response });
  } catch (error) {
    console.error("Error generating answer:", error);
    res.status(500).json({ answer: "Error generating answer" });
  }
});

app.post("/api/v1/generate-prompt", async (req, res) => {
  try {
    const { data } = req.body;
    if (!data) {
      return res.status(400).send({ error: "Missing data in request body" });
    }

    // Assuming geminiGenerate is a function that takes input data and returns a generated prompt

    const prompt = await generateGeminiResponse(data);

    res.status(200).send({ prompt });
  } catch (error) {
    console.error("Error generating prompt:", error);
    res.status(500).send({ error: "Failed to generate prompt" });
  }
});

async function generateGeminiResponse(prompt) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContentStream(prompt);
    const response = await result.response;
    const text = response.text();
    console.log(text);

    return text;
  } catch (error) {
    console.error("Error generating response:", error);
    throw new Error("Error generating response");
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
