import express from "express";
import multer from "multer";
import axios from "axios";
import cors from "cors";
import fs from "fs";
import dotenv from "dotenv";
import FormData from "form-data";

dotenv.config();

const app = express();

// ✅ Improved CORS configuration
const allowedOrigins = [
  "https://background-remover-fronten.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001"
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  preflightContinue: false,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.use(express.json());

// ✅ Health check endpoint
app.get("/", (req, res) => {
  res.json({ status: "Server is running", timestamp: new Date().toISOString() });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "OK", service: "Background Remover API" });
});

// ✅ Set up Multer with error handling
const upload = multer({ 
  dest: "uploads/",
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG and WEBP are allowed.'));
    }
  }
});

// ✅ Background remove route with better error handling
app.post("/api/remove-bg", upload.single("image"), async (req, res) => {
  let imagePath = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({ 
        error: "No image uploaded",
        message: "Please select an image file"
      });
    }

    imagePath = req.file.path;
    console.log("Processing image:", req.file.originalname);

    // ✅ Prepare form-data to send to Remove.bg
    const formData = new FormData();
    formData.append("image_file", fs.createReadStream(imagePath));
    formData.append("size", "auto");

    // ✅ Send image to Remove.bg API with timeout
    const result = await axios.post(
      "https://api.remove.bg/v1.0/removebg", 
      formData, 
      {
        headers: {
          ...formData.getHeaders(),
          "X-Api-Key": process.env.REMOVEBG_API_KEY,
        },
        responseType: "arraybuffer",
        timeout: 30000, // 30 second timeout
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );

    // ✅ Convert result to base64 for React
    const imageBase64 = Buffer.from(result.data).toString("base64");

    // ✅ Clean up temp file
    if (imagePath && fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }

    // ✅ Send processed image back to frontend
    res.json({ 
      success: true,
      image: `data:image/png;base64,${imageBase64}`,
      message: "Background removed successfully"
    });

  } catch (error) {
    // ✅ Clean up temp file on error
    if (imagePath && fs.existsSync(imagePath)) {
      try {
        fs.unlinkSync(imagePath);
      } catch (unlinkError) {
        console.error("Error deleting temp file:", unlinkError);
      }
    }

    console.error("Error details:", {
      message: error.message,
      response: error.response?.data?.toString(),
      status: error.response?.status
    });

    // ✅ Better error messages
    let errorMessage = "Failed to remove background";
    let statusCode = 500;

    if (error.response) {
      statusCode = error.response.status;
      
      if (error.response.status === 403) {
        errorMessage = "Invalid API key or insufficient credits";
      } else if (error.response.status === 400) {
        errorMessage = "Invalid image format or size";
      } else if (error.response.data?.errors) {
        errorMessage = error.response.data.errors[0]?.title || errorMessage;
      }
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = "Request timeout. Please try again.";
      statusCode = 408;
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      errorMessage = "Cannot connect to background removal service";
      statusCode = 503;
    }

    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ✅ Error handling middleware
app.use((err, req, res, next) => {
  console.error("Global error handler:", err);
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: "File too large. Maximum size is 10MB" });
    }
    return res.status(400).json({ error: err.message });
  }
  
  res.status(500).json({ 
    error: "Internal server error",
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ✅ 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ✅ Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/api/health`);
});