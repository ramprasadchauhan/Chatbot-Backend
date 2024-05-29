const express = require("express");
const multer = require("multer");
const fs = require("fs");
const csv = require("csv-parser");
const pdfParse = require("pdf-parse");
const xlsx = require("xlsx");
const dotenv = require("dotenv");
const cors = require("cors");
const path = require("path");

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { downloadFile } = require("./googleDrive");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
const genAI = new GoogleGenerativeAI(process.env.GEMENI_API);

const uploadDir = path.join(__dirname, "./uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log(`Created upload directory at ${uploadDir}`);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage: storage });

let processedFileData = [];

// File Upload Endpoint
app.post("/upload", upload.single("file"), async (req, res) => {
  const file = req.file;
  console.log("Received file:", file);

  if (!file) {
    return res.status(400).send("No file uploaded.");
  }

  const filePath = path.join(uploadDir, file.filename);
  console.log("File path:", filePath);

  try {
    let fileData;
    if (file.mimetype.includes("csv")) {
      fileData = await readCSV(filePath);
    } else if (
      file.mimetype.includes("excel") ||
      file.mimetype.includes("spreadsheet")
    ) {
      fileData = readExcel(filePath);
    } else if (file.mimetype === "application/pdf") {
      fileData = await readPDF(filePath);
    } else {
      return res.status(400).send("Unsupported file type.");
    }

    processedFileData = processFileData(fileData);
    console.log("Processed File Data:", processedFileData);

    res.json({
      message: "File uploaded and processed successfully!",
      data: processedFileData,
    });
  } catch (error) {
    console.error("Error processing file:", error);
    res.status(500).send("Error processing file.");
  }
});

app.post("/upload-from-drive", async (req, res) => {
  const { fileId } = req.body;

  if (!fileId) {
    return res.status(400).send("No file ID provided.");
  }

  try {
    const filePath = await downloadFile(fileId, `drive-file-${Date.now()}.pdf`);
    console.log("Downloaded file path:", filePath); // Log the file path

    let fileData;
    const mimeType = path.extname(filePath);

    if (mimeType.includes("csv")) {
      fileData = await readCSV(filePath);
    } else if (mimeType.includes("xlsx") || mimeType.includes("xls")) {
      fileData = readExcel(filePath);
    } else if (mimeType === ".pdf") {
      fileData = await readPDF(filePath);
    } else {
      return res.status(400).send("Unsupported file type.");
    }

    processedFileData = processFileData(fileData);
    console.log("Processed File Data:", processedFileData);

    res.json({
      message: "File fetched from Drive and processed successfully!",
      data: processedFileData,
    });
  } catch (error) {
    console.error("Error processing file from Drive:", error);
    res.status(500).send("Error processing file from Drive.");
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

function processFileData(fileData) {
  // Example processing: converting all values to uppercase
  return fileData.map((row) => {
    const processedRow = {};
    for (const key in row) {
      processedRow[key] = String(row[key]).toUpperCase();
    }
    return processedRow;
  });
}

// Question Answering Endpoint
app.post("/answer", async (req, res) => {
  const { question } = req.body;

  if (!processedFileData || processedFileData.length === 0) {
    return res
      .status(400)
      .json({ answer: "Please provide a file for related questions." });
  }

  // Create a context or summary from processedFileData
  const dataSummary = JSON.stringify(processedFileData);

  const prompt = `Based on the following data: ${dataSummary}, answer the following question with correct alignment and use new line according to requirement : ${question}`;
  try {
    const response = await generateGeminiResponse(prompt);
    res.json({ answer: response });
  } catch (error) {
    console.error("Error generating answer:", error);
    res.status(500).json({ answer: "Error generating answer" });
  }
});

// Function to send prompt to Gemini API
async function generateGeminiResponse(prompt) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    console.log(text);
    return text;
  } catch (error) {
    console.error("Error generating response:", error);
    throw new Error("Error generating response");
  }
}

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
