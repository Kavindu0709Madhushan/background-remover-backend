import express from "express";
import multer from "multer";
import axios from "axios";
import cors from "cors";
import fs from "fs";
import dotenv from "dotenv";
import FormData from "form-data";

dotenv.config();

const app = express();

// ✅ FIXED: Simpler CORS configuration that allows your frontend
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, curl)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      "https://background-remover-frontview.vercel.app",
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:5173",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:5173"
    ];
    
    // Check if origin is allowed
    if (allowedOrigins.some(allowed => origin.startsWith(allowed))) {
      callback(null, true);
    } else if (process.env.NODE_ENV !== "production") {
      // Allow all origins in development
      callback(null, true);
    } else {
      console.warn(`⚠️  Blocked by CORS: ${origin}`);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ✅ Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - Origin: ${req.headers.origin || 'none'}`);
  next();
});

// ✅ Health check endpoints
app.get("/", (req, res) => {
  res.json({ 
    status: "Server is running", 
    timestamp: new Date().toISOString(),
    apiKey: process.env.PIXIAN_API_KEY ? "Configured ✓" : "Missing ✗",
    endpoints: {
      health: "/api/health",
      removeBackground: "/api/remove-bg"
    }
  });
});

app.get("/api/health", (req, res) => {
  res.json({ 
    status: "OK", 
    service: "Pixian Background Remover API",
    timestamp: new Date().toISOString(),
    pixianKey: process.env.PIXIAN_API_KEY ? "Configured" : "Missing"
  });
});

// ✅ Create uploads directory if it doesn't exist
const uploadsDir = "./uploads";
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log("✓ Created uploads directory");
}

// ✅ Multer configuration with better error handling
const upload = multer({
  dest: "uploads/",
  limits: { 
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    
    console.log("📤 File received:", {
      name: file.originalname,
      type: file.mimetype,
      size: `${(file.size / 1024).toFixed(2)} KB`
    });
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only JPEG, PNG and WEBP are allowed."));
    }
  },
});

// ✅ Background removal route
app.post("/api/remove-bg", upload.single("image"), async (req, res) => {
  let imagePath = null;

  try {
    // Validate API key
    if (!process.env.PIXIAN_API_KEY) {
      console.error("❌ PIXIAN_API_KEY not configured");
      return res.status(500).json({
        success: false,
        error: "Server configuration error",
        message: "Pixian API key is not configured"
      });
    }

    // Validate file upload
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No image uploaded",
        message: "Please select an image file",
      });
    }

    imagePath = req.file.path;
    console.log(`✓ Processing: ${req.file.originalname} (${(req.file.size / 1024).toFixed(2)} KB)`);

    // Verify file exists
    if (!fs.existsSync(imagePath)) {
      throw new Error("Uploaded file not found on server");
    }

    // Prepare FormData for Pixian API
    const formData = new FormData();
    formData.append("image", fs.createReadStream(imagePath));

    console.log("→ Sending to Pixian API...");

    // Call Pixian API
    const result = await axios.post(
      "https://api.pixian.ai/api/v2/remove-background", 
      formData, 
      {
        headers: {
          ...formData.getHeaders(),
          "Authorization": `Bearer ${process.env.PIXIAN_API_KEY}`,
        },
        responseType: "arraybuffer",
        timeout: 60000, // 60 seconds
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        validateStatus: (status) => status >= 200 && status < 500
      }
    );

    // Handle API response
    if (result.status !== 200) {
      const errorText = Buffer.from(result.data).toString('utf-8');
      console.error(`❌ Pixian API error (${result.status}):`, errorText);
      
      let errorMessage = "Failed to remove background";
      if (result.status === 401 || result.status === 403) {
        errorMessage = "Invalid Pixian API key";
      } else if (result.status === 429) {
        errorMessage = "Rate limit exceeded. Please try again later.";
      } else if (result.status === 402) {
        errorMessage = "Pixian API credits exhausted";
      } else if (result.status === 400) {
        errorMessage = "Invalid image format";
      }
      
      throw new Error(errorMessage);
    }

    console.log("✓ Successfully processed by Pixian API");

    // Convert to base64
    const imageBase64 = Buffer.from(result.data).toString("base64");

    // Clean up temp file
    if (imagePath && fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
      console.log("✓ Cleaned up temp file");
    }

    // Send response
    res.json({
      success: true,
      image: `data:image/png;base64,${imageBase64}`,
      message: "Background removed successfully",
    });

  } catch (error) {
    // Clean up temp file on error
    if (imagePath && fs.existsSync(imagePath)) {
      try {
        fs.unlinkSync(imagePath);
        console.log("✓ Cleaned up temp file after error");
      } catch (unlinkError) {
        console.error("❌ Error deleting temp file:", unlinkError.message);
      }
    }

    console.error("❌ Error processing image:", {
      message: error.message,
      code: error.code,
      status: error.response?.status
    });

    let errorMessage = "Failed to remove background";
    let statusCode = 500;

    // Handle specific error types
    if (error.response) {
      statusCode = error.response.status;
      
      if (error.response.status === 401 || error.response.status === 403) {
        errorMessage = "Invalid or expired Pixian API key";
      } else if (error.response.status === 400) {
        errorMessage = "Invalid image format or corrupted file";
      } else if (error.response.status === 429) {
        errorMessage = "Rate limit exceeded. Please try again later.";
        statusCode = 429;
      } else if (error.response.status === 402) {
        errorMessage = "Pixian API credits exhausted";
      }
    } else if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
      errorMessage = "Request timeout. Please try with a smaller image.";
      statusCode = 408;
    } else if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
      errorMessage = "Cannot connect to Pixian service";
      statusCode = 503;
    } else if (error.message) {
      errorMessage = error.message;
    }

    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ✅ Error handling middleware
app.use((err, req, res, next) => {
  console.error("❌ Global error:", err.message);
  
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ 
        success: false,
        error: "File too large. Maximum size is 10MB" 
      });
    }
    return res.status(400).json({ 
      success: false,
      error: err.message 
    });
  }

  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({
      success: false,
      error: "CORS error: Origin not allowed"
    });
  }

  res.status(500).json({
    success: false,
    error: "Internal server error",
    message: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// ✅ 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false,
    error: "Route not found",
    path: req.path,
    availableEndpoints: ["/", "/api/health", "/api/remove-bg"]
  });
});

// ✅ Start server
const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════╗
║   🚀 Background Remover API Server                ║
╠════════════════════════════════════════════════════╣
║   📍 Port: ${PORT.toString().padEnd(39)} ║
║   🔗 Health: http://localhost:${PORT}/api/health${' '.repeat(13)}║
║   🔑 Pixian Key: ${(process.env.PIXIAN_API_KEY ? 'Configured ✓' : 'Missing ✗').padEnd(30)} ║
║   🌍 Environment: ${(process.env.NODE_ENV || 'development').padEnd(29)} ║
╚════════════════════════════════════════════════════╝
  `);
});

// Handle server errors
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use`);
    process.exit(1);
  } else {
    console.error('❌ Server error:', error);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n⚠️  SIGTERM received: closing HTTP server');
  server.close(() => {
    console.log('✓ HTTP server closed');
    
    // Clean up uploads directory
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir);
      files.forEach(file => {
        try {
          fs.unlinkSync(`${uploadsDir}/${file}`);
        } catch (err) {
          console.error(`Failed to delete ${file}:`, err.message);
        }
      });
    }
    
    process.exit(0);
  });
});

// Clean up old uploads on startup
if (fs.existsSync(uploadsDir)) {
  const files = fs.readdirSync(uploadsDir);
  files.forEach(file => {
    try {
      fs.unlinkSync(`${uploadsDir}/${file}`);
    } catch (err) {
      // Ignore errors
    }
  });
  console.log("✓ Cleaned up old uploads");
}

export default app;