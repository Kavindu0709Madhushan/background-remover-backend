import express from "express";
import multer from "multer";
import axios from "axios";
import cors from "cors";
import fs from "fs";
import dotenv from "dotenv";
import FormData from "form-data"; // ✅ You missed this import

dotenv.config();
const app = express();

// ✅ Enable CORS for your React app
app.use(cors({
  origin: "https://background-remover-fronten.vercel.app",
  methods: ["GET", "POST"],
  credentials: true
}));

app.use(express.json());

// ✅ Set up Multer for file uploads
const upload = multer({ dest: "uploads/" });

// ✅ Background remove route
app.post("/api/remove-bg", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image uploaded" });
    }

    const imagePath = req.file.path;

    // ✅ Prepare form-data to send to Remove.bg
    const formData = new FormData();
    formData.append("image_file", fs.createReadStream(imagePath));
    formData.append("size", "auto");

    // ✅ Send image to Remove.bg API
    const result = await axios.post("https://api.remove.bg/v1.0/removebg", formData, {
      headers: {
        ...formData.getHeaders(),
        "X-Api-Key": process.env.REMOVEBG_API_KEY,
      },
      responseType: "arraybuffer",
    });

    // ✅ Convert result to base64 for React
    const imageBase64 = Buffer.from(result.data).toString("base64");

    // ✅ Clean up temp file
    fs.unlinkSync(imagePath);

    // ✅ Send processed image back to frontend
    res.json({ image: `data:image/png;base64,${imageBase64}` });

  } catch (error) {
    console.error("Error:", error.response?.data || error.message);
    res.status(500).json({
      error: error.response?.data?.errors?.[0]?.title || "Failed to remove background.",
    });
  }
});

// ✅ Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
