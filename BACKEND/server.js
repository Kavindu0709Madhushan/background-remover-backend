import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import { Rembg } from "rembg";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// ✅ Allowed origins for frontend
const allowedOrigins = [
  "https://background-remover-frontview.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001"
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.use(express.json());

// ✅ Health check
app.get("/", (req, res) => {
  res.json({ status: "Server is running", timestamp: new Date().toISOString() });
});

// ✅ Setup Multer
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Invalid file type. Only JPG, PNG, WEBP allowed."));
  },
});

// ✅ Background remove route using local AI model
app.post("/api/remove-bg", upload.single("image"), async (req, res) => {
  let imagePath = null;
  const rembg = new Rembg(); // initialize model

  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image uploaded" });
    }

    imagePath = req.file.path;
    console.log("🧠 Processing:", req.file.originalname);

    // 🧩 Read file and remove background
    const input = fs.readFileSync(imagePath);
    const output = await rembg.remove(input);

    // ✅ Convert output to base64 for frontend
    const imageBase64 = Buffer.from(output).toString("base64");

    // 🧹 Remove temp file
    fs.unlinkSync(imagePath);

    res.json({
      success: true,
      image: `data:image/png;base64,${imageBase64}`,
      message: "Background removed successfully (Local AI)",
    });
  } catch (error) {
    console.error("Error:", error);
    if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    res.status(500).json({
      success: false,
      error: "Failed to remove background",
      details: error.message,
    });
  }
});

// ✅ Error handler
app.use((err, req, res, next) => {
  console.error("Global error:", err);
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File too large (max 10MB)" });
    }
  }
  res.status(500).json({ error: err.message });
});

// ✅ 404
app.use((req, res) => res.status(404).json({ error: "Route not found" }));

// ✅ Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Local Background Remover running on port ${PORT}`);
  console.log(`📍 Test at: http://localhost:${PORT}/api/remove-bg`);
});
