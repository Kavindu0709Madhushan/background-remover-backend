import express from "express";
import multer from "multer";
import axios from "axios";
import cors from "cors";
import fs from "fs";
import dotenv from "dotenv";
import FormData from "form-data";

dotenv.config();

const app = express();

// ✅ CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    const allowedOrigins = [
      "https://background-remover-frontview.vercel.app",
      "http://localhost:3000",
      "http://127.0.0.1:5173",
      "http://localhost:5173"
    ];
    if (allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};
app.use(cors(corsOptions));

// ✅ Body parsing
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ✅ Multer (file upload)
const upload = multer({ dest: "uploads/" });

// ✅ Health check
app.get("/", (req, res) => {
  res.json({
    status: "Server is running",
    service: "Pixian.AI Background Remover",
    apiConfigured: !!process.env.PIXIAN_API_ID && !!process.env.PIXIAN_API_SECRET,
  });
});

// ✅ Background removal route
app.post("/api/remove-bg", upload.single("image"), async (req, res) => {
  let imagePath;
  try {
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });
    imagePath = req.file.path;

    // ✅ Prepare authentication
    const auth = Buffer.from(
      `${process.env.PIXIAN_API_ID}:${process.env.PIXIAN_API_SECRET}`
    ).toString("base64");

    // ✅ Prepare FormData
    const formData = new FormData();
    formData.append("image", fs.createReadStream(imagePath));

    console.log("→ Sending to Pixian API...");

    // ✅ Call Pixian API
    const result = await axios.post(
      "https://api.pixian.ai/api/v2/remove-background",
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Basic ${auth}`, // 🔥 Correct authentication format
        },
        responseType: "arraybuffer",
      }
    );

    // ✅ Convert result to base64
    const imageBase64 = Buffer.from(result.data).toString("base64");

    // ✅ Clean up temporary file
    fs.unlinkSync(imagePath);

    // ✅ Send response
    res.json({
      success: true,
      image: `data:image/png;base64,${imageBase64}`,
    });
  } catch (error) {
    if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);

    console.error("❌ Error:", error.response?.status, error.message);
    if (error.response?.status === 402)
      return res.status(402).json({ error: "Pixian credits exhausted" });
    if (error.response?.status === 401)
      return res.status(401).json({ error: "Invalid Pixian API credentials" });

    res.status(500).json({ error: "Failed to remove background" });
  }
});

// ✅ 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ✅ Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
